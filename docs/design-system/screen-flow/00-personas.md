---
title: Personas — focadas em UX
parent: README.md
fonte: docs/prd/00-prd-master.md §3
version: 0.1
date: 2026-04-28
---

# 00 — Personas (lente de UX)

> Refresh sintético das 5 personas do PRD-Mestre §3, focado em decisões de produto: quem está na tela, o que quer fazer, o que dói, e como medimos sucesso.

## P1 — Operador BPO (atendente da operadora) — **PRIMÁRIA MVP**

Funcionário da empresa operadora atendendo **múltiplos tenants** simultaneamente via caixa de entrada cross-tenant. Cabeça do MVP: 80% do tempo dele determina o produto. Trabalha 8–12h/dia em laptop ≥1280px, alterna entre conversas WhatsApp e painel CRM constantemente. Não tem tempo pra ler tutorial.

| JTBD | Frustration | Métrica de sucesso |
|---|---|---|
| Ver fila unificada cross-tenant em 1 clique | Trocar de aba/sessão entre tenants | TTI inbox < 1s |
| Atender em <30s a partir do toast de notificação | Esquecer contexto do cliente (último pedido, histórico) | Tempo até 1ª resposta humana < 5min |
| Reaproveitar resposta da IA quando dá pra continuar dela | Repetir pergunta que já está no histórico | Taxa de quick reply usada > 40% |
| Marcar conversa como resolvida e seguir | Não saber se IA já respondeu o que precisa | Taxa de resolução individual / hora |
| Sinalizar caso problemático pro manager | Demora pra atribuir / passar pra colega | Reassign rate < 10% |

JTBD adicionais: enxergar último pedido sem trocar de tela; ver sentiment_score em tempo real; abrir ticket sem perder a conversa atual.

## P2 — Super-admin de plataforma (sócio/líder operacional) — **PRIMÁRIA MVP**

Sócio ou líder da operadora BPO. Acessa via `admin.deskcomm.com`. **Não fica no painel passivo** — a maior parte do tempo está na inbox cross-tenant operando como operador, mas com poderes de triagem e supervisão. MFA TOTP obrigatório.

| JTBD | Frustration | Métrica de sucesso |
|---|---|---|
| Triagem rápida cross-tenant: o que está estourando agora? | Sem visibilidade unificada de SLA por tenant | Tempo até detectar incidente WAHA < 5min |
| Identificar tenant perto de banimento WAHA | Não saber qual número está em risco | Banimentos/mês = 0 |
| Atribuir/reassignar atendente em massa | Distribuir carga manualmente conversa-a-conversa | Conversas "Sem responsável" < 5/h |
| Auditar ação suspeita (quem viu o quê) | Audit log enorme sem filtros | Audit query p95 < 2s |
| Impersonate tenant pra reproduzir bug | Pedir credencial do cliente | 0 incidentes resolvidos com login compartilhado |

## P3 — Tenant admin (lojista / gestor do e-commerce) — **secundária MVP, primária SaaS**

Dono ou gerente do e-commerce cliente. No MVP entra **pouco** (operadora atende em nome dele); o que ele faz: configurar IA, aprovar pedidos LGPD, ver KPIs do mês. No SaaS futuro vira persona dominante.

| JTBD | Frustration | Métrica de sucesso |
|---|---|---|
| Configurar prompt da IA + base de conhecimento sem código | Mexer em arquivo / chamar suporte | Tempo de setup IA < 15min |
| Aprovar pedido LGPD sem cair em PDF de PDF | Burocracia jurídica obscura | SLA D+7 cumprido em ≥99% |
| Ver custo de IA do mês em uma tela | Surpresa na fatura | NPS billing > 70 |
| Conectar Nuvemshop em ≤4 cliques | OAuth quebrar e ele não saber por quê | Connection success rate > 95% |
| Convidar atendente novo | Onboarding manual de 30min | Convite → 1ª resposta atendente < 24h |

## P4 — Atendente do tenant (Fase 2 SaaS)

Funcionário do e-commerce cliente operando o CRM próprio. UI **idêntica** ao operador BPO, mas escopo de 1 tenant. Não vê inbox cross-tenant, não vê dropdown de seleção de tenant.

| JTBD | Frustration | Métrica de sucesso |
|---|---|---|
| Atender clientes da loja com contexto completo | Repetir pergunta que cliente já respondeu | Mesmas do P1 (escopo 1 tenant) |
| Saber quando cliente é VIP | Tratar igual atendente novato | NPS > 80 |
| Receber notificação só do que é dele | Toast de tenant errado | Notification noise < 5/dia |
| Ver presença dos colegas | Mandar pra alguém offline | Reassign cego = 0 |
| Trocar status (online/busy/offline) | Sistema não respeitar pausa | Sessões interrompidas < 2/dia |

## P5 — Cliente final (comprador do e-commerce) — **north star, NÃO acessa UI**

Pessoa física que comprou ou está comprando. **Não acessa o CRM**; é atendido via WhatsApp. É o "cliente do cliente", e toda decisão de UX do CRM precisa otimizar a **experiência dele indiretamente**.

| JTBD | Frustration | Métrica de sucesso (medida no atendimento) |
|---|---|---|
| Ter resposta em <30s pra dúvida simples | Esperar 30+ min sem resposta | Tempo médio até 1ª resposta < 30s (IA) / 5min (humano) |
| Falar com humano quando IA trava | Bot em loop | Taxa de handoff por incerteza alinhada à expectativa |
| Não repetir histórico ao trocar de atendente | Re-explicar tudo do zero | Repeat-question rate < 5% |
| Saber status do pedido sem clicar em link | "Onde tá meu pedido?" sem resposta clara | First-message resolved by IA > 60% |
| Receber resposta humana no WhatsApp normalmente | Templates frios | NPS pós-conversa ≥ 75 |

## Tabela compacta — quem vê qual UI

| Persona | Layout principal | Cross-tenant? | MFA? | Kanban? | Inbox? | LGPD admin? |
|---|---|---|---|---|---|---|
| P1 Operador BPO | `/app` (com seletor tenant via super-admin) | sim (via P2) | recomendado | leitura | escrita | não |
| P2 Super-admin | `/admin` + `/app` (como impersonate) | sim | obrigatório | escrita | escrita | sim cross-tenant |
| P3 Tenant admin | `/app` (1 tenant) | não | obrigatório | escrita | escrita | sim do tenant |
| P4 Atendente tenant | `/app` (1 tenant) | não | recomendado | escrita | escrita | não |
| P5 Cliente final | WhatsApp | n/a | n/a | n/a | n/a | n/a |
