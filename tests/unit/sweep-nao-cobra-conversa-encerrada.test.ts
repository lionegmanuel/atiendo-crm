import { describe, expect, it } from "vitest";

import { createSupabaseSilenceSweepDb } from "@/lib/followup/silence-sweep";
import { CONVERSATION_TERMINAL_STATUSES } from "@/lib/schemas";

/**
 * O SWEEP DE SILÊNCIO NÃO PODE COBRAR QUEM UM HUMANO JÁ ENCERROU — e este teste
 * vigia a CONSULTA DE PRODUÇÃO, não uma cópia dela.
 *
 * ═══ Por que ele existe, e por que o invariante não bastava ═══
 *
 * `tests/invariants/followup-silence-sweep.test.ts` prova a LÓGICA real (ele
 * importa e chama `runSilenceSweep`), mas injeta um segundo implementador de
 * `SilenceSweepDb` com SQL próprio — porque a produção fala com o PostgREST e o
 * `test:db` sobe só o Postgres. Para comportamento que mora na LÓGICA
 * (threshold, dedup, gate) aquele invariante vigia. Para comportamento que mora
 * no FILTRO DA CONSULTA, ele não vigia — o filtro está na borda, e a borda é
 * dublê.
 *
 * Medido, e é o que motivou este arquivo: com os dois casos do PR #420
 * (@automatikpg-ux) verdes, **removi o filtro da produção** e o invariante
 * continuou **19 de 19 verdes**. Ele estava medindo o filtro do adaptador de
 * teste, não o do produto. Um verde sem lastro é pior que teste nenhum: ele
 * cria segurança falsa sobre um comportamento que atinge cliente — cobrar
 * automaticamente quem um humano encerrou de propósito.
 *
 * ═══ A ressalva, porque ela é estreita e importa ═══
 *
 * Este teste vigia a CHAMADA, não o EFEITO. Se o PostgREST mudar a semântica de
 * `.not(coluna, "in", ...)`, ele fica verde estando errado — foi exatamente o
 * que esta casa pagou com o `setAuth` do Realtime, que o dublê deu como chamado
 * enquanto a biblioteca tinha mudado por baixo. O efeito continua vigiado só
 * por produção e pelos e2e.
 *
 * Molde: `tests/unit/inbox-aba-minhas-sem-fechadas.test.ts`, que faz o mesmo
 * para o filtro de status da inbox.
 */

/** Registra a cadeia do PostgREST; resolve como lista vazia no `await`. */
function fakeSupabase() {
  const chamadas: { metodo: string; args: unknown[] }[] = [];
  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") {
          return (ok: (v: unknown) => unknown) => ok({ data: [], error: null });
        }
        return (...args: unknown[]) => {
          chamadas.push({ metodo: String(prop), args });
          return proxy;
        };
      },
    },
  ) as Record<string, unknown>;
  return { client: { from: () => proxy } as never, chamadas };
}

/** O `.not("status","in","(closed,archived)")` que tira as encerradas. */
const excluiTerminais = (chamadas: { metodo: string; args: unknown[] }[]) =>
  chamadas.some(
    (c) =>
      c.metodo === "not" &&
      c.args[0] === "status" &&
      c.args[1] === "in" &&
      CONVERSATION_TERMINAL_STATUSES.every((s) => String(c.args[2]).includes(s)),
  );

describe("createSupabaseSilenceSweepDb — a consulta de PRODUÇÃO", () => {
  it("CONTROLE: o dublê alcança o caminho (a consulta é montada)", async () => {
    // Sem isto, um dublê que não fosse exercitado devolveria zero chamadas e a
    // asserção abaixo passaria por vacuidade — o modo de falha que este arquivo
    // inteiro existe para não repetir.
    const { client, chamadas } = fakeSupabase();
    await createSupabaseSilenceSweepDb(client).loadSilentContactIds(
      "org-1",
      new Date("2026-08-30T12:00:00Z").toISOString(),
      [],
    );
    expect(chamadas.map((c) => c.metodo)).toContain("select");
    expect(chamadas.length, "o dublê não registrou chamada nenhuma").toBeGreaterThan(2);
  });

  it("exclui conversa CLOSED/ARCHIVED no BANCO — quem um humano encerrou não é cobrado", async () => {
    const { client, chamadas } = fakeSupabase();
    await createSupabaseSilenceSweepDb(client).loadSilentContactIds(
      "org-1",
      new Date("2026-08-30T12:00:00Z").toISOString(),
      [],
    );
    expect(
      excluiTerminais(chamadas),
      "a consulta de produção não exclui as conversas terminais: o sweep vai inscrever em " +
        "follow-up automático quem um humano fechou de propósito. Achado no PR #420.",
    ).toBe(true);
  });

  it("o filtro deriva da constante compartilhada, não de literais", () => {
    // Se alguém escrever ('closed','archived') à mão aqui ou na produção, o dia
    // em que um status terminal novo entrar em CONVERSATION_TERMINAL_STATUSES
    // deixa os dois lados divergentes em silêncio.
    expect(CONVERSATION_TERMINAL_STATUSES.length).toBeGreaterThan(0);
    expect([...CONVERSATION_TERMINAL_STATUSES]).toEqual(["closed", "archived"]);
  });
});
