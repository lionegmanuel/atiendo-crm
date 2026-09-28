"""sonda.py — cada classe com um caso REAL e nomeado do repositório, e um controle negativo.

As fixtures foram gravadas com `sonda.py --gravar` em 2026-09-18 contra a API real:
  sonda-reais.json               #1151 #1163 #1130 #1122 #1025 #1056 #988 #796
  sonda-1122-action-required.json   #1122 na cabeça antiga ee8a486b6 (4 runs parados)
Rodam sem rede:  python3 -m unittest discover -s triagem/instrumentos/tests
"""

import copy
import io
import json
import os
import sys
import unittest
from contextlib import redirect_stdout

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, ".."))
sys.path.insert(0, os.path.join(AQUI, "..", "lib"))

import sonda  # noqa: E402
from medicao import (NaoMedido, falhas_do_playwright, ler_rodape,  # noqa: E402
                     tetos_do_workflow)


def carregar(nome):
    with open(os.path.join(AQUI, "fixtures", nome), encoding="utf-8") as f:
        return json.load(f)


REAIS = carregar("sonda-reais.json")
PARADO = carregar("sonda-1122-action-required.json")
# #1170: o verify, job que TODO PR atravessa, morto no teto de 15 min (1/3 das rodadas do dia).
VERIFY_TETO = carregar("sonda-1170-verify-teto.json")
SHA_1122_ANTIGO = "ee8a486b65933b1dd031fc0cd590a9b3a9fa6244"


def sondar(n, dados=REAIS, sha=None):
    return sonda.sondar(sonda.FonteGravada(dados), n, sha)


def classes(r):
    return sorted(v["classe"] for v in r.get("vermelhos", []))


class ClassesComCasoReal(unittest.TestCase):
    def test_teto_1151_perna_cancelada_aos_30m16s(self):
        r = sondar(1151)
        teto = [v for v in r["vermelhos"] if v["check"] == "e2e-parte (3)"]
        self.assertEqual(len(teto), 1)
        self.assertEqual(teto[0]["classe"], "teto")
        self.assertEqual(teto[0]["teto_min"], 30)
        self.assertEqual(teto[0]["conclusao"], "cancelled")

    def test_teto_1170_verify_aos_15m15s(self):
        (v,) = sondar(1170, VERIFY_TETO)["vermelhos"]
        self.assertEqual((v["check"], v["classe"], v["teto_min"], v["duracao"]), ("verify", "teto", 15, "15m15s"))

    def test_teto_lido_da_main_do_instante_do_run_nao_da_de_hoje(self):
        # O #1184 sobe o verify para 25 min. Com a main de HOJE dizendo 25, o
        # cancelamento de ontem aos 15m15s tem de continuar sendo teto — a régua é a
        # do instante em que o run nasceu.
        dados = copy.deepcopy(VERIFY_TETO)
        chave = next(k for k in dados if k.startswith("workflow:.github/workflows/ci.yml@"))
        dados["workflow:.github/workflows/ci.yml"] = dados[chave].replace(
            "    timeout-minutes: 15", "    timeout-minutes: 25", 1)
        self.assertEqual(classes(sondar(1170, dados)), ["teto"])
        # Controle: a régua do instante, se fosse 25, faria o mesmo cancelamento NÃO ser teto.
        dados[chave] = dados["workflow:.github/workflows/ci.yml"]
        (v,) = sondar(1170, dados)["vermelhos"]
        self.assertEqual((v["classe"], v["teto_min"]), ("cancelado", 25))

    def test_teto_1056_exit_124_do_orcamento_interno(self):
        r = sondar(1056)
        self.assertEqual(classes(r), ["teto"])
        self.assertIn("exit 124", r["vermelhos"][0]["motivo"])

    def test_erro_de_suite_1163_errors_1_com_tests_0_failed(self):
        r = sondar(1163)
        self.assertEqual(r["veredito"], "VERMELHO")
        (v,) = r["vermelhos"]
        self.assertEqual(v["classe"], "erro_de_suite")
        self.assertEqual(v["origem"], ["tests/unit/composer-colar-imagem.test.tsx"])
        self.assertEqual(v["diff"]["no_diff"], [])
        self.assertIn("não é do autor", sonda.imprimir(r))

    def test_action_required_1122_na_cabeca_antiga(self):
        r = sondar(1122, PARADO, SHA_1122_ANTIGO)
        self.assertEqual(r["veredito"], "NÃO MEDIDO")
        self.assertEqual(r["reportados"], 0)
        self.assertEqual(len(r["action_required"]), 4)
        self.assertEqual(len(r["destrave"]), 4)
        self.assertTrue(all("/approve" in d for d in r["destrave"]))
        self.assertIn("action_required", r["motivo"])

    def test_herdado_796_arvore_vencida(self):
        r = sondar(796)
        self.assertEqual(classes(r), ["herdado"])
        v = r["vermelhos"][0]
        self.assertLess(v["run_criado"], "2026-09-15")
        self.assertIn("re-execute ANTES de atribuir", v["motivo"])

    def test_real_988_arquivo_no_diff(self):
        r = sondar(988)
        self.assertEqual(classes(r), ["real"])
        self.assertTrue(r["vermelhos"][0]["diff"]["no_diff"])


class ControlesNegativos(unittest.TestCase):
    """Cada PR real tem EXATAMENTE as classes esperadas — é o controle negativo de todas as outras."""

    ESPERADO = {1151: ["teto"], 1163: ["erro_de_suite"], 1130: [], 1122: [], 1025: ["real"],
                1056: ["teto"], 988: ["real"], 796: ["herdado"]}

    def test_matriz_de_classes(self):
        for n, esperado in self.ESPERADO.items():
            with self.subTest(pr=n):
                self.assertEqual(classes(sondar(n)), esperado)
        with self.subTest(pr=1170):
            self.assertEqual(classes(sondar(1170, VERIFY_TETO)), ["teto"])

    def test_1025_nao_e_herdado_porque_a_falha_cita_codigo_do_diff(self):
        # O teste que falhou (branding.test.ts) está FORA do diff e a main o mudou
        # depois do run — tudo que o "herdado" pede. Mas a falha acusa
        # conversions.ts, que o autor trouxe. A primeira versão da sonda errou este.
        r = sondar(1025)
        v = r["vermelhos"][0]
        self.assertEqual(v["classe"], "real")
        self.assertIn("lib/plataformas-de-anuncio/google/conversions.ts", v["citados_no_diff"])

    def test_1122_atual_e_verde_nos_cinco(self):
        r = sondar(1122)
        self.assertEqual(r["veredito"], "VERDE NOS CINCO")
        self.assertEqual(r["saida"], 0)
        self.assertEqual(r["action_required"], [])


class RegrasDeConstrucao(unittest.TestCase):
    def test_recusa_concluir_com_menos_de_5_reportados(self):
        r = sondar(1151)
        self.assertEqual(r["reportados"], 4)
        self.assertEqual(r["veredito"], "NÃO CONCLUÍDO")
        self.assertEqual(r["saida"], 2)
        self.assertIn("reportados=4/5", sonda.imprimir(r))
        self.assertNotIn("VERDE", sonda.imprimir(r))

    def test_sha_abreviado_e_recusado(self):
        r = sondar(1122, PARADO, "ee8a486b6")
        self.assertEqual(r["veredito"], "NÃO MEDIDO")
        self.assertIn("abreviado", r["motivo"])

    def test_zero_checks_sem_controle_positivo_e_sonda_cega(self):
        # #1130 tem zero runs e está conflitante. Com o controle cego (a main
        # também devolvendo zero), a sonda NÃO pode afirmar "sem CI por conflito".
        dados = copy.deepcopy(REAIS)
        dados[f"check_runs:{dados['main_head']}"] = []
        r = sondar(1130, dados)
        self.assertEqual(r["veredito"], "NÃO MEDIDO")
        self.assertIn("cega", r["motivo"])

    def test_com_controle_1130_afirma_o_conflito(self):
        r = sondar(1130)
        self.assertEqual(r["veredito"], "NÃO MEDIDO")
        self.assertIn("CONFLITANTE", r["motivo"])

    def test_log_inacessivel_vira_nao_medido_e_nunca_real(self):
        dados = copy.deepcopy(REAIS)
        job = sondar(1163)["vermelhos"][0]["job"]
        dados[f"job_log:{job}"] = {"nao_medido": "log expirou"}
        (v,) = sondar(1163, dados)["vermelhos"]
        self.assertEqual(v["classe"], "NÃO MEDIDO")
        self.assertIn("log expirou", v["motivo"])

    def test_diff_vazio_nao_prova_fora_do_diff(self):
        dados = copy.deepcopy(REAIS)
        dados["arquivos:1163"] = []
        (v,) = sondar(1163, dados)["vermelhos"]
        self.assertIsNone(v["diff"]["no_diff"])
        self.assertNotIn("não é do autor", sonda.imprimir(sondar(1163, dados)))

    def test_toda_linha_de_estado_carrega_o_sha(self):
        for n in (1151, 1163, 796):
            with self.subTest(pr=n):
                r = sondar(n)
                sha9 = r["head"][:9]
                texto = sonda.imprimir(r)
                self.assertIn(f"head {sha9}", texto.splitlines()[0])
                for linha in texto.splitlines():
                    if "classe=" in linha:
                        self.assertIn(f"[{sha9}]", linha)

    def test_json_pela_linha_de_comando(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = sonda.main(["1163", "1122", "--json", "--fixture",
                             os.path.join(AQUI, "fixtures", "sonda-reais.json")])
        saida = json.loads(buf.getvalue())
        self.assertEqual([x["pr"] for x in saida], [1163, 1122])
        self.assertEqual(rc, 1)


class Medicao(unittest.TestCase):
    def test_rodape_errors_sozinho(self):
        r = ler_rodape(" Test Files  3 passed (3)\n      Tests  10 passed (10)\n     Errors  1 error\n")
        self.assertEqual((r.testes_falhos, r.erros), (0, 1))

    def test_fail_de_suite_nao_conta_como_teste(self):
        r = ler_rodape(" FAIL  tests/unit/a.test.ts [ tests/unit/a.test.ts ]\n"
                       " FAIL  tests/unit/b.test.ts > caso > x\n")
        self.assertEqual(r.falhas_de_suite, ["tests/unit/a.test.ts"])
        self.assertEqual(r.arquivos_que_falharam, ["tests/unit/b.test.ts"])

    def test_playwright_flaky_nao_e_falha(self):
        log = ("  1 failed\n    [chromium] › tests/e2e/a.spec.ts:3:1 › x\n"
               "  1 flaky\n    [chromium] › tests/e2e/b.spec.ts:3:1 › y\n  10 passed (2m)\n")
        self.assertEqual(falhas_do_playwright(log), ["tests/e2e/a.spec.ts"])

    def test_tetos_ignoram_comentario_na_coluna_zero(self):
        # O e2e.yml real tem comentário na coluna 0 DENTRO de `jobs:` — a primeira
        # versão parava ali e perdia o teto de 30 min da `e2e-parte`.
        yaml = "jobs:\n  a:\n    timeout-minutes: 15\n# comentário solto\n  b:\n    timeout-minutes: 30\n" \
               "    steps:\n      - uses: x\n        timeout-minutes: 5\n"
        self.assertEqual(tetos_do_workflow(yaml), {"a": 15, "b": 30})

    def test_sha_completo_recusa_abreviado(self):
        from medicao import sha_completo
        with self.assertRaises(NaoMedido):
            sha_completo("ee8a486b6")


if __name__ == "__main__":
    unittest.main()
