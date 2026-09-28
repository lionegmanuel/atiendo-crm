<div align="center">

# Atiendo CRM

**CRM de WhatsApp open source con agente de IA, en español.**
Los mensajes entran a una bandeja de entrada, cada cliente nuevo aparece en un embudo Kanban y un agente de IA responde, califica y deriva a una persona cuando hace falta.

[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript)](https://www.typescriptlang.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ecf8e?logo=supabase)](https://supabase.com)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

</div>

---

## Qué incluye

- **Inbox en tiempo real** para las conversaciones de WhatsApp, con un botón para **pausar el agente** y que una persona tome la conversación.
- **Embudo Kanban** con etapas configurables y arrastrar y soltar. Cada número nuevo crea su tarjeta en la primera etapa.
- **Agente de IA** (OpenAI `gpt-4.1-mini` por defecto) que atiende, responde con la información de tu negocio, mueve la tarjeta de etapa y deriva a una persona cuando el cliente lo pide.
- **WhatsApp vía [Zernio](https://zernio.com)** en modo coexistencia: se vincula por QR y tu WhatsApp sigue funcionando en el teléfono.
- **Marca propia sin tocar código:** nombre, color e idioma desde `.env.local`.
- **Multi-empresa** con aislamiento por organización (RLS en Postgres).

## Requisitos

- [Node.js](https://nodejs.org) 22 o superior y [pnpm](https://pnpm.io) (`npm i -g pnpm`).
- Un proyecto gratuito en [Supabase](https://supabase.com).
- Una API key de [OpenAI](https://platform.openai.com).
- Una cuenta en [Zernio](https://zernio.com) y un dominio fijo gratuito de [ngrok](https://ngrok.com) (para que Zernio llegue a tu computadora).

No hace falta Docker ni servidor: todo corre en tu computadora.

---

## Instalación paso a paso

### 1. Clonar e instalar

```bash
git clone https://github.com/lionegmanuel/atiendo-crm.git
cd atiendo-crm
pnpm install
```

### 2. Base de datos (Supabase)

En tu proyecto de Supabase: **SQL Editor** → **New query** → pegá todo el contenido de [`supabase/baseline.sql`](supabase/baseline.sql) → **Run**.

> Alternativa por terminal, con `SUPABASE_DB_URL` ya cargada en `.env.local`: `pnpm db:setup`.

Recomendado: en **Authentication › Sign In / Providers › Email**, desactivá **Confirm email** para no depender del correo de confirmación.

### 3. Variables de entorno

Copiá `.env.example` como `.env.local` y completalo. La plantilla comentada, con de dónde sale cada valor, está en [`demo/env-local-plantilla.txt`](demo/env-local-plantilla.txt). Lo esencial:

| Variable | De dónde sale |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase › Project Settings › API Keys |
| `SUPABASE_DB_URL` | Supabase › botón **Connect** › *Session pooler* (si la contraseña tiene `@`, escribila como `%40`) |
| `OPENAI_API_KEY` | platform.openai.com › API keys |
| `CHANNEL_WEBHOOK_BASE_URL` | Tu dominio fijo de ngrok, por ejemplo `https://tu-dominio.ngrok-free.dev` |
| `INTERNAL_SECRET`, `CPF_ENCRYPTION_KEY`, `WAHA_BYO_ENCRYPTION_KEY` | Generalas: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `AI_CRED_AES_KEY` | Generala: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `APP_NAME`, `APP_ACCENT_HEX`, `APP_LOCALE` | Tu marca, tu color (ej. `#10b981`) y el idioma (`es`) |

Además creá un archivo `.env` vacío en la raíz (lo pide el worker de IA).

### 4. Compilar y levantar

```bash
pnpm build   # una sola vez (tarda varios minutos)
pnpm demo    # levanta la app, el agente de IA y el túnel de ngrok
```

Abrí `http://localhost:3000`, creá tu cuenta y seguí el asistente inicial. En el paso **Su teléfono** elegí *Omitir por ahora*: WhatsApp se conecta con Zernio.

### 5. Embudo en español con datos de ejemplo (opcional)

Supabase › **SQL Editor** → pegá [`scripts/seed-demo-inmobiliaria.sql`](scripts/seed-demo-inmobiliaria.sql) → **Run**. Crea 6 etapas (*Nuevo Lead* → *Cerrado Ganado / Perdido*) y 4 prospectos de ejemplo.
Correlo **después** de crear tu cuenta y **antes** de conectar Zernio.

### 6. Configurar el agente

**Agentes** → tu agente:

1. **Sus instrucciones:** pegá tu prompt. Un ejemplo completo para una inmobiliaria, con el catálogo incluido, está en [`demo/prompt-del-agente.txt`](demo/prompt-del-agente.txt).
2. **La inteligencia que usa:** OpenAI (GPT) · GPT-4.1 Mini · tu clave.
3. **Capacidades:** activá *Atender y responder* y *Pasar a un humano*; en *Elegir una por una* sumá las del embudo (por ejemplo, *Mover oportunidad de etapa*).
4. **Guardar borrador.**

### 7. Conectar WhatsApp con Zernio

1. En Zernio: WhatsApp → **modo coexistencia** → escaneá el QR desde *Dispositivos vinculados*.
2. En el CRM: **Conexiones** → **Proveedor asociado** → ID de la cuenta de WhatsApp + API key de Zernio → **Conectar**.
3. Copiá la **URL del webhook** y el **secreto** (se muestra una sola vez) y pegalos en Zernio › **Webhooks**, con los eventos de mensajes activos.
4. **Agentes** → tu agente → **Número conectado** → **Publicar**. Sin publicar, el agente no responde.

Listo: mandá un WhatsApp desde otro teléfono y mirá cómo entra al Inbox, aparece en el embudo y responde la IA.

---

## Base de conocimiento con archivos (modo avanzado, opcional)

El agente funciona sin esto: con la información del negocio en sus instrucciones alcanza. Si tenés mucho material (catálogos grandes, PDFs, manuales), en **Conocimiento** podés adjuntar archivos y el agente consulta solo la parte que necesita.

Requiere que tu clave de OpenAI tenga acceso a embeddings: platform.openai.com › **Settings › Project › Limits › Model usage** → permitir `text-embedding-3-small`. Después, en tu agente, marcá los materiales en *Qué consulta antes de responder*.

## Problemas frecuentes

| Síntoma | Solución |
|---|---|
| `pnpm demo` se cierra al arrancar | Falta una variable en `.env.local` (ver paso 3). |
| `[tunel]` muestra `ERR_NGROK_334` | Ya hay otro ngrok abierto con tu dominio: cerralo. |
| El mensaje no aparece en el Inbox | Revisá la URL y el secreto en Zernio › Webhooks. En la terminal, `assinatura recusada` indica un secreto mal pegado. |
| El mensaje entra pero la IA no responde | El agente no está publicado con el número conectado. |

## Comandos útiles

| Comando | Qué hace |
|---|---|
| `pnpm demo` | App + agente de IA + túnel, en una terminal |
| `pnpm build` | Compila la app (necesario antes de `pnpm demo`) |
| `pnpm db:setup` | Aplica la base de datos en Supabase |
| `pnpm typecheck` · `pnpm lint` · `pnpm test:unit` | Verificaciones de código |

---

## Licencia

Distribuido bajo la licencia [MIT](LICENSE).
