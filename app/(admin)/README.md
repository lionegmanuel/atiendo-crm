# Admin routes (super-admin de plataforma)

> Placeholder. Rotas vivem em `admin.deskcomm.com` (subdomínio dedicado).

Conteúdo a popular conforme Spec 01 — Plataforma Base:

- `/admin/tenants` — listagem cross-tenant + busca
- `/admin/inbox` — caixa de entrada unificada
- `/admin/audit` — visualizador de `api_audit_log`
- `/admin/health` — saúde de WAHA por tenant, alarmes
- `/admin/onboarding` — wizard de criação de tenant

Toda rota nesse grupo exige:

1. `is_platform_admin = true` (validado server-side via `getUser()`)
2. MFA TOTP completado na sessão atual
3. Toda ação registrada em `api_audit_log` com `acting_as_platform_admin = true`
