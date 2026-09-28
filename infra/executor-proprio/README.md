# Executor próprio do CI

Uma máquina nossa que roda os jobs pesados do trabalho **nosso** — push na `main` e PR de
branch deste repositório — para a fila do GitHub ficar para quem contribui de fora.

Não muda nada até a variável de repositório `EXECUTOR_PROPRIO` valer `ligado`
(Settings → Secrets and variables → Actions → Variables). Apagar a variável é o botão de
emergência: os jobs novos voltam na hora para as máquinas do GitHub.

## Peças

| arquivo | o que é |
|---|---|
| `instalar.sh` | instala Docker + Sysbox numa Ubuntu 24.04 amd64 dedicada, pede o token, liga as vagas e a atualização semanal |
| `vaga.sh` | uma vaga: pede ao GitHub um runner JIT (um job, uso único), roda um contêiner limpo com ele, repete |
| `Dockerfile` | a imagem da vaga — o que os jobs pressupõem do `ubuntu-latest` |
| `entrypoint.sh` | sobe o Docker de dentro da vaga e entrega ao runner |
| `so-o-que-e-nosso.sh` | a guarda de entrada: recusa todo job que não seja nosso, antes do primeiro passo |

## Por que a guarda mora aqui

O repositório é público, e num `pull_request` de fork o GitHub roda o workflow **do fork** — que
pode reescrever `runs-on:` para mirar esta máquina. A expressão de `runs-on` dos nossos workflows
só decide para quem não a edita. A guarda é gravada na imagem e registrada como
`ACTIONS_RUNNER_HOOK_JOB_STARTED`; script de entrada que falha faz o job não rodar.

Aceita: `push`, `workflow_dispatch`, `schedule`, `merge_group`, e `pull_request` cuja branch mora
neste repositório. Recusa o resto, inclusive `pull_request_target` e payload ilegível.

## Por que uma vaga por contêiner (Sysbox)

O `e2e` sobe o Supabase em portas fixas (54321/54322) e o teste de imagem usa `:3000` e nomes fixos
de contêiner: dois jobs no mesmo Docker colidem. Cada vaga tem o próprio Docker e a própria rede,
sem `--privileged`, e o contêiner é descartado ao fim do job.

## Tamanho

Uma vaga = 4 núcleos e 14 GB, como o `ubuntu-latest`. Medido em 15–18/09/2026: o trabalho nosso
ocupava ~5 jobs em média e mais de 10 em 17% do tempo (sob o teto de 20 da época, então a demanda
real é maior). 8 vagas cobrem os picos.

## Operação

```bash
journalctl -u deskcomm-vaga@1 -f                          # log de uma vaga
sudo bash /opt/deskcomm-executor/instalar.sh atualizar    # reconstrói a imagem agora
systemctl list-timers deskcomm-executor-atualizar.timer   # próxima atualização automática
```

Vigiado por `tests/unit/executor-proprio-so-roda-o-que-e-nosso.test.ts`.
