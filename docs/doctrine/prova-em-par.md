# Doutrina da Prova em Par — o caso de aceite que atravessa o agente

> Emenda ao item 12 do Definition of Done (`CLAUDE.md`), o "provado pela tela como um leigo
> faria". **Não substitui esse item: é a emenda dele**, para o caso em que o caminho de usuário
> passa por um agente de IA. Complementa [`sistema-vivo.md`](./sistema-vivo.md) — também não é
> aspiração, é critério de aceite. Origem: validação da v1.12.0 em produção, 2026-09-02 (#489).

## A regra

**Todo caso de aceite que atravessa o agente vem em par com a medição direta da ferramenta, com
o MESMO texto cru.** Não é "além de": é "junto de". **O par é a unidade** — um lado sozinho não diz
o que foi medido.

| lado do par | o que mede | quem mede |
|---|---|---|
| pelo agente (tela) | o atendimento inteiro, ponta a ponta | a pessoa, no navegador, num ambiente fresco |
| pela ferramenta (direto) | a camada de baixo, com o texto que a pessoa escreveu | a função pura, chamada fora do agente |

O resultado só conta como prova quando **os dois concordam**. Quando discordam, o que está sendo
medido é o **modelo**, e o defeito continua onde estava.

## Por que existe: o caso que produziu a regra

O catálogo novo tinha um defeito conhecido e registrado (#476): número que o cliente diz e não é
atributo do produto eliminava o catálogo inteiro. `"quero 2 iphone 15"` devolvia zero, porque o
`2` filtrava a busca.

Esse caso foi posto na bateria de aceite **esperando reprovar** — era ele que separava o que a
v1.12.0 entregava do que ainda estava em PR. Ele **passou**: o agente respondeu perguntando se era
o 128 ou o 256, atendimento correto do começo ao fim.

E a conclusão óbvia estaria errada. A ferramenta, medida direto com o mesmo texto, devolvia
**zero**. O que aconteceu no meio foi o modelo **reformular a consulta sozinho**, tirando o `2`
antes de chamar a busca:

```
"quero 2 iphone 15"
   pelo agente     -> "é o 128 ou o 256?"        VERDE  (e o verde era real)
   pela ferramenta -> []                          VERMELHO
```

O verde não era falso. Ele media outra coisa: **a capacidade do modelo de compensar a
ferramenta**. E compensação não é garantia — a mesma frase com outro fraseado, outro modelo ou
outra temperatura pode não ser compensada, e aí o defeito aparece num cliente.

O agravante: a `description` da tool (`lib/mcp/tools/comercio.ts`) **manda** o modelo passar o
texto cru ("Passe o que a pessoa escreveu, do jeito que ela escreveu"). A instrução existe, é
explícita, e o modelo reformulou assim mesmo. Então não dá para contar com a compensação **nem**
com a instrução. O que sobra é a ferramenta ser robusta ao texto cru — que é o conserto, não o
contorno.

## Como se percebe que se caiu nela

**O verde do agente e o vermelho da ferramenta discordam.** Com só um dos dois, não há como saber
qual você mediu. É por isso que o par tem de ser colhido junto: **a discordância é o instrumento**,
e ela só existe se os dois lados forem medidos.

Os dois lados do par de exemplo foram medidos em 2026-09-02, na validação da v1.12.0: o caso
`"quero 2 iphone 15"` na bateria de aceite (esperando reprovar, e passando) e a mesma frase na
busca, chamada direto, devolvendo zero.

## O limite honesto, para a regra não virar absoluta

A prova pela tela continua sendo **a única** que pega o que ferramenta certa não garante: prompt que
não chama a tool, agente que escala em vez de atender, resposta que sai sem o preço. Na mesma noite
a tela achou dois defeitos que nenhuma medição de função pura acharia — uma base de conhecimento mal
fatiada e um limiar de sentimento escalando cedo demais.

**O par não substitui a tela.** Ele impede que o verde da tela seja lido como prova da camada de
baixo.

## O minuto que a próxima pessoa vai viver

Isto está aqui a pedido de quem passou por ele, e é a parte mais útil.

Quem montou a bateria tinha escrito, com todas as letras, que aquele caso estava **esperando
reprovar**. Quando ele passou, houve um minuto de "então o defeito não existia". A única razão de
não ter sido lido assim é que a ferramenta **já tinha sido medida antes**, direto, e o zero estava
anotado.

Sem aquela medição prévia, um defeito real teria sido dado como resolvido por um verde que media
outra coisa — e ninguém teria motivo para desconfiar, porque o atendimento foi impecável.
