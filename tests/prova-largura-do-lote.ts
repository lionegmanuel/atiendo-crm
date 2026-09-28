/**
 * QUÃO LARGA É A EXPLOSÃO, EM SEGUNDOS?
 *
 * Já está medido que uma escrita no pipeline doente derruba as linhas que viajam
 * no MESMO lote de leitura do WAL, e que a assinatura sobrevive. Falta o número
 * que transforma isso em taxa: quanto tempo, em torno da escrita envenenada, uma
 * escrita saudável precisa evitar para sobreviver?
 *
 * Com essa largura e com a frequência de escrita do pipeline doente, dá para
 * estimar QUANTO do produto perde evento em silêncio — que é a diferença entre
 * "um funil está mudo" e "o produto perde eventos, sem aviso, o tempo todo".
 *
 * DESENHO: para cada distância Δ, uma escrita ENVENENADA e, Δ depois, uma
 * escrita SAUDÁVEL. A saudável chega?
 *
 *   Δ pequeno  → mesmo lote → deve sumir
 *   Δ grande   → lotes diferentes → deve chegar
 *   a virada é a largura procurada.
 *
 * CONTROLE POSITIVO POR TENTATIVA, e sem ele nada aqui vale: antes do veneno,
 * uma escrita saudável que TEM de chegar. Se ela não chegar, aquela tentativa
 * não mede largura nenhuma — o canal já não entregava — e é descartada em vez de
 * virar "sumiu, logo estava dentro do lote".
 *
 * Run: npx tsx tests/prova-largura-do-lote.ts
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

type Resultado = "chegou" | "sumiu" | "descartada";

async function tentativa(
  id: string,
  gapMs: number,
  bom: string,
  ruim: string,
): Promise<Resultado> {
  const cli = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const vistos = new Set<string>();
  const canal = cli
    .channel(`largura-${id}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "crm_lead_activities" },
      (p: { new?: Record<string, unknown> }) => vistos.add(String(p.new?.reason ?? "")),
    );
  const st = await new Promise<string>((r) => canal.subscribe((s) => r(s)));
  if (st !== "SUBSCRIBED") return "descartada";
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
        reason: `${RUN}-${id}-${etapa}`,
        evidence: {},
        performed_at: new Date().toISOString(),
      } as never)
      .select("id");
    if (error || (data ?? []).length === 0) throw new Error(`escrita ${etapa}: ${error?.message}`);
  };

  await escrever(bom, "controle");
  await new Promise((r) => setTimeout(r, 6000));
  await escrever(ruim, "veneno");
  await new Promise((r) => setTimeout(r, gapMs));
  await escrever(bom, "alvo");
  await new Promise((r) => setTimeout(r, 9000));

  await admin.from("crm_lead_activities").delete().like("reason", `${RUN}-${id}-%`);
  await cli.removeAllChannels();

  // O CONTROLE DECIDE SE A TENTATIVA VALE, antes de o alvo ser lido. Sem isso,
  // um canal que já não entregava produziria "sumiu" e eu contaria como largura.
  if (!vistos.has(`${RUN}-${id}-controle`)) return "descartada";
  return vistos.has(`${RUN}-${id}-alvo`) ? "chegou" : "sumiu";
}

async function main(): Promise<void> {
  carimbar(["tests/prova-largura-do-lote.ts"]);
  const { data: bons } = await admin.from("crm_leads").select("id").eq("pipeline_id", SAUDAVEL).order("id").limit(1);
  const { data: ruins } = await admin
    .from("crm_leads")
    .select("id")
    .eq("pipeline_id", DOENTE)
    .order("created_at")
    .limit(1);
  const bom = (bons ?? [])[0] as { id: string };
  const ruim = (ruins ?? [])[0] as { id: string };

  const GAPS = [0, 200, 500, 1000, 3000];
  console.info(`[alvos] saudável ${bom.id.slice(0, 8)} · doente ${ruim.id.slice(0, 8)}`);
  console.info(`[desenho] veneno, depois Δ, depois a escrita saudável que se quer ver chegar\n`);

  const tabela: string[] = [];
  for (const gap of GAPS) {
    const rs: Resultado[] = [];
    for (let k = 1; k <= 2; k++) rs.push(await tentativa(`${gap}-${k}`, gap, bom.id, ruim.id));
    const linha = `Δ=${String(gap).padStart(4)}ms → ${rs.join(", ")}`;
    console.info(`  ${linha}`);
    tabela.push(linha);
  }

  console.info(`\n=== largura da explosão ===\n  ${tabela.join("\n  ")}`);
  console.info(
    "\n  A leitura é a VIRADA, não uma linha isolada: o menor Δ em que as duas tentativas\n" +
      "  chegam é o piso da distância segura; o maior Δ em que alguma some é o teto da\n" +
      "  largura. Se não houver virada, a largura é maior que o maior Δ testado — e o\n" +
      "  resultado é 'não sei ainda', não 'não existe'.",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ prova falhou:", err);
  process.exit(1);
});
