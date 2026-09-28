/**
 * CONVERSAR COM O CASO — o emissor da consulta interna da equipe à IA.
 *
 * ⚠️ ESTE ARQUIVO TEM DE MORAR EM `lib/agent-engine/`. A varredura de herança
 * (`tests/unit/heranca-de-provider-nos-pontos-auxiliares.test.ts`) lê SÓ essa
 * pasta: `arquivosDoMotor(join(process.cwd(), "lib/agent-engine"))`. Se alguém
 * mover este módulo para `lib/ai/` numa refatoração, o painel de Provedores
 * volta a anunciar "padrão da organização" num ponto que, em runtime, usa o
 * modelo do agente — e nenhum gate reclama.
 *
 * ## O que este emissor NÃO faz, de propósito
 *
 * · **Nenhuma tool, nenhum `maxSteps`.** Sem tools, o SDK para no 1º step
 *   (default `stepCountIs(1)`) e `result.text` vem pronto. É o que impede o
 *   modelo de SEQUER TENTAR `send_message`: a IA aqui lê e não age.
 * · **Nenhum streaming.** `runModelCall` só usa `generateText`. Contornar o seam
 *   para transmitir palavra a palavra tiraria binding, orçamento e `llm_calls`
 *   do caminho — os três motivos de o seam existir.
 * · **Nenhuma isenção de orçamento.** `case_chat` não entra em
 *   `PURPOSES_ISENTOS`: isentar faria a consulta gastar sem teto, e o teto é o
 *   que protege o self-hoster da própria equipe.
 *
 * ## Os três campos de provedor vêm do MESMO lugar, ou nenhum vem
 *
 * A lição do PR #151 (`aux-model-args.ts`): emprestar só a string do modelo e
 * deixar provider/credencial no padrão da organização mandava `gpt-5-mini` para
 * o endpoint da Anthropic e matava o turno inteiro. `undefined` nos três faz o
 * seam seguir a cadeia normal (binding → env → padrão da organização).
 */
import type pg from "pg";
import type { ModelMessage } from "ai";

import type { CaseChatAuthorKind } from "@/lib/ai/conversa-do-caso/vocabulario";

import { runModelCall, type LlmEdgeConfig, type RunModelCallDeps } from "../edge/llm/run-model-call";
import type { PersonaDaConversa } from "./conversa-do-caso/persona";

export interface TurnoAnterior {
  author_kind: CaseChatAuthorKind;
  body: string;
}

export interface ConversaDoCasoInput {
  tenantId: string;
  /** Vai para `llm_calls.lead_id` — é o contato do caso, resolvido do banco. */
  contactId: string;
  /** `system` já montado por `montarSystem` (prefixo estável do cache). */
  system: string;
  /** O bloco cercado de `montarBlocoDeDados`. */
  blocoDeDados: string;
  historico: TurnoAnterior[];
  pergunta: string;
  persona: PersonaDaConversa;
}

export interface RespostaDaConversa {
  texto: string;
  /** `llm_calls.id` — o vínculo da linha da resposta com a tela de Execuções. */
  callId: string | null;
  /** Quem respondeu de fato; `null` = persona padrão da organização. */
  agentId: string | null;
}

/**
 * Os `messages` do chat — e a separação de papéis é o ponto.
 *
 * UM turno `user` com o bloco de DADOS cercado, depois o histórico da consulta
 * (`human`→`user`, `ai`→`assistant`), depois a pergunta.
 *
 * **Nunca** o mapeamento do rascunho (inbound→`user`, outbound→`assistant`):
 * num chat, a pergunta do atendente também é `user`, e o modelo passaria a
 * confundir o que o CLIENTE escreveu com o que o OPERADOR pediu. A conversa com
 * o cliente vai dentro do bloco de dados, cercada.
 */
export function montarMensagens(input: {
  blocoDeDados: string;
  historico: TurnoAnterior[];
  pergunta: string;
}): ModelMessage[] {
  return [
    { role: "user", content: input.blocoDeDados },
    ...input.historico.map(
      (m): ModelMessage => ({
        role: m.author_kind === "human" ? "user" : "assistant",
        content: m.body,
      }),
    ),
    { role: "user", content: input.pergunta },
  ];
}

export async function responderSobreOCaso(
  db: pg.Pool,
  llmCfg: LlmEdgeConfig,
  input: ConversaDoCasoInput,
  deps: RunModelCallDeps = {},
): Promise<RespostaDaConversa> {
  // `null` quando a persona do caso não pôde ser usada — e aí os TRÊS campos de
  // provedor saem `undefined` juntos.
  const agent = input.persona.fonte === "agente_do_caso" ? input.persona.agente : null;

  const { result, callId } = await runModelCall(
    db,
    llmCfg,
    {
      tenantId: input.tenantId,
      leadId: input.contactId,
      jobId: null,
      // Gravar `agentId` é decisão medida: a aba "Execuções" do agente filtra
      // `llm_calls.agent_id`, então as consultas da equipe aparecem ali junto
      // dos turnos com o cliente. É desejável — é o custo do agente, gasto na
      // persona dele —, e o `purpose` distingue as linhas.
      agentId: agent === null ? null : agent.agentId,
      purpose: "case_chat",
      system: input.system,
      messages: montarMensagens(input),
      model: agent === null ? undefined : agent.model,
      // NO MESMO OBJETO do `purpose`, e é isso que a varredura de herança
      // exige. `case_chat` está em `PONTOS_QUE_HERDAM_DO_AGENTE` por causa
      // desta linha; tirá-la faz o gate reprovar nos dois sentidos.
      llmOverride:
        agent === null ? undefined : { provider: agent.provider, credentialId: agent.credentialId },
      // SEM `tools` e SEM `maxSteps` — ver o cabeçalho.
    },
    deps,
  );

  return {
    texto: (result.text ?? "").trim(),
    callId: callId ?? null,
    agentId: agent === null ? null : agent.agentId,
  };
}
