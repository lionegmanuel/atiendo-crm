/**
 * O CAMINHO DE `crm_leads` MORREU PARA TODO MUNDO?
 *
 * Durante a janela da grade binária, a sonda de UPDATE em `crm_leads` deu zero
 * para os SEIS leads — inclusive os de "Pedidos", que são o meu controle
 * positivo. Descartei a rodada em vez de reportar, porque controle caído não
 * julga ninguém. Mas o zero em si é um fato que ficou solto: de manhã aquele
 * mesmo caminho entregava para "Pedidos" (3 de 3, duas vezes).
 *
 * E ISSO IMPORTA MAIS QUE O DEFEITO DE ONTEM. Se o caminho de `crm_leads` está
 * morto para todos, o board está mudo em TODOS os pipelines, e não só no do CRM
 * Vivo — o raio da explosão muda de tamanho.
 *
 * O par vai na MESMA assinatura e no MESMO instante: um UPDATE em `crm_leads` e
 * um INSERT em `crm_lead_activities`, os dois no mesmo lead de "Pedidos", com
 * dois canais sem filtro no mesmo cliente. `crm_lead_activities` é o controle
 * vivo — ele entregou 2/2 minutos atrás. Se ele chegar e o outro não, a
 * diferença é o CAMINHO, e não o ambiente, nem o momento, nem o cliente.
 *
 * Run: npx tsx tests/prova-caminho-de-leads.ts
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
const PIPELINE_VIVO = "48c02b4a-0ca1-4bca-8ef0-206b6d240d23";
const RUN = randomUUID().slice(0, 6);

async function rodada(i: number, lead: { id: string; title: string }): Promise<string> {
  const cli = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const chegou = { leads: 0, atividades: 0, leadsAuth: 0 };
  // ASSINANTE AUTENTICADO NO MESMO INSTANTE. A hipótese em julgamento é sobre
  // RLS avaliada no old_record de um UPDATE — e service role BYPASSA RLS, então
  // um assinante privilegiado não pode testá-la nem para confirmar nem para
  // negar. Medir só com ele seria responder a outra pergunta e chamar de
  // resposta. É o papel que a hipótese nomeia que precisa estar no experimento.
  const autenticado = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const entrada = await autenticado.auth.signInWithPassword({
    email: (CREDS.users as Record<string, { email: string }>).manager!.email,
    password: CREDS.password as string,
  });
  if (!entrada.data.session) throw new Error("não autenticou fora do navegador");
  autenticado.realtime.setAuth(entrada.data.session.access_token);
  const c3 = autenticado
    .channel(`caminho-auth-${RUN}-${i}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "crm_leads" }, () => {
      chegou.leadsAuth++;
    });
  const c1 = cli
    .channel(`caminho-leads-${RUN}-${i}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "crm_leads" }, () => {
      chegou.leads++;
    });
  const c2 = cli
    .channel(`caminho-ativ-${RUN}-${i}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "crm_lead_activities" }, () => {
      chegou.atividades++;
    });
  const e1 = await new Promise<string>((r) => c1.subscribe((s) => r(s)));
  const e2 = await new Promise<string>((r) => c2.subscribe((s) => r(s)));
  const e3 = await new Promise<string>((r) => c3.subscribe((s) => r(s)));
  if (e1 !== "SUBSCRIBED" || e2 !== "SUBSCRIBED" || e3 !== "SUBSCRIBED")
    return `assinatura falhou (${e1}/${e2}/${e3})`;
  await new Promise((r) => setTimeout(r, 2500));

  const marca = `${RUN} caminho ${i}`;
  // OS DOIS GATILHOS SÃO CONFERIDOS. Um UPDATE que não muda nada e um INSERT que
  // um gatilho suprime devolvem sucesso e não escrevem — e aí os dois zeros
  // seriam sobre eventos que nunca existiram, não sobre entrega.
  const up = await admin
    .from("crm_leads")
    .update({ title: `${lead.title} ${marca}` })
    .eq("id", lead.id)
    .select("id,title");
  if (up.error || (up.data ?? []).length === 0) return `UPDATE não escreveu: ${up.error?.message}`;
  const ins = await admin
    .from("crm_lead_activities")
    .insert({
      organization_id: ORG,
      lead_id: lead.id,
      source_module: "qa",
      type: "note",
      actor_kind: "system",
      reason: marca,
      evidence: {},
      performed_at: new Date().toISOString(),
    } as never)
    .select("id");
  if (ins.error || (ins.data ?? []).length === 0) return `INSERT não escreveu: ${ins.error?.message}`;

  await new Promise((r) => setTimeout(r, 8000));
  await admin.from("crm_leads").update({ title: lead.title }).eq("id", lead.id);
  await admin.from("crm_lead_activities").delete().eq("reason", marca);
  await cli.removeAllChannels();
  await autenticado.removeAllChannels();
  return (
    `crm_leads UPDATE (serviço): ${chegou.leads > 0 ? "CHEGOU" : "sumiu"} · ` +
    `crm_leads UPDATE (AUTENTICADO): ${chegou.leadsAuth > 0 ? "CHEGOU" : "sumiu"} · ` +
    `crm_lead_activities INSERT: ${chegou.atividades > 0 ? "CHEGOU" : "sumiu"}`
  );
}

async function main(): Promise<void> {
  carimbar(["tests/prova-caminho-de-leads.ts"]);
  const { data } = await admin
    .from("crm_leads")
    .select("id,title")
    .eq("pipeline_id", PIPELINE_VIVO)
    .order("id")
    .limit(1);
  const lead = (data ?? [])[0] as { id: string; title: string };
  console.info(`[alvo] lead ${lead.id.slice(0, 8)} do pipeline SAUDÁVEL — os dois gatilhos na mesma linha`);

  const linhas: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const r = await rodada(i, lead);
    console.info(`  rodada ${i} · ${r}`);
    linhas.push(r);
  }
  const leadsOk = linhas.filter((l) => l.includes("(serviço): CHEGOU")).length;
  const authOk = linhas.filter((l) => l.includes("(AUTENTICADO): CHEGOU")).length;
  const ativOk = linhas.filter((l) => l.includes("INSERT: CHEGOU")).length;
  console.info(
    `\n=== UPDATE de crm_leads: ${leadsOk}/3 por serviço, ${authOk}/3 AUTENTICADO · ` +
      `INSERT de atividades: ${ativOk}/3 ===\n` +
      (authOk === 3
        ? "  O ASSINANTE AUTENTICADO RECEBE UPDATE de crm_leads. A hipótese de que a RLS\n" +
          "  descarta o evento por causa do old_record (replica identity default, sem\n" +
          "  organization_id) está REFUTADA no papel que ela nomeia — e não há por que\n" +
          "  alterar replica identity em banco compartilhado por causa dela.\n"
        : "  O assinante autenticado NÃO recebe, e o de serviço recebe. Compatível com a\n" +
          "  hipótese da RLS sobre o old_record: vale o ALTER como teste.\n") +
      (ativOk === 3 && leadsOk === 0
        ? "==> o caminho de crm_leads está morto para TODOS os pipelines. O board fica mudo em\n" +
          "    qualquer um deles, e o raio da explosão é maior do que o defeito de ontem."
        : leadsOk === 3 && ativOk === 3
          ? "==> os dois caminhos entregam. O zero da janela anterior foi momentâneo, e o certo\n" +
            "    é eu não ter reportado aquilo — a rodada descartada era mesmo indecidível."
          : "==> resultado misto. Intermitente é o pior dos mundos e exige mais rodadas antes\n" +
            "    de qualquer laudo."),
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ prova falhou:", err);
  process.exit(1);
});
