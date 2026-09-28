"""Primitivas de medição com o controle embutido.

Toda função daqui devolve um de dois tipos de resposta: um VALOR medido, ou um
`NaoMedido` com o motivo. Nunca um vazio que se possa ler como negativo — é a
armadilha que a triagem pagou mais vezes: a sonda falha, devolve nada, e o
"nada" é publicado como "não existe".

Sem dependência fora da biblioteca padrão, e sem estado em disco.
"""

from __future__ import annotations

import hashlib
import re
import subprocess
from dataclasses import dataclass, field
from typing import Optional

# md5 da string vazia. Dois blocos "idênticos" com este md5 são dois vazios: o
# extrator falhou dos dois lados (medido com `head -n -1` no macOS).
MD5_VAZIO = "d41d8cd98f00b204e9800998ecf8427e"

SHA_COMPLETO = re.compile(r"^[0-9a-f]{40}$")


class NaoMedido(Exception):
    """A medição não aconteceu. O motivo vai para a saída; o negativo, nunca."""

    def __init__(self, motivo: str):
        super().__init__(motivo)
        self.motivo = motivo

    def __str__(self) -> str:
        return f"NÃO MEDIDO ({self.motivo})"


@dataclass
class Execucao:
    comando: list[str]
    rc: int
    saida: str
    erro: str

    @property
    def ok(self) -> bool:
        return self.rc == 0


def executar(comando: list[str], limite_s: float = 120, cwd: Optional[str] = None,
             entrada: Optional[str] = None) -> Execucao:
    """Roda sem shell (sem word-splitting de zsh nenhum) e com teto de tempo.

    O teto é do Python, não do binário `timeout` — que não existe no macOS e, quando
    falta, vira `exit 127` que um `2>&1 | grep` converte em "não achei erro".
    Estourar o teto é NaoMedido, não "está fora".
    """
    try:
        p = subprocess.run(comando, capture_output=True, text=True, timeout=limite_s,
                           cwd=cwd, input=entrada)
    except subprocess.TimeoutExpired:
        raise NaoMedido(f"`{' '.join(comando[:3])}…` não respondeu em {limite_s:.0f}s")
    except FileNotFoundError:
        raise NaoMedido(f"binário ausente: {comando[0]}")
    return Execucao(comando, p.returncode, p.stdout, p.stderr)


def exigir(comando: list[str], limite_s: float = 120, cwd: Optional[str] = None,
           entrada: Optional[str] = None) -> str:
    """Como `executar`, mas exit != 0 vira NaoMedido com o stderr — nunca saída vazia."""
    r = executar(comando, limite_s, cwd, entrada)
    if not r.ok:
        detalhe = (r.erro or r.saida).strip().splitlines()
        raise NaoMedido(f"`{' '.join(comando[:3])}…` saiu {r.rc}: {detalhe[0] if detalhe else 'sem mensagem'}")
    return r.saida


def sha_completo(sha: str) -> str:
    """`gh run list --commit` com SHA abreviado devolve ZERO runs, sem erro. Recusa na entrada."""
    if not SHA_COMPLETO.match(sha or ""):
        raise NaoMedido(f"SHA abreviado ou inválido ({sha!r}): a API devolve zero runs, sem erro")
    return sha


def md5(texto: str) -> str:
    return hashlib.md5(texto.encode("utf-8")).hexdigest()


def md5_de_bloco(texto: str, rotulo: str) -> str:
    """md5 que recusa o vazio: bloco extraído vazio é falha do extrator, não bloco igual."""
    h = md5(texto)
    if h == MD5_VAZIO:
        raise NaoMedido(f"bloco {rotulo!r} extraído VAZIO (md5 {MD5_VAZIO[:12]}…): o extrator falhou")
    return h


# ── rodapé do vitest ────────────────────────────────────────────────────────────

ANSI = re.compile(r"(?:\x1b|\^\[)\[[0-9;]*[A-Za-z]")


def sem_ansi(texto: str) -> str:
    """Tira escape real (\\x1b[) e o escape que o `gh` imprime como texto (^[[)."""
    return ANSI.sub("", texto)


@dataclass
class Rodape:
    """As TRÊS linhas do rodapé. `Errors N error` sozinha reprova, com `Tests 0 failed`."""

    arquivos_falhos: Optional[int] = None
    testes_falhos: Optional[int] = None
    testes_passados: Optional[int] = None
    erros: Optional[int] = None
    achou_rodape: bool = False
    falhas_de_suite: list[str] = field(default_factory=list)   # formato `FAIL x [ x ]`
    arquivos_que_falharam: list[str] = field(default_factory=list)
    origem_do_erro: list[str] = field(default_factory=list)     # "This error originated in"


_RE_TEST_FILES = re.compile(r"\bTest Files\s+(.*)$")
_RE_TESTS = re.compile(r"^\s*Tests\s+(.*)$")
_RE_ERRORS = re.compile(r"^\s*Errors\s+(\d+)\s+errors?\b")
_RE_FAIL = re.compile(r"^\s*FAIL\s+(\S+?\.(?:test|spec)\.[cm]?[jt]sx?)\b(.*)$")
_RE_ORIGEM = re.compile(r'This error originated in "([^"]+)" test file')


def _conta(trecho: str, rotulo: str) -> int:
    m = re.search(rf"(\d+)\s+{rotulo}\b", trecho)
    return int(m.group(1)) if m else 0


def _corpo(linha: str) -> str:
    """Tira o prefixo do log do Actions: `job<TAB>passo<TAB>2026-…Z `."""
    linha = sem_ansi(linha)
    if "\t" in linha:
        linha = linha.split("\t")[-1]
    return re.sub(r"^﻿?\d{4}-\d\d-\d\dT[\d:.]+Z ?", "", linha)


def ler_rodape(log: str) -> Rodape:
    r = Rodape()
    for bruta in log.splitlines():
        linha = _corpo(bruta)
        if m := _RE_TEST_FILES.search(linha):
            r.achou_rodape = True
            r.arquivos_falhos = _conta(m.group(1), "failed")
        elif m := _RE_TESTS.match(linha):
            r.testes_falhos = _conta(m.group(1), "failed")
            r.testes_passados = _conta(m.group(1), "passed")
        elif m := _RE_ERRORS.match(linha):
            r.erros = int(m.group(1))
        elif m := _RE_FAIL.match(linha):
            arquivo, resto = m.group(1), m.group(2).strip()
            # `FAIL x [ x ]` é a SUÍTE que não carregou — não conta em `Tests N failed`.
            if resto.startswith("[") and arquivo in resto:
                if arquivo not in r.falhas_de_suite:
                    r.falhas_de_suite.append(arquivo)
            elif arquivo not in r.arquivos_que_falharam:
                r.arquivos_que_falharam.append(arquivo)
        if m := _RE_ORIGEM.search(linha):
            if m.group(1) not in r.origem_do_erro:
                r.origem_do_erro.append(m.group(1))
    return r


# ── resumo do Playwright ────────────────────────────────────────────────────────

_RE_PW_FALHOU = re.compile(r"^\s*(\d+) failed\s*$")
_RE_PW_FIM = re.compile(r"^\s*\d+ (?:flaky|passed|skipped|did not run|interrupted)\b")
_RE_PW_SPEC = re.compile(r"\[[\w-]+\] › (tests/\S+?\.spec\.ts)")


def falhas_do_playwright(log: str) -> list[str]:
    """Specs listadas sob `N failed` no resumo final — as que falharam MESMO depois do retry.

    O `✘` do meio do log não serve: o retry pode ter passado (flaky), e ele leria
    como falha um teste que o Playwright deu por verde.
    """
    specs: list[str] = []
    dentro = False
    for bruta in log.splitlines():
        linha = _corpo(bruta)
        if _RE_PW_FALHOU.match(linha):
            dentro = True
            continue
        if dentro:
            if _RE_PW_FIM.match(linha):
                dentro = False
                continue
            if m := _RE_PW_SPEC.search(linha):
                if m.group(1) not in specs:
                    specs.append(m.group(1))
    return specs


# ── o trecho da falha e os caminhos que ele cita ────────────────────────────────

_RE_INICIO_DA_FALHA = re.compile(r"⎯ Failed Tests|⎯ Unhandled Errors|^\s*FAIL\s|^\s+\d+\) \[[\w-]+\] ›")
_RE_FIM_DA_FALHA = re.compile(r"\bTest Files\s|^\s*\d+ (?:failed|flaky|passed)\s*(?:\(|$)")
_RE_CAMINHO_DO_REPO = re.compile(
    r"(?<![\w/.-])((?:app|lib|components|hooks|workers|scripts|supabase|tests|setup|docs)/[\w./\[\]()@-]*?\.[a-z]{1,4})\b")


def trecho_da_falha(log: str) -> list[str]:
    """As linhas do relato de falha (do primeiro FAIL ao rodapé) + as `##[error]`.

    É daqui que saem os caminhos CITADOS pela falha — e não do log inteiro, que lista
    todo arquivo que passou.
    """
    trecho: list[str] = []
    dentro = False
    for bruta in log.splitlines():
        linha = _corpo(bruta)
        if _RE_INICIO_DA_FALHA.search(linha):
            dentro = True
        if dentro or "##[error]" in linha:
            trecho.append(linha)
        if dentro and _RE_FIM_DA_FALHA.search(linha):
            dentro = False
    return trecho


def caminhos_citados(linhas: list[str]) -> list[str]:
    """Caminhos do repositório mencionados no relato da falha.

    O arquivo de TESTE que falhou quase nunca é o culpado num invariante que varre o
    código: medido no #1025, `tests/unit/branding.test.ts` falhou citando
    `lib/plataformas-de-anuncio/google/conversions.ts` — que estava no diff do autor.
    """
    vistos: list[str] = []
    for linha in linhas:
        for m in _RE_CAMINHO_DO_REPO.finditer(linha):
            c = m.group(1).rstrip(".")
            if c not in vistos:
                vistos.append(c)
    return vistos


# ── anotações de erro do Actions ────────────────────────────────────────────────

_RE_ERRO_ACTIONS = re.compile(r"##\[error\](.*)$")
_RE_CAMINHO_NO_ERRO = re.compile(r"^((?:[\w.@-]+/)*[\w.@-]+\.\w+)[(:]\d+")


def erros_do_actions(log: str) -> tuple[list[str], list[str]]:
    """(mensagens, arquivos citados) das linhas `##[error]`, sem o `Process completed`.

    É o que resta quando o passo vermelho não é de teste (typecheck, lint, build):
    o arquivo citado é o que se compara com o diff.
    """
    msgs: list[str] = []
    arquivos: list[str] = []
    for bruta in log.splitlines():
        m = _RE_ERRO_ACTIONS.search(sem_ansi(bruta))
        if not m or m.group(1).startswith("Process completed with exit code"):
            continue
        msg = m.group(1).strip()
        if msg not in msgs:
            msgs.append(msg)
        if (c := _RE_CAMINHO_NO_ERRO.match(msg)) and c.group(1) not in arquivos:
            arquivos.append(c.group(1))
    return msgs, arquivos


# ── timeout-minutes do workflow ─────────────────────────────────────────────────

def tetos_do_workflow(yaml: str) -> dict[str, int]:
    """`timeout-minutes` por job (id e `name:`), lido do texto — sem PyYAML.

    Só o nível do JOB (4 espaços); o `timeout-minutes` de passo (8 espaços) é outro teto.
    Job sem a chave fica com o default do GitHub, 360.
    """
    tetos: dict[str, int] = {}
    dentro_de_jobs = False
    atual: list[str] = []
    for linha in yaml.splitlines():
        if re.match(r"^jobs:\s*$", linha):
            dentro_de_jobs = True
            continue
        if not dentro_de_jobs or re.match(r"^\s*(#|$)", linha):
            continue
        if re.match(r"^\S", linha):
            break
        if m := re.match(r"^  ([A-Za-z0-9_-]+):\s*$", linha):
            atual = [m.group(1)]
            tetos[m.group(1)] = 360
            continue
        if not atual:
            continue
        if m := re.match(r"^    name:\s*['\"]?([^'\"#]+?)['\"]?\s*$", linha):
            atual.append(m.group(1))
            tetos[m.group(1)] = tetos[atual[0]]
        elif m := re.match(r"^    timeout-minutes:\s*(\d+)", linha):
            for nome in atual:
                tetos[nome] = int(m.group(1))
    return tetos


def nome_base_do_job(nome_do_check: str) -> str:
    """`e2e-parte (3)` → `e2e-parte`: a perna da matrix herda o teto do job."""
    return re.sub(r"\s*\(.*\)\s*$", "", nome_do_check)
