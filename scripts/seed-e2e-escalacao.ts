/**
 * Cenário do ciclo agente ↔ pessoa (W3 do épico IA 360).
 *
 * Monta o estado que existe DEPOIS de o agente passar a conversa para um humano —
 * não simulando as escritas na mão, mas chamando a função REAL
 * `performHumanHandoff`: é ela que liga as três travas, e um seed que as ligasse
 * com UPDATE próprio provaria o teste contra a minha cópia da regra, não contra a
 * regra. O chamado também nasce pela função real (`openCase`).
 *
 * Idempotente: reexecutar zera o episódio anterior (chamado + travas) e refaz.
 * Escreve o bloco `escalacao` em `.e2e-creds.json`.
 *
 * Uso (depois de scripts/seed-e2e-credentials.ts):
 *   pnpm exec tsx --env-file=.env.local scripts/seed-e2e-escalacao.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { createClient } from "@supabase/supabase-js";
import pg from "pg";

import { openCase } from "../lib/agent-engine/agent/human-cases";
import { performHumanHandoff } from "../lib/agent-engine/agent/human-handoff";
import { montarBriefingDaPassagem } from "../lib/escalacao/briefing-da-passagem";
import { anunciarDestino, credenciaisSupabaseDeTeste } from "./lib/env-de-teste";

// `process.env` VENCE o `.env.local` (ver scripts/lib/env-de-teste.ts).
//
// A versão anterior lia `.env.local` DIRETO do disco, ignorando o ambiente — e
// por isso a suíte E2E semeava no banco de PRODUÇÃO mesmo com o `.env.e2e`
// injetado no webServer do Playwright: este script nunca olhava para lá.
const credenciais = credenciaisSupabaseDeTeste();
anunciarDestino("seed-e2e-escalacao", credenciais);
const env = {
  NEXT_PUBLIC_SUPABASE_URL: credenciais.url,
  SUPABASE_SERVICE_ROLE_KEY: credenciais.serviceRole,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: credenciais.anonKey,
  NEXT_PUBLIC_APP_URL: credenciais.appUrl,
  SUPABASE_DB_URL: credenciais.dbUrl,
} as Record<string, string>;

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const pool = new pg.Pool({ connectionString: env.SUPABASE_DB_URL! });

const CREDS = path.join(process.cwd(), ".e2e-creds.json");
const TELEFONE = "+5531977776666";
const NOME_CONTATO = "Escalação E2E";
const TITULO_CHAMADO = "Desconto acima da alçada";
const BLOQUEIO = "O cliente pede 20% e a política do agente vai até 10%.";

const logMudo = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as Parameters<typeof performHumanHandoff>[2]["log"];

async function idDe<T extends { id: string }>(
  p: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  o: string,
): Promise<string> {
  const { data, error } = await p;
  if (error || !data) throw new Error(`${o}: ${error?.message ?? "sem linha"}`);
  return (data as T).id;
}

async function main(): Promise<void> {
  const creds = JSON.parse(fs.readFileSync(CREDS, "utf8")) as {
    org_id: string;
    users: Record<string, { id: string; email: string }>;
    [k: string]: unknown;
  };
  const orgId = creds.org_id;

  // Sessão de canal: qualquer uma da org serve (a conversa exige a FK).
  const { data: sessao } = await admin
    .from("channel_sessions")
    .select("id")
    .eq("organization_id", orgId)
    .limit(1)
    .maybeSingle();
  const sessaoId = sessao
    ? (sessao as { id: string }).id
    : await idDe(
        admin
          .from("channel_sessions")
          .insert({
            organization_id: orgId,
            waha_session_name: `e2e-escalacao-${Date.now()}`,
            webhook_secret_encrypted: "\\x00",
          })
          .select("id")
          .single(),
        "channel_sessions",
      );

  const { data: contatoExistente } = await admin
    .from("contacts")
    .select("id")
    .eq("organization_id", orgId)
    .eq("phone_number", TELEFONE)
    .maybeSingle();
  const contatoId = contatoExistente
    ? (contatoExistente as { id: string }).id
    : await idDe(
        admin
          .from("contacts")
          .insert({
            organization_id: orgId,
            phone_number: TELEFONE,
            display_name: NOME_CONTATO,
            name: NOME_CONTATO,
          })
          .select("id")
          .single(),
        "contacts",
      );

  const { data: convExistente } = await admin
    .from("conversations")
    .select("id")
    .eq("organization_id", orgId)
    .eq("contact_id", contatoId)
    .maybeSingle();
  const conversaId = convExistente
    ? (convExistente as { id: string }).id
    : await idDe(
        admin
          .from("conversations")
          .insert({
            organization_id: orgId,
            contact_id: contatoId,
            channel_session_id: sessaoId,
            status: "ai_handling",
            assignee_kind: "ai",
            last_inbound_at: new Date().toISOString(),
          })
          .select("id")
          .single(),
        "conversations",
      );

  // Um negócio aberto para a atividade da volta ter onde pousar.
  const { data: pipeline } = await admin
    .from("crm_pipelines")
    .select("id")
    .eq("organization_id", orgId)
    .eq("is_archived", false)
    .order("is_default", { ascending: false })
    .limit(1)
    .maybeSingle();
  const pipelineId = (pipeline as { id: string } | null)?.id ?? null;
  let negocioId: string | null = null;
  if (pipelineId) {
    const { data: estagio } = await admin
      .from("crm_stages")
      .select("id")
      .eq("organization_id", orgId)
      .eq("pipeline_id", pipelineId)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();
    const { data: negocioExistente } = await admin
      .from("crm_leads")
      .select("id")
      .eq("organization_id", orgId)
      .eq("contact_id", contatoId)
      .eq("status", "open")
      .maybeSingle();
    negocioId = negocioExistente
      ? (negocioExistente as { id: string }).id
      : estagio
        ? await idDe(
            admin
              .from("crm_leads")
              .insert({
                organization_id: orgId,
                pipeline_id: pipelineId,
                stage_id: (estagio as { id: string }).id,
                contact_id: contatoId,
                title: `Pedido de ${NOME_CONTATO}`,
                status: "open",
              })
              .select("id")
              .single(),
            "crm_leads",
          )
        : null;
  }

  // --- reset do episódio: só o que ESTE seed cria ---
  await pool.query(`delete from agent_cases where organization_id = $1 and conversation_id = $2`, [
    orgId,
    conversaId,
  ]);
  await pool.query(
    `delete from conversation_notes where organization_id = $1 and conversation_id = $2`,
    [orgId, conversaId],
  );
  await pool.query(`delete from lead_checkpoints where organization_id = $1 and contact_id = $2`, [
    orgId,
    contatoId,
  ]);
  // OS DOIS `ref_kind`, e não só o novo. O aviso de passagem passou a nascer com
  // `ref_kind='conversation'` (é o que dá o botão "Abrir conversa" na Central);
  // um `delete` que só olhasse `'contact'` viraria NO-OP e o item sobreviveria
  // entre corridas — e a asserção "a segunda passagem nasce" passaria POR SOBRA,
  // que é exatamente o defeito que este bloco de reset existe para impedir.
  // Trocar em vez de somar teria o mesmo problema ao contrário: item de clone
  // antigo continua gravado com `'contact'`.
  await pool.query(
    `delete from agent_inbox_items
      where organization_id = $1
        and ((ref_kind = 'contact' and ref_id = $2) or (ref_kind = 'conversation' and ref_id = $3))`,
    [orgId, contatoId, conversaId],
  );
  // A passagem em si também entra no reset: ela é o FATO, e um fato de ontem na
  // tela de hoje faria o cartão aparecer antes de esta corrida ter produzido
  // passagem nenhuma.
  await pool.query(
    `delete from passagens_de_atendimento where organization_id = $1 and conversation_id = $2`,
    [orgId, conversaId],
  );
  // As atividades TAMBÉM entram no reset, e antes de `performHumanHandoff`.
  // Sem isto o E2E passaria com sobra da corrida anterior: a asserção "a volta
  // aparece na linha do tempo" é `toContain`, e uma linha de ontem a satisfaz
  // sem que esta corrida tenha emitido nada.
  if (negocioId) {
    await pool.query(`delete from crm_lead_activities where organization_id = $1 and lead_id = $2`, [
      orgId,
      negocioId,
    ]);
  }
  await pool.query(
    `update conversations set assigned_to_user_id = null, assignee_kind = 'ai', status = 'ai_handling' where id = $1`,
    [conversaId],
  );

  // O que o agente já sabia da conversa ANTES de travar — é este acumulado que a
  // retomada não pode apagar ao acrescentar o que a pessoa fez.
  await pool.query(
    `insert into lead_checkpoints (organization_id, contact_id, job_id, commitments, objections, next_action, rolling_summary)
     values ($1, $2, null, $3::jsonb, $4::jsonb, $5, $6)`,
    [
      orgId,
      contatoId,
      JSON.stringify(["enviar a tabela de preços"]),
      JSON.stringify(["achou o frete caro"]),
      "confirmar o volume do pedido",
      "Cliente quer 200 unidades e pediu desconto por volume.",
    ],
  );

  // O chamado, pela função real (o agente esbarrando na alçada).
  const chamado = await openCase(
    pool,
    { tenantId: orgId, conversationId: conversaId },
    {
      title: TITULO_CHAMADO,
      summary: "Cliente de 200 unidades pedindo 20% de desconto.",
      blocker: BLOQUEIO,
    },
  );
  if (!chamado.ok) throw new Error(`openCase: ${chamado.error.code}`);

  // E a passagem em si, pela função real — é ela que liga as três travas.
  await performHumanHandoff(
    pool,
    { tenantId: orgId, leadId: contatoId, conversationId: conversaId },
    {
      reason: "desconto acima da alçada",
      conversationSummary: "Cliente quer 200 unidades e pediu 20% de desconto.",
      log: logMudo,
    },
  );

  // Disponibilidade do atendente: sem ela, "quem pode assumir agora" é vazio.
  const agentUserId = creds.users.agent!.id;
  await pool.query(
    `insert into attendant_availability (organization_id, user_id, is_available, capacity, last_heartbeat_at)
     values ($1, $2, true, 5, now())
     on conflict (organization_id, user_id)
     do update set is_available = true, capacity = 5, last_heartbeat_at = now()`,
    [orgId, agentUserId],
  );

  const { rows: estado } = await pool.query<{
    force_human: boolean;
    bot_silenced_until: string | null;
  }>(
    `select c.force_human, v.bot_silenced_until
       from conversations v join contacts c on c.id = v.contact_id where v.id = $1`,
    [conversaId],
  );
  if (estado[0]?.force_human !== true || estado[0]?.bot_silenced_until === null) {
    throw new Error("as travas da passagem não ficaram ligadas — o cenário não vale");
  }

  const passagem = await semearPassagemComContexto(orgId, sessaoId);

  const proximo = {
    ...creds,
    passagem,
    escalacao: {
      conversation_id: conversaId,
      contact_id: contatoId,
      contact_name: NOME_CONTATO,
      lead_id: negocioId,
      case_id: chamado.caseId,
      case_title: TITULO_CHAMADO,
      attendant_user_id: agentUserId,
    },
  };
  fs.writeFileSync(CREDS, JSON.stringify(proximo, null, 2));

  console.info(
    `[seed-escalacao] conversa=${conversaId} chamado=${chamado.caseId} negocio=${negocioId ?? "(nenhum)"} — travas ligadas`,
  );
  await pool.end();
}

/**
 * O CENÁRIO DA PASSAGEM COM CONTEXTO — contato PRÓPRIO, de propósito.
 *
 * ## Por que não reusar o contato do bloco `escalacao`
 *
 * Aquele bloco é lido por `escalacao-ciclo.spec.ts` e por
 * `encerramento-atendimento.spec.ts`, e a chamada dele a `performHumanHandoff`
 * é a ANTIGA, sem `passagem` — ou seja, sem linha em
 * `passagens_de_atendimento` e sem cartão no fio da conversa. Acrescentar o
 * cartão lá mudaria o que aquelas duas specs veem dentro da mesma conversa.
 * Um contato só para este cenário custa quatro linhas e não move nada.
 *
 * ## O que aqui é REAL
 *
 * Tudo o que decide o conteúdo do cartão: `montarBriefingDaPassagem` (a mesma
 * função que o motor chama) e `performHumanHandoff` com o argumento
 * `passagem` (que grava por `registrarPassagem`, com o schema e as colunas de
 * produção). O que está encurtado é só o GATILHO — a decisão do modelo de
 * chamar `request_human_handoff` —, e ele exigiria provedor e canal de verdade
 * para produzir exatamente o mesmo `declaradoPeloModelo` que está escrito aqui.
 *
 * Idempotente: reexecutar apaga o episódio anterior deste contato e refaz.
 */
async function semearPassagemComContexto(
  orgId: string,
  sessaoId: string,
): Promise<{
  conversation_id: string;
  contact_id: string;
  contact_name: string;
  motivo_frase: string;
  fala_do_cliente: string;
  tentativa: string;
}> {
  const TELEFONE_DA_PASSAGEM = "+5531955554444";
  const NOME_DA_PASSAGEM = "Passagem E2E";
  const FALA_DO_CLIENTE = "Isso não está resolvendo, quero falar com um atendente de verdade.";
  const TENTATIVA = "Ofereci o passo a passo do autoatendimento";

  const { data: contatoExistente } = await admin
    .from("contacts")
    .select("id")
    .eq("organization_id", orgId)
    .eq("phone_number", TELEFONE_DA_PASSAGEM)
    .maybeSingle();
  const contatoId = contatoExistente
    ? (contatoExistente as { id: string }).id
    : await idDe(
        admin
          .from("contacts")
          .insert({
            organization_id: orgId,
            phone_number: TELEFONE_DA_PASSAGEM,
            display_name: NOME_DA_PASSAGEM,
            name: NOME_DA_PASSAGEM,
          })
          .select("id")
          .single(),
        "contacts (passagem)",
      );

  const { data: convExistente } = await admin
    .from("conversations")
    .select("id")
    .eq("organization_id", orgId)
    .eq("contact_id", contatoId)
    .maybeSingle();
  const conversaId = convExistente
    ? (convExistente as { id: string }).id
    : await idDe(
        admin
          .from("conversations")
          .insert({
            organization_id: orgId,
            contact_id: contatoId,
            channel_session_id: sessaoId,
            status: "ai_handling",
            assignee_kind: "ai",
            last_inbound_at: new Date().toISOString(),
          })
          .select("id")
          .single(),
        "conversations (passagem)",
      );

  // Reset do episódio — só o que ESTE bloco cria.
  await pool.query(
    `delete from passagens_de_atendimento where organization_id = $1 and conversation_id = $2`,
    [orgId, conversaId],
  );
  await pool.query(
    `delete from agent_inbox_items
      where organization_id = $1
        and ((ref_kind = 'contact' and ref_id = $2) or (ref_kind = 'conversation' and ref_id = $3))`,
    [orgId, contatoId, conversaId],
  );
  await pool.query(
    `update conversations
        set assigned_to_user_id = null, assignee_kind = 'ai', status = 'ai_handling',
            bot_silenced_until = null
      where id = $1`,
    [conversaId],
  );
  await pool.query(`update contacts set force_human = false where id = $1`, [contatoId]);

  // O briefing, pela função REAL do motor.
  const briefing = montarBriefingDaPassagem({
    declaradoPeloModelo: {
      cliente_quer: "falar com uma pessoa sobre a troca do produto",
      tentativas: [{ o_que: TENTATIVA, desfecho: "o cliente disse que já tinha tentado" }],
    },
    checkpoint: {
      rolling_summary: "Cliente comprou há 8 dias e quer trocar por outro tamanho.",
      commitments: ["enviar o código da troca"],
      objections: ["achou o prazo longo"],
      next_action: "confirmar o endereço de coleta",
      declaracao: null,
    },
    pendentesDoCliente: [FALA_DO_CLIENTE],
    motivo: { codigo: "requested_human", texto: "o cliente pediu atendimento humano" },
  });

  await performHumanHandoff(
    pool,
    { tenantId: orgId, leadId: contatoId, conversationId: conversaId },
    {
      reason: "o cliente pediu para falar com uma pessoa",
      conversationSummary: briefing.body,
      passagem: {
        origem: "ferramenta_do_modelo",
        motivoCodigo: "requested_human",
        briefing,
      },
      log: logMudo,
    },
  );

  const { rows } = await pool.query<{ n: string }>(
    `select count(*)::text as n from passagens_de_atendimento
      where organization_id = $1 and conversation_id = $2`,
    [orgId, conversaId],
  );
  if (rows[0]?.n !== "1") {
    throw new Error(
      `a passagem não foi gravada (linhas=${rows[0]?.n ?? "?"}) — o cenário do cartão não vale`,
    );
  }

  return {
    conversation_id: conversaId,
    contact_id: contatoId,
    contact_name: NOME_DA_PASSAGEM,
    motivo_frase: "O cliente pediu para falar com uma pessoa",
    fala_do_cliente: FALA_DO_CLIENTE,
    tentativa: TENTATIVA,
  };
}

main().catch(async (err) => {
  console.error("[seed-escalacao] falhou:", err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
