/**
 * OBSERVAÇÃO (não é teste): um agente de verdade, com as capacidades de
 * escalação ligadas, atendendo pelo caminho de produção.
 *
 * Por que existe: o E2E prova o ENCANAMENTO (o que a pessoa decidiu chega ao
 * contexto de abertura do turno, medido pela função real do motor). Ele não
 * responde se as capacidades são BOAS de usar — se o modelo escolhe a tool
 * certa, se consulta quem está disponível antes de escalar, se o payload que eu
 * devolvo ajuda ou entope o contexto. Isso só se descobre olhando um turno real.
 *
 * Isolamento: cria uma channel_session PRÓPRIA e amarra a versão publicada a
 * ela. `loadPublishedAgentConfig` filtra por `channel_session_id`, então nenhum
 * agente de outra sessão do time é afetado.
 *
 * Uso:
 *   pnpm exec tsx --env-file=.env.local scripts/observar-escalacao-turno-real.ts
 *   (depois: pnpm worker, e scripts/provoke-agent-turn.ts --session w3-observacao)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import pg from "pg";

import { bufToBytea, encryptKey } from "../lib/crypto/aes_gcm";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const env = carregarEnvLocal();

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const pool = new pg.Pool({ connectionString: env.SUPABASE_DB_URL! });

const SESSAO = "w3-observacao";
const TELEFONE = "+5531955554444";
const NOME = "Observacao Escalacao";

/** As capacidades sob observação + o mínimo para o agente conseguir trabalhar. */
const TOOLS = [
  "crm_list_available_attendants",
  "crm_list_human_cases",
  "crm_get_human_case",
  "crm_add_case_note",
  "crm_close_human_case",
  "crm_resume_ai_attendance",
  "crm_get_conversation_history",
  "crm_get_contact",
];

const PROMPT = `Você atende no WhatsApp da Embalagens Nova Lima, que vende caixas e
sacolas em atacado para lojas.

Política de preço: você pode conceder até 10% de desconto por conta própria.
Acima disso é alçada de uma pessoa da equipe — você NÃO pode aprovar sozinho.

Quando esbarrar num limite desses:
- não invente aprovação nem diga que "vai verificar" sem registrar nada;
- deixe o assunto registrado para uma pessoa resolver;
- diga ao cliente, com prazo honesto, o que vai acontecer.

Se o atendimento voltar para você depois de uma pessoa ter atuado, retome de onde
ela parou: não peça de novo o que já foi combinado nem contradiga a decisão dela.`;

async function main(): Promise<void> {
  const creds = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), ".e2e-creds.json"), "utf8"),
  ) as { org_id: string };
  const orgId = creds.org_id;

  // --- sessão de canal própria ---
  const { data: sessaoExistente } = await admin
    .from("channel_sessions")
    .select("id, webhook_path_token")
    .eq("organization_id", orgId)
    .eq("waha_session_name", SESSAO)
    .maybeSingle();

  let sessaoId: string;
  if (sessaoExistente) {
    sessaoId = (sessaoExistente as { id: string }).id;
  } else {
    const { data, error } = await admin
      .from("channel_sessions")
      .insert({
        organization_id: orgId,
        waha_session_name: SESSAO,
        webhook_secret_encrypted: "\\x00",
        webhook_path_token: randomUUID().replace(/-/g, ""),
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`channel_sessions: ${error?.message}`);
    sessaoId = (data as { id: string }).id;
  }

  // --- credencial real (o turno morre sem ela) ---
  // A chave Anthropic desta máquina está SEM CRÉDITO (medido direto no provedor:
  // 400 invalid_request_error "credit balance is too low"), então a observação
  // roda em OpenAI, no `gpt-5.6-terra` — o padrão que a migration 0101 passou a
  // oferecer. Roda no PADRÃO de propósito: se o catálogo aponta para um modelo
  // que o motor não consegue usar, é o self-hoster que descobre, atendendo.
  // LIMITAÇÃO declarada: o padrão de produção da Anthropic (Sonnet 5) não pôde
  // ser exercitado — a chave Anthropic desta máquina está sem crédito.
  // process.env vence o arquivo: dá para rodar com outra chave sem escrevê-la em disco.
  const key = process.env.OPENAI_API_KEY ?? env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY ausente — sem ela não há turno real");
  const label = "Observacao W3 (chave real openai)";
  const { data: credExistente } = await admin
    .from("ai_provider_credentials")
    .select("id")
    .eq("organization_id", orgId)
    .eq("label", label)
    .maybeSingle();
  let credId = (credExistente as { id: string } | null)?.id ?? null;
  if (!credId) {
    const enc = encryptKey(key);
    const { data, error } = await admin
      .from("ai_provider_credentials")
      .insert({
        organization_id: orgId,
        provider: "openai",
        label,
        api_key_encrypted: bufToBytea(enc.ciphertext),
        api_key_iv: bufToBytea(enc.iv),
        api_key_tag: bufToBytea(enc.tag),
        api_key_last4: key.slice(-4),
        is_active: true,
        validated_at: new Date().toISOString(),
      } as never)
      .select("id")
      .single();
    if (error || !data) throw new Error(`ai_provider_credentials: ${error?.message}`);
    credId = (data as { id: string }).id;
  }

  // --- agente + versão publicada, amarrada À MINHA sessão ---
  const { data: agenteExistente } = await admin
    .from("ai_agents")
    .select("id")
    .eq("organization_id", orgId)
    .eq("name", "W3 Observação Escalação")
    .maybeSingle();
  let agenteId = (agenteExistente as { id: string } | null)?.id ?? null;
  if (!agenteId) {
    const { data, error } = await admin
      .from("ai_agents")
      .insert({
        organization_id: orgId,
        name: "W3 Observação Escalação",
        is_active: true,
        system_prompt: PROMPT,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`ai_agents: ${error?.message}`);
    agenteId = (data as { id: string }).id;
  }

  // Versões antigas ficam: `ai_agent_runs` referencia a versão que rodou, e
  // apagar isso apagaria o histórico do que já foi observado. Nova versão a cada
  // execução (o número cresce), e o ponteiro publicado passa a apontar para ela.
  const { rows: proxima } = await pool.query<{ n: number }>(
    `select coalesce(max(version_number), 0) + 1 as n from ai_agent_versions where agent_id = $1`,
    [agenteId],
  );
  await pool.query(
    `update ai_agent_versions set status = 'superseded', superseded_at = now()
      where agent_id = $1 and status = 'published'`,
    [agenteId],
  );
  const { rows: versao } = await pool.query<{ id: string }>(
    `insert into ai_agent_versions
       (organization_id, agent_id, version_number, system_prompt, provider, model,
        credential_id, tool_ids, channel_session_id, status, published_at,
        handoff_tool_enabled, cases_enabled, max_steps)
     values ($1,$2,$7,$3,'openai','gpt-5.6-terra',$4,$5,$6,'published',now(),true,true,12)
     returning id`,
    [orgId, agenteId, PROMPT, credId, TOOLS, sessaoId, proxima[0]!.n],
  );
  await pool.query(`update ai_agents set published_version_id = $2 where id = $1`, [
    agenteId,
    versao[0]!.id,
  ]);

  // --- contato + conversa limpos para a observação ---
  await pool.query(`delete from messages where organization_id = $1 and channel_session_id = $2`, [
    orgId,
    sessaoId,
  ]);
  await pool.query(
    `delete from agent_cases where organization_id = $1 and conversation_id in
       (select id from conversations where channel_session_id = $2)`,
    [orgId, sessaoId],
  );
  await pool.query(
    `delete from lead_checkpoints where organization_id = $1 and contact_id in
       (select id from contacts where organization_id = $1 and phone_number = $2)`,
    [orgId, TELEFONE],
  );
  await pool.query(
    `delete from conversation_notes where organization_id = $1 and conversation_id in
       (select id from conversations where channel_session_id = $2)`,
    [orgId, sessaoId],
  );
  await pool.query(
    `delete from conversations where organization_id = $1 and channel_session_id = $2`,
    [orgId, sessaoId],
  );
  // A memória durável do lead TAMBÉM entra no reset. Sem isto, uma observação
  // herda o que a anterior aprendeu (medido: o "15% aprovado" de uma corrida
  // reapareceu na seguinte, via `lead_notes`) — e aí não são mais duas corridas
  // comparáveis, são uma continuação disfarçada de repetição.
  await pool.query(
    `delete from lead_notes where organization_id = $1 and contact_id in
       (select id from contacts where organization_id = $1 and phone_number = $2)`,
    [orgId, TELEFONE],
  );

  const { data: sessaoFinal } = await admin
    .from("channel_sessions")
    .select("webhook_path_token")
    .eq("id", sessaoId)
    .single();

  console.info(
    JSON.stringify(
      {
        org: orgId,
        sessao: SESSAO,
        sessao_id: sessaoId,
        agente_id: agenteId,
        versao_id: versao[0]!.id,
        tools: TOOLS.length,
        telefone: TELEFONE,
        // PREFIXO, não o token. `webhook_path_token` é credencial viva: é o que
        // autentica o webhook do WAHA e resolve o tenant (o CLAUDE.md o lista
        // como fonte confiável de `organization_id`), então imprimi-lo em claro
        // põe uma chave de tenant no stdout de um script que se roda à mão e
        // cuja saída se cola em canal de conversa. O prefixo responde à única
        // pergunta que o log precisava responder — "a sessão nasceu com token?"
        // —, e quem consome não precisa do valor: `provoke-agent-turn.ts:120-123`
        // busca o token sozinho pelo nome da sessão.
        webhook_token_prefixo: `${(sessaoFinal as { webhook_path_token: string }).webhook_path_token.slice(0, 8)}…`,
      },
      null,
      2,
    ),
  );
  await pool.end();
}

main().catch(async (err) => {
  console.error("[observar] falhou:", err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
