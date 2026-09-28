# components/

Componentes React compartilhados.

- `ui/` — primitives do shadcn/ui (instalar via `npx shadcn@latest add <component>`)
- `<Feature>/` — componentes específicos de domínio (ex: `inbox/ConversationList.tsx`)

## Convenções

- Server Components por default; `"use client"` apenas quando precisa estado/event handler/browser API
- Props tipadas; `Readonly<{...}>` em props de componentes puros
- Sem fetching direto em Server Component sem cache configurado (`cache: "no-store"` ou `revalidate`)
- Estilo via Tailwind + tokens de `app/globals.css`. Sem CSS-in-JS
