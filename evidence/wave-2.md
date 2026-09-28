# Wave 2 — o slot · card em 3 faixas, altura constante · 2026-07-24

Evidência produzida por **@QAVivo** via `tests/capture-wave-2.ts` (navegador próprio,
viewport 1440×900, dev server 3020). Navegação **100% por clique**.

## Contra qual código

| | |
|---|---|
| `HEAD` na captura | `e9c50d2` — *fix(crm-vivo): o Radar passa a nomear o dono agente e usar a janela do estágio* |
| Cadeia da wave | `e9c50d2` → `769b7f2` (um relógio por card) → `bad6f70` (o slot) → `e2ed…` (Wave 1) |
| Árvore de **produção** | **limpa** — só `tests/`, `evidence/`, `seed-e2e-kanban.ts`, `BRIEFING`, `HANDOFF` fora do commit |

Medição em código **parado**, como combinado: o veredito é sobre o commit, não sobre
trabalho em voo.

## O número da wave

**A variação de 38px virou ZERO.**

| | Wave 0 (antes) | Wave 2 (depois) |
|---|---|---|
| Cards medidos | 10 | **12** |
| Alturas distintas | **5** (116, 119, 143, 145, 154) | **1** |
| Altura | 116→154px | **144px, todos** |
| Variação | **38px** | **0px** |

`Set(alturas).size === 1` — o critério, cumprido sem margem.

## Placar

| # | Verificação | Resultado |
|---|---|---|
| gate altura | `Set(alturas).size === 1` em 12 cards | **PASS** — 144px |
| gate elementos | Lei B: máximo 5 elementos | **PASS** — máx. observado 5 |
| cenário 7 | título de 123 chars + valor nulo + 8 tags não quebram | **PASS** — todos 144×302px |
| axe | zero violação *serious*/*critical* | **PASS** — `nested-interactive` **ZERADO** (era 11 nós) |
| radar 1 | contador crítico cai de 40 para 39 | **PASS** — 39 |
| radar 2 | "Carlos" sai do radar (30h numa janela de 96h) | **PASS** — ausente |
| radar 3 | dono agente nomeado, não "Sem dono" | **PASS** — `Agente: Lia — AgendaPlus` |
| regressão | `kanban-owner-filter` · `rbac-roles` · `risk-radar` | **PASS** — build exit 0, e2e exit 0, **7/7** |

**8 verificações, 8 PASS, 0 FALHA.** Nenhum item ficou sem nome.

## O que a tela mostra agora — teste do metro, honesto

`wave-2-board-depois.png` · `wave-2-antes-depois.png` (lado a lado, cenário 8)

- **Quem é o dono: sim.** O disco humano virou **sólido** — a distinção não depende mais
  da borda. Humano = disco cheio; agente = círculo vazado com anel. A ressalva que abri na
  Wave 1 está **paga**.
- **Quem pede atenção: AGORA SIM.** É a linha que eu vinha mantendo vermelha desde a
  Wave 0. `Sem resposta há 6 dias`, `há 20 dias`, `há 8 dias` em âmbar, com a borda
  esquerda do card na mesma cor. A um metro, os cards que gritam são exatamente os que
  deveriam gritar.
- **Tags saíram do card.** Sobrou o ponto de 6px da tag canônica antes do título — a
  exceção que a §5 permite. Nenhuma pílula de tag, nenhum `+5`.
- **Valor nulo virou `—`.** Ausência explícita, não linha em branco: preserva a altura e
  não vira `R$ 0` nem `NaN`.
- **Um relógio por card.** Onde o slot já contou o silêncio (`Sem resposta há 6 dias`), o
  rodapé cala o número e diz só `em Proposta enviada`. Onde não há silêncio a contar, o
  rodapé conta o tempo (`8h em Proposta enviada`). O mesmo número não aparece duas vezes.

## Fragilidade da própria evidência (achado sobre o meu ferramental)

`evidence/wave-0-board-antes.png` é **artefato histórico**: é a única imagem do board
antes do slot. `tests/capture-wave-0.ts` **sobrescreve esse arquivo** a cada execução —
rodá-lo hoje destruiria o "antes" em silêncio, e o cenário 8 perderia a metade esquerda.

Não é hipótese: o script grava com o mesmo nome, sem checar. Fica registrado como risco;
a correção (proteger o arquivo ou versionar o nome) é decisão do regente.
