/**
 * QUAL LINHA envenena o lote? — uma atividade por lead, afastadas no tempo.
 *
 * O defeito é POR LINHA (medido pelo QAVivo: escritas afastadas mostram que a
 * assinatura sobrevive e o que se perde são as linhas que viajam JUNTO com a
 * envenenada). Meus testes anteriores davam 2/2 porque eu pegava o lead com
 * `limit 1` SEM ORDEM — alvo sorteado, e por sorte um lead saudável.
 *
 * Aqui cada lead recebe a SUA atividade, com folga entre elas para caírem em
 * lotes diferentes. O que não chegar aponta a linha.
 */
import * as fs from "node:fs";

import { createClient } from "@supabase/supabase-js";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const env = carregarEnvLocal();
const creds = JSON.parse(fs.readFileSync(".e2e-creds.json", "utf8"));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const PIPES: Record<string, string> = {
  "CRM Vivo": "35bf4ac9-c5e0-4f7d-846a-99b1bcc92d69",
  Pedidos: "48c02b4a-0ca1-4bca-8ef0-206b6d240d23",
};

async function main(): Promise<void> {
  const user = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const { data: sessao } = await user.auth.signInWithPassword({
    email: creds.users.manager.email,
    password: creds.password,
  });
  await user.realtime.setAuth(sessao!.session!.access_token);
  user.realtime.connect();
  await new Promise((r) => setTimeout(r, 2500));
  await user.realtime.setAuth(sessao!.session!.access_token);

  const chegaram = new Set<string>();
  const canal = user
    .channel("caca-linha")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "crm_lead_activities" }, (p) => {
      const id = (p as { new?: { lead_id?: string } }).new?.lead_id;
      if (id) chegaram.add(id);
    });
  await new Promise<void>((res, rej) =>
    canal.subscribe((s) => (s === "SUBSCRIBED" ? res() : s === "CHANNEL_ERROR" ? rej(new Error(s)) : undefined)),
  );
  await new Promise((r) => setTimeout(r, 6000));

  // Um lead de Pedidos entre cada dois do CRM Vivo: o controle roda NA MESMA
  // grade, não num bloco separado — se ele cair, a rodada não julga nada.
  const alvos: Array<{ id: string; rotulo: string; owner: string }> = [];
  for (const [nome, pipe] of Object.entries(PIPES)) {
    const { data } = await admin
      .from("crm_leads")
      .select("id, owner_kind, title")
      .eq("pipeline_id", pipe)
      .order("id");
    for (const l of (data ?? []) as Array<{ id: string; owner_kind: string | null; title: string }>) {
      alvos.push({ id: l.id, rotulo: nome, owner: l.owner_kind ?? "null" });
    }
  }

  const org = "6e567068-fd1c-4f94-ae1f-40e0334be190";
  for (const a of alvos) {
    await admin.from("crm_lead_activities").insert({
      organization_id: org,
      lead_id: a.id,
      type: "note",
      source_module: "crm",
      source_id: a.id,
      actor_kind: "system",
      reason: "caça à linha envenenada",
    });
    await new Promise((r) => setTimeout(r, 1200)); // folga para separar lotes
  }
  await new Promise((r) => setTimeout(r, 8000));

  const perdidos = alvos.filter((a) => !chegaram.has(a.id));
  console.info(`\nenviados ${alvos.length} · chegaram ${chegaram.size} · PERDIDOS ${perdidos.length}`);
  for (const [nome] of Object.entries(PIPES)) {
    const doPipe = alvos.filter((a) => a.rotulo === nome);
    const p = doPipe.filter((a) => !chegaram.has(a.id));
    console.info(`  ${nome}: ${doPipe.length - p.length}/${doPipe.length} chegaram`);
  }
  if (perdidos.length > 0) {
    console.info("\nLINHAS QUE NÃO CHEGARAM:");
    for (const p of perdidos) console.info(`  ${p.id.slice(0, 8)} · ${p.rotulo} · owner_kind=${p.owner}`);
  }
  await user.removeAllChannels();
  process.exit(0);
}
void main();
