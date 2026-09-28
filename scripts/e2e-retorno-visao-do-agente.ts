/**
 * O QUE O AGENTE VÊ — a outra ponta da continuidade (invariante 2 da doutrina).
 *
 * Depois que uma pessoa desmarca o retorno pela tela, o agente precisa DESCOBRIR
 * isso ao retomar; senão ele reagenda no turno seguinte e insiste com quem
 * acabou de pedir para parar. Este script chama a capacidade real de leitura
 * (`crm_list_followups`) com um contexto de agente e imprime, em JSON, o que ela
 * devolve — é o que o teste de tela consome para afirmar que o agente enxerga.
 *
 * Imprime uma linha só, prefixada, para o spec parsear sem ambiguidade.
 *
 * Run: npx tsx scripts/e2e-retorno-visao-do-agente.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";

import type { McpContext } from "../lib/mcp/types";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const env = carregarEnvLocal();
for (const [k, v] of Object.entries(env)) process.env[k] ??= v;

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface Creds {
  org_id: string;
  retorno: { lead_id: string; agent_id: string };
}

async function main(): Promise<void> {
  const { crmListFollowups } = await import("../lib/mcp/tools/retencao");
  const creds = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), ".e2e-creds.json"), "utf8"),
  ) as Creds;

  const ctx: McpContext = {
    organizationId: creds.org_id,
    role: "agent",
    actor: {
      type: "ai_agent",
      id: creds.retorno.agent_id,
      agent_id: creds.retorno.agent_id,
      role: "agent",
    },
    apiTokenId: "00000000-0000-4000-8000-e2e000000000",
    requestId: `visao-agente-${Date.now()}`,
    supabase: admin,
  };

  const visto = await crmListFollowups.handler(
    { lead_id: creds.retorno.lead_id, contact_id: undefined, limit: 20 },
    ctx,
  );
  console.info(`VISAO_DO_AGENTE=${JSON.stringify(visto)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
