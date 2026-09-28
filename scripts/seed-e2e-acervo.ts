/**
 * Fixtures do E2E do acervo de conhecimento (0181).
 *
 * Cria DOIS assistentes `mcp_agent` publicados na mesma organização. Dois, e
 * não um, porque o defeito que esta frente conserta só aparece com dois: o
 * indexador resolvia o agente pela organização (`is_default desc, created_at
 * asc, limit 1`), então o material de qualquer assistente que não fosse o
 * primeiro nunca virava trecho — e a tela de conhecimento, presa a
 * `is_default = true`, sequer o mostrava.
 *
 * NENHUM material é semeado aqui de propósito: quem cadastra é a spec, pela
 * tela, como um usuário faria. O que este script prepara é só o que a tela não
 * tem como criar (assistentes publicados com credencial e número).
 *
 * Run: npx tsx scripts/seed-e2e-acervo.ts
 */
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { anunciarDestino, credenciaisSupabaseDeTeste } from "./lib/env-de-teste";

const credenciais = credenciaisSupabaseDeTeste();
anunciarDestino("seed-e2e-acervo", credenciais);

const admin = createClient(credenciais.url, credenciais.serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");

const AGENTE_A = "E2E Acervo · Suporte";
const AGENTE_B = "E2E Acervo · Vendas";

interface Creds {
  org_id: string;
  followup_agent_fixtures?: { credential_id: string; channel_session_id: string };
  acervo?: { agente_a: string; agente_b: string; versao_a: string; versao_b: string };
}

function lerCreds(): Creds {
  return JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
}

/** Cria (ou devolve) um `mcp_agent` PUBLICADO com o nome dado. */
async function garantirAgentePublicado(
  orgId: string,
  nome: string,
  fixtures: { credential_id: string; channel_session_id: string },
  prioridade: number,
): Promise<{ agentId: string; versionId: string }> {
  const { data: existente } = await admin
    .from("ai_agents")
    .select("id, published_version_id")
    .eq("organization_id", orgId)
    .eq("name", nome)
    .maybeSingle();

  let agentId = existente?.id as string | undefined;
  if (!agentId) {
    const { data, error } = await admin
      .from("ai_agents")
      .insert({
        organization_id: orgId,
        name: nome,
        description: "Fixture do E2E do acervo de conhecimento",
        kind: "mcp_agent",
        model: "claude-sonnet-4-6",
        system_prompt: "Você atende clientes com educação e objetividade.",
        is_active: true,
        // `is_default: false` DE PROPÓSITO, nos dois: é o estado de todo
        // assistente criado pela interface, e era o estado que a tela antiga
        // tornava invisível.
        is_default: false,
        priority: prioridade,
      })
      .select("id")
      .single();
    if (error) throw error;
    agentId = data.id as string;
  }

  let versionId = existente?.published_version_id as string | null | undefined;
  if (!versionId) {
    const { data, error } = await admin
      .from("ai_agent_versions")
      .insert({
        organization_id: orgId,
        agent_id: agentId,
        version_number: 1,
        system_prompt: "Você atende clientes com educação e objetividade.",
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        credential_id: fixtures.credential_id,
        channel_session_id: fixtures.channel_session_id,
        status: "published",
        published_at: new Date().toISOString(),
        knowledge_source_ids: [],
      })
      .select("id")
      .single();
    if (error) throw error;
    versionId = data.id as string;

    const { error: ptrErr } = await admin
      .from("ai_agents")
      .update({ published_version_id: versionId })
      .eq("id", agentId);
    if (ptrErr) throw ptrErr;
  }

  return { agentId, versionId };
}

async function main(): Promise<void> {
  const creds = lerCreds();
  let fixtures = creds.followup_agent_fixtures;
  if (!fixtures) {
    execFileSync("npx", ["tsx", "scripts/seed-e2e-followup-agent.ts"], { stdio: "inherit" });
    fixtures = lerCreds().followup_agent_fixtures;
  }
  if (!fixtures) {
    throw new Error("followup_agent_fixtures ausente — o problema não é a ordem dos seeds.");
  }

  const a = await garantirAgentePublicado(creds.org_id, AGENTE_A, fixtures, 10);
  const b = await garantirAgentePublicado(creds.org_id, AGENTE_B, fixtures, 5);

  // Devolve o cenário: se a spec anterior marcou material, a próxima execução
  // mediria o resto dela em vez do próprio começo.
  await admin
    .from("ai_agent_versions")
    .update({ knowledge_source_ids: [] })
    .in("id", [a.versionId, b.versionId]);

  // E o acervo volta a ser o que era: sem isto, a segunda execução esbarra no
  // nome único e a spec falha por colisão em vez de por defeito.
  await admin
    .from("ai_knowledge_sources")
    .delete()
    .eq("organization_id", creds.org_id)
    .like("name", "E2E %");

  const atualizado: Creds = {
    ...creds,
    acervo: {
      agente_a: a.agentId,
      agente_b: b.agentId,
      versao_a: a.versionId,
      versao_b: b.versionId,
    },
  };
  fs.writeFileSync(CREDS_PATH, `${JSON.stringify(atualizado, null, 2)}\n`);

  console.log("[seed-acervo] agente A:", a.agentId, "| agente B:", b.agentId);
  console.log("✅ fixtures do acervo prontas");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
