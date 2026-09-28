/**
 * Seed E2E do nascimento do lead (spec 17, passo 1).
 *
 * Semeia o MÍNIMO para que uma mensagem possa chegar pelo caminho de produção:
 * uma `channel_session` com `webhook_path_token`, que é o que a rota
 * `/api/v1/webhooks/waha/[token]` usa para descobrir de qual organização o
 * evento é. **Nenhum contato, nenhuma conversa, nenhum lead** — quem tem de
 * criar isso é o produto, e é justamente o que a spec mede.
 *
 * Grava também o id do funil `is_default`, porque a prova de tela precisa abrir
 * o quadro certo (`/app/pipelines/<id>`) e o funil é do tenant, não fixo.
 *
 * Idempotente. Depende de `.e2e-creds.json` (rode `scripts/seed-e2e-credentials.ts`
 * antes).
 *
 * Run: npx tsx scripts/seed-e2e-nascimento-do-lead.ts
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";

import { anunciarDestino, credenciaisSupabaseDeTeste } from "./lib/env-de-teste";

const credenciais = credenciaisSupabaseDeTeste();
anunciarDestino("seed-e2e-nascimento-do-lead", credenciais);

const admin = createClient(credenciais.url, credenciais.serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");
const SESSION_NAME = "e2e-nascimento-session";
/** Fixo e idempotente: o spec precisa saber a URL antes de chamar. */
const WEBHOOK_TOKEN = "e2e-nascimento-token-fixo-0001";

interface Creds {
  org_id: string;
  nascimento?: { webhook_token: string; session_name: string; pipeline_default_id: string };
}

function lerCreds(): Creds {
  if (!fs.existsSync(CREDS_PATH)) {
    throw new Error(".e2e-creds.json ausente — rode scripts/seed-e2e-credentials.ts primeiro");
  }
  return JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
}

async function garantirSessao(orgId: string): Promise<void> {
  const { data: existente } = await admin
    .from("channel_sessions")
    .select("id")
    .eq("organization_id", orgId)
    .eq("waha_session_name", SESSION_NAME)
    .maybeSingle();

  if (existente) {
    // Re-afirma o token: outra rodada pode tê-lo mudado, e o spec o usa na URL.
    const { error } = await admin
      .from("channel_sessions")
      .update({ webhook_path_token: WEBHOOK_TOKEN } as never)
      .eq("id", (existente as { id: string }).id);
    if (error) throw new Error(`update channel_session: ${error.message}`);
    return;
  }

  const { error } = await admin.from("channel_sessions").insert({
    organization_id: orgId,
    waha_session_name: SESSION_NAME,
    display_name: "Número Nascimento E2E",
    // Placeholder, como todas as rotas que criam sessão gravam. Sem header de
    // assinatura o webhook aceita e devolve `signatureVerified: false` — que é
    // exatamente o que acontece com WAHA Core em produção (webhook-auth.ts).
    webhook_secret_encrypted: "\\x00",
    webhook_path_token: WEBHOOK_TOKEN,
  } as never);
  if (error) throw new Error(`insert channel_session: ${error.message}`);
}

async function funilPadrao(orgId: string): Promise<string> {
  const { data, error } = await admin
    .from("crm_pipelines")
    .select("id")
    .eq("organization_id", orgId)
    .eq("is_default", true)
    .eq("is_archived", false)
    .maybeSingle();
  if (error) throw new Error(`select pipeline default: ${error.message}`);
  if (!data) {
    throw new Error(
      "a organização de e2e não tem funil is_default — sem ele o lead não nasce, e o spec mediria o produto errado",
    );
  }
  return (data as { id: string }).id;
}

async function main(): Promise<void> {
  const creds = lerCreds();
  await garantirSessao(creds.org_id);
  const pipelineDefaultId = await funilPadrao(creds.org_id);

  creds.nascimento = {
    webhook_token: WEBHOOK_TOKEN,
    session_name: SESSION_NAME,
    pipeline_default_id: pipelineDefaultId,
  };
  fs.writeFileSync(CREDS_PATH, `${JSON.stringify(creds, null, 2)}\n`);
  console.info(`seed-e2e-nascimento-do-lead: ok (funil de entrada ${pipelineDefaultId})`);
}

void main();
