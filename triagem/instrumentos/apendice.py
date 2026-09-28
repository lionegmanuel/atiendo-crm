#!/usr/bin/env python3
"""apendice.py — resolve e confere o conflito do apêndice do `supabase/baseline.sql`.

    python3 triagem/instrumentos/apendice.py --arquivo supabase/baseline.sql --verificar
    python3 triagem/instrumentos/apendice.py --arquivo supabase/baseline.sql --resolver

O conflito é sempre o mesmo: os dois lados acrescentam um bloco no mesmo ponto
de inserção. A resolução também: ficam OS DOIS, em ordem de número de migration.

--resolver   só resolve hunk em que os dois lados são blocos INTEIROS acrescentados
             (sem base comum alterada). Qualquer outro hunk: recusa, e não escreve nada.
             O resultado passa pela verificação ANTES de ir para o disco.
--verificar  confere um arquivo já resolvido contra os dois lados (por padrão HEAD e
             MERGE_HEAD; ou --lado-a/--lado-b):
               1. nenhum marcador de conflito;
               2. o cabeçalho de cada bloco aparece exatamente 1×;
               3. cada bloco é IDÊNTICO, por md5, ao do lado de onde veio — md5 do
                  vazio aborta com NÃO MEDIDO (é o extrator que falhou);
               4. blocos novos vizinhos em ordem de número; bloco que cria função ou
                  devolve `anon` fica ANTES da VARREDURA; o bloco que se declara
                  "ÚLTIMO BLOCO DO ARQUIVO" é o último;
               5. contraprova: diff de CADA lado para o resultado tem inserções > 0 e
                  remoções == 0 (pega a linha em branco engolida: 111 contra 110). O
                  "lado" é o pai + o que o git já mesclou sozinho (`git merge-tree`).

Saída: 0 = ok · 1 = verificação reprovou / hunk recusado · 2 = NÃO MEDIDO.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from dataclasses import dataclass
from typing import Optional

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from medicao import NaoMedido, executar, exigir, md5_de_bloco  # noqa: E402

# Cabeçalhos de bloco que o apêndice usa de fato (medidos no baseline):
#   -- ---- a transferência entre funis não é perda comercial (migration 0266) ----
#   -- PAÍS DA ORGANIZAÇÃO (migration 20260918014500_0277) — issue #1033   (abaixo de uma régua ═══)
#   -- BEGIN 0271_extensoes_declarativas — 20260917120000                  (só se não vier logo após outro)
# E o que NÃO é cabeçalho, também medido:
#   -- Cópia de `fn_mesclar_contatos` como está em vigor (migration 0222, a última a
RE_CAB_TRACOS = re.compile(r"^-- ---- .*\(migration (?:\d{14}_)?(\d{4})\)")
RE_CAB_CAIXA_ALTA = re.compile(r"^-- [A-ZÀ-Ý0-9][A-ZÀ-Ý0-9 ,/:·&-]*\(migration (?:\d{14}_)?(\d{4})\)")
RE_CAB_BEGIN = re.compile(r"^-- BEGIN (\d{4})_")
RE_REGUA = re.compile(r"^-- ═{5,}\s*$")
RE_VARREDURA = re.compile(r"^-- ---- VARREDURA anon:")

# As mesmas regex de tests/unit/varredura-anon-e-o-ultimo-bloco.test.ts.
RE_CRIA_FUNCAO = re.compile(r"^[ \t]*create[ \t]+(?:or[ \t]+replace[ \t]+)?function", re.I | re.M)
RE_GRANT_ANON = re.compile(r"^[ \t]*grant[ \t][^;]*\bto\b[^;]*\banon\b", re.I | re.M)

MARCADORES = ("<<<<<<< ", "=======", ">>>>>>> ", "||||||| ")


def numero_do_cabecalho(linhas: list[str], i: int) -> Optional[str]:
    linha = linhas[i]
    for rx in (RE_CAB_TRACOS, RE_CAB_CAIXA_ALTA):
        if m := rx.match(linha):
            return m.group(1)
    if m := RE_CAB_BEGIN.match(linha):
        anterior = linhas[i - 1] if i > 0 else ""
        if not (RE_CAB_TRACOS.match(anterior) or RE_CAB_CAIXA_ALTA.match(anterior)):
            return m.group(1)
    return None


@dataclass
class Bloco:
    cabecalho: str      # a linha que identifica o bloco (a do "(migration NNNN)")
    numero: str
    inicio: int         # índice da 1ª linha (a régua ═══, quando há)
    fim: int            # exclusivo
    texto: str          # linhas do bloco, sem as linhas em branco do fim

    @property
    def cria_funcao_ou_devolve_anon(self) -> bool:
        return bool(RE_CRIA_FUNCAO.search(self.texto) or RE_GRANT_ANON.search(self.texto))


def blocos(linhas: list[str]) -> list[Bloco]:
    inicios = []
    for i in range(len(linhas)):
        if (n := numero_do_cabecalho(linhas, i)) is not None:
            ini = i - 1 if i > 0 and RE_REGUA.match(linhas[i - 1]) else i
            inicios.append((ini, i, n))
    saida = []
    for k, (ini, cab, n) in enumerate(inicios):
        fim = inicios[k + 1][0] if k + 1 < len(inicios) else len(linhas)
        corpo = linhas[ini:fim]
        while corpo and not corpo[-1].strip():
            corpo = corpo[:-1]
        saida.append(Bloco(linhas[cab], n, ini, fim, "\n".join(corpo)))
    return saida


# ── conflito ────────────────────────────────────────────────────────────────────

@dataclass
class Hunk:
    nosso: list[str]
    base: Optional[list[str]]
    deles: list[str]
    rotulo_nosso: str
    rotulo_deles: str


def partir(linhas: list[str]) -> list:
    """Sequência de `str` (linha comum) e `Hunk`."""
    partes: list = []
    i = 0
    while i < len(linhas):
        if not linhas[i].startswith("<<<<<<< "):
            if linhas[i].startswith(MARCADORES):
                raise NaoMedido(f"marcador de conflito solto na linha {i + 1}: {linhas[i][:30]!r}")
            partes.append(linhas[i])
            i += 1
            continue
        rot_n = linhas[i][8:].strip()
        nosso, base, deles, alvo = [], None, [], "nosso"
        i += 1
        while i < len(linhas) and not linhas[i].startswith(">>>>>>> "):
            l = linhas[i]
            if l.startswith("||||||| ") and alvo == "nosso":
                base, alvo = [], "base"
            elif l == "=======" and alvo in ("nosso", "base"):
                alvo = "deles"
            else:
                {"nosso": nosso, "base": base, "deles": deles}[alvo].append(l)
            i += 1
        if i >= len(linhas):
            raise NaoMedido("conflito aberto sem `>>>>>>>` até o fim do arquivo")
        partes.append(Hunk(nosso, base, deles, rot_n, linhas[i][8:].strip()))
        i += 1
    return partes


def lado(partes: list, qual: str) -> list[str]:
    saida: list[str] = []
    for p in partes:
        if isinstance(p, Hunk):
            saida += p.nosso if qual == "a" else p.deles
        else:
            saida.append(p)
    return saida


def blocos_do_lado(linhas: list[str], rotulo: str) -> list[list[str]]:
    """Parte um lado do hunk em blocos inteiros; recusa se ele não começa num cabeçalho."""
    corpo = list(linhas)
    while corpo and not corpo[0].strip():
        corpo = corpo[1:]
    if not corpo:
        raise ValueError(f"lado {rotulo} vazio — não é acréscimo de bloco")
    achados = blocos(corpo)
    if not achados or achados[0].inicio != 0:
        raise ValueError(f"lado {rotulo} não começa num cabeçalho de bloco ({corpo[0][:60]!r})")
    return [corpo[b.inicio:b.fim] for b in achados]


def resolver_hunk(h: Hunk) -> list[str]:
    if h.base is not None and any(l.strip() for l in h.base):
        raise ValueError("a base comum também mudou (diff3 com base não vazia) — não é acréscimo puro")
    todos = [(b, "a") for b in blocos_do_lado(h.nosso, "nosso")] + \
            [(b, "b") for b in blocos_do_lado(h.deles, "deles")]
    nums = {}
    for b, _ in todos:
        n = numero_do_cabecalho(b, 1 if RE_REGUA.match(b[0]) else 0)
        if n in nums:
            raise ValueError(f"os dois lados trazem a migration {n} — colisão de número, use renumerar.py")
        nums[n] = b
    saida: list[str] = []
    for n in sorted(nums, key=int):
        b = list(nums[n])
        while b and not b[-1].strip():
            b = b[:-1]
        if saida:
            saida.append("")
        saida += b
    # O que vinha depois do hunk colava no último bloco de um dos lados; se algum
    # lado terminava em linha em branco, ela volta — engoli-la é o "111 contra 110".
    if (h.nosso and not h.nosso[-1].strip()) or (h.deles and not h.deles[-1].strip()):
        saida.append("")
    return saida


def resolver(texto: str) -> tuple[str, str, str]:
    """Devolve (resolvido, lado_a, lado_b) — os dois lados reconstruídos do próprio arquivo."""
    linhas = texto.split("\n")
    partes = partir(linhas)
    hunks = [p for p in partes if isinstance(p, Hunk)]
    if not hunks:
        raise ValueError("o arquivo não tem conflito para resolver")
    saida: list[str] = []
    for p in partes:
        saida += resolver_hunk(p) if isinstance(p, Hunk) else [p]
    return "\n".join(saida), "\n".join(lado(partes, "a")), "\n".join(lado(partes, "b"))


# ── verificação ─────────────────────────────────────────────────────────────────

def numstat(de: str, para: str) -> tuple[int, int]:
    with tempfile.TemporaryDirectory() as d:
        a, b = os.path.join(d, "a"), os.path.join(d, "b")
        with open(a, "w", encoding="utf-8") as f:
            f.write(de)
        with open(b, "w", encoding="utf-8") as f:
            f.write(para)
        r = executar(["git", "diff", "--no-index", "--numstat", a, b])
        if r.rc not in (0, 1):
            raise NaoMedido(f"git diff --no-index saiu {r.rc}: {r.erro.strip()[:100]}")
        if r.rc == 0:
            return 0, 0
        m = re.match(r"^(\d+)\s+(\d+)\s", r.saida)
        if not m:
            raise NaoMedido(f"numstat ilegível: {r.saida[:80]!r}")
        return int(m.group(1)), int(m.group(2))


def verificar(resultado: str, lado_a: str, lado_b: str, rotulos=("a", "b")) -> list[dict]:
    """Lista de conferências; cada uma com ok True/False, ou `nao_medido`."""
    checks: list[dict] = []

    def conf(nome, ok, detalhe=""):
        checks.append({"conferencia": nome, "ok": ok, "detalhe": detalhe})

    linhas_r = resultado.split("\n")
    marcas = [i + 1 for i, l in enumerate(linhas_r) if l.startswith(MARCADORES)]
    conf("sem marcador de conflito", not marcas, f"linhas {marcas[:5]}" if marcas else "")

    br = blocos(linhas_r)
    ba = {b.cabecalho: b for b in blocos(lado_a.split("\n"))}
    bb = {b.cabecalho: b for b in blocos(lado_b.split("\n"))}
    # Controle positivo: o extrator acha blocos nos três. Zero em algum = extrator cego.
    if not br or not ba or not bb:
        checks.append({"conferencia": "extrator de blocos", "ok": None,
                       "detalhe": f"NÃO MEDIDO: blocos r={len(br)} {rotulos[0]}={len(ba)} {rotulos[1]}={len(bb)}"})
        return checks

    contagem: dict[str, int] = {}
    for b in br:
        contagem[b.cabecalho] = contagem.get(b.cabecalho, 0) + 1
    esperados = set(ba) | set(bb)
    faltando = sorted(h for h in esperados if contagem.get(h, 0) == 0)
    repetidos = sorted(h for h, n in contagem.items() if n > 1)
    conf("cada cabeçalho exatamente 1×", not faltando and not repetidos,
         "; ".join([f"FALTA {h[:70]}" for h in faltando] + [f"{contagem[h]}× {h[:70]}" for h in repetidos]))

    por_cab = {b.cabecalho: b for b in br}
    divergentes, conferidos = [], 0
    for h in sorted(esperados):
        if h not in por_cab:
            continue
        try:
            mr = md5_de_bloco(por_cab[h].texto, h[:50])
            origens = {md5_de_bloco(x[h].texto, h[:50]) for x in (ba, bb) if h in x}
        except NaoMedido as e:
            checks.append({"conferencia": "md5 dos blocos", "ok": None, "detalhe": str(e)})
            return checks
        conferidos += 1
        if mr not in origens:
            divergentes.append(h[:70])
    conf("cada bloco idêntico (md5) ao do lado de onde veio", not divergentes,
         f"{conferidos} blocos conferidos" + (f"; DIFERE: {divergentes}" if divergentes else ""))

    # Ordem: só entre blocos NOVOS (de um lado só) que ficaram vizinhos — a main tem
    # blocos antigos fora de ordem (0274 antes de 0267) e isso não é deste merge.
    novos = {h for h in esperados if (h in ba) != (h in bb)}
    idx = [i for i, b in enumerate(br) if b.cabecalho in novos]
    fora_de_ordem = [f"{br[i].numero}>{br[j].numero}" for i, j in zip(idx, idx[1:])
                     if j == i + 1 and (br[i].cabecalho in ba) != (br[j].cabecalho in ba)
                     and int(br[i].numero) > int(br[j].numero)]
    conf("blocos novos vizinhos em ordem de número", not fora_de_ordem, ", ".join(fora_de_ordem))

    varr = next((i for i, b in enumerate(br) if RE_VARREDURA.match(b.cabecalho)), None)
    if varr is None:
        checks.append({"conferencia": "posição da VARREDURA", "ok": None,
                       "detalhe": "NÃO MEDIDO: bloco da VARREDURA anon não encontrado no resultado"})
    else:
        depois = [br[i].numero for i in idx if i > varr and br[i].cria_funcao_ou_devolve_anon]
        conf("bloco novo que cria função/devolve anon fica antes da VARREDURA", not depois,
             f"depois da varredura: {depois}" if depois else f"varredura no bloco {varr + 1}/{len(br)}")
    ultimos = [i for i, b in enumerate(br) if "ÚLTIMO BLOCO DO ARQUIVO" in b.texto]
    conf("o bloco que se declara último é o último", all(i == len(br) - 1 for i in ultimos),
         ", ".join(br[i].numero for i in ultimos))

    for rot, origem in zip(rotulos, (lado_a, lado_b)):
        try:
            ins, rem = numstat(origem, resultado)
        except NaoMedido as e:
            checks.append({"conferencia": f"contraprova contra {rot}", "ok": None, "detalhe": str(e)})
            continue
        conf(f"contraprova contra {rot}: inserções > 0 e remoções == 0", ins > 0 and rem == 0,
             f"+{ins} -{rem}")
    return checks


def lados_do_merge(ra: str, rb: str, caminho: str, raiz: str) -> tuple[str, str]:
    """Os dois lados como o MERGE os vê: cada pai + o que o git já mesclou sozinho.

    Comparar o resultado com o pai CRU acusa como "remoção" toda edição que o outro
    lado fez fora do conflito (medido no cbedd1fc5: a main trocou "dizia" por "diz"
    num comentário, e a contraprova contra o pai deu -1). O `merge-tree` refaz o
    conflito e isola o que só a resolução decidiu.
    """
    r = executar(["git", "-C", raiz, "merge-tree", "--write-tree", ra, rb])
    if r.rc not in (0, 1) or not r.saida:
        raise NaoMedido(f"git merge-tree {ra} {rb} saiu {r.rc}: {r.erro.strip()[:100]}")
    arvore = r.saida.splitlines()[0]
    texto = exigir(["git", "-C", raiz, "show", f"{arvore}:{caminho}"])
    if "<<<<<<< " not in texto:
        # Sem conflito neste arquivo: os dois lados são o merge limpo.
        return texto, texto
    _, lado_a, lado_b = resolver_ou_lados(texto)
    return lado_a, lado_b


def resolver_ou_lados(texto: str) -> tuple[Optional[str], str, str]:
    partes = partir(texto.split("\n"))
    return None, "\n".join(lado(partes, "a")), "\n".join(lado(partes, "b"))


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--arquivo", required=True)
    modo = ap.add_mutually_exclusive_group(required=True)
    modo.add_argument("--verificar", action="store_true")
    modo.add_argument("--resolver", action="store_true")
    ap.add_argument("--lado-a", help="ref do primeiro lado (padrão: HEAD)")
    ap.add_argument("--lado-b", help="ref do segundo lado (padrão: MERGE_HEAD)")
    ap.add_argument("--saida", help="--resolver escreve aqui em vez de no próprio arquivo")
    ap.add_argument("--caminho", default="supabase/baseline.sql",
                    help="caminho do arquivo DENTRO do repositório, lido nas refs (padrão: o baseline)")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)

    raiz = executar(["git", "rev-parse", "--show-toplevel"]).saida.strip()
    caminho_no_repo = a.caminho
    rel: dict = {"arquivo": a.arquivo}
    try:
        with open(a.arquivo, encoding="utf-8") as f:
            texto = f.read()
        if a.resolver:
            try:
                resultado, lado_a, lado_b = resolver(texto)
            except ValueError as e:
                rel.update(resultado="RECUSADO", motivo=str(e))
                return _fim(rel, a.json, 1)
            checks = verificar(resultado, lado_a, lado_b, ("lado a (do próprio conflito)", "lado b (do próprio conflito)"))
        else:
            resultado = texto
            ra = a.lado_a or "HEAD"
            rb = a.lado_b or ("MERGE_HEAD" if executar(["git", "-C", raiz, "rev-parse", "-q", "--verify",
                                                          "MERGE_HEAD"]).ok else None)
            if rb is None:
                raise NaoMedido("sem MERGE_HEAD e sem --lado-b: não há o segundo lado para comparar")
            lado_a, lado_b = lados_do_merge(ra, rb, caminho_no_repo, raiz)
            checks = verificar(resultado, lado_a, lado_b, (ra, rb))
    except NaoMedido as e:
        rel.update(resultado="NÃO MEDIDO", motivo=e.motivo)
        return _fim(rel, a.json, 2)

    rel["conferencias"] = checks
    if any(c["ok"] is None for c in checks):
        rel["resultado"] = "NÃO MEDIDO"
        cod = 2
    elif all(c["ok"] for c in checks):
        rel["resultado"] = "OK"
        cod = 0
    else:
        rel["resultado"] = "REPROVADO"
        cod = 1
    if a.resolver:
        if cod == 0:
            destino = a.saida or a.arquivo
            with open(destino, "w", encoding="utf-8") as f:
                f.write(resultado)
            rel["escrito_em"] = destino
        else:
            rel["escrito_em"] = None
            rel["motivo"] = "a resolução não passou na verificação — nada foi escrito"
    return _fim(rel, a.json, cod)


def _fim(rel: dict, como_json: bool, cod: int) -> int:
    if como_json:
        print(json.dumps(rel, ensure_ascii=False, indent=2))
    else:
        print(f"{rel['resultado']}  {rel['arquivo']}" + (f" — {rel['motivo']}" if rel.get("motivo") else ""))
        for c in rel.get("conferencias", []):
            marca = "✓" if c["ok"] else ("?" if c["ok"] is None else "✗")
            print(f"  {marca} {c['conferencia']}" + (f"  ({c['detalhe']})" if c["detalhe"] else ""))
        if rel.get("escrito_em"):
            print(f"  escrito em {rel['escrito_em']}")
    return cod


if __name__ == "__main__":
    sys.exit(main())
