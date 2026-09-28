# Sabotagens medidas — ondas 1 e 2 do épico "casos vivos"

Régua: worktree `DeskcommCRM-casos-vivos`, branch `feat/casos-vivos`, HEAD `3ffeb8487`.
Cada rodada desfaz UMA proteção, roda o invariante alvo com `pnpm test:db <arquivo>` e restaura
o arquivo sabotado — com `md5` conferido antes e depois, e uma guarda que **aborta a rodada se o
diff não tiver alcançado o arquivo** (a primeira tentativa não alcançou, e dois "verdes" que não
provavam nada foram descartados por essa guarda).

## Onda 1 — `caso-so-nasce-do-motor.test.ts` (29 casos)

| rodada | o que foi desfeito | previsto | medido |
|---|---|---|---|
| S1 | `grant insert on agent_cases to authenticated` de volta | 2 vermelhos | **5** — os 2 previstos, mais 3 do encadeamento com a 0274: com a tabela gravável de novo, `fn_aplicar_travas_de_suporte()` **replanta** as policies `support_write_*`, e os casos que exigem "zero policy de escrita" reprovam |
| S2 | `ai.case_opened` fora da reserva do `emit_event` | 1 vermelho | **2** — o caso (d) e o caso novo "as DUAS guardas se somam" (escrito depois da previsão) |
| S3 | `revoke` de `conversation_assignment_events` removido, policy mantida derrubada | 2 vermelhos | **4**, todos da tabela sabotada (o mesmo encadeamento da 0274) |

A divergência entre previsto e medido é **do lado seguro**: em nenhuma rodada algo ficou verde
que devia ficar vermelho. O que a previsão não continha era a reação da função de travas da
migration 0274 — que é comportamento correto e agora está escrito.

## Onda 2 — `lgpd-caso-anonimiza.test.ts` + `cascata-lgpd-nao-encolhe.test.ts` (21 casos)

| rodada | o que foi desfeito | previsto | medido |
|---|---|---|---|
| S1′ | o passo de `agent_cases` na cascata deixa de apagar (colunas trocadas por elas mesmas) | 4 vermelhos (com o passo REMOVIDO) | **4**: título, resumo/bloqueio, contexto, e "rodar de novo é no-op". O caso do `counts` fica verde porque o passo continua contando linhas — é a diferença entre remover o passo e esvaziar o efeito dele, e é o motivo de os dois existirem |
| S7 | **sabotar o CONSERTO**: tirar `agent_cases` da lista NOMEADA da catraca, com a função intacta | 1 vermelho | **1** — "CATRACA: nenhuma tabela entrou na cascata sem ser declarada aqui". A comparação é nos dois sentidos, então afrouxar a lista não passa em silêncio |

## O que estas rodadas NÃO provam

- Não rodei S2–S6 nem S8–S9 da onda 2 (a previsão delas está no relatório da onda).
- Nenhuma prova de tela: isso é a onda 12, com navegador dirigindo o produto.
