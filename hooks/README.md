# hooks/

React hooks compartilhados (Client Components).

A popular conforme as specs:

- `useSupabaseRealtime.ts` — subscribe a `postgres_changes` filtrado por tenant
- `useToast.ts` — notificações
- `useDebouncedCallback.ts`
- `useTenant.ts` — contexto do tenant atual (lê de cookie/header validado pelo server)
- `useFeatureFlag.ts` — flags simples por tenant (ex: ai_handoff_enabled)

Convenções:

- Sempre `"use client"` no topo
- Validar input com Zod onde aplicável
- Cleanup explícito em `useEffect` (canais Realtime, listeners, timers)
