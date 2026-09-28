/**
 * O VENENO MATA O LOTE OU MATA A ASSINATURA?
 *
 * Duas observações que não se encaixavam. Numa rodada, escrevendo os leads de
 * "Pedidos" PRIMEIRO, os três chegaram e os do CRM Vivo não. Noutra, com a mesma
 * ordem, não chegou NADA. A diferença entre elas não era a ordem — as seis
 * escritas caíram em menos de um segundo nos dois casos, e o que muda é se elas
 * couberam no MESMO lote de leitura do WAL.
 *
 * Isso separa dois diagnósticos com consertos e gravidades diferentes:
 *   LOTE       — uma linha ruim derruba as que viajam junto, e só elas. Quem
 *                escreve longe do CRM Vivo no tempo continua recebendo.
 *   ASSINATURA — a primeira linha ruim mata o canal para sempre; tudo depois se
 *                perde, mesmo sem relação nenhuma com o CRM Vivo.
 *
 * O experimento afasta as escritas no tempo, que é a única forma de fazê-las
 * cair em lotes diferentes:
 *
 *   t=0    escreve em "Pedidos"   → chega? (assinatura sadia antes do veneno)
 *   t=6s   escreve no CRM Vivo    → não deve chegar (é o defeito conhecido)
 *   t=12s  escreve em "Pedidos"   → CHEGA?  ← é esta que decide
 *
 * Se a terceira chegar, o dano é de lote. Se sumir, a assinatura morreu no
 * caminho — e aí o board de QUALQUER pipeline para de funcionar assim que
 * alguém mexer num lead do CRM Vivo, o que é um raio muito maior.
 *
 * Run: npx tsx tests/prova-lote-ou-assinatura.ts
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
const SAUDAVEL = "48c02b4a-0ca1-4bca-8ef0-206b6d240d23";
const DOENTE = "35bf4ac9-c5e0-4f7d-846a-99b1bcc92d69";
const RUN = randomUUID().slice(0, 6);

async function rodada(i: number, bom: string, ruim: string): Promise<string[]> {
  const cli = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const vistos: string[] = [];
  const canal = cli
    .channel(`lote-${RUN}-${i}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "crm_lead_activities" },
      (p: { new?: Record<string, unknown> }) => vistos.push(String(p.new?.reason ?? "?")),
    );
  const st = await new Promise<string>((r) => canal.subscribe((s) => r(s)));
  if (st !== "SUBSCRIBED") throw new Error(`assinatura: ${st}`);
  await new Promise((r) => setTimeout(r, 2500));

  const escrever = async (leadId: string, etapa: string): Promise<void> => {
    const { data, error } = await admin
      .from("crm_lead_activities")
      .insert({
        organization_id: ORG,
        lead_id: leadId,
        source_module: "qa",
        type: "note",
        actor_kind: "system",
        reason: `${RUN}-${i}-${etapa}`,
        evidence: {},
        performed_at: new Date().toISOString(),
      } as never)
      .select("id");
    if (error || (data ?? []).length === 0) throw new Error(`escrita ${etapa}: ${error?.message}`);
  };

  // A SEPARAÇÃO NO TEMPO É O EXPERIMENTO. Escrever tudo junto — que é o que eu
  // vinha fazendo — garante o mesmo lote e torna lote e assinatura
  // indistinguíveis: os dois produzem "sumiu tudo".
  await escrever(bom, "antes");
  await new Promise((r) => setTimeout(r, 6000));
  await escrever(ruim, "veneno");
  await new Promise((r) => setTimeout(r, 6000));
  await escrever(bom, "depois");
  await new Promise((r) => setTimeout(r, 8000));

  await admin.from("crm_lead_activities").delete().like("reason", `${RUN}-${i}-%`);
  await cli.removeAllChannels();
  return vistos;
}

async function main(): Promise<void> {
  carimbar(["tests/prova-lote-ou-assinatura.ts"]);
  const { data: bons } = await admin.from("crm_leads").select("id").eq("pipeline_id", SAUDAVEL).order("id").limit(1);
  const { data: ruins } = await admin
    .from("crm_leads")
    .select("id")
    .eq("pipeline_id", DOENTE)
    .order("created_at")
    .limit(1);
  const bom = (bons ?? [])[0] as { id: string };
  const ruim = (ruins ?? [])[0] as { id: string };
  console.info(`[alvos] saudável ${bom.id.slice(0, 8)} · doente ${ruim.id.slice(0, 8)} · escritas separadas por 6s`);

  const resumo: string[] = [];
  for (let i = 1; i <= 2; i++) {
    const vistos = await rodada(i, bom.id, ruim.id);
    const tem = (e: string): string => (vistos.some((v) => v.endsWith(e)) ? "CHEGOU" : "sumiu");
    const linha = `antes=${tem("antes")} · veneno=${tem("veneno")} · DEPOIS=${tem("depois")}`;
    console.info(`  rodada ${i} · ${linha}`);
    resumo.push(linha);
  }

  const depoisChegou = resumo.filter((l) => l.includes("DEPOIS=CHEGOU")).length;
  const antesChegou = resumo.filter((l) => l.includes("antes=CHEGOU")).length;
  console.info(
    `\n=== ${antesChegou}/2 antes · ${depoisChegou}/2 DEPOIS ===\n` +
      (antesChegou === 0
        ? "==> nem a escrita ANTES do veneno chegou. Sem essa, a rodada não julga nada: o canal\n" +
          "    já não entregava, e o que veio depois não prova consequência de nada."
        : depoisChegou === 2
          ? "==> dano de LOTE. A linha ruim derruba quem viaja junto, e a assinatura sobrevive —\n" +
            "    quem escreve longe do CRM Vivo no tempo continua recebendo."
          : depoisChegou === 0
            ? "==> a ASSINATURA MORRE. Depois da primeira linha do CRM Vivo, o canal não entrega\n" +
              "    mais nada — e o board de QUALQUER pipeline para assim que alguém mexer num lead\n" +
              "    de lá. O raio é muito maior que o defeito de ontem."
            : "==> misto em 2 rodadas: não decide, e comportamento intermitente exige mais."),
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ prova falhou:", err);
  process.exit(1);
});
