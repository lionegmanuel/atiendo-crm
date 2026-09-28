# tests/e2e/

Playwright tests. Smoke + jornadas críticas.

## Suítes a criar

- `auth.spec.ts` — login com MFA, refresh, logout
- `tenant-isolation.spec.ts` — **GATE OBRIGATÓRIO**: cria 2 tenants e valida que A não vê dados de B em nenhum endpoint
- `lgpd.spec.ts` — data_request E2E (request → export entregue)
- `whatsapp-inbox.spec.ts` — recebe webhook simulado, vê na inbox em <2s via Realtime
- `kanban.spec.ts` — drag-drop entre stages (fractional indexing)
- `super-admin.spec.ts` — switch de tenant + audit log com `acting_as_platform_admin`

## Comandos

```bash
npx playwright install
npm run test:e2e
```
