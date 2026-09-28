/**
 * Seed E2E da gestão de funis: uma SEGUNDA organização com o mesmo manager
 * dentro dela.
 *
 * ⚠️ ESTA SEGUNDA ORGANIZAÇÃO É O TESTE, não cenário de enfeite. O bug que a
 * feature conserta só aparece com o usuário participando de mais de uma org: a
 * policy `crm_pipelines_select` libera TODAS as orgs de quem consulta, e a tela
 * do Kanban não filtrava pela ativa. Como `trg_seed_default_pipeline_for_org`
 * semeia um funil "Pedidos" em toda org nova, as duas listas se misturavam em
 * linhas idênticas. Com uma org só, o spec passaria mesmo com o filtro apagado —
 * mediria o seed, não o código.
 *
 * Idempotente: upsert por slug da organização. Depende de .e2e-creds.json
 * (rode scripts/seed-e2e-credentials.ts antes). Grava o bloco `funis`.
 *
 * Run: npx tsx scripts/seed-e2e-funis.ts
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";
import { anunciarDestino, credenciaisSupabaseDeTeste } from "./lib/env-de-teste";

// `process.env` VENCE o `.env.local` (ver scripts/lib/env-de-teste.ts).
//
// A versão anterior lia `.env.local` DIRETO do disco, ignorando o ambiente — e
// por isso a suíte E2E semeava no banco de PRODUÇÃO mesmo com o `.env.e2e`
// injetado no webServer do Playwright: este script nunca olhava para lá.
const credenciais = credenciaisSupabaseDeTeste();
anunciarDestino("seed-e2e-funis", credenciais);
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
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");
const SEGUNDA_SLUG = "e2e-segunda-org";

interface Creds {
  org_id: string;
  users: Record<string, { id: string; email: string }>;
  funis?: { segunda_org_id: string };
}

async function main(): Promise<void> {
  const creds = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
  const managerId = creds.users.manager!.id;

  const { data: existente } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", SEGUNDA_SLUG)
    .maybeSingle();

  let segundaOrgId = (existente as { id: string } | null)?.id ?? null;

  /**
   * ⚠️ O SEED GARANTE O FIXTURE QUE ELE DECLARA — inclusive na org que reencontra.
   *
   * Esta organização existe **sem `onboarded_at`** de propósito (ver o `insert`
   * abaixo): depois da separação dos slugs ela é o único lugar do harness com
   * uma organização legitimamente não configurada, e é dela que
   * `troca-de-organizacao-tem-volta.spec.ts` precisa para provar a saída do
   * wizard.
   *
   * Só que "criar sem a coluna" não é o mesmo que "garantir sem a coluna". Num
   * banco onde outro seed carimbou a linha primeiro — foi o que aconteceu no
   * ambiente do autor da spec de escopo, com `onboarded_at` de 27/08 21:40 —
   * este seed rodava, não olhava o estado, e a spec da saída quebrava com um
   * `page.waitForURL` estourando por 60s: mensagem opaca, causa invisível.
   *
   * É a MESMA classe que `tests/unit/seeds-nao-disputam-organizacao.test.ts`
   * fecha do lado de quem cria, reaparecendo do lado de quem reusa. A regra que
   * vale para os dois: o seed é dono do estado que ele promete, não só da
   * primeira escrita dele.
   */
  if (segundaOrgId) {
    const { error: fixErr } = await admin
      .from("organizations")
      .update({ onboarded_at: null })
      .eq("id", segundaOrgId)
      .not("onboarded_at", "is", null);
    if (fixErr) throw new Error(`garantir a org NÃO configurada: ${fixErr.message}`);
  }

  if (!segundaOrgId) {
    const { data, error } = await admin
      .from("organizations")
      .insert({
        slug: SEGUNDA_SLUG,
        legal_name: "E2E Segunda Org LTDA",
        display_name: "E2E Segunda Org",
        // ⚠️ SEM `onboarded_at` DE PROPÓSITO — e agora isso é o fixture, não um
        // descuido.
        //
        // Esta org existe para o caso do funil homônimo, e ficou sem onboarding
        // por omissão. Enquanto ela dividia o slug com o seed de duas
        // organizações, essa omissão vazava para uma spec que não a pediu e
        // derrubava o CI (ver o cabeçalho de `seed-e2e-duas-organizacoes.ts`).
        // Com os slugs separados, ela passa a ser o único lugar do harness com
        // uma organização legitimamente NÃO configurada — que é exatamente o
        // estado de que `troca-de-organizacao-tem-volta.spec.ts` precisa para
        // provar que dá para sair do wizard.
      })
      .select("id")
      .single();
    if (error) throw new Error(`falha ao criar a segunda org: ${error.message}`);
    segundaOrgId = (data as { id: string }).id;
    // O gatilho `trg_seed_default_pipeline_for_org` já semeou o funil "Pedidos"
    // aqui dentro — é exatamente esse homônimo que o spec não pode ver na lista.
  }

  // `revoked_at is null` é o que `fn_user_org_ids()` exige para o vínculo valer —
  // sem ele a segunda org não entra na policy e o cenário do bug não se monta.
  const { error: vincErr } = await admin.from("user_organizations").upsert(
    {
      user_id: managerId,
      organization_id: segundaOrgId,
      role: "manager",
      accepted_at: new Date().toISOString(),
      revoked_at: null,
    },
    { onConflict: "user_id,organization_id" },
  );
  if (vincErr) throw new Error(`falha ao vincular o manager: ${vincErr.message}`);

  creds.funis = { segunda_org_id: segundaOrgId };
  fs.writeFileSync(CREDS_PATH, JSON.stringify(creds, null, 2));

  const { count } = await admin
    .from("crm_pipelines")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", segundaOrgId);

  console.log(`✅ segunda org ${segundaOrgId} com ${count ?? 0} funil(is); manager vinculado.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
