# Checkpoint G3 — Atribuição, IA-assignee, dono do lead, tags — 2026-07-17
Status: COMPLETO

## 1. Entregue nesta fase

| Feature | Título | Commit | Verificação |
|---|---|---|---|
| G3-01 | Eventos de atribuição auditáveis (claim/transfer/release) | 84f8d93 | gov-verifier PASS 2026-07-17 (1ª rodada) |
| G3-02 | IA como assignee de 1ª classe (assignee_kind) | c23f71e | gov-verifier PASS 2026-07-17 (após 1 rodada de reparo) |
| G3-03 | Dono do lead visível e filtrável (kanban + lista) | 8dec8e8 | gov-verifier PASS 2026-07-17 (1ª rodada) |
| G3-04 | Atribuição em massa de leads | ad0255e | gov-verifier PASS 2026-07-17 (1ª rodada) |
| G3-05 | Tags de conversa + filtros | 141bac4 | gov-verifier PASS 2026-07-17 (1ª rodada) |

## 2. Evidências (prova, não afirmação) — gates da fase G3

**Gate "toda mudança de dono de conversa (claim/transfer/handoff) gera evento auditável"** —
migration 0031 cria `conversation_assignment_events` (append-only, RLS org, índice
por conversa) + `fn_conversation_assign` (SECURITY INVOKER: SELECT FOR UPDATE +
UPDATE condicional + INSERT do evento na MESMA transação; `changed_by = auth.uid()`
anti-spoof). claim/release migrados pro rpc mantendo o 409 do optimistic lock;
rota de transfer nova (imediata, decisão G1-06d) + ReassignDialog no inbox.
Invariante do eixo 3 flipado. Provado por probes cross-org no Postgres descartável
(todas negaram) + idempotência de claim duplicado (409, zero evento duplicado).

**Gate "IA é assignee de 1ª classe — handoff = reassignment auditado"** — migration
0032 adiciona `conversations.assignee_kind ('user'|'ai')` com CHECK de coerência
(kind='user' ⇒ dono; kind='ai' ⇒ sem dono) + backfill antes da constraint.
`crm_request_human_handoff` grava evento `reason='handoff'` (kind ai→user com
elegível / fila sem elegível). Guard determinístico no `ai-response-worker`:
conversa `kind='user'` ⇒ bot vetado (`skip 'assigned_to_human'`, família
force_human/bot_silenced_until) — a semântica que o Vendaval consome na fase FG.
Invariante do eixo 6 flipado. **Esta feature exigiu 1 rodada de reparo**: a
forward-fix INB-06a (guard de membership em `fn_conversation_assign`, via helper
`fn_member_role_in_org`) introduziu um vazamento — o helper SECURITY DEFINER era
executável por `anon` (grant herdado de ALTER DEFAULT PRIVILEGES) e enumerava
role de qualquer tenant sem autenticar. Fechado com `revoke execute from anon`
nas 2 cópias + invariante que prova `permission denied` SOB role anon real;
re-verificação fresca PASS.

**Gate "kanban/lista mostram dono do lead, filtro por dono, atribuição em massa"** —
G3-03: OwnerBadge (nome+avatar, badge tracejada "Sem responsável", tokens do
design system) + filtro por owner deep-linkável na URL + reatribuir pelo card
(reuso de useEditLead + /team/assignable + realtime existente do board; sem
migration). G3-04: bulk assign com gate ≥manager POR-ACTION (authz.denied
automático, sem regredir move/tag/delete de agent) + validação de owner membro
agent+ da org (422 `invalid_owner`) + audit agregada `leads.bulk_assigned` +
toast com contagem; limite mantido em 50 (AT-06). 154 unit + e2e do filtro/toast.

**Gate "tags de conversa com filtro"** — migration 0033: `conversations.tags text[]`
+ GIN + vocabulário canônico em `organizations.settings.canonical_conversation_tags`
(org-scoped, DIRC na spec §3.3). PATCH aceita tags normalizadas (Zod:
lowercase/trim/dedup, ≤20 tags, ≤40 chars) com audit `conversation.tags_changed`;
editor de tags no side panel + filtro por tag no inbox. Invariante do eixo 7
flipado + invariante de filtro org-scoped (org1=1, org2=1, global≥2 — não vaza).

Screenshots em `loop/checkpoints/evidence/G3/`: G3-01-reassign-dialog,
G3-03-lead-owner, G3-04-bulk-assign(+select), G3-05-conversation-tags.

Estado dos invariantes ao fim da fase: **48 verdes** no Postgres descartável
(install+update do baseline sempre verdes); os `it.fails` GAP(G3) dos eixos 3, 6
e 7 flipados para testes normais. Suíte unit: **154 verdes**.

## 3. Pendências (cópia auditável da inbox operacional)

Todos os itens abaixo estão **open** e são `proposal`/follow-up **não-vetantes** —
nenhum bloqueou a fase. Decisão do dono no checkpoint.

- **INB-03 (G2-01)** — onboarding/whatsapp/session POST sem gate de role (recomendo
  gate admin por consistência); nota pro bulk-assign da G3-04 (já resolvida: nasceu ≥manager).
- **INB-04 (G2-02)** — race no guard de último admin (check-then-write sem lock,
  pré-existente do EPIC-09). Recomendo fechar com constraint/trigger.
- **INB-05 (G2-03)** — spec §4 nota 8 prevê api_audit_log SELECT manager+ "em G2",
  mas nenhuma feature cobre; segue admin-only. Recomendo manter admin-only + corrigir a nota.
- **INB-06 (G3-01)** — (a) validação de destino da transferência estava só na rota
  (FECHADO na G3-02 pela forward-fix INB-06a); (b) banco live do dev com drift
  (schema_migrations parou na 0027; migrations 0028-0033 não aplicadas no live —
  o gate do loop é o Postgres descartável, mas reconciliar o live antes de teste
  manual). **Ação operacional do dono.**
- **INB-07 (G3-02)** — 6 SECURITY DEFINER de ESCRITA anon-executáveis pré-existentes
  (fn_upsert_wa_*, emit_event, fn_log_event, fn_audit_log_row, fn_mark_conversation_message).
  Gap do baseline, não introduzido pela fase. Recomendo mini-feature de hardening
  (revoke execute from anon nas SECURITY DEFINER de escrita), priorizando ingestão de WhatsApp.
- **INB-08 (G3-03)** — view de lista de leads não existe no app; parte do acceptance
  da G3-03 ("coluna na lista") sem alvo (kanban é a única superfície). Escopo de produto.
- **INB-09 (G3-04)** — 2 notas do verifier: (1) validação de owner do bulk gateada
  por isServiceRoleConfigured() — bypass se service role ausente (prod sempre tem);
  (2) edge multi-org na resolução de org do 1º lead (não vaza, RLS segura). Recomendo
  agrupar com o hardening do INB-07.

## 4. Riscos observados na construção

- **Drift do banco live do dev** (INB-06b): 6 migrations pós-0027 (0028-0033) não
  aplicadas no ambiente live do dono. O gate de schema do loop é o Postgres
  descartável (sempre verde), mas qualquer teste manual no dev vai divergir até reconciliar.
- **Superfície SECURITY DEFINER × anon** (INB-07): a paridade Supabase (ALTER
  DEFAULT PRIVILEGES ... TO anon) faz TODA função nova nascer anon-executável. A
  G3-02 fechou a sua; 6 funções de escrita pré-existentes seguem expostas. Classe
  de bug recorrente — merece uma varredura de hardening dedicada.
- **UI de leads limitada a kanban** (INB-08): não há view de lista/tabela; features
  que assumam "lista de leads" (filtros, colunas) não têm superfície hoje.
- **Padrão de resolução de org na rota bulk** (INB-09.2): resolve org do 1º lead,
  não do authz — inofensivo hoje (RLS), mas frágil se a rota crescer.
- `member.role_changed` no union de audit sem emissor (doutrina append-only,
  herança da G2-02) — cosmético.

## 5. O que a PRÓXIMA fase (G4) precisa

- Aprovação deste checkpoint (`loop/checkpoints/G4… não — loop/checkpoints/G3.approved`).
- Decisões do dono nos INB abertos — nenhuma bloqueia G4-01, mas:
  - INB-06b (drift do live) é pré-requisito pra QUALQUER teste manual no dev.
  - INB-07/09 (hardening anon + org do bulk) são candidatos naturais a agrupar
    numa feature de hardening — o dono decide se entra na G4 ou vira avulso.
- G4 constrói sobre G3: `visibility_mode` (G4-01) usa `assignee_kind`/
  `assigned_to_user_id` (G3-01/02) e o harness test:db/invariantes já operante.
  A decisão G1-06a (default `own_and_unassigned`) já está na spec §3.5.

## 6. Custo da fase

- 5 sessões do loop (started 07:05, 07:49, 08:39, 09:03, 09:23 — sessions.log de
  2026-07-17; G3-01/02 abriram na virada do dia anterior 22:53/23:09 mas
  fecharam hoje), todas com PASS.
- 1 rodada de reparo (G3-02, vazamento anon — pego e fechado dentro do loop).
- Zero features bloqueadas. 3 migrations em tripla (0031, 0032, 0033) — todas
  install+update verdes no Postgres descartável.
- 7 itens de inbox abertos (todos proposal/não-vetantes) aguardando decisão do dono.
