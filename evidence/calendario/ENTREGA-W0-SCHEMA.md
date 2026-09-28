# ENTREGA — CAL-W0 · Schema do módulo de Agenda

**Frente:** Wave 0, serial · **Dono:** @Arquiteto · **Branch:** `cal/w0-schema`
**Commits:** `e4bb4dec` (schema), `3e0d2e84` (RBAC por papel), `3865ae34` (higiene do harness)

---

## O que entrou

Seis tabelas (`calendar_event_types`, `calendar_appointments`,
`calendar_availability_exceptions`, `calendar_connections`,
`calendar_connection_calendars`, `calendar_external_events`), a coluna
`user_organizations.calendar_color`, um trigger de limpeza de vínculo
polimórfico, o vocabulário em `lib/agenda/tipos.ts` e três invariantes novos.

A migration é a `0177` — a `0176` estava livre quando medi e foi tomada pela
branch `pr-346` enquanto eu escrevia. Os três artefatos foram renumerados
juntos.

## Provado por execução

| O quê | Como |
|---|---|
| baseline aplica em banco novo | `install ok` com `ON_ERROR_STOP=1` |
| e re-aplica sem erro | `update ok` com `ON_ERROR_STOP=1` |
| isolamento entre 2 organizações, nas 6 tabelas | `agenda-rls.test.ts` |
| o papel decide quem escreve | `agenda-rbac.test.ts` |
| o vocabulário do banco e o do TypeScript são o mesmo | `agenda-vocabulario.test.ts` |
| a dívida de RBAC não cresceu | `rbac-config-ia-canais.test.ts`, que reprovava 5 tabelas |
| nada quebrou no resto | 119 de 119 arquivos do `test:db`, zero falha de asserção |

**Cinco sabotagens, todas com previsão nominal antes de rodar**, e o verde de
volta em cada uma: policy permissiva (2 falhas previstas, 2 medidas), gate de
papel removido (1/1), vocabulário divergente (1/1), RBAC afrouxado (1/1),
escrita liberada no espelho do Google (1/1 — depois de consertar o próprio
teste, que passava por violação de FK e não por RLS).

## A prova em tela — dívida ABERTA, e por que não declaro endereço ainda

A DECISÃO 21 pede que frente sem pixel declare `prova-em-tela: <caminho>`, e o
gate `entrega-sem-tela-declara-quem-prova.test.ts` exige que o caminho exista.

**Não declaro nenhum, e a razão não é esquecimento.** As telas da Agenda são da
frente 2, que está em curso; uma spec Playwright que dirige uma tela inexistente
não prova nada, e uma spec criada vazia só para satisfazer o `existsSync` seria
pior que a ausência — seria o endereço real apontando para o cômodo vazio.

Estas são as quatro propriedades do schema que **só a tela prova**, e nenhuma
delas a camada de API consegue provar sozinha:

1. **O RBAC é visível, não só verdadeiro.** O `viewer` tem de VER a agenda e não
   conseguir marcar. Se a tela oferece o botão e o banco recusa, é o
   anti-pattern "tela oferece o que o código ignora" — esta base já pagou um PR
   inteiro por ele.
2. **O vocabulário chega traduzido.** `ROTULO_DA_SITUACAO` existe para "Não
   compareceu" aparecer onde o banco diz `no_show`. Nenhum teste meu prova que a
   tela usa o rótulo em vez do código.
3. **A cor da pessoa aparece.** `calendar_color` nasce `NULL` de propósito e a
   tela deriva de `corPadraoDoMembro`; se não derivar, todo mundo nasce sem cor
   e o filtro por pessoa perde o eixo visual.
4. **O estado vazio de quem não publicou horário.** A DECISÃO 1 diz que a tela
   não pode dizer "nenhum horário disponível" e calar — é a diferença entre o
   produto parecer quebrado e parecer que está esperando você.

**Endereço proposto, a confirmar com a frente 2:**
`tests/e2e/agenda-quem-marca-e-quem-ve.spec.ts` para (1) e
`tests/e2e/agenda-grade.spec.ts` para (2), (3) e (4). Quando qualquer um dos
dois existir, a linha `prova-em-tela:` entra aqui e o gate passa a vigiá-la.

## Dívidas declaradas

- Os dez pares de vocabulário vivem em arquivo próprio porque
  `vocabulario-banco-x-typescript` é congelado. Migram quando houver autorização
  do dono; a razão está no cabeçalho de `agenda-vocabulario.test.ts`.
- `lib/database.types.ts` não foi regenerado. Medido: zero import real no repo
  inteiro — as duas menções são comentários dizendo que está desatualizado.
- `docs/architecture/agenda.architecture.json` não existe. Quem o criar aciona
  os cinco casos de `mapas-de-arquitetura`; mapa meio-escrito reprova o `verify`.
- **Nenhum gate mede que a migration e o apêndice do baseline concordam.** Fiz
  por construção (derivando um do outro) porque errei antes; a próxima pessoa
  faz por cópia e a divergência só aparece no banco do cliente.
