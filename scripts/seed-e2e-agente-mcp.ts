/**
 * Emite um token MCP de AGENTE para o E2E de "organizar a operação" (IA 360 W4).
 *
 * ⚠️ POR QUE UM TOKEN DE VERDADE, E NÃO UM MOCK. O que o teste precisa provar é
 * que a mudança feita pelo AGENTE chega à tela marcada como dele. Isso depende
 * de três coisas que só existem no caminho real: o scope `actor:ai_agent` (que
 * `deriveActor` lê para montar o `Actor`), a espécie gravada por
 * `autoriaDaMudanca`, e a leitura da tela. Um handler chamado direto no processo
 * de teste pularia a primeira e provaria menos do que parece.
 *
 * ⚠️ O PAPEL É `manager` PORQUE A OPERAÇÃO É CONFIGURAÇÃO. As seis escritas do
 * pacote `organizar` são `apenasHumano`: as rotas HTTP que elas espelham exigem
 * `manager`, e um agente publicado (papel `agent`) não as alcança de propósito —
 * paridade com o que o produto já pratica, não lacuna. O caminho exercitado aqui
 * é o do cliente MCP externo (server-to-server), que é real, suportado e o ÚNICO
 * por onde uma escrita de configuração chega ao banco vinda de um ator
 * `ai_agent`. O que faz a autoria sair como `ai` é o scope `actor:ai_agent`, não
 * o papel — por isso o teste continuaria válido se o papel mudasse.
 *
 * Idempotente: revoga tokens anteriores com o mesmo nome antes de emitir.
 *
 * Run: npx tsx scripts/seed-e2e-agente-mcp.ts
 * Output: .e2e-agente-mcp.json (gitignored)
 */
import { createHash, randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";
import { anunciarDestino, credenciaisSupabaseDeTeste } from "./lib/env-de-teste";

// `process.env` VENCE o `.env.local` (ver scripts/lib/env-de-teste.ts).
//
// A versão anterior lia `.env.local` DIRETO do disco, ignorando o ambiente — e
// por isso a suíte E2E semeava no banco de PRODUÇÃO mesmo com o `.env.e2e`
// injetado no webServer do Playwright: este script nunca olhava para lá.
const credenciais = credenciaisSupabaseDeTeste();
anunciarDestino("seed-e2e-agente-mcp", credenciais);
const env = {
  NEXT_PUBLIC_SUPABASE_URL: credenciais.url,
  SUPABASE_SERVICE_ROLE_KEY: credenciais.serviceRole,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: credenciais.anonKey,
  NEXT_PUBLIC_APP_URL: credenciais.appUrl,
  SUPABASE_DB_URL: credenciais.dbUrl,
} as Record<string, string>;

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_URL || !SERVICE_ROLE) {
  throw new Error("Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY em .env.local");
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const NOME = "e2e-agente-organiza";
const ORG_SLUG = "e2e-test-org";

async function main(): Promise<void> {
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", ORG_SLUG)
    .maybeSingle();
  if (orgErr) throw new Error(orgErr.message);
  if (!org) {
    throw new Error(`org "${ORG_SLUG}" não existe — rode scripts/seed-e2e-credentials.ts antes`);
  }
  const orgId = (org as { id: string }).id;

  const { data: dono, error: donoErr } = await admin
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", orgId)
    .eq("role", "admin")
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();
  if (donoErr) throw new Error(donoErr.message);
  if (!dono) throw new Error("nenhum admin ativo na org de E2E");

  // ⚠️ SÓ O LIXO VELHO MORRE, e a janela existe por um defeito que este seed
  // causou: a versão anterior revogava TODO token vivo do mesmo nome antes de
  // emitir. Duas execuções próximas (um rerun, dois specs em sequência) faziam a
  // segunda matar o token que a primeira estava usando no meio da corrida — e o
  // sintoma chegava como `Token revoked` numa chamada MCP, parecendo defeito do
  // produto. Medido: quatro tokens emitidos em 35s, três revogados em cascata.
  //
  // Dez minutos é maior que qualquer execução do spec e muito menor que o TTL de
  // 6h, então o lixo continua sendo limpo sem atropelar quem está correndo.
  const CORTE_MIN = 10;
  await admin
    .from("api_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("organization_id", orgId)
    .eq("name", NOME)
    .is("revoked_at", null)
    .lt("created_at", new Date(Date.now() - CORTE_MIN * 60_000).toISOString());

  const prefix = `dsk_e2eag_${randomBytes(3).toString("hex")}`;
  const plaintext = `${prefix}_${randomBytes(32).toString("base64url")}`;
  const hash = createHash("sha256").update(plaintext).digest();

  const { data: token, error } = await admin
    .from("api_tokens")
    .insert({
      organization_id: orgId,
      created_by: (dono as { user_id: string }).user_id,
      name: NOME,
      prefix,
      token_hash: `\\x${hash.toString("hex")}`,
      scopes: ["mcp:read", "mcp:write", "actor:ai_agent", "role:manager"],
      expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single();
  if (error || !token) throw new Error(error?.message ?? "insert do token falhou");

  const saida = {
    organization_id: orgId,
    token_id: (token as { id: string }).id,
    // Plaintext só aqui: o banco guarda o hash, e o arquivo é gitignored.
    bearer: plaintext,
  };
  fs.writeFileSync(
    path.join(process.cwd(), ".e2e-agente-mcp.json"),
    JSON.stringify(saida, null, 2),
  );
  console.info(`token MCP de agente emitido para a org ${orgId} (.e2e-agente-mcp.json)`);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
