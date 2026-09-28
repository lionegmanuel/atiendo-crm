/**
 * A FALTA DO E-MAIL DA FICHA NÃO DERRUBA A SINCRONIZAÇÃO.
 *
 * `reconcileAppointment` passou a ler `contacts.email` para o convite do
 * Google. Os invariantes montam o cliente só com `rpc` — sem `.from` — e a
 * leitura estourava ANTES de publicar o evento: o catch devolvia `"failed"`
 * e o Meet nunca nascia. Lead sem e-mail (WhatsApp) é o caso comum; stub de
 * teste sem tabela, também. Os dois devolvem null. Quem sincroniza segue.
 */
import { describe, expect, it } from "vitest";

import { emailDoContato } from "@/lib/agenda/google/sync-executor";

const ORG = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CONTATO = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";

describe("emailDoContato não derruba a publicação", () => {
  it("cliente sem .from (o stub dos invariantes) devolve null", async () => {
    await expect(emailDoContato({} as never, ORG, CONTATO)).resolves.toBeNull();
  });

  it("explode na leitura e mesmo assim devolve null, não lança", async () => {
    const db = { from: () => { throw new Error("db.from explodiu"); } };
    await expect(emailDoContato(db as never, ORG, CONTATO)).resolves.toBeNull();
  });

  it("sem contactId nem pergunta o banco", async () => {
    const db = { from: () => { throw new Error("não chame"); } };
    await expect(emailDoContato(db as never, ORG, null)).resolves.toBeNull();
  });

  it("PostgREST com error devolve null em vez de throw", async () => {
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: { message: "boom" } }),
            }),
          }),
        }),
      }),
    };
    await expect(emailDoContato(db as never, ORG, CONTATO)).resolves.toBeNull();
  });

  it("ficha com e-mail devolve o par limpo", async () => {
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  email: "  lead@clinica.test ",
                  name: "Ian",
                  display_name: null,
                  is_anonymized: false,
                },
                error: null,
              }),
            }),
          }),
        }),
      }),
    };
    await expect(emailDoContato(db as never, ORG, CONTATO)).resolves.toEqual({
      email: "lead@clinica.test",
      nome: "Ian",
    });
  });
});
