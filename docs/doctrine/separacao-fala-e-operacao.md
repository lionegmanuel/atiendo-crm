# A separação entre FALAR e OPERAR

> Proposta de arquitetura. Nasceu de um defeito medido, não de uma preferência de desenho.
> Doutrina irmã: [`sistema-vivo.md`](./sistema-vivo.md).
>
> **Execução:** [`docs/specs/16-spec-tres-papeis-do-agente.md`](../specs/16-spec-tres-papeis-do-agente.md)
> — decisões de produto fechadas, contrato, UI e ordem de construção.
>
> **O passo 1 está fechado com número** (2026-08-05, `gpt-5.6-terra`, 18 turnos, gate desarmado):
> **30,0% de vazamento com prompt de operador · 0,0% com prompt de atendimento.** A hipótese
> central — o vazamento é condicional ao prompt — se confirma.
> Relatório: [`evidence/ia-360-w4/medicao-vazamento/RELATORIO.md`](../../evidence/ia-360-w4/medicao-vazamento/RELATORIO.md).

---

## O problema, dito com precisão

Um agente que **fala com o lead** e **opera o CRM** no mesmo turno sofre uma contaminação que não
tem saída por prompt:

- Se o texto do sistema **não ensina** a usar as ferramentas, ele responde bem e **não mexe em nada**.
- Se **ensina**, ele passa a mexer — e a contar: *"Ótimo, acabei de mover seu contato aqui no nosso
  CRM"*. Resolveu um problema e criou outro.

**A causa não é o modelo.** É falha de **endereçamento**: um único contexto serve dois
destinatários. O modelo lê `crm_move_lead_stage` e lê "fale com carinho com o paciente" no mesmo
lugar e precisa adivinhar, token a token, o que é fala e o que é ação. Ele repete o que lê — é o
que um modelo de linguagem faz.

**Medido nesta base** (`gpt-5.6-terra`, turnos reais):

| o que estava no contexto | o que chegou ao usuário |
|---|---|
| `Role 'agent' insufficient (required: 'manager')` | "**seu perfil atual é agent**, e essa alteração exige permissão de **manager**" |
| `description: "…entradas automáticas de contatos (webhook_sources)"` | "nenhuma entrada automática de contatos **(webhook)** configurada" |
| `name: crm_list_webhook_sources` (após limpar a description) | "nenhuma entrada automática/**webhook** cadastrada" |

A terceira linha é a que decide o desenho: **limpei o texto e o vazamento voltou pelo NOME da
ferramenta** — que é contrato de wire e não pode ser renomeado. Não há prompt que feche isso; só
se fecha **não mostrando**.

### A TERCEIRA porta — achada depois, e esta doutrina a subestimava

A medição de 2026-08-05 encontrou uma origem que não está na tabela acima e que **não se fecha
escondendo a ferramenta**:

> "As execuções mais recentes deram erro na ação de webhook: `unsafe_url:https_required`"

Isso não veio da `description` nem do `name`. Veio do **DADO que a ferramenta devolveu**. Um
Conversador que não vê ferramenta nenhuma, mas recebe payload cru, continua vazando.

Na mesma resposta chegaram **UUIDs crus de usuários** à tela do cliente — vazamento de *dado*, não
de vocabulário, e que o detector não pega por desenho (`uuid` na lista é a palavra, não o valor).

O texto abaixo dizia apenas *"com retorno já traduzido"*, en passant. **Não é detalhe: é a terceira
porta, e ela exige uma camada própria de projeção** (spec 16 §4).

---

## O remédio já existe nesta base, em miniatura

Antes de propor coisa nova: o `inbound-turn.ts` **já resolve essa classe de problema** em três
pontos, e a proposta é generalizar o que ele faz.

**1. Falar é ato deliberado, não subproduto.**
`send_message` é tool; **texto solto do modelo é descartado**. Já existe a separação entre "o
modelo pensou" e "o cliente recebeu".

**2. O que não pode depender da memória do modelo é imposto pelo runtime.**
O turno de fechamento (`purpose: 'checkpoint'`) roda **sempre**. O comentário do próprio arquivo
diz o porquê, e é a frase que sustenta toda esta proposta:

> *"tool `update_checkpoint` dependeria de o modelo lembrar de chamá-la; a chamada de fechamento
> sempre acontece"*

**3. O modelo DECLARA em linguagem de negócio; o código TRADUZ para operação.**
`update_lead_state`: o modelo marca o avanço com evidência; a máquina de estados valida e o avanço
é **espelhado** no CRM. O modelo não move card — ele diz que a pessoa avançou. E o schema é
**largo para o SDK, whitelist `.strict()` no código**: campo forjado vira *ensino ao modelo*, nunca
strip silencioso.

**A proposta é aplicar esses três princípios ao resto das ~40 operações.**

---

## O desenho

### Turno 1 — o Conversador

- **Contexto:** voz da marca, conhecimento do produto, regras de atendimento. **Zero nome de
  ferramenta, zero nome de tabela, zero vocabulário de sistema.** Ele não sabe que existe um CRM.
- **Ferramentas:** só as que respondem pergunta de cliente (conhecimento, histórico da conversa), e
  **com retorno já traduzido** — nada de `last_change_actor_kind` no payload que ele lê.
- **Saída:** duas coisas separadas — a **mensagem** ao lead, e uma **declaração de intenção em
  linguagem de negócio**: "quer remarcar", "desistiu por preço", "prometi retorno na terça".

### Turno 2 — o Operador

- **Disparo:** imposto pelo runtime, como o checkpoint. **Roda sempre**, inclusive quando o
  Conversador não achou que era caso.
- **Contexto:** o estado do lead + a declaração + o histórico. Conhece as ~40 operações.
- **Saída:** chamadas de ferramenta e registro. **Não escreve uma linha que vá ao lead** — não tem
  canal para isso.
- **Onde moram:** mover etapa, marcar, abrir caso, agendar retorno, pedir handoff, e as capacidades
  de operação da W4.

### O contrato entre eles

**JSON validado por Zod, nunca prosa.** Prosa contamina; esquema não. O contrato já existe pela
metade em `lead_checkpoints` (compromissos, objeções, `next_action`, rolling summary) e
`lead_state` (estágio). O que falta é declará-lo como **a fronteira** entre os dois turnos, em vez
de subproduto de um turno só.

---

## O erro que quase todo mundo comete aqui

**Deixar o Conversador chamar o Operador.** Isso devolve o problema inteiro: volta a depender do
modelo lembrar, e um turno em que ele "não achou necessário" é um lead que não andou no funil, em
silêncio.

O Operador é disparado por **evento** (`event_log` + worker, o padrão que esta base já usa em todo
lugar), não por decisão do turno anterior.

---

## A rede, que não é a cura

Um gate novo em `lib/agent-engine/guardrails/before-send.ts`: **vazamento de vocabulário interno**.
Reprova a mensagem que contenha nome de ferramenta (`crm_*`), nome de tabela, ou termo de sistema
(`role`, `manager`, `pipeline`, `webhook`…), com **veto instrutivo** de volta ao modelo — o padrão
que a cadeia já usa.

⚠️ **Isso é rede, não solução.** A cura é o Conversador nunca ter visto aquele vocabulário. Mas o
gate tem valor imediato e independente: **transforma "acho que vaza" em número**, medido em
produção, antes de qualquer refatoração. É por ele que se começa.

---

## Como isso fica vivo (os invariantes)

| invariante | como esta arquitetura o cumpre |
|---|---|
| **1 · nada é ilha** | Conversador → Operador → CRM → timeline → humano → contexto do próximo turno. Cada peça com entrada e saída. |
| **2 · continuidade nos dois sentidos** | a declaração do Conversador é o input estruturado que o humano lê no handoff **e** o que o Operador consome. Um artefato, dois leitores. |
| **3 · log visível** | toda decisão do Operador emite `crm_lead_activities` — aparece na timeline, não só no banco. |
| **4 · nada morre sem próximo passo** | o Operador roda **sempre**; um turno sem ação é uma decisão registrada, não um esquecimento. |
| **5 · informação com propósito** | o gate de vazamento não só barra: devolve ao modelo o que fazer em vez disso. |
| **6 · configuração tem superfície** | Operador que não consegue agir (papel, dado faltando) → item de inbox/caso, nunca `return` mudo. |

**Métricas que não existem hoje e passam a existir:** taxa de ação por turno, vetos por gate,
turnos em que o Operador quis agir e não pôde. Se ele parar de agir, alguém vê.

---

## Ordem de construção — cada passo vale sozinho

**1. Gate de vazamento no before-send.** ✅ **FEITO** (`internal_vocabulary`, cadeia v6). Entregou o
número: **30% com prompt de operador, 0% com prompt de atendimento**. *Sinal de sucesso cumprido.*

**2. Contrato de estado explícito.** Promover o checkpoint a fronteira declarada entre os dois
papéis, com Zod e teste. Ainda um turno só. *Sinal: o contrato existe e é validado.*

**3. Turno de operação imposto, consumindo evento.** O Operador nasce rodando em paralelo ao que já
existe, sem tirar nada do Conversador — comparável lado a lado. *Sinal: o Operador age nos casos em
que o turno único não agia.*

**4. Tirar as ferramentas de CRM do Conversador.** Só depois que o passo 3 estiver cobrindo.
*Sinal: o vazamento medido no passo 1 vai a zero por ausência, não por filtro.*

Ordem inversa quebra o produto no meio.

---

## O que isso resolve da W4

As 15 capacidades de "organizar a operação" ganham **mão**: o Operador é quem as usa. E a pergunta
que ficou sem dono — *"quem conversa com o agente para ele organizar a casa?"* — deixa de existir:
a resposta não é "alguém conversa", é **"o sistema opera sozinho, por evento, e registra tudo"**.
