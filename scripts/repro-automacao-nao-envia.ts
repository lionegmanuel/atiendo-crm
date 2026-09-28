/**
 * REPRODUÇÃO do defeito relatado: "configurei a automação de enviar WhatsApp
 * quando entra contato novo pelo webhook, e a mensagem não foi enviada".
 *
 * Monta o cenário EXATO da tela (gatilho `lead.created` → ação
 * `send_whatsapp_message`), dispara um POST real na URL pública da fonte,
 * drena o event_log pela MESMA rota de cron que o scheduler bate, e imprime o
 * que a automação REGISTROU ao lado do que a mensagem VIROU.
 *
 * Não é teste: é instrumento de medição. Some com os próprios rastros no fim.
 */

import { carregarEnvLocal } from "./lib/env-de-teste";

const env = carregarEnvLocal();
const APP = process.env.APP_URL ?? "http://localhost:3021";
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY!;
const INTERNAL = env.INTERNAL_SECRET!;

async function pg<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status} ${text}`);
  return text ? (JSON.parse(text) as T) : ([] as unknown as T);
}

async function main(): Promise<void> {
  const creds = JSON.parse(
    await (await import("node:fs/promises")).readFile(".e2e-creds.json", "utf8"),
  ) as { org_id: string };
  const orgId = creds.org_id;
  const ts = Date.now();

  // ── 1. Um número de WhatsApp CONECTADO, como o da tela do relato ──────────
  const [session] = await pg<Array<{ id: string }>>("channel_sessions", {
    method: "POST",
    body: JSON.stringify({
      organization_id: orgId,
      waha_session_name: `repro-${ts}`,
      webhook_secret_encrypted: "00",
      phone_number: `+5531${String(ts).slice(-8)}`,
      status: "WORKING",
      provider: "waha",
    }),
  });
  const sessionId = session!.id;

  // ── 2. A fonte de captação e a regra, iguais às da tela ───────────────────
  const [pipeline] = await pg<Array<{ id: string }>>(
    `crm_pipelines?organization_id=eq.${orgId}&select=id&limit=1`,
  );
  const [stage] = await pg<Array<{ id: string }>>(
    `crm_stages?pipeline_id=eq.${pipeline!.id}&select=id&order=position.asc&limit=1`,
  );
  const token = `repro${ts}`;
  const [source] = await pg<Array<{ id: string }>>("webhook_sources", {
    method: "POST",
    body: JSON.stringify({
      organization_id: orgId,
      name: `Repro ${ts}`,
      path_token: token,
      default_pipeline_id: pipeline!.id,
      default_stage_id: stage!.id,
    }),
  });

  const [rule] = await pg<Array<{ id: string }>>("automation_rules", {
    method: "POST",
    body: JSON.stringify({
      organization_id: orgId,
      name: `Abordar Leads - Repro ${ts}`,
      trigger_event: "lead.created",
      conditions: [],
      actions: [
        {
          type: "send_whatsapp_message",
          config: {
            channel_session_id: sessionId,
            template:
              "Olá {{nome}}, você acabou de preencher um formulário para saber mais sobre nossos serviços, me conte um pouco mais sobre seu negócio.",
          },
        },
      ],
      is_active: true, // ligada, como na tela
    }),
  });

  // ── 3. O formulário sendo preenchido de verdade ───────────────────────────
  const capt = await fetch(`${APP}/api/v1/webhooks/in/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nome: "Cliente Repro",
      telefone: "11988887777",
      email: `repro${ts}@exemplo.com`,
    }),
  });
  const captBody = await capt.json();
  console.log("POST no webhook →", capt.status, JSON.stringify(captBody));

  // ── 4. O drain, como o scheduler faz a cada minuto ────────────────────────
  for (let i = 0; i < 3; i++) {
    const d = await fetch(`${APP}/api/v1/cron/event-log-drain`, {
      method: "POST",
      headers: { Authorization: `Bearer ${INTERNAL}` },
    });
    console.log("drain", i + 1, "→", d.status, (await d.text()).slice(0, 200));
  }

  // ── 5. O QUE A AUTOMAÇÃO DIZ vs O QUE A MENSAGEM É ────────────────────────
  const runs = await pg<
    Array<{ id: string; status: string; actions_result: unknown; error: string | null }>
  >(`automation_rule_runs?rule_id=eq.${rule!.id}&select=id,status,actions_result,error`);
  console.log("\n=== automation_rule_runs (o que a aba Atividade mostra) ===");
  console.log(JSON.stringify(runs, null, 2));

  const msgs = await pg<
    Array<{
      id: string;
      status: string;
      error_code: string | null;
      error_message: string | null;
      body: string | null;
      metadata: Record<string, unknown> | null;
    }>
  >(
    `messages?channel_session_id=eq.${sessionId}&select=id,status,error_code,error_message,body,metadata`,
  );
  console.log("\n=== messages (o que o cliente recebeu, de verdade) ===");
  console.log(JSON.stringify(msgs, null, 2));

  console.log("\n=== VEREDITO ===");
  const run = runs[0];
  const msg = msgs[0];
  console.log("run.status          =", run?.status ?? "(nenhum run)");
  console.log("mensagem.status     =", msg?.status ?? "(nenhuma mensagem)");
  console.log("mensagem.error_code =", msg?.error_code ?? "-");
  if (run?.status === "success" && msg && msg.status !== "sent") {
    console.log(
      "\n>>> DEFEITO CONFIRMADO: a automação registrou SUCESSO e a mensagem está em",
      `'${msg.status}'. A tela diz que deu certo; o cliente não recebeu nada.`,
    );
  }

  // ── 6. Limpeza ────────────────────────────────────────────────────────────
  if (!process.env.MANTER) {
    await pg(`automation_rule_runs?rule_id=eq.${rule!.id}`, { method: "DELETE" });
    await pg(`automation_rules?id=eq.${rule!.id}`, { method: "DELETE" });
    await pg(`webhook_sources?id=eq.${source!.id}`, { method: "DELETE" });
    for (const m of msgs) await pg(`messages?id=eq.${m.id}`, { method: "DELETE" });
    console.log("\n(rastros removidos — use MANTER=1 para preservar)");
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
