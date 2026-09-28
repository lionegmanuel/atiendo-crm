/**
 * O EXPERIMENTO DECISIVO: três eventos, um canal, uma janela.
 *
 *   UPDATE em crm_leads ................ testa a hipótese da replica identity
 *   INSERT de atividade em lead de PEDIDOS ..... controle POSITIVO (sabe-se que chega)
 *   INSERT de atividade em lead de CRM VIVO .... o defeito que o QAVivo mediu
 *
 * Os dois INSERTs são idênticos em tudo menos o PIPELINE do lead, e correm no
 * mesmo canal, no mesmo instante, com o mesmo token. Se um chega e o outro não,
 * a diferença está no dado — e nada mais pode explicar.
 */
import * as fs from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { escolherAlvo } from "./qa-helpers";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const env = carregarEnvLocal();
const creds = JSON.parse(fs.readFileSync(".e2e-creds.json", "utf8"));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const PIPE = "35bf4ac9-c5e0-4f7d-846a-99b1bcc92d69"; // CRM Vivo — Clínica
const PEDIDOS = "48c02b4a-0ca1-4bca-8ef0-206b6d240d23"; // mesma org, outro pipeline

async function main(): Promise<void> {
  // ⚠️ O TOKEN VAI NA CRIAÇÃO DO CLIENTE, não num `setAuth` depois.
  //
  // A primeira versão fazia login, chamava `realtime.setAuth(token)` e assinava.
  // O canal respondia SUBSCRIBED e a assinatura era registrada como ANON —
  // conferido em `realtime.subscription`. Três rodadas mediram um canal sem
  // permissão nenhuma e devolveram "nada chega", que eu quase reportei como
  // defeito do produto. É o MESMO defeito que consertei no hook, cometido por
  // mim no instrumento: o socket assina com o papel que tinha no instante do
  // subscribe, e autenticar depois não volta atrás.
  const user = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const m = creds.users.manager;
  const PAPEL = process.env.PAPEL ?? "usuario";
  let token: string;
  if (PAPEL === "service") {
    // O MESMO papel que o assinante independente do QAVivo usa.
    token = env.SUPABASE_SERVICE_ROLE_KEY!;
  } else {
    const { data: sessao, error: authErr } = await user.auth.signInWithPassword({
      email: m.email,
      password: creds.password,
    });
    if (authErr || !sessao.session) throw new Error(`login falhou: ${authErr?.message}`);
    token = sessao.session.access_token;
  }
  console.info(`papel do assinante: ${PAPEL}`);
  await user.realtime.setAuth(token);
  // Conecta ANTES de assinar e dá tempo do handshake carregar o token: sem
  // isto, o `subscribe` corre com o socket ainda anônimo.
  user.realtime.connect();
  await new Promise((r) => setTimeout(r, 2500));
  await user.realtime.setAuth(token);
  console.info(`autenticado (${PAPEL})`);

  const recebidos: string[] = [];
  const canal = user
    .channel("prova-ri")
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "crm_leads" }, () =>
      recebidos.push("UPDATE crm_leads"),
    )
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "crm_lead_activities" }, () =>
      recebidos.push("INSERT crm_lead_activities"),
    );

  await new Promise<void>((resolve, reject) => {
    canal.subscribe((status) => {
      console.info(`canal: ${status}`);
      if (status === "SUBSCRIBED") resolve();
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error(status));
    });
  });
  // ⚠️ SUBSCRIBED é o ACK do canal, NÃO a garantia de que o servidor já
  // registrou os filtros de postgres_changes. Com 2s, a mesma sonda deu 1 evento
  // numa rodada e 0 na seguinte — instabilidade que viraria veredito falso em
  // qualquer direção. 6s e repetição são o que tornam o resultado legível.
  await new Promise((r) => setTimeout(r, 6000));

  // ⚠️ `escolherAlvo` e não `limit 1`, e isto é a lição de hoje mecanizada: a
  // primeira versão pegava um lead SEM ORDEM e, por sorte, um saudável. O
  // resultado "2/2, tudo chega" parecia CONTRADIZER a medição do QAVivo e não
  // contradizia nada — media outro lead. Alvo sorteado não discorda de ninguém,
  // só parece. O helper recusa lista vazia, ordena e LOGA qual de quantos foi
  // escolhido, para o "por sorte um saudável" não voltar a acontecer calado.
  const pega = async (pipe: string) => {
    const { data } = await admin
      .from("crm_leads").select("id, organization_id, title").eq("pipeline_id", pipe);
    const lista = (data ?? []) as Array<{ id: string; organization_id: string; title: string }>;
    return escolherAlvo(lista, (l) => l.id, `lead do pipeline ${pipe.slice(0, 8)}`);
  };
  const vivo = await pega(PIPE);
  const pedidos = await pega(PEDIDOS);

  const atividade = (l: { id: string; organization_id: string }, marca: string) =>
    admin.from("crm_lead_activities").insert({
      organization_id: l.organization_id,
      lead_id: l.id,
      type: "note",
      source_module: "crm",
      source_id: l.id,
      actor_kind: "system",
      reason: `sonda replica identity · ${marca}`,
    });

  await admin.from("crm_leads").update({ title: `${vivo.title} ` }).eq("id", vivo.id);
  const [a1, a2] = await Promise.all([atividade(pedidos, "pedidos"), atividade(vivo, "crm vivo")]);
  if (a1.error || a2.error) throw new Error(`INSERT falhou: ${a1.error?.message ?? a2.error?.message}`);

  await new Promise((r) => setTimeout(r, 7000));
  const conta = (t: string) => recebidos.filter((x) => x === t).length;
  console.info(`recebidos (${recebidos.length}): ${JSON.stringify(recebidos)}`);
  console.info(`  UPDATE crm_leads ........................ ${conta("UPDATE crm_leads") ? "CHEGOU" : "não chegou"}`);
  console.info(`  INSERTs de atividade ...................... ${conta("INSERT crm_lead_activities")} de 2`);

  await admin.from("crm_leads").update({ title: vivo.title }).eq("id", vivo.id);
  await user.removeAllChannels();
  process.exit(0);
}
void main();
