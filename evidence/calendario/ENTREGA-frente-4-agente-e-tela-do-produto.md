# ENTREGA — Frente 4 · O agente marca, e o compromisso aparece na tela do cliente

prova-em-tela: tests/e2e/agente-marca-consulta.spec.ts
prova-em-tela: tests/e2e/agenda-tela-do-produto.spec.ts

> Este registro nasce de uma execução, não de uma leitura. Tudo abaixo saiu de
> rodar as specs contra um Postgres aplicado do `baseline.sql` (stack isolado,
> Kong em 54421) e o app em `next build` + `next start` na 3011 — a receita de
> ambiente fresco da doutrina de QA Visual.

## As três fotos, e o que cada uma prova

| imagem | o que ela é lastro de |
|---|---|
| `agente-marca-consulta.png` | o agente marcou **pelo caminho real do MCP**, e o nome do CONTATO aparece na Agenda — as três linhas dizem "Paciente Agenda E2E" |
| `tela-do-produto-claro.png` | a tela que o cliente abre em 1440×1000, **não** a vitrine |
| `tela-do-produto-celular.png` | a mesma em 390×844, com a medida de estouro horizontal ≤ 0 feita por `scrollWidth − clientWidth`, não a olho |

## O que a execução ACHOU — quatro defeitos que o código parado não mostrava

**1. O seed nascia com telefone sem `+`.** O CHECK do contato é
`^\+\d{8,15}$`; os outros quatro seeds da casa escrevem com o `+` e este era o
único fora. O `INSERT` falhava e derrubava as duas metades da spec. Um
caractere.

**2. A tela prometia "com quem" e só o servidor não entregava.** O subtítulo diz
*"O que está marcado, com quem, e quem atende"*. Os dois componentes já
renderizavam `quemSeraAtendido` e o wire já tinha o campo — `page.tsx` trazia
`contact_id` no `select` e o descartava no mapeamento. O modo de falha é o que
vale: `dados-de-mentira.ts` preenche esse campo nos **11** cards, então a tela
pareceu completa o desenvolvimento inteiro, e no dia da ligação ao banco o
`?? a.titulo` do histórico transformou a ausência em **silêncio** — sem card em
branco, sem erro. Medido nas duas direções: sem o campo, METADE 2 reprova; com
ele, 3 de 3.

**3. O nome acessível do card dizia o contrário do vocabulário da página.** O
`aria-label` era `, com ${pessoa.nome}` — o ATENDENTE. Quem usa leitor de tela
ouvia os dois papéis trocados, e o card visual não desmente porque só mostra o
contato quando `duracao >= 45`, e consulta de clínica dura 30.

**4. Uma spec que só passava com o banco sujo.**
`getByRole("heading", {name:"Agenda"})` casa por substring, e o estado vazio
("Sua agenda está livre esta semana") é um segundo heading. O estado vazio é o
da **instalação fresca** — o produto que se vende — e a spec passava só porque
outra deixava agendamentos para trás. Com 3 linhas passa, com 0 falha; medido
nas duas direções antes de tocar. A linha do link, duas acima, já usava `exact`.

## E um teste que já era DESLIGADOR

`"a tela declara honestamente que ainda não lê agendamentos"` cobrava
`data-fonte="vazio-ate-a-api"`. A leitura passou a existir — `_client.tsx` emite
`"api"` / `"api-sem-dado"` —, a dívida foi paga e a asserção ficou cobrando o
estado de ontem. **Só não reprovava porque a falha do item 4 abortava o bloco
serial**: 22 testes rodavam antes, 27 depois.

Ele agora guarda a INTENÇÃO (decisão 18 — fonte real, nunca dado de mentira) em
vez do valor vencido, e isso foi **provado sabotando**: com
`data-fonte="vitrine"` ele reprova com a mensagem prevista
(`Expected pattern: /^api(-sem-dado)?$/  Received string: "vitrine"`).

> A primeira tentativa de sabotagem **não valeu**: deu vermelho por timeout de
> 180s esperando `tela-agenda`, porque rodar com `-g` atropelou o `beforeAll`.
> Vermelho pela razão errada não prova guarda nenhuma — refeito com o arquivo
> inteiro.

## Placar

Conjunto de agenda, banco no estado fresco: **27 passed, 1 skipped**
(`agenda-marcar-pela-tela` segue fora — depende de recurso de VPS).
