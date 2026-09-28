/**
 * Estreia do estado de risco numa organização (wave 7, peça 4).
 *
 *   npx tsx scripts/seed-risk-states.ts [organization_id]
 *
 * Sem argumento, roda na org do primeiro negócio aberto que encontrar — útil em
 * desenvolvimento, INADEQUADO em produção com mais de um tenant. Em produção,
 * passe o id: escolher a org sozinho é o tipo de conveniência que vira acidente
 * multi-tenant.
 *
 * É IDEMPOTENTE (upsert por lead) e pode ser re-executado. O que ele NÃO faz:
 * emitir atividade de timeline — o acervo esfriou há dias e "esfriou agora"
 * seria falso. Ver `lib/leads/risk-seed.ts` para as três decisões.
 */

import { createClient } from "@supabase/supabase-js";

import { semeiaEstadosDeRisco } from "@/lib/leads/risk-seed";
import { carregarEnvLocal } from "./lib/env-de-teste";

function env(): Record<string, string> {
  // `process.env` vence o `.env.local`, e a ausência do arquivo não é erro —
  // ver scripts/lib/env-de-teste.ts.
  return carregarEnvLocal();
}

async function main(): Promise<void> {
  const e = env();
  const admin = createClient(e.NEXT_PUBLIC_SUPABASE_URL!, e.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  let org = process.argv[2];
  if (!org) {
    const { data } = await admin
      .from("crm_leads")
      .select("organization_id")
      .eq("status", "open")
      .limit(1);
    org = (data?.[0] as { organization_id: string } | undefined)?.organization_id;
    if (!org) throw new Error("nenhum negócio aberto encontrado — passe o organization_id");
    console.info(`[seed-risk] sem argumento: usando a org ${org.slice(0, 8)} (só faça isso em dev)`);
  }

  const r = await semeiaEstadosDeRisco(admin, org);
  console.info(
    `[seed-risk] ${r.gravados} estados gravados · ` +
      `${r.porBucket.critico} crítico, ${r.porBucket.em_risco} em risco, ` +
      `${r.porBucket.em_voo} em voo, ${r.porBucket.em_dia} em dia` +
      (r.semRelogio > 0 ? ` · ${r.semRelogio} sem relógio (fora, e contados)` : "") +
      (r.itemDeCaixaId ? ` · item de caixa ${r.itemDeCaixaId.slice(0, 8)}` : " · sem item (nada a revisar)"),
  );
}

void main();
