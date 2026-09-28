"""loop/hooks/pre-push — com `git push` DE VERDADE, para repositórios bare descartáveis.

O caso real: a branch preparada por um agente foi construída sobre a main e não
continha os 12 commits do contribuidor (#1134). Sem `--force`, o git recusou por
não ser fast-forward. Com `--force`, só este hook fica no caminho.
"""

import os
import shutil
import subprocess
import tempfile
import unittest

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.abspath(os.path.join(AQUI, "..", "..", ".."))
HOOK = os.path.join(RAIZ, "loop", "hooks", "pre-push")


class Mundo:
    """upstream (origin) e fork (do contribuidor), ambos bare; `trab` é o nosso clone."""

    def __init__(self):
        self.dir = tempfile.mkdtemp(prefix="prepush-")
        self.env = dict(os.environ, GIT_CONFIG_GLOBAL="/dev/null", GIT_CONFIG_SYSTEM="/dev/null",
                        GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t", GIT_COMMITTER_NAME="t",
                        GIT_COMMITTER_EMAIL="t@t")
        self.env.pop("DESKCOMM_GOV_PHASE_MERGE", None)
        up, fork, trab, autor = (os.path.join(self.dir, x) for x in ("upstream.git", "fork.git", "trab", "autor"))
        self.up, self.fork, self.trab, self.autor = up, fork, trab, autor
        self.g(self.dir, "init", "-q", "--bare", "-b", "main", up)
        self.g(self.dir, "clone", "-q", up, trab)
        self.g(trab, "commit", "-q", "--allow-empty", "-m", "base")
        self.g(trab, "push", "-q", "origin", "main")
        self.g(self.dir, "clone", "-q", "--bare", up, fork)
        # O contribuidor trabalha no fork: 12 commits na branch do PR.
        self.g(self.dir, "clone", "-q", fork, autor)
        self.g(autor, "checkout", "-q", "-b", "feat/pr")
        for i in range(12):
            self.g(autor, "commit", "-q", "--allow-empty", "-m", f"commit do contribuidor {i + 1}")
        self.g(autor, "push", "-q", "origin", "feat/pr")
        self.g(trab, "remote", "add", "contrib", fork)
        self.g(trab, "fetch", "-q", "contrib")
        hooks = os.path.join(self.dir, "hooks")
        os.makedirs(hooks)
        shutil.copy(HOOK, os.path.join(hooks, "pre-push"))
        self.g(trab, "config", "core.hooksPath", hooks)

    def g(self, cwd, *args, env=None):
        r = subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True, env=env or self.env)
        return r

    def push(self, *args, env=None):
        return self.g(self.trab, "push", *args, env=env)

    def fechar(self):
        shutil.rmtree(self.dir, ignore_errors=True)


class PrePush(unittest.TestCase):
    def setUp(self):
        self.m = Mundo()

    def tearDown(self):
        self.m.fechar()

    def ponta_do_fork(self):
        return self.m.g(self.m.fork, "rev-parse", "feat/pr").stdout.strip()

    # ── fork de contribuidor ──

    def test_caso_real_12_commits_somem_com_force_e_o_hook_recusa(self):
        antes = self.ponta_do_fork()
        self.m.g(self.m.trab, "checkout", "-q", "-b", "conserto", "origin/main")   # construída sobre a MAIN
        self.m.g(self.m.trab, "commit", "-q", "--allow-empty", "-m", "o conserto do agente")
        r = self.m.push("--force", "contrib", "conserto:feat/pr")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("recusado sempre", r.stderr)
        self.assertEqual(self.ponta_do_fork(), antes)          # nada foi apagado

    def test_sem_flag_mas_com_mais_refspec_tambem_e_force(self):
        antes = self.ponta_do_fork()
        self.m.g(self.m.trab, "checkout", "-q", "-b", "conserto", "origin/main")
        self.m.g(self.m.trab, "commit", "-q", "--allow-empty", "-m", "x")
        r = self.m.push("contrib", "+conserto:feat/pr")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("recusado sempre", r.stderr)
        self.assertEqual(self.ponta_do_fork(), antes)

    def test_force_mesmo_em_fast_forward_e_recusado(self):
        self.m.g(self.m.trab, "checkout", "-q", "-b", "certo", "contrib/feat/pr")
        self.m.g(self.m.trab, "commit", "-q", "--allow-empty", "-m", "commit nosso, novo")
        r = self.m.push("-f", "contrib", "certo:feat/pr")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("recusado sempre", r.stderr)

    def test_linhagem_lista_os_commits_que_sumiriam(self):
        # Chamada direta, como o git chama: é a recusa (b), independente do `--force`.
        self.m.g(self.m.trab, "checkout", "-q", "-b", "conserto", "origin/main")
        self.m.g(self.m.trab, "commit", "-q", "--allow-empty", "-m", "x")
        local = self.m.g(self.m.trab, "rev-parse", "HEAD").stdout.strip()
        entrada = f"refs/heads/conserto {local} refs/heads/feat/pr {self.ponta_do_fork()}\n"
        r = subprocess.run(["bash", HOOK, "contrib", self.m.fork], cwd=self.m.trab, input=entrada,
                           capture_output=True, text=True, env=self.m.env)
        self.assertEqual(r.returncode, 1)
        self.assertIn("12 commit(s) sumiriam", r.stderr)
        self.assertIn("commit do contribuidor 12", r.stderr)

    def test_commit_novo_por_cima_da_ponta_passa(self):
        self.m.g(self.m.trab, "checkout", "-q", "-b", "certo", "contrib/feat/pr")
        self.m.g(self.m.trab, "commit", "-q", "--allow-empty", "-m", "commit nosso, novo")
        r = self.m.push("contrib", "certo:feat/pr")
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_alvo_em_movimento(self):
        # Nós: trabalho em cima do que vimos. O autor empurra de novo; nós trazemos o
        # commit dele por OUTRO caminho (sem atualizar contrib/feat/pr) — o push seria
        # fast-forward, mas a ponta mudou desde o nosso fetch.
        self.m.g(self.m.autor, "commit", "-q", "--allow-empty", "-m", "o autor consertou sozinho")
        self.m.g(self.m.autor, "push", "-q", "origin", "feat/pr")
        self.m.g(self.m.trab, "fetch", "-q", self.m.fork, "feat/pr")
        self.m.g(self.m.trab, "checkout", "-q", "-b", "certo", "FETCH_HEAD")
        self.m.g(self.m.trab, "commit", "-q", "--allow-empty", "-m", "commit nosso")
        r = self.m.push("contrib", "certo:feat/pr")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("mudou desde o seu último fetch", r.stderr)

    def test_escape_do_gov_loop_nao_vale_para_fork(self):
        self.m.g(self.m.trab, "checkout", "-q", "-b", "certo", "contrib/feat/pr")
        self.m.g(self.m.trab, "commit", "-q", "--allow-empty", "-m", "x")
        env = dict(self.m.env, DESKCOMM_GOV_PHASE_MERGE="1")
        r = self.m.push("--force", "contrib", "certo:feat/pr", env=env)
        self.assertNotEqual(r.returncode, 0)

    def test_nome_de_remoto_com_f_nao_e_force(self):
        # `-u` seguido de um remoto com "f" no nome: o glob antigo lia como `-f`.
        self.m.g(self.m.trab, "remote", "rename", "contrib", "fork")
        self.m.g(self.m.trab, "checkout", "-q", "-b", "certo", "fork/feat/pr")
        self.m.g(self.m.trab, "commit", "-q", "--allow-empty", "-m", "x")
        r = self.m.push("-u", "fork", "certo:feat/pr")
        self.assertEqual(r.returncode, 0, r.stderr)

    # ── origin (nossas branches) ──

    def test_origin_feature_branch_passa_mesmo_com_force(self):
        self.m.g(self.m.trab, "checkout", "-q", "-b", "fix/nossa")
        self.m.g(self.m.trab, "commit", "-q", "--allow-empty", "-m", "x")
        r = self.m.push("--force", "origin", "fix/nossa")
        self.assertEqual(r.returncode, 0, r.stderr)

    def test_origin_main_continua_bloqueada(self):
        self.m.g(self.m.trab, "commit", "-q", "--allow-empty", "-m", "x")
        r = self.m.push("origin", "main")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("a main é produção", r.stderr)


if __name__ == "__main__":
    unittest.main()
