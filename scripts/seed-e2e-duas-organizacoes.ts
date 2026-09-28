/**
 * Seed do cenário que fez o defeito aparecer: UM usuário em DUAS organizações.
 *
 * ─── Por que este seed existe ────────────────────────────────────────────────
 * O dono do produto instalou a v1.7.0, abriu a Agenda e viu SEIS tipos de
 * agendamento onde há três. Não havia duplicata nenhuma: ele é admin de duas
 * organizações na mesma instalação, e a Agenda consultava sem filtrar a org
 * ativa. Toda a suíte E2E até aqui roda com usuário de UMA organização — e um
 * cenário de uma org não consegue, por construção, enxergar esse defeito.
 *
 * ⚠️ NÃO é o `seed-e2e-tenant-b`. Aquele cria uma org B com um usuário PRÓPRIO,
 * para provar que o realtime não vaza entre inquilinos — dois usuários, duas
 * orgs. Aqui é o oposto: o MESMO usuário nas duas, que é a configuração que a
 * RLS permite de propósito e que o escopo de tela tem de resolver.
 *
 * Estado deixado no banco:
 *   - a org A é a do `.e2e-creds.json` (a que já existe);
 *   - uma org B, com o usuário `manager` do e2e como admin dela;
 *   - um tipo de agendamento EXCLUSIVO em cada org, de nome inconfundível.
 *
 * Os nomes são exclusivos de propósito: contar chips não prova nada (a org B
 * também recebe os três tipos semeados no provisionamento, com os MESMOS nomes),
 * e a asserção precisa ser sobre o CONJUNTO de nomes.
 *
 * Idempotente: reusa org por slug, tipo por slug, membership por par.
 *
 * Run: npx tsx scripts/seed-e2e-duas-organizacoes.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { anunciarDestino, credenciaisSupabaseDeTeste } from "./lib/env-de-teste";

const credenciais = credenciaisSupabaseDeTeste();
anunciarDestino("seed-e2e-duas-organizacoes", credenciais);

const admin = createClient(credenciais.url, credenciais.serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");

/**
 * ⚠️ SLUG PRÓPRIO, e a troca dele é o conserto de um CI vermelho.
 *
 * Isto era `"e2e-segunda-org"` — o MESMO slug que `scripts/seed-e2e-funis.ts:50`
 * usa. Os dois seeds construíam estados diferentes na mesma linha de
 * `organizations`, e quem rodava primeiro vencia: o de funis cria a org **sem
 * `onboarded_at`** (ele só quer o funil homônimo), e este aqui, ao encontrar a
 * linha por slug, devolvia o id sem corrigir nada.
 *
 * Na parte 2 do e2e o `pipelines-gestao` roda antes do `agenda-escopo`, então a
 * org B chegava sem onboarding — e `app/app/layout.tsx` manda para `/onboarding`
 * toda org nesse estado. A troca de organização terminava num redirect, o shell
 * saía da árvore junto com o seletor, e a spec reprovava com `element(s) not
 * found` depois de alguns `unexpected value "disabled"`. Medido no run
 * 33164258175 e reproduzido aqui zerando o `onboarded_at` à mão.
 *
 * Dois seeds disputando uma linha é o defeito; corrigir o `onboarded_at` no
 * caminho de "já existe" trataria o sintoma e deixaria a disputa de pé, para o
 * próximo campo que divergisse. Slug próprio remove a disputa.
 */
const ORG_B_SLUG = "e2e-org-b";
const ORG_B_NOME = "E2E Segunda Organização";

/** Um tipo por org, com nome que não existe na outra. É a asserção da spec. */
const TIPO_A = { slug: "so-da-org-a", nome: "Atendimento Só Da Org A" };
const TIPO_B = { slug: "so-da-org-b", nome: "Atendimento Só Da Org B" };

interface Creds {
  org_id: string;
  password: string;
  users?: Record<string, { id: string; email: string; role: string }>;
  duas_orgs?: unknown;
}

async function orgB(): Promise<string> {
  const { data: existente, error } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", ORG_B_SLUG)
    .maybeSingle();
  if (error) throw new Error(`buscar org B: ${error.message}`);
  if (existente) {
    const id = (existente as { id: string }).id;
    /**
     * O SEED GARANTE A PRECONDIÇÃO QUE ELE PRÓPRIO EXIGE — mesmo reencontrando a
     * org de uma corrida anterior.
     *
     * Defesa em profundidade ao lado do slug próprio: o que quebrou o CI foi uma
     * org **sem `onboarded_at`**, e um seed que devolve o id sem olhar o estado
     * herda qualquer coisa que estivesse ali. `update` e não `upsert` porque a
     * linha existe; e só este campo, para não pisar no que outra spec configurou.
     */
    const { error: fixErr } = await admin
      .from("organizations")
      .update({ onboarded_at: new Date().toISOString() } as never)
      .eq("id", id)
      .is("onboarded_at", null);
    if (fixErr) throw new Error(`garantir onboarding da org B: ${fixErr.message}`);
    return id;
  }

  const { data, error: insErr } = await admin
    .from("organizations")
    .insert({
      slug: ORG_B_SLUG,
      display_name: ORG_B_NOME,
      legal_name: ORG_B_NOME,
      timezone: "America/Sao_Paulo",
      locale: "pt-BR",
      onboarded_at: new Date().toISOString(),
    } as never)
    .select("id")
    .single();
  if (insErr || !data) throw new Error(`criar org B: ${insErr?.message}`);
  return (data as { id: string }).id;
}

async function membroDe(userId: string, orgId: string): Promise<void> {
  const { data: existente, error } = await admin
    .from("user_organizations")
    .select("user_id")
    .eq("user_id", userId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) throw new Error(`buscar membership: ${error.message}`);
  if (existente) {
    const { error: updErr } = await admin
      .from("user_organizations")
      .update({ role: "admin", revoked_at: null } as never)
      .eq("user_id", userId)
      .eq("organization_id", orgId);
    if (updErr) throw new Error(`atualizar membership: ${updErr.message}`);
    return;
  }
  const { error: insErr } = await admin.from("user_organizations").insert({
    user_id: userId,
    organization_id: orgId,
    role: "admin",
    accepted_at: new Date().toISOString(),
  } as never);
  if (insErr) throw new Error(`inserir membership: ${insErr.message}`);
}

async function tipoExclusivo(orgId: string, t: { slug: string; nome: string }, donoId: string): Promise<string> {
  const { data: existente } = await admin
    .from("calendar_event_types")
    .select("id")
    .eq("organization_id", orgId)
    .eq("slug", t.slug)
    .maybeSingle();
  if (existente) return (existente as { id: string }).id;

  const { data, error } = await admin
    .from("calendar_event_types")
    .insert({
      organization_id: orgId,
      name: t.nome,
      slug: t.slug,
      description: "Tipo exclusivo desta organização — usado pela spec de escopo.",
      duration_minutes: 30,
      minimum_notice_minutes: 60,
      booking_window_days: 60,
      is_active: true,
      default_owner_user_id: donoId,
    } as never)
    .select("id")
    .single();
  if (error) throw new Error(`calendar_event_types (${t.slug}): ${error.message}`);
  return (data as { id: string }).id;
}

async function main(): Promise<void> {
  if (!fs.existsSync(CREDS_PATH)) {
    throw new Error(`${CREDS_PATH} não existe — rode scripts/seed-e2e-credentials.ts antes.`);
  }
  const creds = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
  if (!creds.org_id) throw new Error(".e2e-creds.json sem org_id");

  // `manager`, e não `admin`, pelo mesmo motivo das outras specs de agenda: o
  // admin do seed tem TOTP enrolado e a tela de 2FA não é o assunto aqui.
  const usuario = creds.users?.manager;
  if (!usuario) throw new Error(".e2e-creds.json sem `users.manager` — rode seed-e2e-credentials.ts");

  const orgBId = await orgB();
  if (orgBId === creds.org_id) throw new Error("org B saiu igual à org A — o cenário não existiria");
  await membroDe(usuario.id, orgBId);

  const tipoAId = await tipoExclusivo(creds.org_id, TIPO_A, usuario.id);
  const tipoBId = await tipoExclusivo(orgBId, TIPO_B, usuario.id);

  const bloco = {
    org_a_id: creds.org_id,
    org_b_id: orgBId,
    org_b_nome: ORG_B_NOME,
    usuario_email: usuario.email,
    tipo_a: { ...TIPO_A, id: tipoAId },
    tipo_b: { ...TIPO_B, id: tipoBId },
  };
  fs.writeFileSync(CREDS_PATH, JSON.stringify({ ...creds, duas_orgs: bloco }, null, 2));
  console.info(`[seed-e2e-duas-organizacoes] ${JSON.stringify(bloco)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
