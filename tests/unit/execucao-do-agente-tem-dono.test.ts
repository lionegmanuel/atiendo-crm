/**
 * A EXECUÇÃO TEM QUE SABER DE QUEM ELA É.
 *
 * ─── O defeito, medido em produção (VPS, 2026-08-30) ───────────────────────
 *
 * A aba **Execuções** da tela de um agente mostrava "Nenhuma execução ainda"
 * enquanto o agente respondia no WhatsApp. Três peças, e as três medidas:
 *
 *   1. `app/api/v1/ai/agents/[id]/runs/route.ts` lê **`ai_agent_runs`** — tabela
 *      que só o dispatcher legado escrevia, e cujo cron é NO-OP permanente
 *      (`app/api/v1/cron/agent-dispatcher/route.ts` devolve
 *      `{ skipped: true, deprecated: true }`). Em produção: **0 linhas**.
 *   2. O motor que responde de verdade (`lib/agent-engine`) registra em
 *      **`llm_calls`** — 130 linhas de `purpose='agent_turn'` na mesma
 *      organização, a última do próprio dia em que a tela dizia "nenhuma".
 *   3. `llm_calls` **tem** a coluna `agent_id`, com FK para `ai_agents`. Ela
 *      nunca era preenchida: os dois `insert into llm_calls` de
 *      `run-model-call.ts` não a listavam. Medido: **0 de 130**.
 *
 * Sem (3), (1) não tem como ser consertado — não dá para filtrar por agente uma
 * tabela em que o agente não está escrito. É por isso que este arquivo guarda a
 * COLUNA: ela é a peça que faltava para a tela poder existir.
 *
 * ─── O que este teste prova, e o que NÃO prova ─────────────────────────────
 *
 * Ele lê o FONTE de `run-model-call.ts` e cobra que **todo** `insert into
 * llm_calls` liste `agent_id`. É uma cerca estrutural, do mesmo tipo que
 * `tests/unit/cron-audita-so-quando-ha-efeito.test.ts`, e a razão de ser
 * estrutural é que os dois INSERTs são inline dentro de um caminho que exige
 * provider, registry e orçamento para ser alcançado — exercitá-lo mediria o
 * dublê, não o código.
 *
 * **NÃO prova que o valor gravado é o agente certo** — prova que a coluna entrou
 * no INSERT e que existe um parâmetro para ela. O valor correto é guardado do
 * outro lado, por `tests/unit/aba-de-execucoes-le-o-motor-vivo.test.ts`, que
 * exercita a leitura.
 *
 * A cerca varre por REGEX sobre todos os INSERTs do arquivo, não sobre uma lista
 * fixa de dois: um terceiro INSERT adicionado amanhã cai aqui sozinho.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const FONTE = join(process.cwd(), "lib/agent-engine/edge/llm/run-model-call.ts");

/** Cada `insert into llm_calls (...)` do arquivo, com as colunas que ele lista. */
function insertsEmLlmCalls(src: string): Array<{ colunas: string[]; trecho: string }> {
  const out: Array<{ colunas: string[]; trecho: string }> = [];
  const rx = /insert\s+into\s+llm_calls\s*\(([\s\S]*?)\)\s*\n?\s*values/gi;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(src)) !== null) {
    const colunas = m[1]!
      .split(",")
      .map((c) => c.trim().replace(/\s+/g, " "))
      .filter((c) => c !== "");
    out.push({ colunas, trecho: src.slice(m.index, m.index + 90).replace(/\s+/g, " ") });
  }
  return out;
}

describe("llm_calls grava de QUEM é a execução", () => {
  const src = readFileSync(FONTE, "utf8");
  const inserts = insertsEmLlmCalls(src);

  it("o arquivo tem os INSERTs que esta cerca existe para vigiar", () => {
    // Sem esta asserção, apagar os dois INSERTs (ou mudar o nome da tabela)
    // deixaria a cerca VERDE por vacuidade — o modo de falha clássico de teste
    // que varre fonte.
    expect(
      inserts.length,
      "nenhum `insert into llm_calls` encontrado em run-model-call.ts — " +
        "ou o registrador saiu do arquivo, ou a regex desta cerca ficou cega",
    ).toBeGreaterThanOrEqual(2);
  });

  it("TODO insert em llm_calls lista agent_id — inclusive o do ramo de ERRO", () => {
    // O ramo de erro importa tanto quanto o de sucesso, e mais: "o agente falhou"
    // é exatamente a pergunta que a tela de Execuções existe para responder.
    for (const { colunas, trecho } of inserts) {
      expect(
        colunas,
        `INSERT sem agent_id — a execução nasce órfã e a aba do agente não acha o ` +
          `que mostrar.\n  trecho: ${trecho}…\n  colunas: ${colunas.join(", ")}`,
      ).toContain("agent_id");
    }
  });

  it("agent_id entra como PARÂMETRO, nunca literal — o valor vem do turno", () => {
    // Uma forma de fazer a cerca acima passar sem consertar nada seria escrever
    // `agent_id` na lista e gravar `null` fixo no VALUES. Aqui isso reprova.
    for (const { colunas } of inserts) {
      const idx = colunas.indexOf("agent_id");
      expect(idx).toBeGreaterThanOrEqual(0);
    }
    // O input precisa ter por onde receber o agente.
    expect(
      /agentId\??\s*:/.test(src),
      "RunModelCallInput não declara agentId — não há por onde o turno informar o dono",
    ).toBe(true);
    expect(
      /input\.agentId|d\.input\.agentId/.test(src),
      "agentId é declarado mas nunca lido: o INSERT não pode estar recebendo o valor real",
    ).toBe(true);
  });
});
