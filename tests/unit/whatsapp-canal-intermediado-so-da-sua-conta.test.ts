import { describe, expect, it } from "vitest";

import { contaDoEventoZernio, inboundPayloadBelongsToSession } from "@/lib/channels/inbound";

/**
 * O WEBHOOK DO PROVEDOR INTERMEDIADO É POR ESPAÇO DE TRABALHO, NÃO POR NÚMERO.
 *
 * Medido numa instalação real (23/09/2026): um espaço com DEZ contas — dois
 * WhatsApp e Facebook/Instagram/Meta Ads de três negócios. A caixa de um número
 * recebeu mensagens enviadas por OUTRO número do mesmo espaço. A guarda de
 * conta existia só para o canal social; para o WhatsApp devolvia `true` sem
 * olhar.
 *
 * A guarda busca a conta da sessão ELA MESMA (como a social): uma guarda que
 * lesse a conta de um campo que a rota deveria trazer ficaria verde sem
 * filtrar nada no dia em que a rota não trouxesse.
 */
const DESTA_SESSAO = "acc_sintetica_desta_sessao";
const OUTRA_DO_ESPACO = "acc_sintetica_de_outro_numero";

/** Banco dublado: devolve a conta que a sessão tem, e registra se foi perguntado. */
function banco(contaDaSessao: string | null, erro = false) {
  const perguntas: string[] = [];
  const cadeia: Record<string, unknown> = {};
  for (const m of ["select", "eq"])
    cadeia[m] = (...a: unknown[]) => {
      perguntas.push(`${m}:${a.join("=")}`);
      return cadeia;
    };
  cadeia.maybeSingle = async () =>
    erro
      ? { data: null, error: { message: "timeout" } }
      : { data: { zernio_account_id: contaDaSessao }, error: null };
  return { admin: { from: () => cadeia } as never, perguntas };
}

const entrada = (corpo: Record<string, unknown> | string, provider = "zernio") =>
  ({
    session: { id: "s1", organization_id: "o1", provider },
    rawBody: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
    headers: new Headers(),
    secret: "x",
  }) as never;

describe("o WhatsApp do provedor intermediado só aceita evento da SUA conta", () => {
  it("evento de OUTRA conta do mesmo espaço é recusado — o caso medido", async () => {
    const { admin } = banco(DESTA_SESSAO);
    expect(
      await inboundPayloadBelongsToSession(
        admin,
        entrada({ event: "message.sent", account: { id: OUTRA_DO_ESPACO } }),
      ),
    ).toBe(false);
  });

  it("evento da própria conta passa — nos três lugares onde o provedor põe a conta", async () => {
    for (const corpo of [
      { account: { id: DESTA_SESSAO } },
      { account: { accountId: DESTA_SESSAO } },
      { accountId: DESTA_SESSAO },
    ]) {
      const { admin } = banco(DESTA_SESSAO);
      expect(await inboundPayloadBelongsToSession(admin, entrada(corpo)), JSON.stringify(corpo)).toBe(
        true,
      );
    }
  });

  it("a conta da sessão é lida do banco com o filtro de organização", async () => {
    const { admin, perguntas } = banco(DESTA_SESSAO);
    await inboundPayloadBelongsToSession(admin, entrada({ account: { id: DESTA_SESSAO } }));
    expect(perguntas).toContain("eq:organization_id=o1");
    expect(perguntas).toContain("eq:id=s1");
  });

  it("evento SEM conta passa — recusá-lo cegaria o vigia para `account.disconnected`", async () => {
    const { admin, perguntas } = banco(DESTA_SESSAO);
    expect(await inboundPayloadBelongsToSession(admin, entrada({ event: "account.disconnected" }))).toBe(
      true,
    );
    // Sem conta no evento não há o que comparar: nem pergunta ao banco.
    expect(perguntas).toEqual([]);
  });

  it("mensagem e revisão de modelo SEM conta são recusadas — o provedor sempre a manda nelas", async () => {
    for (const event of ["message.received", "message.sent", "whatsapp.template.status_updated"]) {
      const { admin } = banco(DESTA_SESSAO);
      expect(await inboundPayloadBelongsToSession(admin, entrada({ event })), event).toBe(false);
    }
  });

  it("evento de número SEM conta passa a guarda — quem o confere é o número, em `zernioInbound`", async () => {
    const { admin } = banco(DESTA_SESSAO);
    expect(
      await inboundPayloadBelongsToSession(admin, entrada({ event: "whatsapp.number.suspended", number: {} })),
    ).toBe(true);
  });

  it("sessão sem conta RECUSA — falha fechada (a constraint do banco hoje impede este estado)", async () => {
    const { admin } = banco(null);
    expect(
      await inboundPayloadBelongsToSession(admin, entrada({ account: { id: OUTRA_DO_ESPACO } })),
    ).toBe(false);
  });

  it("falha ao ler a sessão LANÇA — nunca vira aceite silencioso", async () => {
    const { admin } = banco(DESTA_SESSAO, true);
    await expect(
      inboundPayloadBelongsToSession(admin, entrada({ account: { id: OUTRA_DO_ESPACO } })),
    ).rejects.toThrow("zernio_session_lookup_failed");
  });

  it("corpo que não é JSON não derruba a guarda", () => {
    expect(contaDoEventoZernio("isto não é json")).toBeNull();
  });
});
