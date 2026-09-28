import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { loadInboundBodyForJob } from "@/lib/agent-engine/agent/inbound-turn";
import type { Queryable } from "@/lib/agent-engine/queue/queue";

/**
 * A CORRIDA DO INBOUND — e por que este arquivo não é o `mensagem-atual-prioritaria`.
 *
 * Aquele prova as duas funções PURAS: a abertura prioriza o texto que recebe, e a
 * barreira reconhece a frase falsa. Nenhuma das duas sabe de onde o texto veio — e
 * "de onde ele veio" É o conserto: o job já carrega `inbound_message_id`, e até
 * este trabalho o motor o recebia (`inboundTurnPayloadSchema`) e NUNCA o usava,
 * relendo "a última inbound" do histórico a cada turno.
 *
 * Medido na `main` de hoje, com um registro inbound concorrente sem corpo:
 * `latestInboundSignal` devolvia `""` enquanto a linha apontada pelo job tinha
 * texto. O turno inteiro — abertura, detecção de handoff, barreira de envio —
 * passava a operar sobre uma mensagem vazia que o cliente nunca mandou.
 *
 * Os dois níveis abaixo existem porque a perda é SILENCIOSA nos dois:
 *  1. o recorte da consulta (org + conversa + id + direction) não aparece em
 *     chamada nenhuma — só no SQL;
 *  2. a fiação (`inboundMessageId: payload.inbound_message_id`) pode sumir sem
 *     que um único teste de função pura fique vermelho: a leitura devolve `null`
 *     e o motor volta, calado, a ler o histórico.
 */

function pool(rows: { body: string | null }[]) {
  const query = vi.fn().mockResolvedValue({ rows });
  return { db: { query } as unknown as Queryable, query };
}

describe("a linha canônica é lida pelo id do job", () => {
  it("recorta por organização, conversa, id E direção — nessa ordem de parâmetros", async () => {
    const { db, query } = pool([{ body: "Quero marcar com a Drª Mara." }]);
    const corpo = await loadInboundBodyForJob(db, {
      tenantId: "org-1",
      conversationId: "conv-1",
      inboundMessageId: "msg-1",
    });

    expect(corpo).toBe("Quero marcar com a Drª Mara.");
    const [sql, params] = query.mock.calls[0]!;
    // Sem `organization_id` o id de outro tenant serviria; sem `conversation_id`
    // uma mensagem de outra conversa do mesmo contato serviria; sem `direction`
    // uma OUTBOUND nossa viraria "a mensagem atual do cliente".
    expect(sql).toMatch(/organization_id\s*=\s*\$1/);
    expect(sql).toMatch(/conversation_id\s*=\s*\$2/);
    expect(sql).toMatch(/\bid\s*=\s*\$3/);
    expect(sql).toMatch(/direction\s*=\s*'inbound'/);
    expect(params).toEqual(["org-1", "conv-1", "msg-1"]);
  });

  it("linha que existe com corpo NULL é texto vazio, não ausência", async () => {
    // A diferença decide o desfecho: `''` diz "a mensagem do job não tem texto"
    // (e a abertura cai no ramo do histórico); `null` diria "não achei o job" e
    // o motor voltaria ao registro concorrente — o defeito de origem.
    const { db } = pool([{ body: null }]);
    await expect(
      loadInboundBodyForJob(db, { tenantId: "o", conversationId: "c", inboundMessageId: "m" }),
    ).resolves.toBe("");
  });

  it("sem linha nenhuma devolve null — e é isso que autoriza o fallback", async () => {
    const { db } = pool([]);
    await expect(
      loadInboundBodyForJob(db, { tenantId: "o", conversationId: "c", inboundMessageId: "m" }),
    ).resolves.toBeNull();
  });
});

const FONTE = fs.readFileSync(
  path.join(process.cwd(), "lib/agent-engine/agent/inbound-turn.ts"),
  "utf8",
);

describe("fiação — o id sai do payload e chega ao sinal do turno", () => {
  it("o handler de inbound_turn repassa payload.inbound_message_id", () => {
    // Sem esta linha o campo volta a ser recebido e ignorado, que é exatamente o
    // estado da `main` antes deste conserto: nenhum teste de função pura muda de cor.
    expect(FONTE).toMatch(/inboundMessageId:\s*payload\.inbound_message_id/);
  });

  it("a mensagem que o turno RESPONDE é a linha canônica, não a última do histórico", () => {
    // O nome mudou de `inboundSignal` para `mensagemDoJob` quando as duas
    // perguntas do turno se separaram — o que o turno RESPONDE (pinado no job) e
    // o que o cliente DISSE e ainda não foi respondido (a rajada inteira). Ver
    // `rajada-nao-cala-o-pedido-de-humano.test.ts`.
    expect(FONTE).toMatch(
      /const mensagemDoJob =\s*currentInboundText \?\? latestInboundSignal\(/,
    );
  });

  it("a abertura recebe o texto canônico quando ele existe", () => {
    expect(FONTE).toMatch(/\.\.\.\(currentInboundText !== null \? \{ currentInboundText \} : \{\}\)/);
  });
});
