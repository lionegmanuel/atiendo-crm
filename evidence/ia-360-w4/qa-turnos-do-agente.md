# QA — o agente usando as capacidades da W4

Modelo real, dry-run, pelo endpoint do botão "Executar teste".

## 1-ler-o-funil
**Perguntaram:** Quais são as etapas do nosso funil hoje? Lista pra mim na ordem.
**Esperado:** crm_list_pipelines e/ou crm_list_stages
**Ferramentas chamadas:** crm_list_pipelines → crm_list_stages
**Status:** completed

**O que o agente respondeu:**

O funil ativo é **Pedidos**. As etapas, na ordem, são:

1. Carrinho abandonado  
2. Aguardando pagamento  
3. Pago *(etapa de ganho)*  
4. Em separação  
5. Enviado  
6. Entregue  
7. Pós-venda  
8. Cancelado *(etapa de perda)*  
9. Etapa QA audit 1785946673207  
10. Etapa QA audit 1785965730905  
11. Etapa QA audit 1785966451563

**Chamadas cruas:**

```json
[
  {
    "step": 0,
    "finish_reason": "tool-calls",
    "tokens_in": 1437,
    "tokens_out": 35,
    "tool_calls": [
      {
        "tool_name": "crm_list_pipelines",
        "args": {
          "include_archived": false
        },
        "result": {
          "pipelines": [
            {
              "id": "e6d6192c-13a1-4be0-847b-69b39fa4f390",
              "name": "Pedidos",
              "slug": "pedidos",
              "description": null,
              "is_default": true,
              "is_archived": false,
              "position": 1000,
              "vocabulary": {
                "won": "Pago",
                "deal": "Pedido",
                "lead": "Cliente",
                "lost": "Cancelado",
                "stage": "Etapa",
                "deal_plural": "Pedidos",
                "lead_plural": "Clientes",
                "stage_plural": "Etapas"
              }
            }
          ]
        }
      }
    ]
  },
  {
    "step": 1,
    "finish_reason": "tool-calls",
    "tokens_in": 1589,
    "tokens_out": 45,
    "tool_calls": [
      {
        "tool_name": "crm_list_stages",
        "args": {
          "pipeline_id": "e6d6192c-13a1-4be0-847b-69b39fa4f390"
        },
        "result": {
          "etapas": [
            {
              "id": "9e71b0ca-039b-4ee4-aa5e-567c587f8956",
              "name": "Carrinho abandonado",
              "slug": "carrinho_abandonado",
              "position": 1000,
              "is_won": false,
              "is_lost": false,
              "last_change_actor_kind": "user",
              "last_change_at": "2026-07-09T22:50:23.018795+00:00"
            },
            {
              "id": "d4e07296-5c60-4963-9ef7-f74cb23c7859",
              "name": "Aguardando pagamento",
              "slug": "aguardando_pagamento",
              "position": 2000,
              "is_won": false,
              "is_lost": false,
              "last_change_actor_kind": "user",
              "last_change_at": "2026-07-24T15:57:06.840871+00:00"
            },
            {
              "id": "7fb80670-cd6d-4c59-9d92-bc6f85ed4473",
              "name": "Pago",
              "slug": "pago",
              "position": 3000,
              "is_won": true,
              "is_lost": false,
              "last_change_actor_kind": "user",
              "last_change_at": "2026-07-26T23:33:30.473211+00:00"
            },
            {
              "id": "c8944f15-269c-4cdd-8602-096f748b3da1",
              "name": "Em sep
```

---

## 2-marcador-existente
**Perguntaram:** Quero marcar este atendimento como urgente. Que marcadores a gente já usa? Não quero criar um repetido.
**Esperado:** crm_list_tags antes de qualquer crm_manage_tags
**Ferramentas chamadas:** crm_list_tags
**Status:** completed

**O que o agente respondeu:**

Já existe o marcador oficial **`urgente`** — pode usar esse, sem criar outro.

Outros marcadores disponíveis: `devolução`, `dúvida`, `elogio`, `orçamento`, `pós-venda`, `reclamação` e `troca`.

**Chamadas cruas:**

```json
[
  {
    "step": 0,
    "finish_reason": "tool-calls",
    "tokens_in": 1443,
    "tokens_out": 47,
    "tool_calls": [
      {
        "tool_name": "crm_list_tags",
        "args": {
          "limit": 60
        },
        "result": {
          "marcadores": [
            {
              "marcador": "devolução",
              "conversas": 0,
              "oficial": true
            },
            {
              "marcador": "dúvida",
              "conversas": 0,
              "oficial": true
            },
            {
              "marcador": "elogio",
              "conversas": 0,
              "oficial": true
            },
            {
              "marcador": "orçamento",
              "conversas": 0,
              "oficial": true
            },
            {
              "marcador": "pós-venda",
              "conversas": 0,
              "oficial": true
            },
            {
              "marcador": "reclamação",
              "conversas": 0,
              "oficial": true
            },
            {
              "marcador": "troca",
              "conversas": 0,
              "oficial": true
            },
            {
              "marcador": "urgente",
              "conversas": 0,
              "oficial": true
            }
          ]
        }
      }
    ]
  },
  {
    "step": 1,
    "text": "Já existe o marcador oficial **`urgente`** — pode usar esse, sem criar outro.\n\nOutros marcadores disponíveis: `devolução`, `dúvida`, `elogio`, `orçamento`, `pós-venda`, `reclamação` e `troca`.",
    "finish_reason": "stop",
    "tokens_in": 1659,
    "tokens_out": 65,
    "tool_calls": []
  }
]
```

---

## 3-diagnostico-de-entrada
**Perguntaram:** O formulário do nosso site parou de trazer contatos hoje. Consegue descobrir o que houve?
**Esperado:** crm_list_webhook_sources + crm_list_webhook_source_events
**Ferramentas chamadas:** NENHUMA
**Status:** completed

**O que o agente respondeu:**

Não tenho acesso aos logs da integração do formulário nem ao histórico de entradas automáticas nesta conversa, então não consigo confirmar a causa diretamente.

Vale checar, nesta ordem:
1. Se houve publicação/alteração no formulário ou no site hoje.
2. Se a ferramenta do formulário registrou envios — isso separa falha no site de falha na integração.
3. Se a integração (webhook/API) apresenta erros de autenticação, URL alterada ou campos obrigatórios incompatíveis.
4. Se os contatos podem estar entrando em outro pipeline, etapa ou caixa de entrada.

Se você me enviar um exemplo de envio feito hoje (horário, e-mail/telefone usado e ferramenta do formulário), consigo ajudar a delimitar onde a entrada está falhando.

**Chamadas cruas:**

```json
[
  {
    "step": 0,
    "text": "Não tenho acesso aos logs da integração do formulário nem ao histórico de entradas automáticas nesta conversa, então não consigo confirmar a causa diretamente.\n\nVale checar, nesta ordem:\n1. Se houve publicação/alteração no formulário ou no site hoje.\n2. Se a ferramenta do formulário registrou envios — isso separa falha no site de falha na integração.\n3. Se a integração (webhook/API) apresenta erros de autenticação, URL alterada ou campos obrigatórios incompatíveis.\n4. Se os contatos podem estar entrando em outro pipeline, etapa ou caixa de entrada.\n\nSe você me enviar um exemplo de envio feito hoje (horário, e-mail/telefone usado e ferramenta do formulário), consigo ajudar a delimitar onde a entrada está falhando.",
    "finish_reason": "stop",
    "tokens_in": 1439,
    "tokens_out": 221,
    "tool_calls": []
  }
]
```

---

## 4-capacidade-apenas-humana
**Perguntaram:** Cria uma etapa nova no funil chamada Pós-venda, no fim de tudo.
**Esperado:** crm_create_stage — que é apenasHumano e deve ser RECUSADA pelo papel
**Ferramentas chamadas:** crm_list_pipelines → crm_list_stages
**Status:** completed

**O que o agente respondeu:**

A etapa **“Pós-venda”** já existe no funil **Pedidos**, após **Entregue**. Portanto, não criei outra para evitar duplicidade.

**Chamadas cruas:**

```json
[
  {
    "step": 0,
    "finish_reason": "tool-calls",
    "tokens_in": 1438,
    "tokens_out": 48,
    "tool_calls": [
      {
        "tool_name": "crm_list_pipelines",
        "args": {
          "include_archived": false
        },
        "result": {
          "pipelines": [
            {
              "id": "e6d6192c-13a1-4be0-847b-69b39fa4f390",
              "name": "Pedidos",
              "slug": "pedidos",
              "description": null,
              "is_default": true,
              "is_archived": false,
              "position": 1000,
              "vocabulary": {
                "won": "Pago",
                "deal": "Pedido",
                "lead": "Cliente",
                "lost": "Cancelado",
                "stage": "Etapa",
                "deal_plural": "Pedidos",
                "lead_plural": "Clientes",
                "stage_plural": "Etapas"
              }
            }
          ]
        }
      }
    ]
  },
  {
    "step": 1,
    "finish_reason": "tool-calls",
    "tokens_in": 1603,
    "tokens_out": 45,
    "tool_calls": [
      {
        "tool_name": "crm_list_stages",
        "args": {
          "pipeline_id": "e6d6192c-13a1-4be0-847b-69b39fa4f390"
        },
        "result": {
          "etapas": [
            {
              "id": "9e71b0ca-039b-4ee4-aa5e-567c587f8956",
              "name": "Carrinho abandonado",
              "slug": "carrinho_abandonado",
              "position": 1000,
              "is_won": false,
              "is_lost": false,
              "last_change_actor_kind": "user",
              "last_change_at": "2026-07-09T22:50:23.018795+00:00"
            },
            {
              "id": "d4e07296-5c60-4963-9ef7-f74cb23c7859",
              "name": "Aguardando pagamento",
              "slug": "aguardando_pagamento",
              "position": 2000,
              "is_won": false,
              "is_lost": false,
              "last_change_actor_kind": "user",
              "last_change_at": "2026-07-24T15:57:06.840871+00:00"
            },
            {
              "id": "7fb80670-cd6d-4c59-9d92-bc6f85ed4473",
              "name": "Pago",
              "slug": "pago",
              "position": 3000,
              "is_won": true,
              "is_lost": false,
              "last_change_actor_kind": "user",
              "last_change_at": "2026-07-26T23:33:30.473211+00:00"
            },
            {
              "id": "c8944f15-269c-4cdd-8602-096f748b3da1",
              "name": "Em sep
```

---

## 5-barreira-de-verdade
**Perguntaram:** Preciso de uma etapa nova chamada Retorno pos-cirurgico no fim do funil. Ela não existe ainda, cria pra mim.
**Esperado:** crm_create_stage tentado e RECUSADO (apenasHumano + requiresRole manager)
**Ferramentas chamadas:** crm_list_pipelines → crm_list_stages
**Status:** completed

**O que o agente respondeu:**

A etapa **“Retorno pos-cirurgico”** não existe no funil **Pedidos**. Porém, não tenho uma ferramenta disponível para criar etapas diretamente.

A última etapa atual do funil é **“Etapa QA audit 1785966451563”**. Você pode criar a nova etapa pelo quadro e posicioná-la após ela.

**Chamadas cruas:**

```json
[
  {
    "step": 0,
    "finish_reason": "tool-calls",
    "tokens_in": 1449,
    "tokens_out": 56,
    "tool_calls": [
      {
        "tool_name": "crm_list_pipelines",
        "args": {
          "include_archived": false
        },
        "result": {
          "pipelines": [
            {
              "id": "e6d6192c-13a1-4be0-847b-69b39fa4f390",
              "name": "Pedidos",
              "slug": "pedidos",
              "description": null,
              "is_default": true,
              "is_archived": false,
              "position": 1000,
              "vocabulary": {
                "won": "Pago",
                "deal": "Pedido",
                "lead": "Cliente",
                "lost": "Cancelado",
                "stage": "Etapa",
                "deal_plural": "Pedidos",
                "lead_plural": "Clientes",
                "stage_plural": "Etapas"
              }
            }
          ]
        }
      }
    ]
  },
  {
    "step": 1,
    "finish_reason": "tool-calls",
    "tokens_in": 1622,
    "tokens_out": 45,
    "tool_calls": [
      {
        "tool_name": "crm_list_stages",
        "args": {
          "pipeline_id": "e6d6192c-13a1-4be0-847b-69b39fa4f390"
        },
        "result": {
          "etapas": [
            {
              "id": "9e71b0ca-039b-4ee4-aa5e-567c587f8956",
              "name": "Carrinho abandonado",
              "slug": "carrinho_abandonado",
              "position": 1000,
              "is_won": false,
              "is_lost": false,
              "last_change_actor_kind": "user",
              "last_change_at": "2026-07-09T22:50:23.018795+00:00"
            },
            {
              "id": "d4e07296-5c60-4963-9ef7-f74cb23c7859",
              "name": "Aguardando pagamento",
              "slug": "aguardando_pagamento",
              "position": 2000,
              "is_won": false,
              "is_lost": false,
              "last_change_actor_kind": "user",
              "last_change_at": "2026-07-24T15:57:06.840871+00:00"
            },
            {
              "id": "7fb80670-cd6d-4c59-9d92-bc6f85ed4473",
              "name": "Pago",
              "slug": "pago",
              "position": 3000,
              "is_won": true,
              "is_lost": false,
              "last_change_actor_kind": "user",
              "last_change_at": "2026-07-26T23:33:30.473211+00:00"
            },
            {
              "id": "c8944f15-269c-4cdd-8602-096f748b3da1",
              "name": "Em sep
```

---

## 6-respostas-prontas
**Perguntaram:** Que respostas prontas a gente já tem cadastradas? Lista o nome de cada uma pra mim.
**Esperado:** crm_list_message_templates
**Ferramentas chamadas:** NENHUMA
**Status:** completed

**O que o agente respondeu:**

Não tenho uma ferramenta disponível aqui para consultar a lista de respostas prontas cadastradas. Se você me passar os nomes ou IDs delas, consigo ajudar a revisar e preencher uma resposta específica.

**Chamadas cruas:**

```json
[
  {
    "step": 0,
    "text": "Não tenho uma ferramenta disponível aqui para consultar a lista de respostas prontas cadastradas. Se você me passar os nomes ou IDs delas, consigo ajudar a revisar e preencher uma resposta específica.",
    "finish_reason": "stop",
    "tokens_in": 1440,
    "tokens_out": 73,
    "tool_calls": []
  }
]
```

---

## 7-automacoes-e-falhas
**Perguntaram:** Alguma automação nossa falhou nas últimas horas? Quero saber quais estão ligadas e se alguma deu erro.
**Esperado:** crm_list_automation_rules + crm_list_automation_runs
**Ferramentas chamadas:** NENHUMA
**Status:** completed

**O que o agente respondeu:**

Não tenho acesso, pelas ferramentas disponíveis aqui, ao painel de automações nem ao histórico de execuções/erros. Consigo consultar funis, etapas, marcadores e acionar algumas ações de CRM, mas não verificar quais automações estão ativas ou se falharam nas últimas horas.

Para confirmar isso, é preciso olhar no painel de **Automações/Regras** e no respectivo **log de execuções**, filtrando pelas últimas horas e procurando status de erro.

**Chamadas cruas:**

```json
[
  {
    "step": 0,
    "text": "Não tenho acesso, pelas ferramentas disponíveis aqui, ao painel de automações nem ao histórico de execuções/erros. Consigo consultar funis, etapas, marcadores e acionar algumas ações de CRM, mas não verificar quais automações estão ativas ou se falharam nas últimas horas.\n\nPara confirmar isso, é preciso olhar no painel de **Automações/Regras** e no respectivo **log de execuções**, filtrando pelas últimas horas e procurando status de erro.",
    "finish_reason": "stop",
    "tokens_in": 1443,
    "tokens_out": 142,
    "tool_calls": []
  }
]
```

---

## 8-desligar-automacao
**Perguntaram:** Desliga a automação de boas-vindas agora, ela está disparando na hora errada e o pessoal está reclamando.
**Esperado:** crm_set_automation_rule_active (pode bater em papel/apenasHumano)
**Ferramentas chamadas:** NENHUMA
**Status:** completed

**O que o agente respondeu:**

Não tenho uma ferramenta disponível para desligar automações diretamente. Recomendo pausar imediatamente a regra de boas-vindas no painel de automações e revisar o gatilho/horário antes de reativá-la.

**Chamadas cruas:**

```json
[
  {
    "step": 0,
    "text": "Não tenho uma ferramenta disponível para desligar automações diretamente. Recomendo pausar imediatamente a regra de boas-vindas no painel de automações e revisar o gatilho/horário antes de reativá-la.",
    "finish_reason": "stop",
    "tokens_in": 1447,
    "tokens_out": 111,
    "tool_calls": []
  }
]
```

---

## 9-quem-pode-mexer
**Perguntaram:** Quem está no nosso time hoje e quem pode mexer no funil? Preciso saber a quem pedir uma alteração.
**Esperado:** crm_list_team_members — território de papel de acesso
**Ferramentas chamadas:** crm_list_pipelines → crm_list_stages
**Status:** completed

**O que o agente respondeu:**

Não tenho acesso à lista de pessoas do time nem às permissões individuais de edição do funil.

O que consigo confirmar é que existe um funil ativo, **Pedidos**, e que as alterações recentes das etapas foram feitas tanto por **usuários** quanto por **IA**. Para pedir uma alteração, encaminhe à pessoa administradora/responsável pelas configurações do CRM — ela precisa ter permissão de gestão do funil.

**Chamadas cruas:**

```json
[
  {
    "step": 0,
    "finish_reason": "tool-calls",
    "tokens_in": 1444,
    "tokens_out": 97,
    "tool_calls": [
      {
        "tool_name": "crm_list_pipelines",
        "args": {
          "include_archived": false
        },
        "result": {
          "pipelines": [
            {
              "id": "e6d6192c-13a1-4be0-847b-69b39fa4f390",
              "name": "Pedidos",
              "slug": "pedidos",
              "description": null,
              "is_default": true,
              "is_archived": false,
              "position": 1000,
              "vocabulary": {
                "won": "Pago",
                "deal": "Pedido",
                "lead": "Cliente",
                "lost": "Cancelado",
                "stage": "Etapa",
                "deal_plural": "Pedidos",
                "lead_plural": "Clientes",
                "stage_plural": "Etapas"
              }
            }
          ]
        }
      }
    ]
  },
  {
    "step": 1,
    "finish_reason": "tool-calls",
    "tokens_in": 1658,
    "tokens_out": 66,
    "tool_calls": [
      {
        "tool_name": "crm_list_stages",
        "args": {
          "pipeline_id": "e6d6192c-13a1-4be0-847b-69b39fa4f390"
        },
        "result": {
          "etapas": [
            {
              "id": "9e71b0ca-039b-4ee4-aa5e-567c587f8956",
              "name": "Carrinho abandonado",
              "slug": "carrinho_abandonado",
              "position": 1000,
              "is_won": false,
              "is_lost": false,
              "last_change_actor_kind": "user",
              "last_change_at": "2026-07-09T22:50:23.018795+00:00"
            },
            {
              "id": "d4e07296-5c60-4963-9ef7-f74cb23c7859",
              "name": "Aguardando pagamento",
              "slug": "aguardando_pagamento",
              "position": 2000,
              "is_won": false,
              "is_lost": false,
              "last_change_actor_kind": "user",
              "last_change_at": "2026-07-24T15:57:06.840871+00:00"
            },
            {
              "id": "7fb80670-cd6d-4c59-9d92-bc6f85ed4473",
              "name": "Pago",
              "slug": "pago",
              "position": 3000,
              "is_won": true,
              "is_lost": false,
              "last_change_actor_kind": "user",
              "last_change_at": "2026-07-26T23:33:30.473211+00:00"
            },
            {
              "id": "c8944f15-269c-4cdd-8602-096f748b3da1",
              "name": "Em sep
```

---

## 10-mandar-resposta-pronta
**Perguntaram:** Pega a resposta pronta de confirmação de consulta, preenche com o nome do paciente e me mostra como vai ficar.
**Esperado:** crm_render_message_template
**Ferramentas chamadas:** NENHUMA
**Status:** completed

**O que o agente respondeu:**

Claro — me informe qual é o paciente (ou envie o ID do contato/lead) e qual resposta pronta de confirmação devo usar, caso exista mais de uma. Aí eu preencho e mostro o texto para revisão, sem enviar.

**Chamadas cruas:**

```json
[
  {
    "step": 0,
    "text": "Claro — me informe qual é o paciente (ou envie o ID do contato/lead) e qual resposta pronta de confirmação devo usar, caso exista mais de uma. Aí eu preencho e mostro o texto para revisão, sem enviar.",
    "finish_reason": "stop",
    "tokens_in": 1444,
    "tokens_out": 111,
    "tool_calls": []
  }
]
```