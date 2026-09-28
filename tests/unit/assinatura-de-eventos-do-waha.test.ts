import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * O CANAL POR QR ASSINAVA A MESMA MENSAGEM DUAS VEZES.
 *
 * ─── O defeito, e por que ele era invisível ─────────────────────────────────
 *
 * `WHATSAPP_HOOK_EVENTS` pedia `message` E `message.any`. O WAHA emite os dois
 * para a mesma mensagem, e `lib/waha/ingest.ts` já chama isso de corrida e
 * deduplica — então NADA aparecia errado no produto: nenhuma mensagem em
 * dobro, nenhum alerta.
 *
 * O que dobrava era o ARQUIVO do corpo cru. Medido numa instalação real:
 * 22.939 linhas de `message` ao lado de 24.582 de `message.any`, numa tabela
 * que era 86% do banco. 41% dela era cópia.
 *
 * ─── Por que dá para tirar `message`, e como isso foi provado ───────────────
 *
 * Não pela documentação — pelo banco. Cruzando os ids de mensagem dos dois
 * eventos em 22.815 mensagens reais:
 *
 *   chegaram só por `message` ......... 0
 *   chegaram só por `message.any` ..... 1.642   (as que saíram de nós)
 *
 * Superconjunto estrito, medido. E a doutrina do CLAUDE.md já mandava assinar
 * `message.any` "não só `message`" por causa de multi-device — o que faltava
 * era tirar o irmão redundante.
 *
 * ─── O que este teste segura ────────────────────────────────────────────────
 *
 * Que alguém devolva `message` à lista "por segurança". A segurança aqui é
 * medida e está acima; devolvê-lo dobra de novo a tabela que mais pesa no
 * banco de todo clone, sem trazer uma única mensagem a mais.
 */

const COMPOSES = ["docker-compose.prod.yml", "docker-compose.yml"];

describe("a assinatura de eventos do canal por QR", () => {
  for (const arquivo of COMPOSES) {
    const linha =
      readFileSync(arquivo, "utf8")
        .split("\n")
        .find((l) => l.includes("WHATSAPP_HOOK_EVENTS")) ?? "";

    it(`${arquivo}: assina \`message.any\``, () => {
      // O superconjunto. Sem ele o canal perde as mensagens que SAEM de nós,
      // que é o caso multi-device da doutrina.
      expect(linha).toContain("message.any");
    });

    it(`${arquivo}: NÃO assina \`message\` sozinho`, () => {
      const eventos = (linha.split('"')[1] ?? "").split(",").map((e) => e.trim());
      expect(eventos, "`message` voltou — dobra o arquivo sem trazer mensagem nova").not.toContain(
        "message",
      );
    });

    it(`${arquivo}: os outros eventos continuam`, () => {
      // O conserto não pode ter custado o resto: ack move o status, revoked e
      // edited corrigem linha existente, e os dois de sessão são o que faz o
      // canal enxergar a própria queda.
      for (const e of ["message.ack", "message.edited", "message.revoked", "session.status", "state.change"]) {
        expect(linha, `sumiu ${e}`).toContain(e);
      }
    });
  }
});
