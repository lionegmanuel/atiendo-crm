"""renumerar.py — contra a renumeração REAL de b2a49a6d7 (0269 → 0277, #1033).

O teste monta um repositório descartável com os cinco arquivos daquele commit:
`origin/main` = a base da branch, HEAD = o pai do commit. O instrumento tem de
produzir, byte a byte, o que o humano commitou — e mais nada. Sem rede.
"""

import os
import shutil
import subprocess
import sys
import tempfile
import unittest

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, ".."))
sys.path.insert(0, os.path.join(AQUI, "..", "lib"))

import renumerar  # noqa: E402

RAIZ = subprocess.run(["git", "-C", AQUI, "rev-parse", "--show-toplevel"],
                      capture_output=True, text=True, check=True).stdout.strip()
COMMIT = "b2a49a6d7"
# A main do lado do merge 581853b1d (o que a branch trouxe logo depois).
MAIN_DA_EPOCA = "e8a536ce5"
VELHO = "supabase/migrations/20260917121500_0269_pais_da_organizacao.sql"
NOVO = "supabase/migrations/20260918014500_0277_pais_da_organizacao.sql"
TOCADOS = ["app/app/settings/tenant/page.tsx", "lib/schemas/settings.ts", "supabase/baseline.sql",
           "supabase/migrations/MANIFEST.md"]
ENV = dict(os.environ, GIT_CONFIG_GLOBAL="/dev/null", GIT_CONFIG_SYSTEM="/dev/null",
           GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t", GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t")


def git(raiz, *args, entrada=None):
    r = subprocess.run(["git", "-C", raiz, *args], capture_output=True, text=True, env=ENV, input=entrada)
    return r


def show(ref, caminho):
    r = git(RAIZ, "show", f"{ref}:{caminho}")
    return r.stdout if r.returncode == 0 else None


class RepoDescartavel:
    def __init__(self, extras_base=None, extras_branch=None):
        self.dir = tempfile.mkdtemp(prefix="renumerar-")
        base = git(RAIZ, "merge-base", f"{COMMIT}^", MAIN_DA_EPOCA).stdout.strip()
        git(self.dir, "init", "-q", "-b", "main")
        # A última migration da base entra também: sem nenhuma, a origin/main não tem
        # teto e o instrumento (com razão) declara NÃO MEDIDO.
        ultima = sorted(n for n in git(RAIZ, "ls-tree", "--name-only", f"{base}:supabase/migrations")
                        .stdout.splitlines() if n.endswith(".sql"))[-1]
        mig_base = f"supabase/migrations/{ultima}"
        self._escrever({c: show(base, c) for c in TOCADOS + [mig_base]} | (extras_base or {}))
        git(self.dir, "add", "-A")
        git(self.dir, "commit", "-q", "-m", "base")
        git(self.dir, "update-ref", "refs/remotes/origin/main", "HEAD")
        git(self.dir, "checkout", "-q", "-b", "pais")
        self._escrever({c: show(f"{COMMIT}^", c) for c in TOCADOS + [VELHO]} | (extras_branch or {}))
        git(self.dir, "add", "-A")
        git(self.dir, "commit", "-q", "-m", "branch")

    def _escrever(self, arquivos):
        for c, texto in arquivos.items():
            if texto is None:
                continue
            os.makedirs(os.path.dirname(os.path.join(self.dir, c)), exist_ok=True)
            with open(os.path.join(self.dir, c), "w", encoding="utf-8") as f:
                f.write(texto)

    def ler(self, c):
        with open(os.path.join(self.dir, c), encoding="utf-8") as f:
            return f.read()

    def rodar(self, *args):
        import io
        from contextlib import redirect_stdout
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = renumerar.main(["--repo", self.dir, *args])
        return rc, buf.getvalue()

    def fechar(self):
        shutil.rmtree(self.dir, ignore_errors=True)


class CasoReal(unittest.TestCase):
    def setUp(self):
        self.r = RepoDescartavel(
            # Citação HERDADA: a base já tem uma linha com `0269` que é de OUTRA
            # migration (fixture de teste). Não é órfã e não se toca.
            extras_base={"tests/shell/colisao.test.sh": "printf 'x' > 20260101000000_0269_de_outro.sql\n"},
            # Fronteira de dígito: um id de fixture com 0269 por DENTRO.
            extras_branch={"tests/fixture.json": '{"id": 1715954026965688, "mig": "0269"}\n'})

    def tearDown(self):
        self.r.fechar()

    def test_reproduz_o_commit_humano_byte_a_byte(self):
        rc, saida = self.r.rodar("--de", "0269", "--para", "0277", "--ref", "pais",
                                 "--timestamp", "20260918014500", "--aplicar")
        self.assertEqual(rc, 0, saida)
        for c in TOCADOS + [NOVO]:
            with self.subTest(arquivo=c):
                self.assertEqual(self.r.ler(c), show(COMMIT, c))
        self.assertFalse(os.path.exists(os.path.join(self.r.dir, VELHO)))
        # git mv: o índice já sabe do rename (coluna 1 = R; a 2 = M, a edição não encenada).
        self.assertIn(f"RM {VELHO} -> {NOVO}", git(self.r.dir, "status", "--porcelain").stdout)

    def test_fronteira_de_digito_e_heranca(self):
        rc, saida = self.r.rodar("--de", "0269", "--para", "0277", "--ref", "pais",
                                 "--timestamp", "20260918014500", "--aplicar")
        self.assertEqual(rc, 0, saida)
        self.assertEqual(self.r.ler("tests/fixture.json"), '{"id": 1715954026965688, "mig": "0277"}\n')
        self.assertIn("0269_de_outro", self.r.ler("tests/shell/colisao.test.sh"))
        self.assertIn("herdada", saida)

    def test_plano_nao_escreve_nada(self):
        antes = git(self.r.dir, "status", "--porcelain").stdout
        rc, saida = self.r.rodar("--de", "0269", "--para", "0277", "--ref", "pais", "--timestamp", "20260918014500")
        self.assertEqual(rc, 0, saida)
        self.assertIn("PLANO", saida)
        self.assertEqual(git(self.r.dir, "status", "--porcelain").stdout, antes)


class Recusas(unittest.TestCase):
    def setUp(self):
        self.r = RepoDescartavel()

    def tearDown(self):
        self.r.fechar()

    def test_preencher_buraco_e_recusado(self):
        # O universo deste repo tem teto 0269 (a própria branch). 0250 é buraco.
        rc, saida = self.r.rodar("--de", "0269", "--para", "0250", "--ref", "pais")
        self.assertEqual(rc, 1)
        self.assertIn("buraco", saida)

    def test_numero_tomado_por_outra_ref_e_recusado(self):
        git(self.r.dir, "checkout", "-q", "-b", "viva", "origin/main")
        os.makedirs(os.path.join(self.r.dir, "supabase/migrations"), exist_ok=True)
        with open(os.path.join(self.r.dir, "supabase/migrations/20260919000000_0280_viva.sql"), "w") as f:
            f.write("select 1;\n")
        git(self.r.dir, "add", "-A")
        git(self.r.dir, "commit", "-q", "-m", "branch viva")
        git(self.r.dir, "checkout", "-q", "pais")
        rc, saida = self.r.rodar("--de", "0269", "--para", "0280", "--ref", "pais")
        self.assertEqual(rc, 1)
        self.assertIn("refs/heads/viva", saida)
        rc, saida = self.r.rodar("--proximo-livre")
        self.assertIn("próximo livre: 0281", saida)

    def test_timestamp_novo_passa_de_todos_do_universo(self):
        u = renumerar.universo(self.r.dir)
        from datetime import datetime, timezone
        passado = datetime(2020, 1, 1, tzinfo=timezone.utc)
        ts = renumerar.novo_timestamp(u, passado)
        self.assertGreater(ts, max(u["timestamps"]))

    def test_aplicar_com_arvore_suja_e_recusado(self):
        with open(os.path.join(self.r.dir, TOCADOS[0]), "a") as f:
            f.write("// sujo\n")
        rc, saida = self.r.rodar("--de", "0269", "--para", "0277", "--ref", "pais",
                                 "--timestamp", "20260918014500", "--aplicar")
        self.assertEqual(rc, 1)
        self.assertIn("não commitada", saida)

    def test_aplicar_fora_da_ref_e_recusado(self):
        git(self.r.dir, "checkout", "-q", "main")
        rc, saida = self.r.rodar("--de", "0269", "--para", "0277", "--ref", "pais",
                                 "--timestamp", "20260918014500", "--aplicar")
        self.assertEqual(rc, 1)
        self.assertIn("HEAD", saida)

    def test_sem_origin_main_e_nao_medido(self):
        git(self.r.dir, "update-ref", "-d", "refs/remotes/origin/main")
        rc, saida = self.r.rodar("--proximo-livre")
        self.assertEqual(rc, 2)
        self.assertIn("NÃO MEDIDO", saida)


class Prova(unittest.TestCase):
    """A prova dos dois sentidos pega a citação que ficou para trás."""

    def test_citacao_esquecida_e_orfa(self):
        r = RepoDescartavel()
        try:
            rc, _ = r.rodar("--de", "0269", "--para", "0277", "--ref", "pais", "--timestamp", "20260918014500")
            plano = renumerar.planejar(r.dir, "0269", "0277", "pais", "origin/main", "20260918014500")
            del plano["edicoes"]["lib/schemas/settings.ts"]   # a citação que ninguém arrastou
            renumerar.aplicar(r.dir, plano)
            checks = renumerar.provar(r.dir, plano)
            ruins = [c for c in checks if not c["ok"]]
            self.assertEqual(len(ruins), 1)
            self.assertIn("lib/schemas/settings.ts", ruins[0]["detalhe"])
        finally:
            r.fechar()

    def test_sem_aplicar_o_controle_positivo_acusa_que_o_novo_nao_aparece(self):
        # A sabotagem R6 passou verde: nenhum caso deixava o número novo AUSENTE.
        # Aqui a prova roda sem a renumeração ter acontecido.
        r = RepoDescartavel()
        try:
            plano = renumerar.planejar(r.dir, "0269", "0277", "pais", "origin/main", "20260918014500")
            checks = {c["conferencia"]: c["ok"] for c in renumerar.provar(r.dir, plano)}
            self.assertFalse(checks["`0277` aparece (controle: a sonda enxerga)"])
            self.assertFalse(checks["`20260918014500` aparece (controle: a sonda enxerga)"])
        finally:
            r.fechar()


if __name__ == "__main__":
    unittest.main()
