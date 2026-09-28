import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildOpeningMessage, inboundsNaoRespondidos } from "@/lib/agent-engine/agent/inbound-turn";
import { detectAmbiguousOptOut, detectHumanHandoffRequest } from "@/lib/agent-engine/agent/human-handoff";
import type { LeadContext } from "@/lib/agent-engine/edge/crm/get-lead-context";

/**
 * A RAJADA — o dano colateral do pin, e a separação que o desfaz.
 *
 * O drain coalesce rajada: com `INBOUND_DEBOUNCE_MS` (default 8000, em
 * `lib/agent-engine/env.ts`), a segunda mensagem do cliente NÃO ganha job próprio
 * — ela entra de carona no job da primeira (`edge/crm/drain.ts`, bloco
 * "Coalescência"), e o único job que existe carrega o id da PRIMEIRA.
 *
 * Medido no `drainTick` real com um pool falso: a 2ª mensagem não emite
 * `insert into job_queue`.
 *
 * Daí as duas perguntas do turno, que o pin havia emendado numa só:
 *
 *   1. A QUE ESTE TURNO RESPONDE? À mensagem do job. É para isso que o pin
 *      existe: um registro concorrente não pode sequestrar o turno.
 *   2. O QUE O CLIENTE DISSE e ainda não foi respondido? Tudo desde a nossa
 *      última resposta. Handoff, opt-out e urgência leem daqui — um pedido de
 *      humano que chega na 2ª mensagem de uma rajada não pode ser calado, e
 *      calá-lo seria pior que o defeito que o pin veio consertar.
 */

const PRIMEIRA = "oi";
const SEGUNDA = "quero falar com uma pessoa";

/** A rajada como o turno a enxerga: nada nosso saiu entre as duas. */
const contexto: LeadContext = {
  lead_id: "11111111-1111-4111-8111-111111111111",
  contact: { name: "Cristiano", phone: null, email: null, tags: [], is_blocked: false },
  conversation_id: "22222222-2222-4222-8222-222222222222",
  last_human_decision: null,
  messages: [
    { direction: "outbound", body: "Oi! Como posso ajudar?", sent_at: "2026-09-06T09:00:00-04:00" },
    { direction: "inbound", body: PRIMEIRA, sent_at: "2026-09-06T09:03:00-04:00" },
    { direction: "inbound", body: SEGUNDA, sent_at: "2026-09-06T09:03:03-04:00" },
  ],
} as unknown as LeadContext;

describe("rajada coalescida: o turno responde à 1ª e OUVE a 2ª", () => {
  it("o bloco de mensagem atual nomeia a mensagem do job — a PRIMEIRA", () => {
    // `currentInboundText` é o corpo da linha que o job aponta.
    const abertura = buildOpeningMessage(null, null, contexto, "sem notas", false, [], "", PRIMEIRA);

    expect(abertura).toContain("## Mensagem atual do cliente — fonte prioritária");
    expect(abertura).toContain(JSON.stringify({ texto: PRIMEIRA }));
    // E não promove a segunda a "mensagem atual" — ela é do histórico, e é lá
    // que o modelo a lê. Promovê-la desfaria o conserto do registro concorrente.
    expect(abertura).not.toContain(JSON.stringify({ texto: SEGUNDA }));
  });

  it("o pedido de humano da 2ª mensagem É ouvido — é a linha que o pin quase calou", () => {
    const pendentes = inboundsNaoRespondidos(contexto.messages);
    expect(pendentes).toEqual([PRIMEIRA, SEGUNDA]);

    // A checagem do turno é `.some(...)`, com o detector REAL. Só a mensagem do
    // job (`PRIMEIRA`) não dispararia nada — é exatamente esse o dano colateral.
    expect(detectHumanHandoffRequest(PRIMEIRA)).toBe(false);
    expect(pendentes.some((t) => detectHumanHandoffRequest(t))).toBe(true);
  });

  it("por MENSAGEM, nunca emendado: 'PARAR' na 2ª ainda é palavra isolada", () => {
    // `ehPalavraIsolada` (lib/opt-out/deteccao.ts) exige que a mensagem INTEIRA
    // seja a palavra-chave. Emendar a rajada num texto só — "oi\nPARAR" — mataria
    // a propriedade, e o opt-out deixaria de disparar. Este caso é o que impede
    // uma "simplificação" para `pendentes.join()`.
    const rajada = [PRIMEIRA, "PARAR"];
    expect(detectAmbiguousOptOut(rajada.join("\n"))).toBe(false);
    expect(rajada.some((t) => detectAmbiguousOptOut(t))).toBe(true);
  });

  it("o corte é a nossa última resposta — o que já foi respondido não volta", () => {
    const jaRespondido: LeadContext["messages"] = [
      { direction: "inbound", body: "quero falar com um atendente", sent_at: "2026-09-05T10:00:00-04:00" },
      { direction: "outbound", body: "Claro, já chamo alguém.", sent_at: "2026-09-05T10:01:00-04:00" },
      { direction: "inbound", body: "obrigado", sent_at: "2026-09-06T09:03:00-04:00" },
    ] as unknown as LeadContext["messages"];
    // Sem o corte, um pedido de humano de ontem — já atendido — re-dispararia
    // handoff a cada turno novo.
    expect(inboundsNaoRespondidos(jaRespondido)).toEqual(["obrigado"]);
  });

  it("registro concorrente sem corpo não vira mensagem pendente", () => {
    const comVazio = [
      { direction: "outbound", body: "Oi!", sent_at: "2026-09-06T09:00:00-04:00" },
      { direction: "inbound", body: SEGUNDA, sent_at: "2026-09-06T09:03:00-04:00" },
      { direction: "inbound", body: "   ", sent_at: "2026-09-06T09:03:02-04:00" },
    ] as unknown as LeadContext["messages"];
    expect(inboundsNaoRespondidos(comVazio)).toEqual([SEGUNDA]);
  });
});

const FONTE = readFileSync(
  join(process.cwd(), "lib/agent-engine/agent/inbound-turn.ts"),
  "utf8",
);

describe("fiação — as duas perguntas leem de fontes diferentes", () => {
  it("handoff, opt-out e urgência leem os inbounds pendentes, POR MENSAGEM", () => {
    // Presença antes de qualquer coisa: uma asserção que some junto com o código
    // que ela vigia não vigia nada.
    expect(FONTE).toMatch(/const inboundsPendentes = inboundsNaoRespondidos\(/);
    expect(FONTE).toMatch(/inboundsPendentes\.some\([\s\S]{0,200}?detectHumanHandoffRequest\(/);
    expect(FONTE).toMatch(/inboundsPendentes\.some\(\(texto\) => detectAmbiguousOptOut\(texto\)\)/);
    expect(FONTE).toMatch(/inboundsPendentes\.some\(\(texto\) => detectUrgencySignal\(texto\)\)/);
    // E nenhum deles voltou a olhar só a última linha do histórico.
    expect(FONTE).not.toMatch(/detectAmbiguousOptOut\(latestInboundSignal\(/);
  });

  it("o veto do falso-vazio segue na mensagem PINADA — é sobre o que o turno responde", () => {
    const i = FONTE.indexOf("send_message: tool({");
    const j = FONTE.indexOf("update_lead_state: tool({", i);
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    expect(FONTE.slice(i, j)).toMatch(/claimsCurrentInboundIsEmpty\(body, mensagemDoJob\)/);
  });
});
