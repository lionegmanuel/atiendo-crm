/**
 * O DISCRIMINADOR VALE PARA OUTRA TABELA?
 *
 * Medido: atividade de lead do pipeline "Pedidos" chega (12/12, 3/3); atividade
 * de lead do pipeline "CRM Vivo — Clínica" não chega (0/3), inclusive em lead
 * ANTIGO e com assinante SEM filtro. O Realtime não enxerga pipeline — então ou
 * existe um mecanismo que eu não conheço, ou a diferença que eu chamei de
 * "pipeline" é outra coisa correlacionada com ele.
 *
 * Este corte troca a TABELA e mantém os dois leads: um UPDATE em `crm_leads`,
 * que também está na publicação. Se o UPDATE do lead do CRM Vivo também sumir, o
 * discriminador acompanha a LINHA através de tabelas diferentes. Se chegar, o
 * problema é específico de `crm_lead_activities` — e são consertos diferentes.
 *
 * Run: npx tsx tests/prova-discriminador.ts <leadPedidos> <leadCrmVivo>
 */
import { createClient } from "@supabase/supabase-js";

import { carimbar } from "./qa-helpers";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const env = carregarEnvLocal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main(): Promise<void> {
  carimbar(["tests/prova-discriminador.ts"]);
  // AMOSTRA, não um par. Dois leads podem diferir por acaso em qualquer coisa;
  // se TODOS de um pipeline chegam e NENHUM do outro chega, a coincidência
  // precisaria valer seis vezes seguidas na mesma janela.
  const ids = process.argv.slice(2);
  const [pedidos, crmVivo] = [ids[0]!, ids[ids.length - 1]!];
  const vistos: string[] = [];
  const cli = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const canal = cli
    .channel("discriminador-leads")
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "crm_leads" },
      (p: { new?: Record<string, unknown> }) => vistos.push(String(p.new?.id ?? "?").slice(0, 8)),
    );
  console.info(`[canal] UPDATE em crm_leads, sem filtro: ${await new Promise<string>((r) => canal.subscribe((s) => r(s)))}`);
  await new Promise((r) => setTimeout(r, 2500));

  for (const id of ids) {
    const { error } = await admin
      .from("crm_leads")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(`update ${id.slice(0, 8)}: ${error.message}`);
  }
  await new Promise((r) => setTimeout(r, 9000));

  console.info(
    `\n  chegaram: ${vistos.join(", ") || "(nenhum)"}\n` +
      ids
        .map((id) => `  ${id.slice(0, 8)} → ${vistos.includes(id.slice(0, 8)) ? "CHEGOU" : "sumiu"}`)
        .join("\n"),
  );
  void pedidos;
  void crmVivo;
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ prova falhou:", err);
  process.exit(1);
});
