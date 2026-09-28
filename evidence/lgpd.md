# LGPD — prova do ciclo de anonimização · 2026-07-24

Evidência produzida por **@QAVivo**. Duas frentes: o **ensaio** (concluído, 9/9) e a
**prova real** (bloqueada por um bug encontrado no caminho).

## Resultado do ensaio — 9/9 PASS

`tests/capture-lgpd-ensaio-tenant-b.ts`, no tenant descartável, com `store_redact`.

| # | Verificação | Resultado |
|---|---|---|
| 1 | UI: a tela de aprovação **abre** | PASS |
| 2 | UI: aprovação transiciona o pedido | PASS — `received` → `processing` |
| 3 | Worker de LGPD executou | PASS — 1 evento, `tenant_completed` |
| | **o que TEM de sumir** | |
| 4 | Contato anonimizado | PASS — `Cliente Anonimizado #877bfe4f` |
| 5 | `activity.reason` → NULL | PASS — era texto com telefone do titular |
| 6 | `activity.payload` / `metadata` zerados | PASS — `{}` e `{}` |
| | **o que NÃO pode sumir** | |
| 7 | `activity.evidence` sobreviveu | PASS — idêntico antes/depois |
| 8 | `activity.actor_kind` sobreviveu | PASS — `ai` → `ai` |
| 9 | `created_at` preservado | PASS |

**A doutrina se confirma na prática:** o cascade apaga o que é PII e preserva o que é
auditoria. Não apaga demais nem de menos — e só o teste dos **dois lados** mostra isso.

## Dois bugs encontrados, ambos no caminho da tela

### 1. A tela de aprovação cai — vocabulário divergente

`ApproveButton.tsx` faz `VARIANT_LABELS[requestType].button`.

| | valores |
|---|---|
| O que a **UI** conhece | `customer_data_request` · `customer_redact` · `store_redact` |
| O que o **banco** aceita (`lgpd_requests_request_type_check`) | `data_request` · `redact` · `store_redact` |
| Interseção | **só `store_redact`** |

Um pedido `redact` (anonimizar **um cliente**) faz `VARIANT_LABELS['redact']` ser
`undefined`, `.button` lança, e a página inteira cai no error boundary.

**Dos três tipos, dois quebram** — e são justamente os dois que tratam de **um titular**.
Não dá nem para criar um pedido no vocabulário da UI: o banco **rejeita** `customer_redact`.

### 2. O filtro esconde o pedido — mesma raiz, efeito pior

Filtrar por "Anonimização cliente" **não devolve nada** (controle: filtrar por outro tipo
também esconde, provando que o filtro aplica de verdade). A lista ainda mostra o tipo cru
(`redact`) em vez do rótulo humano.

> **A tela que quebra grita; o filtro que não acha é silencioso.** O admin filtra, vê lista
> vazia, conclui "não há pedido pendente" e vai embora — com o prazo legal correndo.

Critério de re-teste: não basta a tela abrir — **o filtro tem que achar**.

## Débito registrado (não construído)

**Não existe runner por handler.** `processLgpdRedact` é função pura sem `main`, e o único
script de worker é o genérico, que carrega **todos** os handlers — inclusive os de envio.

Consequência operacional real, além desta entrega: em produção **não dá para processar uma
classe de evento isoladamente**, nem **reprocessar um evento específico** depois de um
incidente. Num sistema que promete SLA de LGPD, isso é limitação de operação, não detalhe.

O runner deste teste (escopo cirúrgico: só `lgpd.redact_received`, só a org alvo, com
guarda que recusa qualquer coisa fora disso) resolve o ensaio — **não** substitui o que
falta em produção.

## O que o ambiente impediu

- **Sem worker rodando**: `healthz` 8787 mudo e **139 eventos de envio pendentes**
  (`message.sent` / `message.outbound`), alguns de **29 de abril**. Subir o worker genérico
  dispararia mensagem de três meses atrás para contato real.
- **Mensagens fora do ensaio**: o tenant descartável não tem `channel_session`, e criar uma
  seria inventar um número de WhatsApp inexistente. O ensaio cobre contato + atividades;
  a cobertura de mensagens entra na prova real.

## Nota de método — o alcance é que define o risco

`store_redact` anonimiza o **tenant inteiro**: na org de teste seriam **55 contatos, 132
mensagens e 51 leads**, irreversíveis. Por isso o ensaio foi no tenant descartável.

Mas a **prova real não precisa disso**: `redact` é *contact-scoped* — toca só o titular
alvo. Quando o vocabulário for alinhado, roda direto na org de teste, sem risco.

**A regra não é "prova de LGPD exige tenant separado". É: o que define o risco é o alcance
da operação, não o assunto dela.**
