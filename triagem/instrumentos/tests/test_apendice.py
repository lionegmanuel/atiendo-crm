"""apendice.py — contra os dois conflitos REAIS do apêndice que estão no histórico da main.

  581853b1d  merge: traz a main (#1135) — o apêndice fica com os DOIS blocos (0266 × 0277)
  cbedd1fc5  Merge branch 'main' into fix/949 (0273 × 0274, os dois DEPOIS da varredura)

O conflito é recriado sem rede com `git merge-tree` sobre os pais do merge, e a
resolução do instrumento tem de ser byte a byte a que o humano commitou.
"""

import os
import subprocess
import sys
import unittest

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, ".."))
sys.path.insert(0, os.path.join(AQUI, "..", "lib"))

import apendice  # noqa: E402

RAIZ = subprocess.run(["git", "-C", AQUI, "rev-parse", "--show-toplevel"],
                      capture_output=True, text=True, check=True).stdout.strip()
CAMINHO = "supabase/baseline.sql"
CASOS = ["581853b1d", "cbedd1fc5"]


def git(*args):
    return subprocess.run(["git", "-C", RAIZ, *args], capture_output=True, text=True)


def show(ref):
    r = git("show", f"{ref}:{CAMINHO}")
    assert r.returncode == 0, r.stderr
    return r.stdout


_cache = {}


def caso(merge):
    """(conflitado, lado_a, lado_b, resolvido_pelo_humano)."""
    if merge not in _cache:
        p1, p2 = git("rev-parse", f"{merge}^1").stdout.strip(), git("rev-parse", f"{merge}^2").stdout.strip()
        mt = git("merge-tree", "--write-tree", p1, p2)
        assert mt.returncode == 1, "o merge real conflitava; merge-tree tem de sair 1"
        arvore = mt.stdout.splitlines()[0]
        _cache[merge] = (show(arvore), show(p1), show(p2), show(merge))
    return _cache[merge]


def falhas(checks):
    return sorted(c["conferencia"] for c in checks if c["ok"] is not True)


class ResolveOsCasosReais(unittest.TestCase):
    def test_resolucao_e_byte_a_byte_a_do_humano(self):
        for m in CASOS:
            with self.subTest(merge=m):
                conflitado, a, b, humano = caso(m)
                self.assertIn("<<<<<<< ", conflitado)   # controle: o conflito existe mesmo
                resolvido, _, _ = apendice.resolver(conflitado)
                self.assertEqual(resolvido, humano)

    def test_verificar_o_commit_humano_contra_os_lados_do_merge(self):
        for m in CASOS:
            with self.subTest(merge=m):
                _, _, _, humano = caso(m)
                a, b = apendice.lados_do_merge(f"{m}^1", f"{m}^2", CAMINHO, RAIZ)
                self.assertEqual(falhas(apendice.verificar(humano, a, b)), [])

    def test_contra_o_pai_cru_a_contraprova_acusa_o_que_o_outro_lado_editou(self):
        # Controle da escolha do "lado": no cbedd1fc5 a main editou um comentário
        # fora do conflito; contra o pai cru isso aparece como remoção.
        _, a, b, humano = caso("cbedd1fc5")
        self.assertEqual(falhas(apendice.verificar(humano, a, b)),
                         ["contraprova contra a: inserções > 0 e remoções == 0"])


class PegaResolucaoErrada(unittest.TestCase):
    """Cada sabotagem é um jeito real de errar a mão — e cada uma cai numa conferência."""

    def setUp(self):
        _, _, _, self.humano = caso("581853b1d")
        self.a, self.b = apendice.lados_do_merge("581853b1d^1", "581853b1d^2", CAMINHO, RAIZ)
        self.linhas = self.humano.split("\n")
        self.i266 = next(i for i, l in enumerate(self.linhas) if "(migration 0266)" in l and l.startswith("-- ----"))
        self.i277 = next(i for i, l in enumerate(self.linhas) if "(migration 20260918014500_0277)" in l) - 1

    def test_linha_em_branco_engolida_o_111_contra_110(self):
        # A linha em branco logo acima do hunk existe nos DOIS lados; engoli-la é o
        # erro medido (111 contra 110). A linha que a própria resolução põe entre
        # os blocos não conta: ela não existia em lado nenhum.
        vazia = self.i266 - 1
        self.assertEqual(self.linhas[vazia], "")
        sabotado = "\n".join(self.linhas[:vazia] + self.linhas[vazia + 1:])
        # Só o lado b acusa: contra o a, a linha em branco que a resolução pôs entre
        # os blocos "substitui" a engolida — as linhas do a continuam em ordem no
        # resultado, e nada foi removido DELE. Um lado basta para reprovar.
        self.assertEqual(falhas(apendice.verificar(sabotado, self.a, self.b)),
                         ["contraprova contra b: inserções > 0 e remoções == 0"])

    def test_bloco_duplicado(self):
        bloco = self.linhas[self.i277:self.i277 + 5]
        sabotado = "\n".join(self.linhas[:self.i277] + bloco + [""] + self.linhas[self.i277:])
        self.assertIn("cada cabeçalho exatamente 1×", falhas(apendice.verificar(sabotado, self.a, self.b)))

    def test_ficou_so_um_lado(self):
        self.assertIn("cada cabeçalho exatamente 1×", falhas(apendice.verificar(self.a, self.a, self.b)))

    def test_ordem_trocada(self):
        conflitado, _, _, _ = caso("581853b1d")
        # O humano escolheu o lado de número MAIOR primeiro: é só não ordenar.
        partes = apendice.partir(conflitado.split("\n"))
        linhas = []
        for p in partes:
            linhas += (p.nosso + [""] + p.deles) if isinstance(p, apendice.Hunk) else [p]
        self.assertEqual(falhas(apendice.verificar("\n".join(linhas), self.a, self.b)),
                         ["blocos novos vizinhos em ordem de número"])

    def test_bloco_alterado_a_mao(self):
        sabotado = self.humano.replace("do país que já saiu pelo menos", "do país que já saiu pelo  menos", 1)
        if sabotado == self.humano:  # controle: a frase precisa existir para a sabotagem valer
            linha = self.linhas[self.i277 + 3]
            sabotado = self.humano.replace(linha, linha + " ", 1)
        self.assertNotEqual(sabotado, self.humano)
        self.assertIn("cada bloco idêntico (md5) ao do lado de onde veio",
                      falhas(apendice.verificar(sabotado, self.a, self.b)))

    def test_bloco_que_cria_funcao_depois_da_varredura(self):
        # O movimento natural: colar o bloco novo no FIM do arquivo.
        a = self.a + "\n-- ---- nova (migration 9998) ----\ncreate or replace function public.fn_x() returns int\n" \
                     "  language sql as $$ select 1 $$;\n"
        r = self.humano + "\n-- ---- nova (migration 9998) ----\ncreate or replace function public.fn_x() returns int\n" \
                          "  language sql as $$ select 1 $$;\n"
        self.assertIn("bloco novo que cria função/devolve anon fica antes da VARREDURA",
                      falhas(apendice.verificar(r, a, self.b)))

    def test_extrator_vazio_e_nao_medido_nunca_igual(self):
        # `head -n -1` no macOS: os dois lados saem vazios e os md5 "batem".
        checks = apendice.verificar(self.humano, "", "")
        self.assertEqual([c["ok"] for c in checks if c["conferencia"] == "extrator de blocos"], [None])


class Recusa(unittest.TestCase):
    def test_base_alterada_nos_dois_lados_e_recusada(self):
        texto = "x\n<<<<<<< a\n-- ---- um (migration 0001) ----\n||||||| base\nlinha antiga\n=======\n" \
                "-- ---- dois (migration 0002) ----\n>>>>>>> b\n"
        with self.assertRaises(ValueError):
            apendice.resolver(texto)

    def test_lado_que_nao_e_bloco_inteiro_e_recusado(self):
        texto = "x\n<<<<<<< a\nalter table t add column c int;\n=======\n-- ---- dois (migration 0002) ----\n>>>>>>> b\n"
        with self.assertRaises(ValueError):
            apendice.resolver(texto)

    def test_mesmo_numero_nos_dois_lados_e_recusado(self):
        texto = "x\n<<<<<<< a\n-- ---- um (migration 0002) ----\nselect 1;\n=======\n" \
                "-- ---- dois (migration 0002) ----\nselect 2;\n>>>>>>> b\n"
        with self.assertRaisesRegex(ValueError, "renumerar"):
            apendice.resolver(texto)

    def test_md5_do_vazio_e_nao_medido(self):
        # A sabotagem A3 mostrou que nenhum caso de `verificar` alcança esta guarda
        # (bloco sempre tem ao menos o cabeçalho); ela é vigiada aqui, direto.
        from medicao import NaoMedido, md5_de_bloco
        with self.assertRaises(NaoMedido):
            md5_de_bloco("", "vazio")
        self.assertEqual(len(md5_de_bloco("x", "x")), 32)

    def test_linha_de_prosa_com_migration_nao_e_cabecalho(self):
        linhas = ["-- Cópia de `fn_mesclar_contatos` como está em vigor (migration 0222, a última a"]
        self.assertIsNone(apendice.numero_do_cabecalho(linhas, 0))


if __name__ == "__main__":
    unittest.main()
