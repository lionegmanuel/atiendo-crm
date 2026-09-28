# O passo do telefone pergunta COMO se conecta

**Tipo:** reproduzível — o script está em `tests/e2e/wizard-do-funcionario.spec.ts`
(caso "o passo do telefone pergunta COMO se conecta antes de assumir o código") e em
`tests/unit/onboarding-escolhe-como-conecta.test.tsx`.

**Contra:** `bc079649` (main, release v1.4.0) + a branch `feat/canal-no-onboarding`.
**Ambiente:** Supabase local pg17 com o `baseline.sql` aplicado, `next build` + `next start`
(produção), worktree com `node_modules` real. **Sem WAHA, sem chave de IA, sem `META_*`** —
que é o estado de quem acabou de instalar numa VPS.

## O que estas quatro telas provam

| Arquivo | O que prova |
|---|---|
| `canal-no-onboarding-1-a-pergunta.png` | O passo abre **perguntando**, com as três formas que o produto suporta. Antes abria já assumindo o código no celular. As duas saídas ("Pular por enquanto", "Conectei em outro lugar") existem já neste estado. |
| `canal-no-onboarding-2-conta-oficial.png` | O ramo da conta oficial monta o formulário real de Conexões (não uma cópia), **precedido do aviso** de que este servidor ainda não recebe por esse caminho — e o aviso aponta a saída que funciona hoje. |
| `canal-no-onboarding-3-provedor-parceiro.png` | O ramo do parceiro monta o cliente dele. A marca do parceiro **não é digitada em lugar nenhum** da tela do wizard: vem do servidor. |
| `canal-no-onboarding-4-codigo-no-celular.png` | O ramo do código, num ambiente **sem WhatsApp de pé** — o estado real de uma instalação fresca. A tela diz o que houve, mostra o detalhe técnico, e oferece "Tentar de novo" mais as duas saídas. Nenhum beco. |

## A prova que não é visual — e é a que tem dente

O defeito não era a ausência da pergunta: era o canal **nascer sem que ninguém escolhesse**.
`_client.tsx` disparava `POST /api/v1/onboarding/whatsapp/session` no primeiro efeito, e a
linha em `channel_sessions` nasce com o provedor default do transporte por código.

Medido contando linhas no banco durante a jornada, numa organização recém-criada:

```
CANAIS CRIADOS SEM ESCOLHER: 0
CANAIS APOS NAVEGAR PELOS TRES RAMOS: 0
CANAIS APOS ESCOLHER O CODIGO: 1
```

A linha do meio é a que importa: passear pelos dois ramos de credencial — inclusive abrir o formulário
oficial e o do parceiro — **não deixa canal pendurado**.

## Sabotagem

Teste verde não prova que ele vigia. Devolvendo o `POST` para a montagem da tela (o defeito
original), `tests/unit/onboarding-escolhe-como-conecta.test.tsx` reprova **4 dos 9 casos** —
incluindo "escolher conta oficial leva ao canal oficial, e NÃO cria sessão de código".

## O que este trabalho NÃO fez

Não existe, nem aqui nem na tela de Conexões, um aviso de **"o webhook ainda não foi ligado
do outro lado"**. Quem conecta pela conta oficial e não completa a assinatura no painel da
Meta segue enviando e nunca recebendo, em silêncio. É um buraco real e **anterior** a esta
mudança, que vale para os dois caminhos — construí-lo só no wizard deixaria o produto
incoerente. Fica registrado como trabalho por fazer.
