/**
 * MESMA ASSINATURA, DOIS LEADS — o experimento que não pode ser confundido.
 *
 * A taxa de entrega, medida em processos separados e intercalados no tempo, deu
 * 12/12 e 3/3 num lead que já existia e 0/3 num lead criado segundos antes —
 * inclusive com assinante SEM FILTRO, que deveria receber tudo. Só que isso
 * ainda são DUAS execuções: sobra a suspeita de que algo além do lead mudou.
 *
 * Aqui é uma assinatura só, sem filtro, e dois INSERTs no mesmo instante — um em
 * cada lead. Um único observador, uma única janela, uma única conexão. Se chegar
 * o do lead antigo e não chegar o do novo, a diferença é a LINHA, e não há mais
 * onde se esconder.
 *
 * O que se lê no quadro é o `lead_id` que veio dentro dele: contar quantos
 * chegaram diria "chegou 1 de 2" sem dizer QUAL, e os dois defeitos possíveis
 * têm o mesmo número.
 *
 * Run: npx tsx tests/prova-dois-leads-um-canal.ts
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import { CREDS, carimbar } from "./qa-helpers";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const env = carregarEnvLocal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ORG = CREDS.org_id as string;
const PIPELINE = (CREDS.crm_vivo as { pipeline_id: string }).pipeline_id;
const STAGE = Object.values((CREDS.crm_vivo as { stage_ids: Record<string, string> }).stage_ids)[0]!;
const DONO = (CREDS.users as Record<string, { id: string }>).manager!.id;
const RUN = randomUUID().slice(0, 8);

async function main(): Promise<void> {
  carimbar(["tests/prova-dois-leads-um-canal.ts"]);

  const { data: leads } = await admin
    .from("crm_leads")
    .select("id,title,created_at,pipeline_id,stage_id,owner_user_id")
    .eq("organization_id", ORG)
    .eq("status", "open")
    .order("id")
    .limit(1);
  const antigo = (leads ?? [])[0] as
    | { id: string; title: string; created_at: string; pipeline_id: string; stage_id: string }
    | undefined;
  if (!antigo) throw new Error("sem lead antigo");

  const { data: criado, error: erroCriar } = await admin
    .from("crm_leads")
    .insert({
      organization_id: ORG,
      // O lead novo nasce no MESMO pipeline do antigo quando `MESMO_PIPELINE=1`.
      // Os dois leads da primeira medição estavam em pipelines diferentes, e eu
      // li a diferença como "novo vs antigo" sem ter olhado para isso. Enquanto
      // as duas variáveis andarem juntas, a conclusão serve às duas.
      pipeline_id: process.env.MESMO_PIPELINE === "1" ? antigo.pipeline_id : PIPELINE,
      stage_id: process.env.MESMO_PIPELINE === "1" ? antigo.stage_id : STAGE,
      title: `QA-DOIS ${RUN}`,
      owner_user_id: DONO,
      status: "open",
      position_in_stage: 1000,
    } as never)
    .select("id,pipeline_id,stage_id")
    .single();
  if (erroCriar || !criado) throw new Error(`criar lead: ${erroCriar?.message}`);
  const novo = criado as { id: string; pipeline_id: string; stage_id: string };

  console.info(`[antigo] ${antigo.id.slice(0, 8)} pipeline=${antigo.pipeline_id.slice(0, 8)} stage=${antigo.stage_id.slice(0, 8)}`);
  console.info(`[novo]   ${novo.id.slice(0, 8)} pipeline=${novo.pipeline_id.slice(0, 8)} stage=${novo.stage_id.slice(0, 8)}`);

  const chegaram: string[] = [];
  const cli = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const canal = cli
    .channel(`dois-${RUN}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "crm_lead_activities" },
      (p: { new?: Record<string, unknown> }) => {
        const id = String(p.new?.lead_id ?? "?").slice(0, 8);
        chegaram.push(id);
      },
    );
  const estado = await new Promise<string>((r) => canal.subscribe((s) => r(s)));
  console.info(`[canal] uma assinatura SEM filtro: ${estado}`);
  await new Promise((r) => setTimeout(r, 2500));

  for (const [rotulo, leadId] of [
    ["antigo", antigo.id],
    ["novo", novo.id],
  ] as const) {
    const { error } = await admin.from("crm_lead_activities").insert({
      organization_id: ORG,
      lead_id: leadId,
      source_module: "qa",
      type: "note",
      actor_kind: "system",
      reason: `${RUN} dois-leads ${rotulo}`,
      evidence: {},
      performed_at: new Date().toISOString(),
    } as never);
    if (error) throw new Error(`insert ${rotulo}: ${error.code} ${error.message}`);
  }
  console.info("[gatilho] um INSERT em cada lead");

  await new Promise((r) => setTimeout(r, 9000));

  // A PERGUNTA MAIS BURRA POR ÚLTIMO, e é a que eu deveria ter feito primeiro:
  // a linha EXISTE? Um `insert` que um gatilho BEFORE suprime devolve sucesso ao
  // cliente e não escreve nada — sem linha não há WAL, sem WAL não há realtime, e
  // todo o meu inquérito sobre entrega estaria investigando um evento que nunca
  // houve. Eu chequei o `error` do insert e tratei isso como prova de escrita;
  // não é. Prova de escrita é ler de volta.
  const { data: gravadas } = await admin
    .from("crm_lead_activities")
    .select("lead_id")
    .like("reason", `${RUN} dois-leads%`);
  const escritas = ((gravadas ?? []) as { lead_id: string }[]).map((r) => r.lead_id.slice(0, 8));
  console.info(`[leitura de volta] linhas realmente gravadas: ${escritas.join(", ") || "(nenhuma)"}`);

  const veioAntigo = chegaram.includes(antigo.id.slice(0, 8));
  const veioNovo = chegaram.includes(novo.id.slice(0, 8));
  console.info(
    `\n=== um observador, uma janela ===\n` +
      `  quadros recebidos: ${chegaram.length === 0 ? "(nenhum)" : chegaram.join(", ")}\n` +
      `  lead ANTIGO chegou: ${veioAntigo}\n` +
      `  lead NOVO   chegou: ${veioNovo}`,
  );
  console.info(
    veioAntigo && !veioNovo
      ? "==> a MESMA assinatura recebe a linha de um lead e não recebe a do outro. A diferença\n" +
        "    é a LINHA — e não sobrou hipótese de conexão, filtro, RLS, cliente ou tempo."
      : veioAntigo && veioNovo
        ? "==> os dois chegam. O zero do lead novo era das execuções separadas, não do lead."
        : "==> nem o lead antigo chegou nesta janela. Este observador não está medindo entrega\n" +
          "    nenhuma, e nada aqui julga o lead novo.",
  );

  await admin.from("crm_lead_activities").delete().like("reason", `${RUN} dois-leads%`);
  await admin.from("crm_leads").delete().eq("id", novo.id);
  await cli.removeAllChannels();
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ prova falhou:", err);
  process.exit(1);
});
