/**
 * Faz UMA mensagem inbound chegar numa conversa — pelo caminho da ingestão.
 *
 * Existe para o `tests/e2e/inbox-tempo-real.spec.ts` poder provar que a mensagem
 * aparece na tela SEM recarregar. Roda FORA do browser, como o webhook do
 * WhatsApp roda: se a mensagem fosse escrita pela própria página, o teste
 * provaria que a UI mostra o que ela mesma escreveu — que é outra coisa.
 *
 * Grava as DUAS pontas que o inbox escuta, porque são canais diferentes no mesmo
 * socket e era a coexistência deles que expunha o defeito do token:
 *   - INSERT em `messages`      → a conversa aberta
 *   - UPDATE em `conversations` → a lista (é o carimbo que reordena, não o insert)
 *
 * Run: npx tsx scripts/e2e-chega-mensagem.ts <conversation_id> <corpo>
 */

import { createClient } from "@supabase/supabase-js";

import { anunciarDestino, credenciaisSupabaseDeTeste } from "./lib/env-de-teste";

const credenciais = credenciaisSupabaseDeTeste();
anunciarDestino("e2e-chega-mensagem", credenciais);

const admin = createClient(credenciais.url, credenciais.serviceRole, {
  auth: { persistSession: false },
});

async function main(): Promise<void> {
  const [conversationId, corpo] = process.argv.slice(2);
  if (!conversationId || !corpo) {
    throw new Error("uso: e2e-chega-mensagem.ts <conversation_id> <corpo>");
  }

  // As FKs da mensagem vêm da conversa: passá-las por argumento seria pedir ao
  // teste que soubesse do schema, e um valor errado viraria falha de FK longe
  // da causa.
  const { data: conv, error: eConv } = await admin
    .from("conversations")
    .select("id, organization_id, channel_session_id, contact_id")
    .eq("id", conversationId)
    .single();
  if (eConv || !conv) throw new Error(`conversa: ${eConv?.message ?? "não encontrada"}`);

  const c = conv as {
    id: string;
    organization_id: string;
    channel_session_id: string;
    contact_id: string;
  };

  const { error: eMsg } = await admin.from("messages").insert({
    organization_id: c.organization_id,
    conversation_id: c.id,
    channel_session_id: c.channel_session_id,
    contact_id: c.contact_id,
    external_id: `e2e-tempo-real-${Date.now()}`,
    direction: "inbound",
    type: "text",
    body: corpo,
    status: "delivered",
  } as never);
  if (eMsg) throw new Error(`mensagem: ${eMsg.message}`);

  const agora = new Date().toISOString();
  const { error: eConvUpd } = await admin
    .from("conversations")
    .update({ last_message_at: agora, last_inbound_at: agora, last_message_preview: corpo } as never)
    .eq("id", c.id);
  if (eConvUpd) throw new Error(`carimbo: ${eConvUpd.message}`);

  console.info(`[e2e-chega-mensagem] entregue em ${c.id}: ${corpo}`);
}

main().catch((err: unknown) => {
  console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
