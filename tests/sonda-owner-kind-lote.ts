/**
 * É o PIPELINE ou é a PROPRIEDADE DA LINHA?
 *
 * `owner_kind='ai'` existe só no CRM Vivo (4 linhas, contra 0 em Pedidos). Se o
 * defeito for "lead com dono AGENTE", ele deixa de ser curiosidade do banco de
 * dev e passa a atingir qualquer tenant que use IA como dono — que é a
 * funcionalidade central do produto, comendo eventos em silêncio justamente nos
 * leads que a IA está cuidando.
 *
 * O desenho separa as duas explicações num passo: dono agente e dono humano DO
 * MESMO PIPELINE, alternados e AFASTADOS NO TEMPO (a descoberta é que a linha
 * envenenada mata o lote em que viaja — disparar junto mascararia o efeito nos
 * dois sentidos).
 */
import * as fs from "node:fs";

import { createClient } from "@supabase/supabase-js";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const env = carregarEnvLocal();
const creds = JSON.parse(fs.readFileSync(".e2e-creds.json", "utf8"));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const ORG = "6e567068-fd1c-4f94-ae1f-40e0334be190";
const VIVO = "35bf4ac9-c5e0-4f7d-846a-99b1bcc92d69";

async function main(): Promise<void> {
  const user = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const { data: s } = await user.auth.signInWithPassword({
    email: creds.users.manager.email,
    password: creds.password,
  });
  await user.realtime.setAuth(s!.session!.access_token);
  user.realtime.connect();
  await new Promise((r) => setTimeout(r, 2500));
  await user.realtime.setAuth(s!.session!.access_token);

  const chegaram = new Set<string>();
  const canal = user
    .channel("owner-kind")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "crm_lead_activities" }, (p) => {
      const id = (p as { new?: { lead_id?: string } }).new?.lead_id;
      if (id) chegaram.add(id);
    });
  await new Promise<void>((res, rej) =>
    canal.subscribe((st) => (st === "SUBSCRIBED" ? res() : st === "CHANNEL_ERROR" ? rej(new Error(st)) : undefined)),
  );
  await new Promise((r) => setTimeout(r, 6000));

  const porOwner = async (kind: string | null) => {
    const q = admin.from("crm_leads").select("id, title").eq("pipeline_id", VIVO).order("id");
    const { data } = await (kind === null ? q.is("owner_kind", null) : q.eq("owner_kind", kind));
    return (data ?? []) as Array<{ id: string; title: string }>;
  };
  const ai = await porOwner("ai");
  const humano = await porOwner("user");
  console.info(`no MESMO pipeline: ${ai.length} com dono agente · ${humano.length} com dono humano`);

  // Alternado: ai, user, ai, user... e afastados. Se só os `ai` sumirem, é a
  // propriedade da linha; se os vizinhos `user` sumirem junto, é o LOTE.
  const grade: Array<{ id: string; owner: string }> = [];
  for (let i = 0; i < Math.max(ai.length, humano.length); i++) {
    if (ai[i]) grade.push({ id: ai[i]!.id, owner: "ai" });
    if (humano[i]) grade.push({ id: humano[i]!.id, owner: "user" });
  }

  for (const g of grade) {
    await admin.from("crm_lead_activities").insert({
      organization_id: ORG,
      lead_id: g.id,
      type: "note",
      source_module: "crm",
      source_id: g.id,
      actor_kind: "system",
      reason: `owner_kind=${g.owner}`,
    });
    await new Promise((r) => setTimeout(r, 2500)); // folga: lotes separados
  }
  await new Promise((r) => setTimeout(r, 8000));

  const linha = (o: string) => {
    const doTipo = grade.filter((g) => g.owner === o);
    const ok = doTipo.filter((g) => chegaram.has(g.id)).length;
    return `${ok}/${doTipo.length}`;
  };
  console.info(`\nchegaram · dono AGENTE: ${linha("ai")} · dono HUMANO: ${linha("user")}`);
  const perdidos = grade.filter((g) => !chegaram.has(g.id));
  if (perdidos.length) {
    console.info("perdidos:");
    for (const p of perdidos) console.info(`  ${p.id.slice(0, 8)} owner=${p.owner}`);
  } else {
    console.info("nenhum perdido — owner_kind NÃO explica o defeito nesta janela");
  }
  await user.removeAllChannels();
  process.exit(0);
}
void main();
