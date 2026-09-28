---
title: Empty States & Errors — Catálogo
parent: README.md
fonte: Sub-PRDs + UX research
version: 0.1
date: 2026-04-28
---

# 06 — Empty States & Errors

> Catálogo padronizado em PT-BR. Toda tela com estado `empty | error | no-permission | loading-failed` deve usar uma destas composições. Ícones do Phosphor Icons (consistência com design-system base).

## Princípios

1. **Sempre dizer o porquê**: nunca "Erro" sem motivo acionável.
2. **Sempre oferecer ação**: primária + secundária quando possível.
3. **Tom direto, não infantil**: "Sem conversas" > "Ops! Nenhuma conversa por aqui :)".
4. **Request ID em erros server**: facilita suporte (Sub-PRD 01 §3.8).
5. **Reduce-motion respeitado**: sem ilustrações animadas pra quem optou.

## Formato de cada entrada

`Tela / contexto` · **Ícone Phosphor** · **Headline** · **Sub-copy** · **Ação primária** · **Ação secundária**

---

## A. Empty states (estado vazio benigno)

### A1. Primeira conversa — `/app/inbox`
- Ícone: `ChatCircleDots`
- Headline: **Nenhuma conversa ainda**
- Sub-copy: Quando um cliente mandar mensagem no WhatsApp, ela aparece aqui. Verifique se o número está conectado.
- Primária: `Ver conexão WhatsApp` → `/app/integrations/whatsapp`
- Secundária: `Convidar atendentes` → `/app/team/invite`

### A2. Filtro sem resultados — `/app/inbox?filter=unread`
- Ícone: `MagnifyingGlass`
- Headline: **Sem mensagens não lidas**
- Sub-copy: Você está em dia. Quer ver todas as conversas?
- Primária: `Ver todas` → reset filter
- Secundária: —

### A3. Pipeline vazio — `/app/pipelines/[id]`
- Ícone: `Kanban`
- Headline: **Sem cards neste pipeline**
- Sub-copy: Pedidos chegam automaticamente quando a Nuvemshop confirma vendas. Você também pode criar manualmente.
- Primária: `Criar lead manual`
- Secundária: `Ver conexão Nuvemshop` → `/app/integrations/nuvemshop`

### A4. Coluna Kanban vazia (inline)
- Ícone: `ArrowDown` cinza claro
- Headline: **Arraste cards pra cá**
- Sub-copy: —
- Sem CTAs (estado decorativo).

### A5. Lista de contacts vazia — `/app/contacts`
- Ícone: `Users`
- Headline: **Nenhum contato**
- Sub-copy: Contatos são criados automaticamente quando você recebe mensagens ou sincroniza pedidos da Nuvemshop.
- Primária: `Criar contato manual`
- Secundária: `Sincronizar Nuvemshop` → `/app/integrations/nuvemshop/sync`

### A6. Audit log vazio — `/app/audit`
- Ícone: `ListMagnifyingGlass`
- Headline: **Nenhuma ação registrada no período**
- Sub-copy: Tente expandir o intervalo de datas ou remover filtros.
- Primária: `Limpar filtros`
- Secundária: —

### A7. LGPD sem pedidos — `/app/lgpd/requests`
- Ícone: `ShieldCheck`
- Headline: **Nenhum pedido LGPD pendente**
- Sub-copy: Pedidos chegam via Nuvemshop ou direto pelo titular. Você terá D+7 (export) ou D+15 (anonimização) pra responder.
- Primária: `Solicitar anonimização manual` → `/app/lgpd/redact`
- Secundária: `Ver framework LGPD` (link doc)

### A8. Merge queue vazia — `/app/contacts/merge-queue`
- Ícone: `GitMerge`
- Headline: **Nada pra mesclar**
- Sub-copy: Quando o sistema encontrar contatos potencialmente duplicados, eles aparecem aqui pra você decidir.
- Sem CTAs.

### A9. Sem sessões WhatsApp — `/app/integrations/whatsapp`
- Ícone: `WhatsappLogo`
- Headline: **Nenhum número conectado**
- Sub-copy: Conecte um número WhatsApp pra começar a receber mensagens. Recomendamos número exclusivo, não pessoal.
- Primária: `Conectar número` → `/app/integrations/whatsapp/new`
- Secundária: `Ler boas práticas anti-banimento` (link doc)

### A10. AI usage 0 — `/app/ai/usage`
- Ícone: `Robot`
- Headline: **Sem uso de IA neste mês**
- Sub-copy: A IA começa a responder assim que você conecta um número WhatsApp e ativa um agent.
- Primária: `Configurar agent` → `/app/ai/agents`
- Secundária: —

---

## B. Errors (falha do sistema)

### B1. 404 — Página não encontrada — `/_not-found`
- Ícone: `Question`
- Headline: **Não encontramos essa página**
- Sub-copy: O endereço pode estar errado ou o item pode ter sido removido.
- Primária: `Voltar pra inbox` → `/app/inbox`
- Secundária: `Ir pra início` → `/`

### B2. 403 — Sem permissão — `/403`
- Ícone: `Lock`
- Headline: **Você não tem acesso a esta área**
- Sub-copy: Seu papel atual (`{role}`) não permite ver isso. Peça ao admin do tenant pra conceder acesso.
- Primária: `Voltar` → router.back()
- Secundária: `Ir pra inbox` → `/app/inbox`

### B3. 500 — Erro de servidor — `/_error`
- Ícone: `Warning`
- Headline: **Algo deu errado do nosso lado**
- Sub-copy: Já fomos notificados. Se persistir, mande este código pro suporte: **`{request_id}`**
- Primária: `Tentar novamente` → reload
- Secundária: `Voltar pra inbox` → `/app/inbox`

### B4. 503 — Serviço indisponível — `/503`
- Ícone: `CloudSlash`
- Headline: **Estamos com instabilidade agora**
- Sub-copy: Algumas dependências estão fora do ar. Mensagens novas podem demorar pra aparecer. Acompanhe o status: status.deskcomm.com
- Primária: `Tentar novamente em 30s`
- Secundária: `Ver status` → external link

### B5. Network offline — banner global PWA-like
- Ícone: `WifiSlash`
- Headline: **Sem internet**
- Sub-copy: Suas mudanças serão enviadas quando a conexão voltar.
- Banner persistente top-of-page até reconectar; sem botões.

### B6. Permission denied (modal contextual)
- Ícone: `Lock`
- Headline: **Ação não permitida**
- Sub-copy: Seu papel `{role}` não pode `{action}`. Peça pro admin do tenant.
- Primária: `Entendi`
- Secundária: —

### B7. Subscription expired (Fase SaaS)
- Ícone: `CreditCard`
- Headline: **Assinatura expirada**
- Sub-copy: Reative a assinatura pra continuar atendendo. Suas conversas estão preservadas.
- Primária: `Atualizar pagamento` → `/app/settings/billing`
- Secundária: `Falar com suporte`

### B8. Realtime reconnecting — banner inline (Sub-PRD 04 §3.12)
- Ícone: `ArrowsClockwise` (animado, exceto reduce-motion)
- Headline: **Reconectando…**
- Sub-copy: Mensagens novas vão aparecer assim que a conexão voltar.
- Banner amarelo top-of-content, dismissível após reconexão (vira verde "Reconectado" 3s).

### B9. WAHA session FAILED — banner em sessão
- Ícone: `WhatsappLogo` cinza + badge erro
- Headline: **Sessão {phone} caiu**
- Sub-copy: O WhatsApp Web foi desconectado no telefone. Refaça o pareamento pra continuar.
- Primária: `Reconectar QR` → `/app/integrations/whatsapp/[id]/qr`
- Secundária: `Ver runbook` (link)

### B10. Nuvemshop token_expired
- Ícone: `Storefront` + warning
- Headline: **Conexão com Nuvemshop expirou**
- Sub-copy: Pedidos novos não estão sendo importados. Reconecte em 1 minuto.
- Primária: `Reconectar` → `/app/integrations/nuvemshop/connect`
- Secundária: `Ignorar até amanhã`

### B11. AI budget exhausted
- Ícone: `Robot` + warning
- Headline: **Orçamento mensal de IA atingido**
- Sub-copy: Bot está {throttle: respondendo só com modelo econômico | desligado}. Aumente o limite ou aguarde dia 1º.
- Primária: `Aumentar limite` → `/app/ai/budget`
- Secundária: `Manter desligado`

### B12. LGPD request expired (D+7 estourado)
- Ícone: `Clock` vermelho
- Headline: **SLA estourado — D+{N}**
- Sub-copy: Este pedido deveria ter sido respondido em D+7. Escale pro super-admin imediatamente.
- Primária: `Aprovar agora`
- Secundária: `Notificar super-admin`

### B13. Idempotency conflict (mostrado em form)
- Ícone: `Warning`
- Headline: **Já enviamos esta operação antes**
- Sub-copy: Use idempotency-key diferente ou recarregue a página.
- Primária: `Recarregar`
- Secundária: —

### B14. Rate limit excedido
- Ícone: `HourglassMedium`
- Headline: **Muitas requisições**
- Sub-copy: Aguarde {retry_after}s e tente de novo.
- Banner inline que conta regressivamente.

### B15. Drag-drop conflict (toast)
- Ícone: `ArrowsClockwise`
- Headline: **Card mudou enquanto você arrastava**
- Sub-copy: Atualizamos a posição. Tente arrastar de novo se necessário.
- Toast 5s, sem ação.

### B16. Send failed (bubble-level)
- Ícone: `WarningCircle` em vermelho dentro do bubble
- Headline (inline): **Falha ao enviar**
- Sub-copy (tooltip): {error_code} — toque pra reenviar
- Primária: tap reenvia
- Secundária: long-press → menu "Excluir"

---

## C. Estados especiais (não são empty nem error)

### C1. Loading (skeleton)
- Padrão: skeleton blocks com `animate-pulse` (`prefers-reduced-motion: no-preference`); estáticos pra reduce-motion.
- Threshold pra mostrar: >300ms (evita flash em rede rápida).

### C2. Optimistic UI failed (rollback)
- Toast 5s "Não conseguimos salvar — desfizemos a mudança"
- Sem botão; só informativo.

### C3. No-permission inline (campo desabilitado)
- Tooltip: "Apenas {role+} pode editar"
- Cursor `not-allowed`.

### C4. Anonymized contact opened
- Banner roxo top: **Contato anonimizado em {date}** — Os dados pessoais foram removidos por solicitação LGPD.
- Sem CTAs (irreversível).

### C5. Blocked contact (STOP detected)
- Banner vermelho-claro: **Cliente solicitou parar (STOP)** — Envios automáticos estão bloqueados. Você ainda pode responder manualmente.
- Primária: `Desbloquear` (manager+)

### C6. Manager mode supervisor
- Banner roxo: **Modo Supervisor** — Composer desabilitado. Suas visualizações estão sendo auditadas.
- Sem CTAs.

### C7. Window 24h expired
- Banner amber no header da thread: **Última mensagem do cliente há {N}h** — Envios fora da janela de 24h podem violar a política do WhatsApp.
- Primária: continua permitindo envio (não bloqueia)

---

## D. Tom de voz padronizado (PT-BR)

| Não usar | Usar |
|---|---|
| "Ops! Algo deu errado :(" | "Algo deu errado do nosso lado" |
| "Você não pode fazer isso" | "Seu papel atual não permite" |
| "Recarregue a página" | "Tente novamente" |
| "Erro 500" sem contexto | "Algo deu errado — código {request_id}" |
| Emojis em erros | Texto + ícone Phosphor |
| Frases passivas longas | Frases curtas, ativas |

## E. Acessibilidade dos estados

- Empty/error têm `role="status"` (anúncio screen reader)
- Banners de reconexão têm `role="alert"` + `aria-live="polite"`
- Toasts têm `role="status"` ou `role="alert"` conforme severidade
- Foco move pra ação primária quando estado vira ativo
- Cores nunca são o único sinal: ícone + texto + cor
