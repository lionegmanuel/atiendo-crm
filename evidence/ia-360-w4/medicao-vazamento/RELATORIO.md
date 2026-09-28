# O NÚMERO: quantos % dos turnos vazam jargão interno

> Passo 1 da esteira de [`docs/doctrine/separacao-fala-e-operacao.md`](../../../docs/doctrine/separacao-fala-e-operacao.md):
> *"Gate de vazamento no before-send. […] Entrega o número real do problema hoje.
> **Sinal de sucesso: saber quantos % dos turnos vazam.**"*
>
> Medido em 2026-08-05, SHA `804752c1` (árvore com as mudanças descritas em
> "O que foi tocado no instrumento"). Modelo `gpt-5.6-terra`, chave OpenAI real.

---

## A resposta, em uma tabela

| prompt | turnos rodados | com vazamento | **taxa** |
|---|---:|---:|---:|
| **OPERADOR** ("atende E mantém a casa em ordem… USE as ferramentas") | 10 | 3 | **30,0%** |
| **ATENDIMENTO** (self-hoster comum, voz de paciente) | 8 | 0 | **0,0%** |
| total | 18 | 3 | 16,7% |

Comando e saída literal em [`saida-medir.txt`](./saida-medir.txt); os 18 turnos crus
(pergunta, resposta byte a byte, ferramentas, custo) em [`turnos/`](./turnos/).

**A hipótese registrada no HANDOFF — "o vazamento é condicional ao prompt" — se
confirma, e agora com o detector na mão em vez de a olho.** 30% contra 0%.

### Por que este 0% vale mais que o 0% anterior

A medição anterior (HANDOFF, 3 turnos de paciente) também deu zero, mas a própria nota
declarava a limitação: *"Ele não chamou ferramenta nenhuma. Não vazou porque não usou."*
Zero por ausência de gatilho não mede nada.

Os cinco cenários de paciente acrescentados aqui (c4–c8) pisam de propósito no território
de cada capacidade ligada, e **três deles de fato chamaram ferramenta**:

| cenário | ferramentas chamadas | vazou? |
|---|---|---|
| c2 · "mandei mensagem pelo site e ninguém respondeu" | `crm_list_webhook_sources → crm_list_automation_rules → crm_list_automation_runs` | não |
| c4 · "preenchi o formulário do site, receberam?" | `crm_list_webhook_sources` | não |
| c6 · "me manda a mensagem com endereço e horários" | `crm_list_message_templates` | não |

São exatamente as ferramentas cujo NOME vazou do lado do operador. Com o prompt de
atendimento, o modelo leu o mesmo `crm_list_webhook_sources` e escreveu *"não consigo
verificar por aqui o que ocorreu com a mensagem enviada pelo site"*. **O zero agora é por
tradução, não por silêncio.**

---

## Os três vazamentos, crus

**1 · `3-diagnostico-de-entrada` — categoria `arquitetura`, termo `webhook`**

> "Verifiquei a configuração: **não há nenhuma entrada automática/webhook cadastrada**
> para receber os envios do formulário — nem ativa nem desativada."

É a reincidência do defeito que a doutrina já documenta: o modelo lê o `name` da tool
(`crm_list_webhook_sources`) e o repete. `name` é contrato de wire e não se renomeia.

**2 · `7-automacoes-e-falhas` — `arquitetura` + `snake_case`; termos `webhook`, `unsafe_url`, `https_required`**

> "As execuções mais recentes — incluindo a última — deram erro na ação de webhook:
> `unsafe_url:https_required`"

O pior dos três: um **código de erro cru**, copiado do resultado da ferramenta direto para
a tela do cliente. Não veio do prompt nem do nome da tool — veio do DADO que a tool
devolveu.

**3 · `9-quem-pode-mexer` — categoria `papel`; termos `admin`, `manager`**

> "Hoje o time ativo é: `56252c10-8fe1-4a6b-8b3b-845e27c7156e` — **admin** …
> `50b65ff5-…` — **manager** … `a3f26dd0-…` — **agent**"

É o vazamento medido original ("seu perfil atual é agent") de volta, por outra porta.

> ⚠️ **Achado fora do escopo do gate:** esta resposta também despejou **UUIDs crus** de
> usuários. O detector não os pega — `uuid` na lista de arquitetura é a PALAVRA, não o
> valor. Um identificador de usuário na tela do cliente é vazamento de dado, não só de
> vocabulário. Fica registrado; não foi corrigido aqui.

---

## O gate estava ARMADO no caminho medido? **NÃO.** (e a prova)

O endpoint `/api/v1/ai/agents/[id]/versions/[vid]/test` chama `runAgent` de
`lib/ai/runtime/agent.ts` — runtime marcado `@deprecated` no próprio cabeçalho
("fora do caminho quente; o runtime canônico é lib/agent-engine"). Ele **não importa a
cadeia `runBeforeSend`**, logo nenhum gate rodou.

Três medições independentes, cada uma com controle positivo (instrumento provado vivo
antes de a ausência valer como dado):

```
$ grep -rn "guardrails|before-send|agent-engine" lib/ai/runtime/
lib/ai/runtime/agent.ts:3: * O runtime canônico é lib/agent-engine (workers/agent-worker). Remoção física
   → única ocorrência é um COMENTÁRIO. Zero import.

$ # literais de string da cadeia before_send dentro do build .next
  "internal_vocabulary"        → 0 arquivo(s)
  "case_promise_without_case"  → 0 arquivo(s)
  "messaging_window_closed"    → 0 arquivo(s)
  "before_send gate avaliado"  → 0 arquivo(s)
  --- CONTROLE POSITIVO (o grep está vivo) ---
  "ai_agent_runs"              → 33 arquivo(s)
  "INTERNAL_AGENT_RUN_STUB"    → 16 arquivo(s)
  "crm_list_webhook_sources"   → 13 arquivo(s)
```

A cadeia inteira de guardrails está **ausente do build do app Next**: ela vive no processo
do worker (`workers/agent-worker`), não na rota. `internalVocabularyGate` arma num único
ponto — `lib/agent-engine/agent/inbound-turn.ts:1240`, `enforceInternalVocabulary: true`.

> **Portanto os 30% / 0% acima são vazamento CRU, com o gate desligado.** É o número que a
> doutrina pede ("transforma 'acho que vaza' em número, antes de qualquer refatoração"),
> e é assim que deve ser lido: a taxa do defeito, não a taxa que sobra depois da rede.

---

## O gate ARMADO, observado no caminho de produção

Como o número acima não exercita o gate, montei o cenário no caminho onde ele arma:
sessão de canal própria (`w4-vazamento`), versão publicada com as capacidades da W4, e o
**prompt híbrido** — *"você atende E mantém a casa em ordem"* — que a nota do HANDOFF
aponta como o risco plausível de self-hoster e que ninguém havia rodado. Turno disparado
pelo webhook do WAHA, drenado pelo worker real.

Setup em [`observar-gate-armado.ts`](./observar-gate-armado.ts); log em
[`worker-gate-armado.log`](./worker-gate-armado.log); traces em
[`before-send-traces-gate-armado.txt`](./before-send-traces-gate-armado.txt).

**Primeiro: o gate está de fato na cadeia.** O trace do turno traz os 10 gates, com
`internal_vocabulary` entre `case_promise` e `disclosure` — exatamente a posição 6.7:

```
stop pass · lgpd pass · pacing pass · messaging_window skipped(not_applicable) ·
spinning pass · promise pass · semantic_promise pass · case_promise pass ·
internal_vocabulary … · disclosure pass
```

### O veto instrutivo funcionou — e isto nunca tinha sido observado

4 turnos rodaram. **1 veto**, e o desfecho é o que o gate promete:

| horário | job | veredito |
|---|---|---|
| 20:11:59.136 | `3975bd37` | **veto** `internal_vocabulary_leak` — `leaked_count: 2`, `leaked_kinds: snake_case` |
| 20:12:03.450 | `3975bd37` | **pass** — mesma tentativa de envio, 4,3s depois |
| 20:12:10.501 | `3975bd37` | job concluído, mensagem entregue |

Ou seja: **vetou 1 vez · o modelo reescreveu na 2ª tentativa · a versão reescrita saiu
limpa.** O fail-safe (`MAX_VETOS_DE_VOCABULARIO_INTERNO = 2`) nem precisou disparar.

**O que o cliente recebeu depois da reescrita:**

> "Verifiquei as regras automáticas. Há uma regra ativa que, quando um novo cadastro é
> criado, tenta enviar os dados para uma integração externa. Os registros mostram que essa
> integração **foi bloqueada porque o endereço configurado não atende ao requisito de
> conexão segura**. […] Posso encaminhar isso para a equipe responsável corrigir a
> integração e verificar o formulário."

**MEDIDO:** o veto carregava 2 termos `snake_case`. **INFERIDO** (o corpo da candidata não
vai a log, por desenho — é trecho de mensagem de cliente): os dois termos eram
`unsafe_url` e `https_required`. A base da inferência é que a frase reescrita traduz
exatamente esse par (`unsafe_url:https_required` → "o endereço configurado não atende ao
requisito de conexão segura"), e é o mesmo par que vazou cru no cenário `7` da medição sem
gate. **Não é medição; é leitura da evidência ao redor.**

**O veto ficou visível**, como manda o invariante 3 do sistema vivo — mas não na timeline:
o contato de teste não tem lead aberto, então caiu no fallback declarado
(`event_log → agent.activity_unrouted`, `activity_type: send_vetoed`, `reason: no_open_lead`).

### Os outros 3 turnos passaram limpos, e o dado é interessante

Duas perguntas que vazaram na medição sem gate — a do formulário do site
(`webhook`) e a do time (`admin`/`manager`) — **saíram traduzidas** no caminho de produção
com o prompt híbrido, sem o gate precisar agir:

> "Verifiquei a equipe cadastrada: há 1 pessoa administradora, 1 gestora, 2 atendentes e 1
> pessoa com acesso apenas de consulta. **Não consigo informar nomes ou dados internos.**"

Compare com o mesmo território sob prompt de OPERADOR sem gate: UUIDs crus + `admin` +
`manager`. Reforça a conclusão central: **o prompt é a variável dominante**, e a rede é
rede — não é ela que está segurando os 0%.

---

## O que ficou SEM medir (declarado, não estimado)

1. **Taxa de vazamento COM o gate armado, em amostra que sustente uma taxa.** O caminho de
   produção rodou **4 turnos** — número para observar mecanismo, não para calcular
   percentual. Não divido 1 por 4 e chamo de 25%.
2. **A 2ª camada do fail-safe** (2 vetos seguidos → envio liberado com o gate desarmado,
   `MAX_VETOS_DE_VOCABULARIO_INTERNO`). O modelo consertou de primeira; o caminho de
   liberação não foi exercitado.
3. **O corpo da 1ª tentativa vetada.** Não é logado por desenho (PII). Ver a distinção
   medido/inferido acima.
4. **Um turno perdido:** a pergunta "me manda a lista das etapas do funil" (inbound
   20:12:00) chegou enquanto o job `3975bd37` rodava e não ganhou turno próprio — 5
   inbounds, 4 jobs, nenhum marcado `deduped`. Não investiguei; fora do escopo, mas
   registrado porque é uma mensagem de cliente sem resposta.
5. **Outros modelos/provedores.** Tudo em `gpt-5.6-terra`. A chave Anthropic desta máquina
   segue **sem crédito** (medido: *"Your credit balance is too low to access the Anthropic
   API"* — o primeiro turno de produção morreu nisso).

## O que foi tocado no instrumento

- `tests/e2e/qa-agente-usa-as-maos.spec.ts`
  - **+10 cenários** (5 de operador, 5 de paciente) — o denominador de 8 não sustentava taxa;
  - **dump JSON cru por turno** em `turnos/` — o relatório markdown é reescrito a cada
    corrida (e a corrida é de 1 cenário por vez), então sozinho ele guarda 1 turno;
  - **correção da extração do nome da ferramenta**: era lida no nível do PASSO, onde não
    está, e todo cenário imprimia `? → ? → ?`. O cenário `1` foi coletado antes da correção
    — o nome dele foi recuperado do dump cru, sem re-rodar o modelo (re-rodar seria jogar o
    dado de novo e ficar com o segundo resultado).
- **Banco local de E2E:** `organizations.settings.llm` da org de teste estava em
  `anthropic/claude-sonnet-4-5` (chave sem crédito) e foi apontado para
  `openai/gpt-5.6-terra`, senão nenhum turno de produção roda. Mudança em banco local, não
  versionada.

---

## Estado de ambiente deixado de propósito (decisão do Rafael, 2026-08-05)

`organizations.settings.llm` da org de E2E (`e2e-test-org`) aponta para
**`openai/gpt-5.6-terra`**, não mais para `anthropic/claude-sonnet-4-5`.

**Não é resíduo de teste — é decisão.** A chave Anthropic desta base está **sem crédito** (medido:
o primeiro turno de produção morreu com `Your credit balance is too low`), e sem essa troca
**nenhum turno de agente roda no ambiente local**. Quem for medir comportamento de agente aqui
depende disso.

Se algum dia a chave Anthropic voltar a ter saldo e alguém quiser o comportamento antigo, é um
`update` em `organizations.settings` — mas saiba que estará trocando um modelo que funciona por um
que hoje não responde.
