/**
 * Seed E2E da AGENDA — o cenário mínimo para a IA e a tela marcarem de verdade.
 *
 * ⚠️ ELE É INFRA COMPARTILHADA, não é de uma spec. Serve às duas que estão paradas
 * esperando por ele: `agente-marca-consulta.spec.ts` (a IA marca por MCP) e
 * `agenda-marcar-pela-tela.spec.ts` (o humano marca clicando). Sem os três objetos
 * abaixo, `crm_find_free_slots` responde `sem_responsavel` ou `publicou_horarios:false`
 * — que são os caminhos de RECUSA, não o caminho feliz.
 *
 * Estado deixado no banco:
 *   - um TIPO de atendimento com `slug` estável (a IA fala slug, não uuid: o schema diz
 *     que ele existe para "dar à IA um handle que ela não alucina");
 *   - JORNADA publicada para o atendente do e2e — seg-sex, 09:00-18:00, fuso explícito;
 *   - um CONTATO para ser atendido.
 *
 * ⚠️ O FUSO É EXPLÍCITO DE PROPÓSITO. Se o `schedule` viesse `{}`, o Zod preencheria
 * `America/Sao_Paulo` por default e `fuso_suposto` voltaria `true` — o que é um estado
 * legítimo do produto, mas NÃO é o que estas specs querem exercitar. Semear o fuso
 * separa "a agenda funciona" de "a agenda funciona apesar de ninguém ter configurado".
 *
 * Idempotente: reusa o que já existe por `slug`/`user_id`/telefone. Não apaga nada —
 * um seed que apaga contato quebraria as outras jornadas que usam o mesmo banco.
 *
 * Run: npx tsx scripts/seed-e2e-agenda.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { anunciarDestino, credenciaisSupabaseDeTeste } from "./lib/env-de-teste";

const credenciais = credenciaisSupabaseDeTeste();
anunciarDestino("seed-e2e-agenda", credenciais);
for (const [k, v] of Object.entries({
  NEXT_PUBLIC_SUPABASE_URL: credenciais.url,
  SUPABASE_SERVICE_ROLE_KEY: credenciais.serviceRole,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: credenciais.anonKey,
  NEXT_PUBLIC_APP_URL: credenciais.appUrl,
})) process.env[k] ??= v as string;

const admin = createClient(credenciais.url, credenciais.serviceRole, {
  auth: { persistSession: false },
});

const CREDS_PATH = path.join(process.cwd(), ".e2e-creds.json");

/** O slug é CONTRATO com as specs e com a IA — mudá-lo quebra as duas. */
const TIPO_SLUG = "consulta-e2e";
const TIPO_NOME = "Consulta E2E";
const CONTATO_NOME = "Paciente Agenda E2E";
const CONTATO_FONE = "+5511988887777";
const FUSO = "America/Sao_Paulo";

interface Creds {
  org_id: string;
  /**
   * ⚠️ A CONVENÇÃO É `users.<chave>.id`, NÃO `user_id`.
   *
   * A primeira versão deste seed lia `creds.user_id` — uma chave que NADA escreve. Só
   * apareceu quando alguém RODOU: `seed-e2e-credentials` grava `users` como
   * `Record<chave, {id, email, role}>` com admin, manager, agent, viewer e dono. O erro
   * estava numa linha visível para qualquer leitura, e duas leituras não o pegaram.
   */
  users?: Record<string, { id: string; email: string; role: string }>;
  agenda?: unknown;
}

async function tipoDeAtendimento(orgId: string, donoId: string | null): Promise<string> {
  const { data: existente } = await admin
    .from("calendar_event_types")
    .select("id")
    .eq("organization_id", orgId)
    .eq("slug", TIPO_SLUG)
    .maybeSingle();
  if (existente) return (existente as { id: string }).id;

  const { data, error } = await admin
    .from("calendar_event_types")
    .insert({
      organization_id: orgId,
      name: TIPO_NOME,
      slug: TIPO_SLUG,
      description: "Tipo semeado para as jornadas E2E de agenda.",
      duration_minutes: 30,
      minimum_notice_minutes: 60,
      booking_window_days: 60,
      is_active: true,
      ...(donoId ? { default_owner_user_id: donoId } : {}),
    } as never)
    .select("id")
    .single();
  if (error) throw new Error(`calendar_event_types: ${error.message}`);
  return (data as { id: string }).id;
}

async function jornadaPublicada(orgId: string, userId: string): Promise<void> {
  // Seg a sex, 09:00–18:00. `windows` NÃO VAZIO é o ponto: vazio significa "não
  // publiquei" (DECISÃO 1.1) e faria a consulta devolver zero horários com
  // `publicou_horarios: false` — estado legítimo, mas não o que as specs querem.
  const schedule = {
    timezone: FUSO,
    windows: [1, 2, 3, 4, 5].map((dow) => ({ dow, start: "09:00", end: "18:00" })),
  };
  const { error } = await admin
    .from("attendant_availability")
    .upsert(
      { organization_id: orgId, user_id: userId, is_available: true, schedule } as never,
      { onConflict: "organization_id,user_id" },
    );
  if (error) throw new Error(`attendant_availability: ${error.message}`);
}

async function contato(orgId: string): Promise<string> {
  const { data: existente } = await admin
    .from("contacts")
    .select("id")
    .eq("organization_id", orgId)
    .eq("phone_number", CONTATO_FONE)
    .maybeSingle();
  if (existente) return (existente as { id: string }).id;

  const { data, error } = await admin
    .from("contacts")
    .insert({ organization_id: orgId, name: CONTATO_NOME, phone_number: CONTATO_FONE } as never)
    .select("id")
    .single();
  if (error) throw new Error(`contacts: ${error.message}`);
  return (data as { id: string }).id;
}

async function main(): Promise<void> {
  if (!fs.existsSync(CREDS_PATH)) {
    throw new Error(`${CREDS_PATH} não existe — rode scripts/seed-e2e-credentials.ts antes.`);
  }
  const creds = JSON.parse(fs.readFileSync(CREDS_PATH, "utf8")) as Creds;
  if (!creds.org_id) throw new Error(".e2e-creds.json sem org_id");

  // ⚠️ O DONO É O `agent`, E A ESCOLHA TEM RAZÃO — não é "qualquer usuário serve".
  //
  // `agent` é o piso de papel que a 0177 exige para escrever compromisso (RBAC da
  // DECISÃO 16: `agent+` escreve `calendar_appointments`). Semear a jornada num papel
  // ACIMA disso — manager ou admin — faria o cenário provar o caminho do privilegiado e
  // esconder se o piso realmente basta. O e2e deve semear no papel mínimo que o produto
  // promete, não no mais confortável.
  const donoId = creds.users?.agent?.id ?? null;
  if (!donoId) {
    // Sem dono não há jornada, e sem jornada a consulta recusa com `sem_responsavel` —
    // caminho de ERRO disfarçado de cenário pronto, e a spec passaria a provar a RECUSA
    // achando que prova o sucesso.
    throw new Error(
      ".e2e-creds.json sem `users.agent.id` — a jornada precisa de um atendente dono, e " +
        "semear sem ele deixaria a agenda em `sem_responsavel`, que é o caminho de recusa. " +
        "Rode scripts/seed-e2e-credentials.ts antes.",
    );
  }

  await jornadaPublicada(creds.org_id, donoId);
  const tipoId = await tipoDeAtendimento(creds.org_id, donoId);
  const contatoId = await contato(creds.org_id);

  const bloco = {
    tipo_id: tipoId,
    tipo_slug: TIPO_SLUG,
    tipo_nome: TIPO_NOME,
    dono_user_id: donoId,
    contato_id: contatoId,
    contato_nome: CONTATO_NOME,
    fuso: FUSO,
  };
  fs.writeFileSync(CREDS_PATH, JSON.stringify({ ...creds, agenda: bloco }, null, 2));
  console.info(`[seed-e2e-agenda] ${JSON.stringify(bloco)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
