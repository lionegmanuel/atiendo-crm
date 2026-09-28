/**
 * QUAL PAPEL O SERVIDOR REGISTRA PARA A MINHA ASSINATURA?
 *
 * O @DevVivo descobriu que a sonda Node dele registrava a assinatura como ANON
 * mesmo depois de `realtime.setAuth(token)`, com o canal respondendo SUBSCRIBED.
 * Se a minha perna "autenticada" fez o mesmo, eu não testei autenticado — e ela
 * era uma das pernas de uma refutação minha.
 *
 * Eu não consigo consultar `realtime.subscription` (permission denied), e ela só
 * tem linha enquanto o socket está ABERTO: quando o processo morre, some. Então
 * o dado não se pega depois — precisa de alguém consultando ENQUANTO isto roda.
 *
 * ESTE PROCESSO SEGURA DUAS ASSINATURAS ABERTAS LADO A LADO:
 *   receita-A — a minha: `setAuth(token)` e `subscribe()`
 *   receita-B — a dele:  `connect()`, espera o handshake, `setAuth` de novo, e
 *               SÓ ENTÃO `subscribe()`
 *
 * Duas na mesma consulta respondem duas perguntas de uma vez: se a minha era
 * anônima, e se a receita dele resolve. Separadas em dois processos, a diferença
 * poderia ser o momento — e eu já perdi um dia inteiro para diferenças que eram
 * o momento.
 *
 * Run: MINUTOS=10 npx tsx tests/sonda-papel-em-aberto.ts
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import { CREDS, carimbar } from "./qa-helpers";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const env = carregarEnvLocal();
const RUN = randomUUID().slice(0, 6);

async function entrar() {
  const cli = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const r = await cli.auth.signInWithPassword({
    email: (CREDS.users as Record<string, { email: string }>).manager!.email,
    password: CREDS.password as string,
  });
  if (!r.data.session) throw new Error(`não autenticou: ${r.error?.message}`);
  return { cli, token: r.data.session.access_token };
}

async function main(): Promise<void> {
  carimbar(["tests/sonda-papel-em-aberto.ts"]);
  const MINUTOS = Number(process.env.MINUTOS ?? "10");

  // ---- receita A: a minha, exatamente como estava nas medições sob suspeita ---
  const a = await entrar();
  a.cli.realtime.setAuth(a.token);
  const canalA = a.cli.channel(`papel-receita-A-${RUN}`).on(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: "crm_lead_activities" },
    () => {},
  );
  const stA = await new Promise<string>((r) => canalA.subscribe((s) => r(s)));

  // ---- receita B: a do @DevVivo -------------------------------------------
  const b = await entrar();
  b.cli.realtime.connect();
  // A ESPERA É A RECEITA. Sem o handshake concluído, o `setAuth` anterior é o
  // que vale no join — e é aí que a assinatura nasce anônima com o canal
  // dizendo SUBSCRIBED, que é o modo de falha mais traiçoeiro que eu vi hoje:
  // o estado reportado é do CLIENTE, não do que o servidor registrou.
  await new Promise((r) => setTimeout(r, 2000));
  b.cli.realtime.setAuth(b.token);
  const canalB = b.cli.channel(`papel-receita-B-${RUN}`).on(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: "crm_lead_activities" },
    () => {},
  );
  const stB = await new Promise<string>((r) => canalB.subscribe((s) => r(s)));

  console.info(
    `\n=== DUAS ASSINATURAS ABERTAS — consulte agora ===\n` +
      `  receita-A (minha)      canal "papel-receita-A-${RUN}"  → ${stA}\n` +
      `  receita-B (do DevVivo) canal "papel-receita-B-${RUN}"  → ${stB}\n\n` +
      `  select claims_role::text, filters from realtime.subscription;\n\n` +
      `  Os dois dizem SUBSCRIBED. Se um deles estiver registrado como anon, o\n` +
      `  SUBSCRIBED é do cliente e não do servidor — e é isso que se quer ver.\n` +
      `  Seguro abertas por ${MINUTOS} minutos.`,
  );

  for (let m = 1; m <= MINUTOS; m++) {
    await new Promise((r) => setTimeout(r, 60_000));
    console.info(`  [aberto há ${m}min de ${MINUTOS}]`);
  }
  await a.cli.removeAllChannels();
  await b.cli.removeAllChannels();
  console.info("=== fechadas ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ sonda falhou:", err);
  process.exit(1);
});
