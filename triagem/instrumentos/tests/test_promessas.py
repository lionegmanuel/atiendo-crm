"""promessas.py — contra comentários e branches REAIS, gravados em 2026-09-18.

  promessas-reais.json   #1017 #1058 #1067 #1134 #714 #928 #1025 #1168

O caso mais caro, nomeado pela varredura manual da manhã: `triagem/1058-comportamento`,
"os 4 consertos que estão só no nosso disco". Sem rede.
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

import promessas  # noqa: E402

FIXTURE = os.path.join(AQUI, "fixtures", "promessas-reais.json")
with open(FIXTURE, encoding="utf-8") as f:
    DADOS = json.load(f)
PRS = [1017, 1058, 1067, 1134, 714, 928, 1025, 1168]


def rodar(dados=DADOS, prs=PRS):
    import tempfile
    fd, caminho = tempfile.mkstemp(suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(dados, f)
    try:
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = promessas.main([*map(str, prs), "--json", "--fixture", caminho])
    finally:
        os.remove(caminho)
    saida = buf.getvalue()
    return rc, (json.loads(saida) if saida.lstrip().startswith("[") else json.loads(saida))


RC, RES = rodar()
POR_PR = {r["pr"]: r for r in RES}


class CasosReais(unittest.TestCase):
    def test_1058_branch_represada_com_os_4_consertos(self):
        r = POR_PR[1058]
        self.assertEqual(r["represadas"], ["triagem/1058-comportamento"])
        self.assertEqual(r["represadas_detalhe"]["triagem/1058-comportamento"], 4)
        self.assertEqual(r["estado"], "não cumprida")

    def test_714_e_928_branch_local_publicada_com_outro_nome_nao_e_represada(self):
        # Os commits de `triagem/714-smtp-como-opcao` estão em origin/triagem/714-smtp-atualizado.
        for n in (714, 928):
            with self.subTest(pr=n):
                self.assertEqual(POR_PR[n]["represadas"], [])

    def test_928_a_gente_monta_o_recorte_e_promessa(self):
        (p,) = POR_PR[928]["promessas"]
        self.assertIn("A gente monta o recorte", p["trecho"])
        self.assertEqual(p["estado"], "parcial")          # o PR #1177 existe, ainda aberto

    def test_1134_o_pr_citado_no_comentario_conta_como_evidencia(self):
        r = POR_PR[1134]
        self.assertEqual(r["estado"], "parcial")
        self.assertTrue(all("PR #1171 (open)" in p["evidencia"] for p in r["promessas"]))

    def test_1134_nao_vou_prometer_prazo_nao_e_promessa(self):
        trechos = " ".join(p["trecho"] for p in POR_PR[1134]["promessas"])
        self.assertNotIn("prometer prazo", trechos)
        self.assertNotIn("Aqui eu corrijo", trechos)

    def test_1067_oferta_que_o_autor_fez_e_dispensada(self):
        r = POR_PR[1067]
        self.assertEqual({p["estado"] for p in r["promessas"]}, {"dispensada"})
        self.assertEqual(r["estado"], "cumprida")

    def test_1025_a_casa_faz_com_a_graph_descreve_nao_promete(self):
        self.assertEqual(POR_PR[1025]["estado"], "nada prometido")

    def test_1017_promessa_cumprida_por_pr_mesclado(self):
        r = POR_PR[1017]
        self.assertEqual(r["estado"], "cumprida")
        self.assertIn("PR #1156 (mesclado)", r["promessas"][0]["evidencia"])

    def test_saida_1_quando_ha_algo_em_aberto(self):
        self.assertEqual(RC, 1)


class Controles(unittest.TestCase):
    def test_ls_remote_sem_a_main_e_nao_medido(self):
        dados = copy.deepcopy(DADOS)
        dados["branches_remotas"] = [b for b in dados["branches_remotas"] if b != "main"]
        rc, saida = rodar(dados)
        self.assertEqual(rc, 2)
        self.assertEqual(saida["resultado"], "NÃO MEDIDO")

    def test_sem_nenhum_pr_nosso_a_lista_de_artefatos_esta_cega(self):
        dados = copy.deepcopy(DADOS)
        dados["nossos"] = {"prs": [], "issues": []}
        rc, saida = rodar(dados)
        self.assertEqual(rc, 2)

    def test_head_ausente_nao_vira_zero(self):
        dados = copy.deepcopy(DADOS)
        dados["a_frente:triagem/1058-comportamento"] = {"nao_medido": "head ausente"}
        rc, res = rodar(dados, [1058])
        self.assertEqual(res[0]["represadas"], [])
        self.assertIn("triagem/1058-comportamento", res[0]["represadas_nao_medidas"])


class RepresadaNoGitDeVerdade(unittest.TestCase):
    """A conta de "commit nosso só no disco" roda no git — a fixture só repete o número.

    Repositório descartável, sem rede: `origin` tem URL https (é publicação), `local`
    tem URL de caminho (não é), e os refs remotos são criados com update-ref.
    """

    @classmethod
    def setUpClass(cls):
        import subprocess
        import tempfile
        cls.dir = tempfile.mkdtemp(prefix="promessas-")
        env = dict(os.environ, GIT_CONFIG_GLOBAL="/dev/null", GIT_CONFIG_SYSTEM="/dev/null")

        def git(*a, quem="nos@triagem"):
            e = dict(env, GIT_AUTHOR_NAME="x", GIT_AUTHOR_EMAIL=quem, GIT_COMMITTER_NAME="x",
                     GIT_COMMITTER_EMAIL=quem)
            r = subprocess.run(["git", "-C", cls.dir, *a], capture_output=True, text=True, env=e)
            assert r.returncode == 0, r.stderr
            return r.stdout.strip()

        def commit(branch, msg, quem="nos@triagem", de="main"):
            git("checkout", "-q", "-B", branch, de)
            git("commit", "-q", "--allow-empty", "-m", msg, quem=quem)

        git("init", "-q", "-b", "main")
        git("config", "user.email", "nos@triagem")
        git("commit", "-q", "--allow-empty", "-m", "base")
        git("remote", "add", "origin", "https://example.invalid/repo.git")
        git("remote", "add", "local", "/caminho/do/checkout/principal")
        git("update-ref", "refs/remotes/origin/main", "main")
        commit("nossa", "a"); commit("nossa", "b", de="nossa")                       # 2 nossos
        commit("do-autor", "c", quem="autor@fork")                                     # commitado pelo autor
        commit("publicada", "d"); git("update-ref", "refs/remotes/origin/triagem/pub", "publicada")
        commit("so-no-local", "e"); git("update-ref", "refs/remotes/local/so-no-local", "so-no-local")
        commit("no-head", "f"); cls.head = git("rev-parse", "no-head")
        cls.fonte = promessas.FonteGitHub("x/y", cls.dir)

    @classmethod
    def tearDownClass(cls):
        import shutil
        shutil.rmtree(cls.dir, ignore_errors=True)

    def test_contagens(self):
        casos = {("nossa", None): 2, ("do-autor", None): 0, ("publicada", None): 0,
                 ("so-no-local", None): 1, ("no-head", None): 1, ("no-head", "HEAD_DO_PR"): 0}
        for (b, h), esperado in casos.items():
            with self.subTest(branch=b, head=h):
                head = self.head if h else None
                self.assertEqual(self.fonte.a_frente_da_main(b, head), esperado)


class Frases(unittest.TestCase):
    def casos(self, texto):
        return promessas.achar_promessas(texto)

    def test_compromissos(self):
        for t in ["A gente monta o recorte numa branch nossa.", "Isso é trabalho nosso, não seu.",
                  "Volto aqui com o SHA.", "Vou abrir a issue hoje.", "Eu empurro o conserto na sua branch.",
                  "Não é pedido de trabalho para você.",
                  "Não vou prometer prazo, mas volto aqui com o SHA."]:     # a negação não cala o resto
            with self.subTest(t=t):
                self.assertEqual(len(self.casos(t)), 1)

    def test_nao_compromissos(self):
        for t in ["Não vou prometer prazo nem revisão.", "A leitura que eu faço disso é de método.",
                  "Por que provider novo em vez de estender o meta_cloud?",   # pergunta de desenho: bola do autor
                  "Como a casa faz com a Graph.", "Isso não é nosso.",
                  "Não vou empurrar nada na sua branch."]:
            with self.subTest(t=t):
                self.assertEqual(self.casos(t), [])

    def test_oferta_condicional(self):
        (p,) = self.casos("Se preferir, nós fazemos — diga uma palavra aqui.")
        self.assertTrue(p["condicional"])

    def test_retorno(self):
        (p,) = self.casos("Quando eu terminar as leituras, eu volto com o veredito.")
        self.assertTrue(p["promete_retorno"])


if __name__ == "__main__":
    unittest.main()
