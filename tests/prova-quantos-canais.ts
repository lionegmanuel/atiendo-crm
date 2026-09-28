/**
 * UM CANAL RECEBE, TRÊS NÃO — a hipótese que sobrou depois de o controle zerar.
 *
 * `prova-canal-timeline.ts` assina UM canal de `postgres_changes` e recebe.
 * `prova-lead-novo-vs-antigo.ts` assina TRÊS no mesmo cliente e não recebe
 * nada — nem o canal SEM filtro, que não tem como não casar. A diferença entre
 * os dois scripts não é o lead nem a RLS: é a QUANTIDADE de assinaturas.
 *
 * Se isso se confirmar, não é curiosidade de laboratório: o navegador do CRM
 * assina o board e a timeline no mesmo socket, e "duas assinaturas matam a
 * entrega" explicaria de uma vez o dossiê mudo, o board mudo e o inbox mudo —
 * sem culpar hook, RLS, token ou ciclo de vida, que é onde eu estava caçando.
 *
 * O experimento é escada, não par: 1 canal, depois 2, depois 3, cada rodada com
 * cliente NOVO (para não herdar estado da anterior) e o mesmo gatilho. Se a
 * entrega cair a partir de um número, o número é o achado.
 *
 * Run: npx tsx tests/prova-quantos-canais.ts
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import { CREDS, carimbar } from "./qa-helpers";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const env = carregarEnvLocal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ORG = CREDS.org_id as string;
const RUN = randomUUID().slice(0, 8);

/**
 * A escada morreu: 1, 2 e 3 canais entregam igual. Então a diferença entre o
 * script que recebe e o que não recebe não é a QUANTIDADE — e sobrou uma coisa
 * só que o outro script tem e este não: um canal SEM filtro no mesmo cliente.
 *
 * `semFiltro` liga esse canal a mais. O canal OBSERVADO continua sendo o mesmo
 * filtrado de sempre, para a única variável ser a companhia dele.
 */
async function rodada(quantos: number, leadId: string, semFiltro = false): Promise<string> {
  // CLIENTE NOVO A CADA RODADA. Reaproveitar o cliente carregaria o estado da
  // rodada anterior para dentro da próxima medição — e o efeito que eu procuro
  // é justamente de acúmulo.
  const cli: SupabaseClient = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL!,
    env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  // O CANAL OBSERVADO É SEMPRE O PRIMEIRO, com o mesmo filtro em todas as
  // rodadas. Os demais são RUÍDO deliberado: existem só para ocupar assinatura.
  // Trocar o canal observado junto com a quantidade seria mudar duas coisas.
  let recebidos = 0;
  const canais = [];
  for (let i = 0; i < quantos; i++) {
    const c = cli.channel(`escada-${RUN}-${quantos}-${i}`).on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "crm_lead_activities", filter: `lead_id=eq.${leadId}` },
      () => {
        if (i === 0) recebidos++;
      },
    );
    canais.push(new Promise<string>((r) => c.subscribe((s) => r(s))));
  }
  if (semFiltro) {
    const c = cli
      .channel(`escada-${RUN}-${quantos}-livre`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "crm_lead_activities" }, () => {});
    canais.push(new Promise<string>((r) => c.subscribe((s) => r(s))));
  }
  const estados = await Promise.all(canais);
  await new Promise((r) => setTimeout(r, 3000));

  const marca = `${RUN} escada ${quantos}`;
  const { error } = await admin.from("crm_lead_activities").insert({
    organization_id: ORG,
    lead_id: leadId,
    source_module: "qa",
    type: "note",
    actor_kind: "system",
    reason: marca,
    evidence: {},
    performed_at: new Date().toISOString(),
  } as never);
  if (error) throw new Error(`gatilho da rodada ${quantos}: ${error.code} ${error.message}`);

  await new Promise((r) => setTimeout(r, 8000));
  await admin.from("crm_lead_activities").delete().eq("reason", marca);
  await cli.removeAllChannels();

  const todosOk = estados.every((e) => e === "SUBSCRIBED");
  return `${quantos} canal(is) filtrado(s) → o PRIMEIRO recebeu ${recebidos} ` +
    `(assinaturas: ${todosOk ? "todas SUBSCRIBED" : estados.join(",")})`;
}

async function main(): Promise<void> {
  carimbar(["tests/prova-quantos-canais.ts"]);
  const { data: leads } = await admin
    .from("crm_leads")
    .select("id,title")
    .eq("organization_id", ORG)
    .eq("status", "open")
    .order("id")
    .limit(1);
  const lead = (leads ?? [])[0] as { id: string; title: string } | undefined;
  if (!lead) throw new Error("sem lead");
  console.info(`[alvo] lead ${lead.id.slice(0, 8)} — o MESMO nas três rodadas`);

  const linhas: string[] = [];
  for (const [n, livre] of [[1, false], [2, false], [3, false], [1, true], [2, true]] as const) {
    const linha = `${livre ? "COM um canal sem filtro junto: " : ""}${await rodada(n, lead.id, livre)}`;
    console.info(`  ${linha}`);
    linhas.push(linha);
  }

  console.info(`\n=== escada de assinaturas, mesmo lead, mesmo gatilho ===\n  ${linhas.join("\n  ")}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ prova falhou:", err);
  process.exit(1);
});
