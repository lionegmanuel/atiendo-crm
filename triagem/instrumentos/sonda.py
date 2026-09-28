#!/usr/bin/env python3
"""sonda.py — qual é o estado deste PR, e de quem é cada vermelho?

    python3 triagem/instrumentos/sonda.py 1151 1166 [--json]
    python3 triagem/instrumentos/sonda.py 1122 --sha <sha-completo>   # uma cabeça antiga

Classes de cada vermelho (cada uma existe porque uma sonda ingênua errou e a
conclusão foi publicada):

  action_required  `gh pr checks` diz "no checks reported", mas há runs parados
                   esperando aprovação — o CI nunca rodou.
  teto             job cancelado com duração >= `timeout-minutes` do workflow.
                   O `gh pr checks` imprime `fail` para ele.
  herdado          o run é anterior a um commit da main que tocou o arquivo que
                   falhou, e o arquivo não está no diff: a árvore testada venceu.
  erro_de_suite    `Errors N error` com `Tests 0 failed`, ou `FAIL x [ x ]`.
  real             nenhuma das acima.

  cancelado        (NÃO MEDIDO) cancelado ANTES do teto: nada foi medido.

Regras: recusa concluir com menos de 5 obrigatórios reportados; toda ausência
só é afirmada com um controle positivo no mesmo comando; falha de medição sai
como NÃO MEDIDO, nunca como negativo; toda linha carrega o SHA.

Saída: 0 = verde nos cinco · 1 = vermelho · 2 = pendente, não concluído ou não medido.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime
from typing import Any, Optional

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from medicao import (NaoMedido, caminhos_citados, erros_do_actions, exigir, executar, falhas_do_playwright,  # noqa: E402
                     ler_rodape, nome_base_do_job, sem_ansi, sha_completo, tetos_do_workflow,
                     trecho_da_falha)

# A régua de fallback. A régua viva é a branch protection, medida a cada execução;
# se as duas divergirem, a saída diz qual usou.
OBRIGATORIOS = ["verify", "build-and-size", "invariants", "e2e", "imagens-ok"]

CONCLUSOES_VERMELHAS = {"failure", "cancelled", "timed_out", "startup_failure"}

# Folga para o relógio do runner: o job estourado aparece com 30m16s para teto de 30.
FOLGA_DO_TETO_S = 30


def _iso(s: Optional[str]) -> Optional[datetime]:
    return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None


# ── fonte: GitHub + git, com teto de tempo e sem shell ─────────────────────────

class FonteGitHub:
    def __init__(self, repo: str, raiz: str):
        self.repo = repo
        self.raiz = raiz

    def _api(self, caminho: str) -> Any:
        return json.loads(exigir(["gh", "api", caminho], limite_s=90))

    def pr(self, n: int) -> dict:
        campos = "number,headRefOid,mergeable,mergeStateStatus,isCrossRepository,author,state"
        return json.loads(exigir(["gh", "pr", "view", str(n), "--repo", self.repo, "--json", campos]))

    def check_runs(self, sha: str) -> list[dict]:
        sha_completo(sha)
        todos: list[dict] = []
        pagina = 1
        while True:
            d = self._api(f"repos/{self.repo}/commits/{sha}/check-runs?per_page=100&page={pagina}")
            todos += [{k: c.get(k) for k in ("id", "name", "status", "conclusion", "started_at",
                                              "completed_at")} | {"suite": c["check_suite"]["id"]}
                      for c in d["check_runs"]]
            if len(todos) >= d["total_count"] or not d["check_runs"]:
                return todos
            pagina += 1

    def runs(self, sha: str) -> list[dict]:
        sha_completo(sha)
        d = self._api(f"repos/{self.repo}/actions/runs?head_sha={sha}&per_page=100")
        return [{k: r.get(k) for k in ("id", "name", "path", "event", "status", "conclusion",
                                        "created_at", "check_suite_id")}
                for r in d["workflow_runs"]]

    def job_log(self, job_id: int) -> str:
        # Sem `--allow-escape-sequences`, o `gh api` recusa o log colorido e sai 1
        # com a saída VAZIA. E é o endpoint do JOB, não o `gh run view --log`: este
        # recusa o log enquanto o RUN inteiro não termina, mesmo com o job já vermelho.
        texto = exigir(["gh", "api", f"repos/{self.repo}/actions/jobs/{job_id}/logs",
                        "--allow-escape-sequences"], limite_s=180)
        if not texto.strip():
            raise NaoMedido(f"log do job {job_id} veio vazio")
        return texto

    def arquivos_do_pr(self, n: int) -> list[str]:
        saida = exigir(["gh", "pr", "diff", str(n), "--repo", self.repo, "--name-only"], limite_s=90)
        return [l for l in saida.splitlines() if l.strip()]

    def protecao(self) -> list[str]:
        d = self._api(f"repos/{self.repo}/branches/main/protection/required_status_checks")
        return list(d.get("contexts") or [])

    def workflow(self, caminho: str, quando: Optional[str] = None) -> str:
        """O workflow como a main estava QUANDO o run nasceu — não como está hoje.

        O teto muda (o #1184 sobe verify 15→25): lido da main de hoje, um cancelamento
        aos 15m15s de ontem viraria "cancelado antes do teto" e mentiria.

        Ponto cego, com sintoma: PR que muda o próprio workflow roda a versão DELE. Se o
        PR toca .github/workflows/ (o #1183 e o #1184), o teto medido aqui pode não ser o
        teto que rodou — um `teto` ou `cancelado` nesse PR se confere pelo teto na branch
        do PR (`git show <head>:.github/workflows/<arquivo>`), não na main.
        """
        ref = "origin/main"
        if quando:
            rev = exigir(["git", "-C", self.raiz, "rev-list", "-1", f"--before={quando}", "origin/main"]).strip()
            if not rev:
                raise NaoMedido(f"a main local não tem commit anterior a {quando}")
            ref = rev
        return exigir(["git", "-C", self.raiz, "show", f"{ref}:{caminho}"])

    def main_head(self) -> str:
        return exigir(["git", "-C", self.raiz, "rev-parse", "origin/main"]).strip()

    def commits_da_main_desde(self, desde_iso: str, arquivos: list[str]) -> list[dict]:
        saida = exigir(["git", "-C", self.raiz, "log", "origin/main", f"--since={desde_iso}",
                        "--format=%H%x09%cI%x09%s", "--", *arquivos])
        commits = []
        for linha in saida.splitlines():
            sha, quando, assunto = linha.split("\t", 2)
            # `--since` é por data de commit, e a data do commit pode ser anterior ao
            # merge que o trouxe; conferido de novo contra o instante do run.
            if _iso(quando) > _iso(desde_iso):
                commits.append({"sha": sha, "quando": quando, "assunto": assunto})
        return commits


class FonteGravada:
    """Repete respostas gravadas — os testes rodam sem rede, com casos reais do repo."""

    def __init__(self, dados: dict):
        self.dados = dados
        self.repo = dados.get("repo", "melgarafael/DeskcommCRM")

    def _get(self, chave: str) -> Any:
        if chave not in self.dados:
            raise NaoMedido(f"fixture sem a chave {chave}")
        v = self.dados[chave]
        if isinstance(v, dict) and "nao_medido" in v:
            raise NaoMedido(v["nao_medido"])
        return v

    def pr(self, n): return self._get(f"pr:{n}")
    def check_runs(self, sha): sha_completo(sha); return self._get(f"check_runs:{sha}")
    def runs(self, sha): sha_completo(sha); return self._get(f"runs:{sha}")
    def job_log(self, job_id): return self._get(f"job_log:{job_id}")
    def arquivos_do_pr(self, n): return self._get(f"arquivos:{n}")
    def protecao(self): return self._get("protecao")
    def workflow(self, caminho, quando=None):
        # Fixture antiga (sem o instante) grava só `workflow:<caminho>`.
        chave = f"workflow:{caminho}@{quando}"
        return self._get(chave if chave in self.dados else f"workflow:{caminho}")
    def main_head(self): return self._get("main_head")

    def commits_da_main_desde(self, desde_iso, arquivos):
        return self._get(f"commits_desde:{desde_iso}:{','.join(sorted(arquivos))}")


def _corpo_da_linha(linha: str) -> str:
    from medicao import _corpo
    return _corpo(linha)


class Gravador:
    """Envolve a fonte real e grava tudo que ela respondeu (inclusive o NÃO MEDIDO).

    O log é gravado REDUZIDO às linhas que o classificador lê — a fixture fica
    pequena sem mudar o que a sonda enxerga.
    """

    def __init__(self, fonte: FonteGitHub):
        self.fonte = fonte
        self.repo = fonte.repo
        self.dados: dict = {"repo": fonte.repo}

    def _chamar(self, chave, fn, *args):
        try:
            v = fn(*args)
        except NaoMedido as e:
            self.dados[chave] = {"nao_medido": e.motivo}
            raise
        self.dados[chave] = v
        return v

    def pr(self, n): return self._chamar(f"pr:{n}", self.fonte.pr, n)
    def check_runs(self, sha): return self._chamar(f"check_runs:{sha}", self.fonte.check_runs, sha)
    def runs(self, sha): return self._chamar(f"runs:{sha}", self.fonte.runs, sha)
    def arquivos_do_pr(self, n): return self._chamar(f"arquivos:{n}", self.fonte.arquivos_do_pr, n)
    def protecao(self): return self._chamar("protecao", self.fonte.protecao)
    def workflow(self, c, quando=None): return self._chamar(f"workflow:{c}@{quando}", self.fonte.workflow, c, quando)
    def main_head(self): return self._chamar("main_head", self.fonte.main_head)

    def commits_da_main_desde(self, desde, arquivos):
        return self._chamar(f"commits_desde:{desde}:{','.join(sorted(arquivos))}",
                            self.fonte.commits_da_main_desde, desde, arquivos)

    def job_log(self, job_id):
        chave = f"job_log:{job_id}"
        try:
            texto = self.fonte.job_log(job_id)
        except NaoMedido as e:
            self.dados[chave] = {"nao_medido": e.motivo}
            raise
        relevante = re.compile(r"Test Files|^\s*Tests\s|Errors\s|FAIL\s|originated in|\d+ failed|"
                               r"\d+ (flaky|passed|skipped|did not run)|\[[\w-]+\] › tests/|##\[error\]")
        falha = set(trecho_da_falha(texto))
        self.dados[chave] = "\n".join(l for l in (_corpo_da_linha(x) for x in texto.splitlines())
                                      if l in falha or relevante.search(l))
        return texto


# ── o controle positivo ─────────────────────────────────────────────────────────

def controle_positivo(fonte) -> tuple[bool, str]:
    """A sonda enxerga? Mesmo endpoint, contra um alvo que SABIDAMENTE tem checks: a main.

    Sem isto, "0 checks" no PR lê igual para "o CI não rodou" e para "a sonda está cega"
    (token sem escopo, SHA abreviado, API fora).
    """
    try:
        head = fonte.main_head()
        n_checks = len(fonte.check_runs(head))
        n_runs = len(fonte.runs(head))
    except NaoMedido as e:
        return False, e.motivo
    if n_checks == 0 or n_runs == 0:
        return False, f"a main ({head[:9]}) devolveu checks={n_checks} runs={n_runs}"
    return True, f"main {head[:9]}: checks={n_checks} runs={n_runs}"


# ── classificação de uma perna vermelha ─────────────────────────────────────────

def classificar_perna(fonte, n: int, perna: dict, run: Optional[dict],
                      tetos: dict[str, int], cache: dict) -> dict:
    nome = perna["name"]
    c = {"check": nome, "job": perna["id"], "conclusao": perna["conclusion"]}

    if perna["conclusion"] in ("cancelled", "timed_out"):
        ini, fim = _iso(perna.get("started_at")), _iso(perna.get("completed_at"))
        base = nome_base_do_job(nome)
        teto = tetos.get(nome, tetos.get(base))
        if ini is None or fim is None or teto is None:
            falta = "teto do job" if teto is None else "início/fim do job"
            c.update(classe="NÃO MEDIDO", motivo=f"cancelado, e sem {falta} para comparar")
            return c
        dur = (fim - ini).total_seconds()
        c["duracao"] = f"{int(dur // 60)}m{int(dur % 60):02d}s"
        c["teto_min"] = teto
        if dur >= teto * 60 - FOLGA_DO_TETO_S:
            c.update(classe="teto", motivo=f"cancelado aos {c['duracao']} com timeout-minutes={teto}: "
                                           "estourou o teto, não reprovou teste")
        else:
            c.update(classe="cancelado", motivo=f"cancelado aos {c['duracao']}, antes do teto de {teto}m: "
                                                "NÃO MEDIDO — nada foi reprovado")
        return c

    try:
        log = fonte.job_log(perna["id"])
    except NaoMedido as e:
        c.update(classe="NÃO MEDIDO", motivo=f"log inacessível: {e.motivo}")
        return c

    rod = ler_rodape(log)
    pw = falhas_do_playwright(log)

    # Exit 124 é o código do `timeout(1)`: o passo foi morto por um teto INTERNO ao
    # job (orçamento que interrompe antes do `timeout-minutes`, medido no #1056).
    # É teto — nenhum teste reprovou.
    if re.search(r"##\[error\]Process completed with exit code 124\b", sem_ansi(log)):
        msgs, _ = erros_do_actions(log)
        c.update(classe="teto", motivo="passo morto por teto interno (exit 124)" +
                 (f": {msgs[0][:140]}" if msgs else ""))
        return c

    def relacao_com_o_diff(arquivos: list[str]) -> Optional[dict]:
        if "diff" not in cache:
            try:
                cache["diff"] = fonte.arquivos_do_pr(n)
            except NaoMedido as e:
                cache["diff"] = e
        diff = cache["diff"]
        if isinstance(diff, NaoMedido):
            return {"no_diff": None, "motivo": diff.motivo}
        # Controle: diff vazio não prova "fora do diff" — prova que a sonda não leu o diff.
        if not diff:
            return {"no_diff": None, "motivo": "o diff veio vazio"}
        return {"no_diff": [a for a in arquivos if a in diff],
                "fora_do_diff": [a for a in arquivos if a not in diff], "arquivos_no_pr": len(diff)}

    if rod.falhas_de_suite or (rod.erros and not rod.testes_falhos):
        origem = rod.falhas_de_suite or rod.origem_do_erro
        c.update(classe="erro_de_suite", origem=origem,
                 motivo=(f"`FAIL x [ x ]` em {', '.join(rod.falhas_de_suite)}" if rod.falhas_de_suite else
                         f"\"Errors {rod.erros} error\" com Tests {rod.testes_falhos or 0} failed"))
        if origem:
            c["diff"] = relacao_com_o_diff(origem)
            citados = [a for a in caminhos_citados(trecho_da_falha(log)) if a not in origem]
            rel_citados = relacao_com_o_diff(citados) if citados else None
            if rel_citados and rel_citados.get("no_diff"):
                c["citados_no_diff"] = rel_citados["no_diff"]
        return c

    falhos = rod.arquivos_que_falharam + [s for s in pw if s not in rod.arquivos_que_falharam]
    fora_dos_testes = ""
    if not falhos:
        # Passo vermelho que não é de teste (typecheck, lint, build): o arquivo que o
        # `##[error]` cita é o que se compara com o diff.
        msgs, citados = erros_do_actions(log)
        verde = (" — rodapé do vitest VERDE e o passo vermelho"
                 if rod.achou_rodape and not rod.testes_falhos and not rod.erros else "")
        fora_dos_testes = f"falha fora dos testes{verde}: {msgs[0][:140] if msgs else 'sem ##[error] no log'}"
        falhos = citados
    c["arquivos_que_falharam"] = falhos
    if not falhos:
        c.update(classe="real", motivo=fora_dos_testes or "nenhum teste nomeado no log")
        return c
    if fora_dos_testes:
        c["erro"] = fora_dos_testes

    rel = relacao_com_o_diff(falhos)
    c["diff"] = rel
    if rel.get("no_diff") is None:
        c.update(classe="real", motivo=f"relação com o diff NÃO MEDIDA ({rel['motivo']})")
        return c
    if rel["no_diff"]:
        c.update(classe="real", motivo=f"o arquivo que falhou está no diff: {', '.join(rel['no_diff'])}")
        return c
    # O teste que falhou está fora do diff — mas a FALHA pode citar código do diff
    # (invariante que varre o repositório). Aí é do autor, e não herdado.
    citados = [a for a in caminhos_citados(trecho_da_falha(log)) if a not in falhos]
    rel_citados = relacao_com_o_diff(citados) if citados else None
    if rel_citados and rel_citados.get("no_diff"):
        c.update(classe="real", citados_no_diff=rel_citados["no_diff"],
                 motivo=f"o teste está fora do diff, mas a falha cita {', '.join(rel_citados['no_diff'])}, "
                        "que ESTÁ no diff")
        return c

    # Fora do diff: a árvore testada ainda existe? O relógio é o `created_at` do run —
    # um RE-RUN reexecuta o mesmo evento (o mesmo GITHUB_SHA da prévia de merge),
    # então `run_started_at` não diz qual main foi testada. (Comportamento do GitHub,
    # não medido aqui: o attempt 2 do #865 falhou depois do #1107, mas num teste do
    # próprio diff — não prova nada sobre a base.)
    if run is None or not run.get("created_at"):
        c.update(classe="real", motivo="fora do diff; instante do run NÃO MEDIDO")
        return c
    try:
        consertos = fonte.commits_da_main_desde(run["created_at"], falhos)
    except NaoMedido as e:
        c.update(classe="real", motivo=f"fora do diff; commits da main NÃO MEDIDOS ({e.motivo})")
        return c
    if consertos:
        k = consertos[-1]
        # O que se MEDE é a árvore vencida, não a inocência do autor: um invariante
        # que varre o schema falha por migration do PR sem estar no diff. Por isso a
        # instrução é re-executar ANTES de atribuir — não "não é do autor".
        c.update(classe="herdado", run_criado=run["created_at"], conserto=k,
                 motivo=f"run criado {run['created_at']}; a main mudou {', '.join(falhos)} depois "
                        f"({k['sha'][:9]} {k['quando']} \"{k['assunto'][:60]}\") — a árvore testada "
                        "venceu: re-execute ANTES de atribuir a alguém")
    else:
        c.update(classe="real", motivo=f"fora do diff ({', '.join(falhos)}), e nenhum commit da main "
                                       f"o tocou depois de {run['created_at']} — conferir se a main está vermelha")
    return c


# ── o PR inteiro ────────────────────────────────────────────────────────────────

def sondar(fonte, n: int, sha: Optional[str] = None) -> dict:
    r: dict[str, Any] = {"pr": n}
    try:
        pr = fonte.pr(n)
    except NaoMedido as e:
        return r | {"veredito": "NÃO MEDIDO", "motivo": f"o PR não foi lido: {e.motivo}", "saida": 2}
    head = sha or pr["headRefOid"]
    r.update(head=head, mergeable=pr.get("mergeable"), merge_state=pr.get("mergeStateStatus"),
             cabeca_atual=pr["headRefOid"], autor=(pr.get("author") or {}).get("login"))
    try:
        sha_completo(head)
    except NaoMedido as e:
        return r | {"veredito": "NÃO MEDIDO", "motivo": e.motivo, "saida": 2}

    try:
        obrig = fonte.protecao()
        r["regua"] = "branch protection"
        if sorted(obrig) != sorted(OBRIGATORIOS):
            r["regua"] += f" (DIVERGE da constante: {obrig})"
    except NaoMedido as e:
        obrig = OBRIGATORIOS
        r["regua"] = f"constante (proteção NÃO MEDIDA: {e.motivo})"
    r["total_obrigatorios"] = len(obrig)

    visivel, prova = controle_positivo(fonte)
    r["controle"] = prova if visivel else f"FALHOU: {prova}"

    try:
        crs = fonte.check_runs(head)
        runs = fonte.runs(head)
    except NaoMedido as e:
        return r | {"veredito": "NÃO MEDIDO", "motivo": e.motivo, "saida": 2}

    ultimo: dict[str, dict] = {}
    for cr in crs:
        if cr["name"] not in ultimo or cr["id"] > ultimo[cr["name"]]["id"]:
            ultimo[cr["name"]] = cr

    estados = {}
    for nome in obrig:
        cr = ultimo.get(nome)
        estados[nome] = ("ausente" if cr is None else
                         "pendente" if cr["status"] != "completed" else cr["conclusion"])
    r["obrigatorios"] = estados
    r["reportados"] = sum(1 for v in estados.values() if v != "ausente")
    r["concluidos"] = sum(1 for v in estados.values() if v not in ("ausente", "pendente"))

    parados = [x for x in runs if x.get("conclusion") == "action_required"]
    r["action_required"] = [{"run": x["id"], "workflow": x["name"], "criado": x["created_at"]} for x in parados]

    # Suítes "obrigatórias": as de workflow que produz algum dos obrigatórios. É o
    # que alcança a perna que falhou ANTES de o agregador (e2e, imagens-ok) nascer.
    run_da_suite = {x["check_suite_id"]: x for x in runs}
    tetos: dict[str, int] = {}
    suites_obrig = set()
    for x in runs:
        try:
            t = tetos_do_workflow(fonte.workflow(x["path"], x.get("created_at")))
        except NaoMedido:
            continue
        if any(o in t for o in obrig):
            suites_obrig.add(x["check_suite_id"])
            tetos.update(t)

    vermelhas = [cr for cr in ultimo.values()
                 if cr["status"] == "completed" and cr["conclusion"] in CONCLUSOES_VERMELHAS
                 and (cr["suite"] in suites_obrig or cr["name"] in obrig)]
    # O agregador vermelho só REFLETE as pernas. Classificado sozinho, apenas se
    # nenhuma perna da mesma suíte falhou.
    pernas = [v for v in vermelhas
              if not (v["name"] in obrig and any(o is not v and o["suite"] == v["suite"] for o in vermelhas))]

    cache: dict = {}
    r["vermelhos"] = [classificar_perna(fonte, n, p, run_da_suite.get(p["suite"]), tetos, cache)
                      for p in sorted(pernas, key=lambda p: p["name"])]

    falhou = [k for k, v in estados.items() if v in CONCLUSOES_VERMELHAS]
    if r["reportados"] == 0 and not visivel:
        r.update(veredito="NÃO MEDIDO", motivo=f"zero checks E o controle falhou — a sonda está cega ({prova})")
    elif r["reportados"] == 0 and parados:
        desde = min(x["created_at"] for x in parados)
        r.update(veredito="NÃO MEDIDO",
                 motivo=f"{len(parados)} runs em action_required desde {desde} — o CI nunca rodou",
                 destrave=[f"gh api -X POST repos/{fonte.repo}/actions/runs/{x['id']}/approve" for x in parados])
    elif r["reportados"] == 0 and not runs and pr.get("mergeable") == "CONFLICTING":
        r.update(veredito="NÃO MEDIDO",
                 motivo="zero runs e o PR está CONFLITANTE: sem ref de merge o GitHub não cria o run")
    elif r["reportados"] < len(obrig):
        faltam = [k for k, v in estados.items() if v == "ausente"]
        r.update(veredito="NÃO CONCLUÍDO",
                 motivo=f"faltam {', '.join(faltam)}" + (" (controle OK: ausência medida)" if visivel else
                                                          " (controle FALHOU: ausência NÃO MEDIDA)"))
    elif falhou:
        r.update(veredito="VERMELHO", motivo=f"obrigatórios vermelhos: {', '.join(falhou)}")
    elif r["concluidos"] < len(obrig):
        r.update(veredito="PENDENTE", motivo="reportados e ainda rodando")
    else:
        r.update(veredito="VERDE NOS CINCO" if len(obrig) == 5 else f"VERDE NOS {len(obrig)}")

    r["saida"] = 0 if r["veredito"].startswith("VERDE") else 1 if r["veredito"] == "VERMELHO" else 2
    return r


def anotar_vermelho_comum(resultados: list[dict]) -> None:
    """O mesmo arquivo vermelho em PRs de autores diferentes aponta para a base, não para eles."""
    donos: dict[str, set] = {}
    for r in resultados:
        for v in r.get("vermelhos", []):
            for a in v.get("arquivos_que_falharam", []):
                donos.setdefault(a, set()).add(r["pr"])
    for r in resultados:
        for v in r.get("vermelhos", []):
            comum = {a: sorted(p for p in donos[a] if p != r["pr"])
                     for a in v.get("arquivos_que_falharam", []) if len(donos[a]) > 1}
            if comum:
                v["vermelho_comum"] = comum


# ── saída humana ────────────────────────────────────────────────────────────────

def imprimir(r: dict) -> str:
    total = r.get("total_obrigatorios", 5)
    sha9 = (r.get("head") or "?")[:9]
    cab = f"#{r['pr']}  reportados={r.get('reportados', 0)}/{total}"
    if "concluidos" in r:
        cab += f" concluídos={r['concluidos']}/{total}"
    cab += f"  {r['veredito']}"
    if r.get("mergeable"):
        cab += f" · {r['mergeable']}/{r.get('merge_state')}"
    cab += f" · head {sha9}"
    linhas = [cab]
    if r.get("head") and r.get("cabeca_atual") and r["head"] != r["cabeca_atual"]:
        linhas.append(f"   ⚠ medido em {sha9}, mas a cabeça ATUAL do PR é {r['cabeca_atual'][:9]}")
    if r.get("motivo"):
        linhas.append(f"   {r['motivo']}  [{sha9}]")
    for d in r.get("destrave", []):
        linhas.append(f"   destrave com: {d}")
    for v in r.get("vermelhos", []):
        linhas.append(f"   {v['check']:<22} = {v['conclusao'].upper():<9} → classe={v['classe']}  [{sha9}]")
        linhas.append(f"   {'':<22}   {v.get('motivo', '')}")
        if v.get("erro"):
            linhas.append(f"   {'':<22}   {v['erro']}")
        for arq, outros in v.get("vermelho_comum", {}).items():
            linhas.append(f"   {'':<22}   {arq} também vermelho em {', '.join(f'#{p}' for p in outros)}")
        rel = v.get("diff")
        if rel and rel.get("no_diff") is not None:
            if rel["no_diff"]:
                linhas.append(f"   {'':<22}   {', '.join(rel['no_diff'])} ESTÁ no diff deste PR")
            elif v.get("citados_no_diff"):
                linhas.append(f"   {'':<22}   {', '.join(rel['fora_do_diff'])} fora do diff, mas a falha cita "
                              f"{', '.join(v['citados_no_diff'])}, que ESTÁ no diff → pode ser do autor")
            elif v["classe"] == "erro_de_suite":
                linhas.append(f"   {'':<22}   originou em {', '.join(rel['fora_do_diff'])}")
                linhas.append(f"   {'':<22}   NÃO está no diff deste PR ({rel['arquivos_no_pr']} arquivos), nem a "
                              "falha cita arquivo do diff → não é do autor")
            else:
                linhas.append(f"   {'':<22}   {', '.join(rel['fora_do_diff'])} NÃO está no diff deste PR "
                              f"({rel['arquivos_no_pr']} arquivos)")
        elif rel:
            linhas.append(f"   {'':<22}   relação com o diff: NÃO MEDIDO ({rel['motivo']})")
    linhas.append(f"   régua: {r.get('regua', '?')} · controle: {r.get('controle', '?')}")
    return "\n".join(linhas)


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("prs", nargs="+", type=int)
    ap.add_argument("--sha", help="mede esta cabeça (SHA completo) em vez da atual — só com 1 PR")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--repo", default=os.environ.get("SONDA_REPO"))
    ap.add_argument("--gravar", help="grava as respostas numa fixture JSON (para teste)")
    ap.add_argument("--fixture", help="lê de uma fixture gravada, sem rede")
    a = ap.parse_args(argv)
    if a.sha and len(a.prs) != 1:
        ap.error("--sha só com um PR")

    raiz = executar(["git", "rev-parse", "--show-toplevel"]).saida.strip() or "."
    if a.fixture:
        with open(a.fixture, encoding="utf-8") as f:
            fonte = FonteGravada(json.load(f))
    else:
        repo = a.repo or exigir(["gh", "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).strip()
        fonte = FonteGitHub(repo, raiz)
        if a.gravar:
            fonte = Gravador(fonte)

    resultados = [sondar(fonte, n, a.sha) for n in a.prs]
    anotar_vermelho_comum(resultados)
    if a.gravar and isinstance(fonte, Gravador):
        with open(a.gravar, "w", encoding="utf-8") as f:
            json.dump(fonte.dados, f, ensure_ascii=False, indent=1)
    if a.json:
        print(json.dumps(resultados, ensure_ascii=False, indent=2))
    else:
        print("\n".join(imprimir(r) for r in resultados))
    return max(r["saida"] for r in resultados)


if __name__ == "__main__":
    sys.exit(main())
