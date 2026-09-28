"""preflight.sh — cada checagem num repositório descartável, com PATH controlado.

O `docker` e o `timeout` são FALSOS, postos num bin/ próprio: o docker que trava
reproduz o `docker ps` de 2219s; o PATH sem `timeout` reproduz o macOS.
"""

import os
import shutil
import stat
import subprocess
import tempfile
import unittest

AQUI = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(AQUI, "..", "preflight.sh")
FERRAMENTAS = ["bash", "git", "python3", "sed", "wc", "tr", "head", "mktemp", "rm", "readlink", "sleep",
               "grep", "printf", "dirname", "cat", "env"]


def executavel(caminho, corpo):
    with open(caminho, "w") as f:
        f.write("#!/bin/bash\n" + corpo + "\n")
    os.chmod(caminho, os.stat(caminho).st_mode | stat.S_IEXEC)


class Cenario:
    def __init__(self, deps=("a", "b", "c"), instaladas=("a", "b"), symlink=False, ramo="main",
                 docker="echo CONTAINER; echo linha1", timeout=False):
        self.dir = tempfile.mkdtemp(prefix="preflight-")
        self.repo = os.path.join(self.dir, "repo")
        self.bin = os.path.join(self.dir, "bin")
        os.makedirs(self.repo)
        os.makedirs(self.bin)
        for f in FERRAMENTAS:
            achado = shutil.which(f)
            if achado:
                os.symlink(achado, os.path.join(self.bin, f))
        if docker is not None:
            executavel(os.path.join(self.bin, "docker"), docker)
        if timeout:
            executavel(os.path.join(self.bin, "timeout"), 'shift; exec "$@"')
        env = dict(os.environ, GIT_CONFIG_GLOBAL="/dev/null", GIT_CONFIG_SYSTEM="/dev/null",
                   GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t", GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t")
        g = lambda *a: subprocess.run(["git", "-C", self.repo, *a], env=env, capture_output=True, check=True)
        g("init", "-q", "-b", "main")
        with open(os.path.join(self.repo, "package.json"), "w") as f:
            f.write('{"dependencies": {%s}}' % ", ".join(f'"{d}": "1"' for d in deps))
        with open(os.path.join(self.repo, "usa.sh"), "w") as f:
            f.write("#!/bin/bash\nif true; then timeout 5 docker ps; fi\n")
        g("add", "-A")
        g("commit", "-q", "-m", "base")
        if ramo != "main":
            g("checkout", "-q", "-b", ramo)
        nm = os.path.join(self.dir, "nm-real") if symlink else os.path.join(self.repo, "node_modules")
        for d in instaladas:
            os.makedirs(os.path.join(nm, d))
            open(os.path.join(nm, d, "package.json"), "w").write("{}")
        if symlink:
            os.symlink(nm, os.path.join(self.repo, "node_modules"))
        elif not instaladas:
            os.makedirs(nm)

    def rodar(self, docker_s="2"):
        env = {"PATH": self.bin, "HOME": self.dir, "PREFLIGHT_DOCKER_S": docker_s,
               "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_CONFIG_SYSTEM": "/dev/null"}
        r = subprocess.run(["bash", SCRIPT, self.repo], env=env, capture_output=True, text=True, timeout=60)
        return r.returncode, r.stdout + r.stderr

    def fechar(self):
        shutil.rmtree(self.dir, ignore_errors=True)


def linha(saida, trecho):
    return next((l for l in saida.splitlines() if trecho in l), "")


class Preflight(unittest.TestCase):
    def rodar(self, **kw):
        c = Cenario(**kw)
        try:
            return c.rodar()
        finally:
            c.fechar()

    def test_ambiente_limpo_e_ok(self):
        rc, s = self.rodar(instaladas=("a", "b", "c"), timeout=True)
        self.assertEqual(rc, 0, s)
        self.assertIn("avisos=0 nao_medidos=0", s)

    def test_dependencia_declarada_e_ausente(self):
        rc, s = self.rodar(timeout=True)
        self.assertEqual(rc, 1)
        self.assertIn("1 de 3 dependências declaradas AUSENTES", s)
        self.assertIn("- c", s)

    def test_node_modules_vazio_e_nao_medido_nunca_faltam_todas(self):
        rc, s = self.rodar(instaladas=(), timeout=True)
        self.assertTrue(linha(s, "dependências:").startswith("NÃO MEDIDO"), s)

    def test_node_modules_symlink(self):
        rc, s = self.rodar(instaladas=("a", "b", "c"), symlink=True, timeout=True)
        self.assertTrue(linha(s, "SYMLINK").startswith("AVISO"), s)

    def test_docker_que_trava_e_nao_medido(self):
        rc, s = self.rodar(instaladas=("a", "b", "c"), docker="sleep 30", timeout=True)
        self.assertTrue(linha(s, "docker ps").startswith("NÃO MEDIDO"), s)
        self.assertIn("NÃO quer dizer que o docker está fora", s)
        self.assertEqual(rc, 2)

    def test_docker_que_falha_e_aviso(self):
        rc, s = self.rodar(instaladas=("a", "b", "c"), docker="echo 'Cannot connect' >&2; exit 1", timeout=True)
        self.assertTrue(linha(s, "docker ps").startswith("AVISO"), s)

    def test_timeout_ausente_nomeia_quem_depende(self):
        rc, s = self.rodar(instaladas=("a", "b", "c"))
        self.assertTrue(linha(s, "`timeout` AUSENTE").startswith("AVISO"), s)
        self.assertIn("1 script(s) do repo chamam", s)
        self.assertIn("- usa.sh", s)

    def test_checkout_principal_fora_da_main(self):
        rc, s = self.rodar(instaladas=("a", "b", "c"), ramo="fix/outra-sessao", timeout=True)
        self.assertTrue(linha(s, "checkout principal").startswith("AVISO"), s)
        self.assertIn("git show origin/main", s)


if __name__ == "__main__":
    unittest.main()
