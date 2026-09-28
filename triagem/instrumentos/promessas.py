#!/usr/bin/env python3
"""promessas.py — o que a triagem prometeu por escrito e não entregou.

    python3 triagem/instrumentos/promessas.py [--abertos] [--json]
    python3 triagem/instrumentos/promessas.py 1134 1130 [--json]

Lê TODOS os comentários da conta do mantenedor (conversa, revisões e comentários de
linha), acha os compromissos explícitos e confere cada um contra ARTEFATO criado
depois dele: commit da casa na branch do PR, PR nosso que cita o número, issue
nossa que cita o número.

  cumprida       há artefato depois da promessa (commit na branch, PR nosso mesclado,
                 ou a issue prometida)
  parcial        há movimento, não entrega (PR nosso ainda aberto, issue quando o
                 prometido era código)
  não cumprida   nada depois da promessa
  dispensada     oferta condicional que o autor respondeu fazendo (conta como cumprida)

Dois falsos positivos que ele distingue:
  - oferta CONDICIONAL ("se preferir, nós fazemos") com silêncio do autor CONTA como
    promessa em aberto — o dono decidiu que não se espera contribuidor para trabalho
    que é da casa;
  - pergunta de desenho ao autor NÃO conta: a bola é dele.

E o caso mais caro: branch que existe no disco e `git ls-remote` não devolve — trabalho
pronto que não chegou a ninguém.

Saída: 0 = nada em aberto · 1 = há promessa não cumprida ou parcial, ou branch represada ·
2 = NÃO MEDIDO.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
from datetime import datetime
from typing import Any, Optional

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from medicao import NaoMedido, exigir, executar  # noqa: E402


def normalizar(texto: str) -> str:
    """Minúsculo e sem acento: "nós fazemos" e "nos fazemos" casam igual."""
    return "".join(c for c in unicodedata.normalize("NFD", texto.lower()) if unicodedata.category(c) != "Mn")


# Compromissos explícitos, medidos nos comentários da triagem (normalizados, sem acento).
COMPROMISSOS = [
    r"\b(a gente|nos) (vai \w+|vamos \w+|faz|fazemos|cuida|cuidamos|resolve|resolvemos|renumera|renumeramos|"
    r"escreve|escrevemos|empurra|empurramos|abre|abrimos|assume|assumimos|porta|portamos|traz|trazemos|"
    r"monta|montamos|prepara|preparamos|entrega|entregamos|leva|levamos|conserta|consertamos|corrige|corrigimos)\b",
    r"\b(e|fica) (trabalho )?(nosso|da casa)\b",
    r"\b(trabalho|divida|conserto|bloqueador|pendencia|renumeracao|parte) (e|que e|fica) (nosso|nossa|da casa)\b",
    r"\bo que e nosso\b",
    r"\bnao e pedido de trabalho para voce\b",
    r"(?<!que )\beu (empurro|faco|escrevo|abro|assumo|ligo|trago|resolvo|renumero|porto|aviso|volto|mando|reviso|rodo|"
    r"monto|preparo|entrego)\b",   # sem "corrijo"/"conserto": "aqui eu corrijo o que eu ia escrever" (#1134)
    r"\bvolto aqui\b|\bvolto com\b",
    r"\bvou (abrir|escrever|fazer|empurrar|conferir|revisar|rodar|voltar|portar|resolver|renumerar|mandar|"
    r"preparar|ligar|avisar|trazer)\b",
    # "como a casa faz com a Graph" descreve, não promete (medido no #1025): sem "faz".
    r"\ba casa (vai|resolve|abre|assume|conserta)\b",
    r"\bquando .{1,120}\b(nos|eu|a gente|a casa) (fazemos|faco|mesclamos|mesclo|empurramos|empurro|abrimos|abro|"
    r"ligamos|ligo|escrevemos|escrevo)\b",
    r"\bme diga qual\b",
    r"\buma palavra aqui\b",
]
RE_COMPROMISSO = re.compile("|".join(f"(?:{p})" for p in COMPROMISSOS))
# Negação no mesmo trecho: "não vou prometer prazo", "não é nosso".
RE_NEGACAO = re.compile(r"\bnao (vou|estou|vamos) promet|\bnao (e|fica) (nosso|da casa)\b|"
                        r"\bnao (vou|vamos) (fazer|empurrar|abrir|escrever)\b|\bsem promessa\b")
RE_CONDICIONAL = re.compile(r"\bse (preferir|quiser|voce (preferir|quiser))\b|\b(me )?diga\b|\buma palavra\b|"
                            r"\bse for (a|o) \w+\b")
RE_TIPO_ISSUE = re.compile(r"\bissue\b")
# Promessa de RETORNO ("volto com o veredito", "eu aviso"): o artefato que a cumpre é um
# comentário nosso posterior — não um commit. Commit não responde a quem esperava resposta.
RE_TIPO_RETORNO = re.compile(r"\bvolto\b|\bvoltar\b|\beu aviso\b|\bvou avisar\b|\btrago a resposta\b|"
                             r"\bvou (revisar|conferir|rodar)\b")
RE_BRANCH = re.compile(r"`((?:triagem|tri\d*|recorte|fix|feat|chore|docs)/[\w./-]+)`")


def trechos(texto: str) -> list[str]:
    """Frase a frase — a promessa e a negação têm de estar no MESMO trecho."""
    partes = re.split(r"(?<=[.!?])\s+|\n+", texto)
    return [p.strip() for p in partes if p.strip()]


def achar_promessas(texto: str) -> list[dict]:
    achadas = []
    for t in trechos(texto):
        # A negação apaga só o trecho NEGADO: "não vou prometer prazo, mas volto aqui"
        # ainda promete o retorno. Descartar a frase inteira calava a promessa real.
        n = RE_NEGACAO.sub(" ", normalizar(t))
        if not RE_COMPROMISSO.search(n):
            continue
        achadas.append({"trecho": t[:240], "condicional": bool(RE_CONDICIONAL.search(n)),
                        "promete_issue": bool(RE_TIPO_ISSUE.search(n)),
                        "promete_retorno": bool(RE_TIPO_RETORNO.search(n))})
    return achadas


def _iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


# ── fonte ───────────────────────────────────────────────────────────────────────

class FonteGitHub:
    def __init__(self, repo: str, raiz: str):
        self.repo, self.raiz = repo, raiz

    def _api_lista(self, caminho: str) -> list:
        saida = exigir(["gh", "api", "--paginate", "--slurp", caminho], limite_s=180)
        return [x for pagina in json.loads(saida) for x in pagina]

    def abertos(self) -> list[int]:
        s = exigir(["gh", "pr", "list", "--repo", self.repo, "--state", "open", "--limit", "300",
                    "--json", "number", "--jq", ".[].number"])
        return [int(x) for x in s.split()]

    def pr(self, n: int) -> dict:
        return json.loads(exigir(["gh", "pr", "view", str(n), "--repo", self.repo, "--json",
                                  "number,author,headRefName,headRefOid,state,createdAt"]))

    def comentarios(self, n: int) -> list[dict]:
        """Conversa + revisões + comentários de linha — a promessa mora em qualquer um."""
        todos = []
        for c in self._api_lista(f"repos/{self.repo}/issues/{n}/comments?per_page=100"):
            todos.append({"id": c["id"], "autor": c["user"]["login"], "quando": c["created_at"],
                          "texto": c.get("body") or "", "onde": "conversa"})
        for c in self._api_lista(f"repos/{self.repo}/pulls/{n}/reviews?per_page=100"):
            if c.get("submitted_at"):
                todos.append({"id": c["id"], "autor": c["user"]["login"], "quando": c["submitted_at"],
                              "texto": c.get("body") or "", "onde": "revisão"})
        for c in self._api_lista(f"repos/{self.repo}/pulls/{n}/comments?per_page=100"):
            todos.append({"id": c["id"], "autor": c["user"]["login"], "quando": c["created_at"],
                          "texto": c.get("body") or "", "onde": "linha"})
        return todos

    def commits(self, n: int) -> list[dict]:
        return [{"sha": c["sha"], "quando": c["commit"]["committer"]["date"],
                 "autor": (c.get("author") or {}).get("login") or c["commit"]["author"]["name"]}
                for c in self._api_lista(f"repos/{self.repo}/pulls/{n}/commits?per_page=100")]

    def nossos(self, mantenedor: str) -> dict:
        campos = "number,title,body,createdAt,state"
        prs = json.loads(exigir(["gh", "pr", "list", "--repo", self.repo, "--author", mantenedor, "--state",
                                 "all", "--limit", "500", "--json", campos + ",mergedAt,headRefName"], limite_s=180))
        issues = json.loads(exigir(["gh", "issue", "list", "--repo", self.repo, "--author", mantenedor,
                                    "--state", "all", "--limit", "500", "--json", campos], limite_s=180))
        return {"prs": prs, "issues": issues}

    def branches_remotas(self) -> list[str]:
        s = exigir(["git", "-C", self.raiz, "ls-remote", "--heads", "origin"], limite_s=90)
        return [l.split("refs/heads/", 1)[1] for l in s.splitlines() if "refs/heads/" in l]

    def substituta(self, branch: str, irmas: list[str]) -> Optional[str]:
        """A branch remota irmã que já tem TODOS os assuntos de commit desta."""
        meus = _assuntos(self.raiz, branch)
        if not meus:
            return None
        for rb in irmas:
            deles = _assuntos(self.raiz, f"refs/remotes/origin/{rb}")
            if deles is not None and meus <= deles:
                return rb
        return None

    def branches_locais(self) -> list[str]:
        return exigir(["git", "-C", self.raiz, "for-each-ref", "--format=%(refname:short)", "refs/heads"]).split()

    def a_frente_da_main(self, branch: str, head_do_pr: Optional[str] = None) -> int:
        """Commits NOSSOS da branch que nem a origin/main nem o head do PR têm.

        "Nosso" é pelo COMMITTER (o `user.email` deste clone): commit da triagem com
        `--author` do contribuidor ainda é commitado por nós, e a cópia local da branch
        de um contribuidor (`tri37/1067-repro`, commitada por ele) não é trabalho represado.
        """
        eu = executar(["git", "-C", self.raiz, "config", "user.email"]).saida.strip()
        if not eu:
            raise NaoMedido("git config user.email vazio: não há como separar commit nosso do alheio")
        # Publicado é o que qualquer ref REMOTA alcança (origin/*, pr/*, forks buscados) e
        # o head do PR quando ele está no clone. O que sobra só existe neste disco.
        # Remoto com URL de CAMINHO LOCAL (aqui: `local` → o checkout principal) não é
        # publicação: as branches dele são as deste mesmo disco, e contá-las como
        # publicadas escondia a represada do #714.
        excluir = [f"^{head_do_pr}"] if head_do_pr and executar(
            ["git", "-C", self.raiz, "cat-file", "-e", f"{head_do_pr}^{{commit}}"]).ok else []
        urls = executar(["git", "-C", self.raiz, "config", "--get-regexp", r"^remote\..*\.url$"]).saida
        locais = [l.split()[0][len("remote."):-len(".url")] for l in urls.splitlines()
                  if len(l.split()) == 2 and not re.match(r"^(https?://|git@|ssh://|git://)", l.split()[1])]
        saida = exigir(["git", "-C", self.raiz, "log", "--format=%ce", branch, *excluir, "--not",
                        *[f"--exclude={r}/*" for r in locais], "--remotes"])
        return sum(1 for l in saida.splitlines() if l.strip() == eu)


def _assuntos(raiz: str, ref: str) -> Optional[set]:
    r = executar(["git", "-C", raiz, "log", "--format=%s", ref, "^origin/main"])
    return set(r.saida.splitlines()) if r.ok else None


class FonteGravada:
    def __init__(self, dados: dict):
        self.dados = dados
        self.repo = dados.get("repo")

    def _get(self, k):
        if k not in self.dados:
            raise NaoMedido(f"fixture sem a chave {k}")
        return self.dados[k]

    def abertos(self): return self._get("abertos")
    def pr(self, n): return self._get(f"pr:{n}")
    def comentarios(self, n): return self._get(f"comentarios:{n}")
    def commits(self, n): return self._get(f"commits:{n}")
    def nossos(self, m): return self._get("nossos")
    def branches_remotas(self): return self._get("branches_remotas")
    def branches_locais(self): return self._get("branches_locais")
    def a_frente_da_main(self, b, head=None):
        v = self._get(f"a_frente:{b}")
        if isinstance(v, dict) and "nao_medido" in v:
            raise NaoMedido(v["nao_medido"])
        return v
    def substituta(self, b, irmas): return self._get(f"substituta:{b}")


class Gravador:
    def __init__(self, fonte):
        self.fonte, self.repo, self.dados = fonte, fonte.repo, {"repo": fonte.repo}

    def _g(self, k, fn, *a):
        v = fn(*a)
        self.dados[k] = v
        return v

    def abertos(self): return self._g("abertos", self.fonte.abertos)
    def pr(self, n): return self._g(f"pr:{n}", self.fonte.pr, n)
    def comentarios(self, n): return self._g(f"comentarios:{n}", self.fonte.comentarios, n)
    def commits(self, n): return self._g(f"commits:{n}", self.fonte.commits, n)
    def nossos(self, m): return self._g("nossos", self.fonte.nossos, m)
    def branches_remotas(self): return self._g("branches_remotas", self.fonte.branches_remotas)
    def branches_locais(self): return self._g("branches_locais", self.fonte.branches_locais)
    def a_frente_da_main(self, b, head=None):
        try:
            return self._g(f"a_frente:{b}", self.fonte.a_frente_da_main, b, head)
        except NaoMedido as e:
            self.dados[f"a_frente:{b}"] = {"nao_medido": e.motivo}
            raise
    def substituta(self, b, irmas): return self._g(f"substituta:{b}", self.fonte.substituta, b, irmas)


# ── a conferência ───────────────────────────────────────────────────────────────

def cita(n: int, texto: str) -> bool:
    return bool(re.search(rf"#{n}(?![0-9])", texto or ""))


def conferir_pr(fonte, n: int, mantenedor: str, nossos: dict, remotas: set, locais: set) -> dict:
    pr = fonte.pr(n)
    autor = (pr.get("author") or {}).get("login")
    comentarios = sorted(fonte.comentarios(n), key=lambda c: c["quando"])
    commits = fonte.commits(n)
    nossos_coments = [c for c in comentarios if c["autor"] == mantenedor]
    r: dict[str, Any] = {"pr": n, "autor": autor, "comentarios_nossos": len(nossos_coments), "promessas": []}

    for c in nossos_coments:
        for p in achar_promessas(c["texto"]):
            t = c["quando"]
            depois = _iso(t)
            commits_casa = [x for x in commits if _iso(x["quando"]) > depois and x["autor"] != autor]
            # Artefato nosso que cita o PR, criado DEPOIS da promessa — ou citado pelo
            # próprio comentário ("saiu no PR #1171"), que pode ser anterior a ele.
            citados_no_comentario = {int(x) for x in re.findall(r"#(\d+)", c["texto"])}
            prs = [x for x in nossos["prs"] if x["number"] != n and (
                   (_iso(x["createdAt"]) > depois and (cita(n, x.get("body")) or cita(n, x.get("title"))))
                   or x["number"] in citados_no_comentario)]
            # Issue só conta quando o prometido ERA a issue: issue que só menciona o PR
            # não é entrega de código (medido no #714: três issues citavam o número).
            issues = [x for x in nossos["issues"] if p["promete_issue"] and (
                      (_iso(x["createdAt"]) > depois and (cita(n, x.get("body")) or cita(n, x.get("title"))))
                      or x["number"] in citados_no_comentario)]
            do_autor = [x for x in comentarios if x["autor"] == autor and _iso(x["quando"]) > depois] + \
                       [x for x in commits if x["autor"] == autor and _iso(x["quando"]) > depois]
            mesclados = [x for x in prs if x.get("mergedAt")]
            retornos = [x for x in nossos_coments if _iso(x["quando"]) > depois]
            if p["promete_retorno"] and not p["promete_issue"]:
                commits_casa, mesclados, prs = [], [], []
                issues = retornos        # a "entrega" de um retorno é voltar a falar
            if p["condicional"] and do_autor and not (commits_casa or mesclados or issues or prs):
                # Oferta que o AUTOR respondeu fazendo: deixou de ser nossa (medido no #1067).
                estado = "dispensada"
            elif commits_casa or mesclados or issues:
                estado = "cumprida"
            elif prs:
                estado = "parcial"
            else:
                estado = "não cumprida"
            evid = ([f"commit {x['sha'][:9]} {x['quando']}" for x in commits_casa[:3]] +
                    [f"PR #{x['number']} ({'mesclado' if x.get('mergedAt') else x['state'].lower()})" for x in prs[:3]] +
                    [f"issue #{x['number']} ({x['state'].lower()})" if "number" in x
                     else f"comentário nosso {x['id']} {x['quando'][:16]}" for x in issues[:3]])
            item = p | {"comentario": c["id"], "onde": c["onde"], "quando": t, "estado": estado, "evidencia": evid}
            if p["condicional"]:
                item["autor_em_silencio"] = not do_autor
                # Oferta nossa com silêncio do autor é promessa em aberto (decisão do dono).
                item["conta"] = True
            r["promessas"].append(item)

    estados = {"cumprida" if p["estado"] == "dispensada" else p["estado"] for p in r["promessas"]}
    r["estado"] = ("nada prometido" if not estados else
                   "cumprida" if estados == {"cumprida"} else
                   "não cumprida" if estados == {"não cumprida"} else "parcial")

    # Branches citadas nos NOSSOS comentários e as que levam o número do PR no nome.
    citadas = {b for c in nossos_coments for b in RE_BRANCH.findall(c["texto"])}
    pelo_numero = {b for b in locais if re.search(rf"(?<![0-9]){n}(?![0-9])", b)}
    candidatas = sorted(b for b in (citadas | pelo_numero) if b in locais and b not in remotas)
    # Commits NOSSOS que nem a main nem o head do PR têm: o que está SÓ no disco. Uma
    # cópia local da branch do contribuidor (`pr-714`) não é represada — está no fork.
    r["represadas_detalhe"], r["represadas_nao_medidas"] = {}, {}
    for b in candidatas:
        try:
            k = fonte.a_frente_da_main(b, pr.get("headRefOid"))
        except NaoMedido as e:
            r["represadas_nao_medidas"][b] = e.motivo
            continue
        if k > 0:
            r["represadas_detalhe"][b] = k
    r["represadas"] = sorted(r["represadas_detalhe"])
    # Uma branch local pode ter sido REFEITA e empurrada com outro nome (rebase:
    # hashes novos, mesmos commits). Medido no #714: `triagem/714-smtp-como-opcao`
    # ficou no disco, e os mesmos três commits saíram em `triagem/714-smtp-atualizado`.
    r["substituidas"] = {}
    # Onde procurar: branch remota com o número no nome, ou head de PR nosso que cita
    # este (o conserto do #1134 saiu no #1171, numa branch sem "1134" no nome).
    irmas = sorted({rb for rb in remotas if re.search(rf"(?<![0-9]){n}(?![0-9])", rb)} |
                   {x["headRefName"] for x in nossos["prs"] if x.get("headRefName") in remotas
                    and (cita(n, x.get("body")) or cita(n, x.get("title")))})
    for b in list(r["represadas"]):
        por = fonte.substituta(b, irmas)
        if por:
            r["substituidas"][b] = por
            r["represadas"].remove(b)
    return r


def podar(dados: dict, prs: list[int]) -> dict:
    """A fixture guarda só os PRs/issues nossos que PODEM virar evidência destes PRs —
    os que citam um deles ou são citados por um comentário gravado —, com o corpo
    reduzido às linhas que têm `#`. O resultado da conferência não muda."""
    citados = {int(x) for k, v in dados.items() if k.startswith("comentarios:")
               for c in v for x in re.findall(r"#(\d+)", c["texto"])}

    def serve(x):
        return x["number"] in citados or any(cita(n, x.get("body")) or cita(n, x.get("title")) for n in prs)

    podado = dict(dados)
    podado["nossos"] = {k: [dict(x, body="\n".join(l for l in (x.get("body") or "").splitlines() if "#" in l))
                            for x in v if serve(x)] for k, v in dados["nossos"].items()}
    return podado


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("prs", nargs="*", type=int)
    ap.add_argument("--abertos", action="store_true", help="todos os PRs abertos (padrão sem números)")
    ap.add_argument("--mantenedor", default="melgarafael")
    ap.add_argument("--repo", default=os.environ.get("SONDA_REPO"))
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--gravar")
    ap.add_argument("--fixture")
    a = ap.parse_args(argv)
    raiz = executar(["git", "rev-parse", "--show-toplevel"]).saida.strip()
    try:
        if a.fixture:
            with open(a.fixture, encoding="utf-8") as f:
                fonte = FonteGravada(json.load(f))
        else:
            repo = a.repo or exigir(["gh", "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).strip()
            fonte = FonteGitHub(repo, raiz)
            if a.gravar:
                fonte = Gravador(fonte)
        prs = a.prs or fonte.abertos()
        remotas = set(fonte.branches_remotas())
        # Controle positivo do ls-remote: a main TEM de estar lá. Sem ela, "não está no
        # remoto" não distingue branch represada de sonda cega.
        if "main" not in remotas:
            raise NaoMedido(f"ls-remote não devolveu a main ({len(remotas)} heads) — a sonda está cega")
        locais = set(fonte.branches_locais())
        nossos = fonte.nossos(a.mantenedor)
        if not nossos["prs"]:
            raise NaoMedido(f"nenhum PR de {a.mantenedor} achado — a lista de artefatos está cega")
        resultados = [conferir_pr(fonte, n, a.mantenedor, nossos, remotas, locais) for n in prs]
    except NaoMedido as e:
        print(json.dumps({"resultado": "NÃO MEDIDO", "motivo": e.motivo}, ensure_ascii=False) if a.json
              else f"NÃO MEDIDO — {e.motivo}")
        return 2
    if a.gravar and isinstance(fonte, Gravador):
        with open(a.gravar, "w", encoding="utf-8") as f:
            json.dump(podar(fonte.dados, prs), f, ensure_ascii=False, indent=1)

    em_aberto = [r for r in resultados if r["estado"] in ("não cumprida", "parcial") or r["represadas"]]
    if a.json:
        print(json.dumps(resultados, ensure_ascii=False, indent=2))
    else:
        from collections import Counter
        cont = Counter(r["estado"] for r in resultados)
        print(f"{len(resultados)} PRs · " + " · ".join(f"{k}: {v}" for k, v in sorted(cont.items())) +
              f" · branches represadas: {sum(len(r['represadas']) for r in resultados)}"
              f"  (controle: ls-remote com {len(remotas)} heads, main inclusa)")
        for r in resultados:
            if r["estado"] == "nada prometido" and not r["represadas"] and not r["represadas_nao_medidas"]:
                continue
            print(f"#{r['pr']} {r['autor']} — {r['estado'].upper()} "
                  f"({len(r['promessas'])} promessas em {r['comentarios_nossos']} comentários nossos)")
            for p in r["promessas"]:
                if p["estado"] == "cumprida":
                    continue
                extra = " · OFERTA, autor em silêncio → nossa em aberto" if p.get("autor_em_silencio") else \
                        " · oferta condicional" if p["condicional"] else ""
                print(f"   [{p['estado']}] {p['quando'][:16]} {p['onde']} {p['comentario']}{extra}")
                print(f"      “{p['trecho'][:180]}”")
                if p["evidencia"]:
                    print(f"      depois: {', '.join(p['evidencia'])}")
            for b in r["represadas"]:
                print(f"   ⚠ branch REPRESADA: {b} — {r['represadas_detalhe'][b]} commits NOSSOS fora da main "
                      "e do PR, ausente de `git ls-remote --heads origin`")
            for b, motivo in r["represadas_nao_medidas"].items():
                print(f"   ? branch {b}: represada NÃO MEDIDO ({motivo})")
            for b, por in r["substituidas"].items():
                print(f"   (branch local {b} não empurrada, mas os mesmos commits saíram em origin/{por})")
    return 1 if em_aberto else 0


if __name__ == "__main__":
    sys.exit(main())
