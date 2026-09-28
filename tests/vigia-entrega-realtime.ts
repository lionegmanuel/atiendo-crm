/**
 * VIGIA: a entrega ainda está viva, e desde quando?
 *
 * O defeito sumiu sem ninguém ter consertado — e defeito que some sozinho volta
 * sozinho. Hoje eu só consegui cercar o INÍCIO do silêncio porque tinha, por
 * acaso, um veredito verde datado (a wave 6 fechando 13/0/0 às 11:41) e um
 * vermelho datado meia hora depois. A janela de 31 minutos foi sorte de registro,
 * não instrumento.
 *
 * Este vigia troca a sorte por um relógio: mede a entrega dos DOIS pipelines de
 * tempos em tempos e escreve uma linha por ciclo. Se o defeito voltar, a
 * transição fica com hora — em vez de ser descoberta de novo por acidente, e
 * datada por aproximação.
 *
 * DESENHO, e cada escolha tem motivo:
 *   - assinatura SEM FILTRO, porque filtro é uma variável a menos e foi
 *     levantado como diferença possível entre a minha medição e a do @DevVivo;
 *   - o pipeline saudável em TODO ciclo, intercalado, como controle positivo:
 *     um ciclo em que ele também não entrega não acusa ninguém, e é registrado
 *     como INDECIDÍVEL em vez de virar "o defeito voltou";
 *   - cliente novo por medição, porque cliente reaproveitado já me deu zeros que
 *     não se reproduziram;
 *   - volume declarado: 2 escritas por ciclo, apagadas em seguida.
 *
 * Run: CICLOS=12 INTERVALO_MIN=5 npx tsx tests/vigia-entrega-realtime.ts
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

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
const LOG = path.join(process.cwd(), "evidence", "vigia-entrega.log");

/**
 * UM CICLO = UMA ASSINATURA, DUAS ESCRITAS.
 *
 * A versão anterior media o pipeline saudável e o doente em assinaturas
 * SEPARADAS. O @DevVivo mostrou por que isso é frágil: uma assinatura pode ser
 * registrada como ANÔNIMA no servidor enquanto o cliente diz SUBSCRIBED — o
 * estado reportado é do CLIENTE, não do que o servidor gravou. Com duas
 * assinaturas, o controle podia estar são e a do doente nascer surda, e eu leria
 * "o defeito voltou" sobre uma assinatura que nunca funcionou.
 *
 * Aqui o CANÁRIO viaja na MESMA assinatura que vai julgar o lead doente: primeiro
 * uma escrita no pipeline saudável, que TEM de chegar; só se ela chegar é que o
 * resultado do doente significa alguma coisa. É o controle positivo deixando de
 * ser "outra medição na mesma janela" e passando a ser "a mesma medição".
 */
async function ciclo(bom: string, doente: string): Promise<{ canario: boolean; doente: boolean }> {
  const cli = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const vistos = new Set<string>();
  const canal = cli
    .channel(`vigia-${RUN}-${Date.now() % 1000000}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "crm_lead_activities" },
      (p: { new?: Record<string, unknown> }) => vistos.add(String(p.new?.reason ?? "")),
    );
  const st = await new Promise<string>((r) => canal.subscribe((s) => r(s)));
  if (st !== "SUBSCRIBED") {
    await cli.removeAllChannels();
    return { canario: false, doente: false };
  }
  await new Promise((r) => setTimeout(r, 2000));

  // O RELÓGIO DOS DOIS NEGÓCIOS, ANTES. O tipo `note` está na LISTA POSITIVA do
  // gatilho de última atividade — então cada ciclo meu movia `last_activity_at`
  // dos dois leads, e apagar a atividade depois NÃO devolvia o relógio. Doze
  // ciclos deixaram os dois parecendo 49 minutos mais ativos do que estavam, num
  // pipeline cuja feature CENTRAL é decidir quem esfriou. O vigia estava
  // contaminando exatamente a grandeza que a wave 7 mede.
  const relogios = new Map<string, string | null>();
  for (const id of [bom, doente]) {
    const { data } = await admin.from("crm_leads").select("last_activity_at").eq("id", id).single();
    relogios.set(id, (data as { last_activity_at: string | null } | null)?.last_activity_at ?? null);
  }

  const marcas = { canario: `${RUN}-canario-${Date.now() % 1000000}`, doente: `${RUN}-doente-${Date.now() % 1000000}` };
  const escrever = async (leadId: string, marca: string): Promise<void> => {
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
    if (error) throw new Error(`vigia: ${error.message}`);
  };

  await escrever(bom, marcas.canario);
  // Folga entre as duas: se caíssem no mesmo instante eu não saberia distinguir
  // "as duas chegaram" de "chegou uma e eu contei duas".
  await new Promise((r) => setTimeout(r, 1500));
  await escrever(doente, marcas.doente);
  await new Promise((r) => setTimeout(r, 7000));

  await admin.from("crm_lead_activities").delete().in("reason", [marcas.canario, marcas.doente]);
  // E O RELÓGIO VOLTA. Por UPDATE direto: desfazer contaminação minha não é
  // operação do produto, e não existe caminho de produto que ande para trás.
  for (const [id, quando] of relogios) {
    await admin.from("crm_leads").update({ last_activity_at: quando } as never).eq("id", id);
  }
  await cli.removeAllChannels();
  return { canario: vistos.has(marcas.canario), doente: vistos.has(marcas.doente) };
}

async function main(): Promise<void> {
  carimbar(["tests/vigia-entrega-realtime.ts"]);
  const CICLOS = Number(process.env.CICLOS ?? "12");
  const INTERVALO = Number(process.env.INTERVALO_MIN ?? "5") * 60_000;
  const { data: b } = await admin.from("crm_leads").select("id").eq("pipeline_id", SAUDAVEL).order("id").limit(1);
  const { data: d } = await admin
    .from("crm_leads")
    .select("id")
    .eq("pipeline_id", DOENTE)
    .order("created_at")
    .limit(1);
  const bom = (b ?? [])[0] as { id: string };
  const doente = (d ?? [])[0] as { id: string };
  console.info(`[vigia] ${CICLOS} ciclos a cada ${INTERVALO / 60000}min · log em ${LOG}`);

  // O NÚMERO QUE SOBE QUANDO EU ESTOU ERRADO. "Ciclos verdes" é contagem de
  // progresso: só cresce quando parece que está tudo bem, e por isso PARECE
  // rigor sem proteger de nada. `indecidiveis` cresce exatamente quando o
  // aparato deixa de medir — e um vigia que perdeu a capacidade de medir mostra
  // um número subindo em vez de ficar quieto, verde e inútil.
  let indecidiveis = 0;
  for (let i = 1; i <= CICLOS; i++) {
    const { canario: okBom, doente: okDoente } = await ciclo(bom.id, doente.id);
    const hora = new Date().toTimeString().slice(0, 8);
    // O CONTROLE DECIDE A LEITURA DO CICLO. Sem ele, um ciclo em que nada
    // entrega viraria "o defeito voltou" — e seria o mesmo par caído que eu já
    // descartei uma vez hoje, agora escrito num log que ninguém vai reauditar.
    const leitura = !okBom
      ? "INDECIDÍVEL (o canário não chegou NESTA assinatura)"
      : okDoente
        ? "os dois entregam"
        : "*** O DEFEITO VOLTOU: controle entrega, doente não ***";
    if (!okBom) indecidiveis++;
    const linha =
      `${hora} ciclo ${String(i).padStart(2)} · canário=${okBom ? "ok" : "FALHOU"} · ` +
      `doente=${okDoente ? "ok" : "FALHOU"} · indecidíveis acumulados=${indecidiveis}/${i} · ${leitura}`;
    console.info(`  ${linha}`);
    fs.appendFileSync(LOG, `${new Date().toISOString()} ${linha}\n`);
    if (i < CICLOS) await new Promise((r) => setTimeout(r, INTERVALO));
  }
  // O FECHO REPORTA A FRAGILIDADE, não o placar. Um vigia que terminou com
  // metade dos ciclos indecidíveis não vigiou nada — e essa linha é a única
  // chance de alguém perceber isso sem reler o log inteiro.
  const fecho =
    indecidiveis === 0
      ? `vigia encerrado: ${CICLOS} ciclos, NENHUM indecidível — a série é legível inteira`
      : `vigia encerrado: ${indecidiveis} de ${CICLOS} ciclos INDECIDÍVEIS — o aparato deixou de ` +
        `medir em ${Math.round((indecidiveis / CICLOS) * 100)}% da série, e ela não sustenta veredito`;
  console.info(`\n${fecho}`);
  fs.appendFileSync(LOG, `${new Date().toISOString()} ${fecho}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ vigia falhou:", err);
  process.exit(1);
});
