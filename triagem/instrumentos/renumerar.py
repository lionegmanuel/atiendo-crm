#!/usr/bin/env python3
"""renumerar.py — renumera uma migration inteira, com todas as citações.

    python3 triagem/instrumentos/renumerar.py --proximo-livre
    python3 triagem/instrumentos/renumerar.py --de 0275 --para 0308 --ref <sha|branch> [--aplicar]

Regras (cada uma paga com uma colisão real):
  1. O universo é TODAS as refs do clone (heads, remotes, PRs buscados) — não só a
     origin/main. Duas faixas combinadas contra a main colidiram com branches vivas.
  2. `max+1`, nunca preencher buraco: buraco preenchido volta a colidir quando a
     branch dona reaparece. `--para` abaixo do teto é recusado.
  3. O TIMESTAMP troca junto (só o NNNN fabricou 12 colisões de timestamp); `git mv`.
  4. Substituição com FRONTEIRA DE DÍGITO — `0295` dentro de `1715954029565688` fica.
  5. Toda citação vai junto: arquivo, rótulo no apêndice, MANIFEST, comentários.
  6. Prova nos dois sentidos: o antigo some E o novo aparece (o controle da sonda).
  7. Citação HERDADA não é órfã: linha que existe idêntica na base (--base, padrão
     origin/main) é de outra migration com o mesmo número e não se toca.

Sem --aplicar, só mostra o plano. Com --aplicar, exige HEAD == --ref e árvore
limpa; faz `git mv` + edições e NÃO commita.

Saída: 0 = ok · 1 = recusado / prova reprovou · 2 = NÃO MEDIDO.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from typing import Optional

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from medicao import NaoMedido, executar, exigir  # noqa: E402

DIR = "supabase/migrations"
RE_MIGRATION = re.compile(r"^(\d{14})_(\d{4})_(.+)\.sql$")


def fronteira(termo: str) -> re.Pattern:
    """`git grep -E` não tem lookaround; o filtro de fronteira é daqui."""
    return re.compile(rf"(?<![0-9]){re.escape(termo)}(?![0-9])")


# ── o universo de números ───────────────────────────────────────────────────────

def universo(raiz: str) -> dict:
    """Todo NNNN e todo timestamp de migration em QUALQUER ref do clone."""
    refs = [l.split(" ", 1) for l in exigir(["git", "-C", raiz, "for-each-ref",
                                             "--format=%(objectname) %(refname)"]).splitlines() if l]
    if not refs:
        raise NaoMedido("for-each-ref não devolveu ref nenhuma")
    # ref → árvore de supabase/migrations, em lote (um processo, não mil).
    entrada = "".join(f"{sha}:{DIR}\n" for sha, _ in refs)
    saida = exigir(["git", "-C", raiz, "cat-file", "--batch-check=%(objectname) %(objecttype)"],
                   entrada=entrada, limite_s=120).splitlines()
    arvore_da_ref: dict[str, str] = {}
    for (sha, ref), linha in zip(refs, saida):
        partes = linha.split()
        if len(partes) == 2 and partes[1] == "tree":
            arvore_da_ref[ref] = partes[0]
    arvores: dict[str, list[str]] = {}
    for arv in set(arvore_da_ref.values()):
        arvores[arv] = exigir(["git", "-C", raiz, "ls-tree", "--name-only", arv]).splitlines()

    donos: dict[str, set] = {}
    tss: dict[str, set] = {}
    for ref, arv in arvore_da_ref.items():
        for nome in arvores[arv]:
            if m := RE_MIGRATION.match(nome):
                donos.setdefault(m.group(2), set()).add(ref)
                tss.setdefault(m.group(1), set()).add(ref)
    if not donos:
        raise NaoMedido("nenhuma migration em ref nenhuma — a sonda está cega")
    main = arvore_da_ref.get("refs/remotes/origin/main")
    teto_main = max((RE_MIGRATION.match(n).group(2) for n in arvores.get(main, []) if RE_MIGRATION.match(n)),
                    default=None)
    return {"donos": donos, "timestamps": tss, "refs": len(refs), "refs_com_migrations": len(arvore_da_ref),
            "arvores": len(arvores), "teto_da_main": teto_main}


def proximo_livre(u: dict) -> dict:
    teto = max(u["donos"], key=int)
    return {"teto": teto, "donos_do_teto": sorted(u["donos"][teto]),
            "proximo": f"{int(teto) + 1:04d}", "teto_ts": max(u["timestamps"])}


def novo_timestamp(u: dict, agora: Optional[datetime] = None) -> str:
    """Depois de TODO timestamp do universo, e nunca no passado."""
    agora = agora or datetime.now(timezone.utc)
    teto = datetime.strptime(max(u["timestamps"]), "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
    return max(agora.replace(microsecond=0), teto + timedelta(seconds=1)).strftime("%Y%m%d%H%M%S")


# ── o plano ─────────────────────────────────────────────────────────────────────

def ler(raiz: str, ref: str, caminho: str) -> Optional[str]:
    r = executar(["git", "-C", raiz, "show", f"{ref}:{caminho}"])
    return r.saida if r.ok else None


def arquivos_que_citam(raiz: str, ref: str, termos: list[str]) -> list[str]:
    args = ["git", "-C", raiz, "grep", "-l", "-F"]
    for t in termos:
        args += ["-e", t]
    r = executar(args + [ref])
    if r.rc not in (0, 1):
        raise NaoMedido(f"git grep saiu {r.rc}: {r.erro.strip()[:100]}")
    return [l.split(":", 1)[1] for l in r.saida.splitlines() if ":" in l]


def planejar(raiz: str, de: str, para: str, ref: str, base: str, ts_novo: str) -> dict:
    nomes = [n for n in exigir(["git", "-C", raiz, "ls-tree", "--name-only", f"{ref}:{DIR}"]).splitlines()
             if (m := RE_MIGRATION.match(n)) and m.group(2) == de]
    if len(nomes) != 1:
        raise ValueError(f"{ref} tem {len(nomes)} migrations com o número {de}: {nomes}")
    ts_velho, _, slug = RE_MIGRATION.match(nomes[0]).groups()
    novo_nome = f"{ts_novo}_{para}_{slug}.sql"
    na_base = ler(raiz, base, f"{DIR}/{nomes[0]}")
    if na_base is not None:
        raise ValueError(f"{nomes[0]} já existe em {base}: renumerar arquivo que a base tem é reescrever história")

    trocas = [(fronteira(f"{ts_velho}_{de}"), f"{ts_novo}_{para}"),
              (fronteira(ts_velho), ts_novo),
              (fronteira(de), para)]
    arquivos = arquivos_que_citam(raiz, ref, [de, ts_velho])
    edicoes, herdadas = {}, []
    for arq in arquivos:
        atual = ler(raiz, ref, arq)
        if atual is None:
            continue
        base_txt = ler(raiz, base, arq)
        linhas_base = set(base_txt.split("\n")) if base_txt is not None else set()
        novas, mudou = [], 0
        for i, linha in enumerate(atual.split("\n")):
            if not (trocas[1][0].search(linha) or trocas[2][0].search(linha)):
                novas.append(linha)
                continue
            if linha in linhas_base:
                herdadas.append(f"{arq}:{i + 1}")
                novas.append(linha)
                continue
            for rx, novo in trocas:
                linha = rx.sub(novo, linha)
            novas.append(linha)
            mudou += 1
        if mudou:
            destino = f"{DIR}/{novo_nome}" if arq == f"{DIR}/{nomes[0]}" else arq
            edicoes[arq] = {"destino": destino, "linhas": mudou, "texto": "\n".join(novas)}
    return {"de": de, "para": para, "ref": ref, "base": base, "arquivo": f"{DIR}/{nomes[0]}",
            "novo_arquivo": f"{DIR}/{novo_nome}", "ts_velho": ts_velho, "ts_novo": ts_novo,
            "edicoes": edicoes, "herdadas": herdadas}


# ── aplicar e provar ────────────────────────────────────────────────────────────

def ocorrencias_na_arvore(raiz: str, termo: str) -> list[tuple[str, int, str]]:
    """(arquivo, linha, texto) na árvore de trabalho, filtrado por fronteira de dígito."""
    r = executar(["git", "-C", raiz, "grep", "-n", "-F", "-e", termo])
    if r.rc not in (0, 1):
        raise NaoMedido(f"git grep saiu {r.rc}: {r.erro.strip()[:100]}")
    rx = fronteira(termo)
    achados = []
    for l in r.saida.splitlines():
        arq, n, texto = l.split(":", 2)
        if rx.search(texto):
            achados.append((arq, int(n), texto))
    return achados


def provar(raiz: str, plano: dict) -> list[dict]:
    """Os dois sentidos: o antigo só sobra como herança; o novo aparece onde foi posto."""
    checks = []
    for velho, novo in ((plano["de"], plano["para"]), (plano["ts_velho"], plano["ts_novo"])):
        linhas_base = {}
        orfas = []
        for arq, n, texto in ocorrencias_na_arvore(raiz, velho):
            if arq not in linhas_base:
                b = ler(raiz, plano["base"], arq)
                linhas_base[arq] = set(b.split("\n")) if b is not None else set()
            if texto not in linhas_base[arq]:
                orfas.append(f"{arq}:{n}")
        checks.append({"conferencia": f"`{velho}` só sobra como citação herdada da base", "ok": not orfas,
                       "detalhe": f"órfãs: {orfas[:8]}" if orfas else ""})
        vistos = ocorrencias_na_arvore(raiz, novo)
        esperado = 1 if novo == plano["ts_novo"] else sum(e["linhas"] for e in plano["edicoes"].values())
        checks.append({"conferencia": f"`{novo}` aparece (controle: a sonda enxerga)", "ok": len(vistos) >= esperado > 0,
                       "detalhe": f"{len(vistos)} ocorrências, mínimo {esperado}"})
    existe = os.path.exists(os.path.join(raiz, plano["novo_arquivo"]))
    sumiu = not os.path.exists(os.path.join(raiz, plano["arquivo"]))
    checks.append({"conferencia": "o arquivo foi renomeado", "ok": existe and sumiu,
                   "detalhe": plano["novo_arquivo"]})
    return checks


def aplicar(raiz: str, plano: dict) -> None:
    head = exigir(["git", "-C", raiz, "rev-parse", "HEAD"]).strip()
    alvo = exigir(["git", "-C", raiz, "rev-parse", f"{plano['ref']}^{{commit}}"]).strip()
    if head != alvo:
        raise ValueError(f"HEAD ({head[:9]}) não é --ref ({alvo[:9]}): aplique na árvore da branch que renumera")
    sujo = [l for l in exigir(["git", "-C", raiz, "status", "--porcelain", "--untracked-files=no"]).splitlines() if l]
    if sujo:
        raise ValueError(f"árvore com mudança não commitada ({len(sujo)} arquivos): commite ou guarde antes")
    exigir(["git", "-C", raiz, "mv", plano["arquivo"], plano["novo_arquivo"]])
    for arq, e in plano["edicoes"].items():
        with open(os.path.join(raiz, e["destino"]), "w", encoding="utf-8") as f:
            f.write(e["texto"])


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--proximo-livre", action="store_true")
    ap.add_argument("--de")
    ap.add_argument("--para")
    ap.add_argument("--ref")
    ap.add_argument("--base", default="origin/main")
    ap.add_argument("--timestamp", help="força o timestamp novo (padrão: depois de todos do universo)")
    ap.add_argument("--aplicar", action="store_true")
    ap.add_argument("--repo", default=None)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    raiz = a.repo or executar(["git", "rev-parse", "--show-toplevel"]).saida.strip()
    rel: dict = {}
    try:
        u = universo(raiz)
        livre = proximo_livre(u)
        rel["universo"] = {k: u[k] for k in ("refs", "refs_com_migrations", "arvores", "teto_da_main")} | livre
        # Controle: o teto do universo não pode ficar abaixo do da main — se ficar, a
        # varredura não viu a main e o "livre" é mentira.
        if u["teto_da_main"] is None:
            raise NaoMedido("refs/remotes/origin/main não entrou no universo — rode `git fetch origin`")
        if int(livre["teto"]) < int(u["teto_da_main"]):
            raise NaoMedido("teto do universo abaixo do da main: a varredura está cega")
        if a.proximo_livre:
            rel["resultado"] = "OK"
            return _fim(rel, a.json, 0)
        if not (a.de and a.para and a.ref):
            ap.error("--de, --para e --ref juntos (ou --proximo-livre)")
        de, para = f"{int(a.de):04d}", f"{int(a.para):04d}"
        if para in u["donos"]:
            raise ValueError(f"{para} já está tomado em: {', '.join(sorted(u['donos'][para])[:5])}")
        if int(para) < int(livre["proximo"]):
            raise ValueError(f"{para} preenche buraco abaixo do teto {livre['teto']} "
                             f"({', '.join(livre['donos_do_teto'][:3])}): use {livre['proximo']}")
        ts = a.timestamp or novo_timestamp(u)
        if ts in u["timestamps"]:
            raise ValueError(f"timestamp {ts} já está tomado em: {', '.join(sorted(u['timestamps'][ts])[:3])}")
        plano = planejar(raiz, de, para, a.ref, a.base, ts)
        rel["plano"] = {k: v for k, v in plano.items() if k != "edicoes"} | \
            {"edicoes": {k: {"destino": v["destino"], "linhas": v["linhas"]} for k, v in plano["edicoes"].items()}}
        if not a.aplicar:
            rel["resultado"] = "PLANO (nada foi escrito; --aplicar para executar)"
            return _fim(rel, a.json, 0)
        aplicar(raiz, plano)
        checks = provar(raiz, plano)
        rel["conferencias"] = checks
        rel["resultado"] = "OK — aplicado, NÃO commitado" if all(c["ok"] for c in checks) else "REPROVADO"
        return _fim(rel, a.json, 0 if all(c["ok"] for c in checks) else 1)
    except ValueError as e:
        rel.update(resultado="RECUSADO", motivo=str(e))
        return _fim(rel, a.json, 1)
    except NaoMedido as e:
        rel.update(resultado="NÃO MEDIDO", motivo=e.motivo)
        return _fim(rel, a.json, 2)


def _fim(rel: dict, como_json: bool, cod: int) -> int:
    if como_json:
        print(json.dumps(rel, ensure_ascii=False, indent=2))
        return cod
    u = rel.get("universo")
    if u:
        print(f"próximo livre: {u['proximo']}  (teto {u['teto']} em {', '.join(u['donos_do_teto'][:3])}"
              f"{'…' if len(u['donos_do_teto']) > 3 else ''}; teto da main {u['teto_da_main']})")
        print(f"  universo: {u['refs']} refs, {u['refs_com_migrations']} com migrations, "
              f"{u['arvores']} árvores distintas; timestamp mais alto {u['teto_ts']}")
    print(rel["resultado"] + (f" — {rel['motivo']}" if rel.get("motivo") else ""))
    p = rel.get("plano")
    if p:
        print(f"  git mv {p['arquivo']} → {p['novo_arquivo']}")
        for arq, e in p["edicoes"].items():
            print(f"  {e['linhas']:>3} linha(s)  {arq}" + (f" → {e['destino']}" if e["destino"] != arq else ""))
        for h in p["herdadas"]:
            print(f"  herdada (idêntica em {p['base']}, não se toca): {h}")
    for c in rel.get("conferencias", []):
        print(f"  {'✓' if c['ok'] else '✗'} {c['conferencia']}" + (f"  ({c['detalhe']})" if c["detalhe"] else ""))
    return cod


if __name__ == "__main__":
    sys.exit(main())
