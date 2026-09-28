/**
 * CORTE do espaço de hipóteses do D21 — a timeline aberta não recebe a atividade
 * criada em outra aba, e restam três suspeitos: filtro, autenticação/RLS do
 * assinante, ou entrega.
 *
 * A pergunta certa não é "qual é o certo?", é "que observação teria resultado
 * DIFERENTE conforme o subconjunto?". Esta: assinar o MESMO evento por um
 * caminho que IGNORA RLS.
 *
 *   recebe  → a publicação e o filtro funcionam, e o problema é do ASSINANTE
 *             (autenticação/RLS) — dois suspeitos viram um
 *   não recebe → o problema é a montante de qualquer assinante, e o filtro do
 *             navegador está inocente
 *
 * Run: npx tsx tests/prova-canal-timeline.ts
 */
import { createClient } from "@supabase/supabase-js";

import { CREDS, carimbar } from "./qa-helpers";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const env = carregarEnvLocal();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main(): Promise<void> {
  carimbar(["tests/prova-canal-timeline.ts", "hooks/leads/useLeadTimeline.ts"]);

  const { data: leads } = await admin
    .from("crm_leads")
    .select("id,title")
    .eq("organization_id", CREDS.org_id)
    .eq("status", "open")
    .order("id")
    .limit(1);
  const lead = (leads ?? [])[0] as { id: string; title: string } | undefined;
  if (!lead) throw new Error("sem lead aberto para o corte");
  console.info(`[alvo] lead ${lead.id.slice(0, 8)} — "${lead.title.slice(0, 40)}"`);

  let recebidos = 0;
  const canal = admin
    .channel(`corte-timeline-${lead.id}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "crm_lead_activities",
        filter: `lead_id=eq.${lead.id}`,
      },
      () => {
        recebidos++;
      },
    );

  const estado = await new Promise<string>((resolve) => {
    canal.subscribe((s) => resolve(s));
  });
  console.info(`[canal] estado da assinatura (ignorando RLS): ${estado}`);
  await new Promise((r) => setTimeout(r, 2000));

  const { error } = await admin.from("crm_lead_activities").insert({
    organization_id: CREDS.org_id,
    lead_id: lead.id,
    source_module: "qa",
    type: "note",
    actor_kind: "system",
    reason: "corte do espaço de hipóteses do D21",
    evidence: {},
    performed_at: new Date().toISOString(),
  } as never);
  if (error) throw new Error(`inserir: ${error.code} ${error.message}`);
  console.info("[gatilho] atividade inserida");

  await new Promise((r) => setTimeout(r, 8000));
  await admin
    .from("crm_lead_activities")
    .delete()
    .eq("lead_id", lead.id)
    .eq("reason", "corte do espaço de hipóteses do D21");
  await admin.removeChannel(canal);

  console.info(`\n=== quadros recebidos por assinante que IGNORA RLS: ${recebidos} ===`);
  // ---- SEGUNDA PERNA: o MESMO evento, assinado com o token do USUÁRIO --------
  //
  // O assinante privilegiado recebe. Falta saber se o assinante AUTENTICADO
  // recebe — e fazer isso fora do navegador tira a UI, o hook e o setAuth da
  // equação. Se aqui também não chegar, o defeito é de autorização e não tem
  // nada a ver com a tela.
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const login = await anon.auth.signInWithPassword({
    email: (CREDS.users as Record<string, { email: string }>).manager!.email,
    password: CREDS.password as string,
  });
  if (login.error || !login.data.session) {
    console.info(`[usuário] não consegui autenticar fora do navegador: ${login.error?.message}`);
  } else {
    let recebidosUsuario = 0;
    anon.realtime.setAuth(login.data.session.access_token);
    const canalUsuario = anon
      .channel(`corte-usuario-${lead.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "crm_lead_activities",
          filter: `lead_id=eq.${lead.id}`,
        },
        () => {
          recebidosUsuario++;
        },
      );
    const estadoUsuario = await new Promise<string>((resolve) => {
      canalUsuario.subscribe((st) => resolve(st));
    });
    console.info(`[usuário] estado da assinatura autenticada: ${estadoUsuario}`);
    await new Promise((r) => setTimeout(r, 2000));
    await admin.from("crm_lead_activities").insert({
      organization_id: CREDS.org_id,
      lead_id: lead.id,
      source_module: "qa",
      type: "note",
      actor_kind: "system",
      reason: "corte do espaço de hipóteses do D21 (usuário)",
      evidence: {},
      performed_at: new Date().toISOString(),
    } as never);
    await new Promise((r) => setTimeout(r, 8000));
    await admin
      .from("crm_lead_activities")
      .delete()
      .eq("lead_id", lead.id)
      .like("reason", "corte do espaço de hipóteses do D21%");
    await anon.removeChannel(canalUsuario);
    console.info(`\n=== quadros recebidos pelo assinante AUTENTICADO (fora do navegador): ${recebidosUsuario} ===`);
    console.info(
      recebidosUsuario > 0
        ? "==> o usuário RECEBE fora do navegador. Então a autorização está ok e o defeito está\n" +
          "    no caminho do NAVEGADOR (hook, momento do setAuth, ciclo de vida do canal)."
        : "==> o usuário NÃO recebe nem fora do navegador. O defeito é de AUTORIZAÇÃO e a tela\n" +
          "    está inocente — o mesmo formato do fn_can_view_lead de hoje de manhã.",
    );
  }

  console.info(
    recebidos > 0
      ? "==> publicação e filtro FUNCIONAM. O problema é do ASSINANTE do navegador\n" +
        "    (autenticação/RLS) — dois suspeitos viram um."
      : "==> nem o assinante privilegiado recebe. O problema é a MONTANTE de qualquer\n" +
        "    assinante, e o filtro do navegador está inocente.",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ corte falhou:", err);
  process.exit(1);
});
