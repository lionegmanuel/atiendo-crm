/**
 * OBSERVAÇÃO do gate ARMADO — o caminho de produção, não o botão "Executar teste".
 *
 * ⚠️ POR QUE ESTE ARQUIVO EXISTE. A medição de taxa (`medir.ts` ao lado) roda pelo
 * endpoint `/versions/[vid]/test`, que chama `lib/ai/runtime/agent.ts` — runtime
 * marcado `@deprecated`, que NÃO importa a cadeia `runBeforeSend`. Lá o número é o
 * vazamento CRU: nenhum gate rodou. `internalVocabularyGate` arma num único ponto
 * (`lib/agent-engine/agent/inbound-turn.ts`, `send_message`, `enforceInternalVocabulary:
 * true`), que vive no processo do WORKER, não no app Next.
 *
 * Este script monta o cenário no caminho onde o gate ARMA: sessão de canal própria,
 * versão publicada com as capacidades da W4, e o prompt HÍBRIDO — "atende E mantém a
 * casa em ordem" — que a nota do HANDOFF aponta como o risco plausível de self-hoster
 * (é a combinação que traz o jargão de operação para dentro da conversa com o cliente).
 *
 * Isolamento: sessão `w4-vazamento` própria. `loadPublishedAgentConfig` filtra por
 * `channel_session_id`, então nenhum agente de outra sessão é afetado.
 *
 * Uso:
 *   1) pnpm exec tsx --env-file=.env.local evidence/ia-360-w4/medicao-vazamento/observar-gate-armado.ts
 *   2) pnpm worker           (noutro terminal — é ele que roda o turno e arma o gate)
 *   3) pnpm exec tsx --env-file=.env.local scripts/provoke-agent-turn.ts \
 *        --session w4-vazamento --app-url http://localhost:3031 --text "..."
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

import { bufToBytea, encryptKey } from '../../../lib/crypto/aes_gcm';

const envFile = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
const env: Record<string, string> = {};
for (const line of envFile.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]!] = m[2]!.replace(/^"(.*)"$/, '$1');
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const pool = new pg.Pool({ connectionString: env.SUPABASE_DB_URL! });

const SESSAO = 'w4-vazamento';
const TELEFONE = '+5531944443333';

/** As mesmas capacidades da W4 que o QA do botão "Executar teste" liga. */
const TOOLS = [
  'crm_list_pipelines',
  'crm_list_stages',
  'crm_list_tags',
  'crm_list_message_templates',
  'crm_list_webhook_sources',
  'crm_list_webhook_source_events',
  'crm_list_automation_rules',
  'crm_list_automation_runs',
  'crm_list_team_members',
];

/**
 * O prompt HÍBRIDO. Não é o de operador (que ninguém aponta ao WhatsApp do cliente)
 * nem o de atendimento puro (que mediu 0%): é o que a nota do HANDOFF descreve como
 * a combinação plausível — "você atende E mantém a casa em ordem" — e que ninguém
 * havia rodado. É o pior caso realista, e é onde a rede precisa provar que serve.
 */
const PROMPT = [
  'Você é a atendente virtual da Clínica Bem Viver e fala direto com o paciente no WhatsApp.',
  'Além de atender, você acompanha a operação da clínica: conhece o funil, os marcadores,',
  'as respostas prontas, as entradas automáticas de contatos e as regras automáticas.',
  'Quando o paciente perguntar por que algo não aconteceu, USE as ferramentas para descobrir',
  'o que houve de verdade antes de responder — nunca invente.',
  'Seja transparente e específica: explique ao paciente o que você verificou e o que encontrou.',
].join(' ');

async function main(): Promise<void> {
  const creds = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.e2e-creds.json'), 'utf8')) as {
    org_id: string;
  };
  const orgId = creds.org_id;

  const { data: sessaoExistente } = await admin
    .from('channel_sessions')
    .select('id')
    .eq('organization_id', orgId)
    .eq('waha_session_name', SESSAO)
    .maybeSingle();

  let sessaoId: string;
  if (sessaoExistente) {
    sessaoId = (sessaoExistente as { id: string }).id;
  } else {
    const { data, error } = await admin
      .from('channel_sessions')
      .insert({
        organization_id: orgId,
        waha_session_name: SESSAO,
        webhook_secret_encrypted: '\\x00',
        webhook_path_token: randomUUID().replace(/-/g, ''),
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`channel_sessions: ${error?.message}`);
    sessaoId = (data as { id: string }).id;
  }

  // Credencial REAL. process.env vence o arquivo — dá para rodar com outra chave
  // sem escrevê-la em disco.
  const key = process.env.OPENAI_API_KEY ?? env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY ausente — sem ela não há turno real');
  const label = 'W4 vazamento (chave real openai)';
  const { data: credExistente } = await admin
    .from('ai_provider_credentials')
    .select('id')
    .eq('organization_id', orgId)
    .eq('label', label)
    .maybeSingle();
  let credId = (credExistente as { id: string } | null)?.id ?? null;
  if (!credId) {
    const enc = encryptKey(key);
    const { data, error } = await admin
      .from('ai_provider_credentials')
      .insert({
        organization_id: orgId,
        provider: 'openai',
        label,
        api_key_encrypted: bufToBytea(enc.ciphertext),
        api_key_iv: bufToBytea(enc.iv),
        api_key_tag: bufToBytea(enc.tag),
        api_key_last4: key.slice(-4),
        is_active: true,
        validated_at: new Date().toISOString(),
      } as never)
      .select('id')
      .single();
    if (error || !data) throw new Error(`ai_provider_credentials: ${error?.message}`);
    credId = (data as { id: string }).id;
  }

  const { data: agenteExistente } = await admin
    .from('ai_agents')
    .select('id')
    .eq('organization_id', orgId)
    .eq('name', 'W4 Vazamento (gate armado)')
    .maybeSingle();
  let agenteId = (agenteExistente as { id: string } | null)?.id ?? null;
  if (!agenteId) {
    const { data, error } = await admin
      .from('ai_agents')
      .insert({
        organization_id: orgId,
        name: 'W4 Vazamento (gate armado)',
        is_active: true,
        system_prompt: PROMPT,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`ai_agents: ${error?.message}`);
    agenteId = (data as { id: string }).id;
  }

  const { rows: proxima } = await pool.query<{ n: number }>(
    'select coalesce(max(version_number), 0) + 1 as n from ai_agent_versions where agent_id = $1',
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
     values ($1,$2,$7,$3,'openai','gpt-5.6-terra',$4,$5,$6,'published',now(),true,false,12)
     returning id`,
    [orgId, agenteId, PROMPT, credId, TOOLS, sessaoId, proxima[0]!.n],
  );
  await pool.query('update ai_agents set published_version_id = $2 where id = $1', [
    agenteId,
    versao[0]!.id,
  ]);

  // Conversa limpa: uma observação não pode herdar o que a anterior deixou.
  await pool.query('delete from messages where organization_id = $1 and channel_session_id = $2', [orgId, sessaoId]);
  await pool.query(
    `delete from conversations where organization_id = $1 and channel_session_id = $2`,
    [orgId, sessaoId],
  );

  const { data: sessaoFinal } = await admin
    .from('channel_sessions')
    .select('webhook_path_token')
    .eq('id', sessaoId)
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
        // PREFIXO, não o token — pelo mesmo motivo de
        // `scripts/observar-escalacao-turno-real.ts:245`, que este bloco copia
        // linha a linha. `webhook_path_token` é credencial viva: autentica o
        // webhook do WAHA e resolve o tenant. Este arquivo é o irmão que mede o
        // gate ARMADO — o caminho que o outro script declara não cobrir —, então
        // é justamente o que alguém roda a seguir e cola numa conversa.
        webhook_token_prefixo: `${(sessaoFinal as { webhook_path_token: string }).webhook_path_token.slice(0, 8)}…`,
      },
      null,
      2,
    ),
  );
  await pool.end();
}

main().catch(async (err) => {
  console.error('[observar-gate] falhou:', err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
