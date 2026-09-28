/**
 * O SELETOR DA CONEXÃO DE AVISOS FILTRA POR CAPACIDADE, NUNCA POR PROVEDOR.
 *
 * O aviso de caso é texto LIVRE disparado quando a IA trava — não há janela de
 * 24 horas aberta pelo suporte, e nunca haverá: o número da equipe não conversa
 * com ninguém. Só serve a conexão que manda texto livre a qualquer hora.
 *
 * A pergunta que a tela faz é `aceitaMensagemLivre`, e não "é o canal X?":
 * `docs/doctrine/restricao-de-canal.md` proíbe nome de provedor fora de
 * `lib/channels/`, e `pnpm lint:channels` reprova — inclusive em comentário. Por
 * isso ESTE arquivo também não nomeia nenhum: ele monta as linhas a partir de
 * `PROVIDERS_DE_MENSAGEM` e pergunta à matriz de capacidades qual delas aceita.
 *
 * O caso que dói sem a capacidade no DTO: a pessoa escolhe a conexão oficial,
 * salva, liga o aviso — e descobre meses depois, no primeiro caso real, que
 * nenhum aviso jamais saiu. O erro `canal_nao_aceita_aviso_livre` é a rede; o
 * seletor é o que impede a escolha.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { DbErrorLike } from "@/lib/channels/archived";
import { PROVIDERS_DE_MENSAGEM, capabilitiesOf } from "@/lib/channels/capabilities";
import { listSelectableChannels } from "@/lib/channels/selectable";

type Resposta = { data: Record<string, unknown>[] | null; error: DbErrorLike | null };

interface Builder {
  select(colunas: string): Builder;
  eq(coluna: string, valor: string): Builder;
  is(coluna: string, valor: null): Builder;
  in(coluna: string, valores: readonly string[]): Builder;
  order(coluna: string, opts: { ascending: boolean }): Builder;
  then(resolve: (v: Resposta) => unknown): Promise<unknown>;
}

function fakeDb(resposta: Resposta) {
  const colunasPedidas: string[] = [];
  const build = (): Builder => {
    const b: Builder = {
      select(colunas) {
        colunasPedidas.push(colunas);
        return b;
      },
      eq: () => b,
      is: () => b,
      in: () => b,
      order: () => b,
      then(resolve) {
        return Promise.resolve(resposta).then(resolve);
      },
    };
    return b;
  };
  return {
    db: { from: () => build() } as unknown as SupabaseClient,
    colunasPedidas,
  };
}

/** Uma linha por provedor de mensagem — a lista vem do módulo, não daqui. */
const LINHAS = PROVIDERS_DE_MENSAGEM.map((provider, i) => ({
  id: `00000000-0000-4000-8000-00000000000${i}`,
  display_name: `Canal ${i}`,
  status: "WORKING",
  phone_number: `+55319999900${i}`,
  waha_session_name: `sessao_${i}`,
  provider,
}));

describe("listSelectableChannels — a capacidade de mandar texto livre", () => {
  it("responde por CAPACIDADE, para todo provedor de mensagem, sem exceção escrita à mão", async () => {
    const { db } = fakeDb({ data: LINHAS, error: null });
    const canais = await listSelectableChannels(db, "org-1");

    expect(canais).toHaveLength(LINHAS.length);
    for (const [i, provider] of PROVIDERS_DE_MENSAGEM.entries()) {
      expect(canais[i]?.aceitaMensagemLivre).toBe(capabilitiesOf(provider).freeformOutsideWindow);
    }
    // A matriz precisa DISTINGUIR: se todos respondessem igual, o teste acima
    // ficaria verde com a projeção cravando uma constante.
    const respostas = new Set(canais.map((c) => c.aceitaMensagemLivre));
    expect(respostas.size).toBe(2);
  });

  it("a consulta pede a coluna do provedor — sem ela a projeção seria um chute", async () => {
    const { db, colunasPedidas } = fakeDb({ data: LINHAS, error: null });
    await listSelectableChannels(db, "org-1");
    expect(colunasPedidas[0]).toContain("provider");
  });

  it("o DTO NÃO expõe o provedor — a tela recebe a capacidade, nunca o nome", async () => {
    const { db } = fakeDb({ data: LINHAS, error: null });
    const canais = await listSelectableChannels(db, "org-1");
    for (const canal of canais) {
      expect(Object.hasOwn(canal, "provider")).toBe(false);
    }
  });

  it("provedor que esta imagem não conhece responde `false` em vez de derrubar o seletor", async () => {
    // Um clone que aplicou o baseline antes de puxar a imagem nova traz um
    // provedor mais recente na coluna. `capabilitiesOf` LANÇA para ele — e um
    // throw aqui apagaria a lista inteira de conexões, inclusive as que
    // funcionam. Falhar fechado NESTA linha é o desfecho barato.
    const { db } = fakeDb({
      data: [{ ...LINHAS[0], provider: "provedor_do_futuro" }],
      error: null,
    });
    const canais = await listSelectableChannels(db, "org-1");
    expect(canais).toHaveLength(1);
    expect(canais[0]?.aceitaMensagemLivre).toBe(false);
  });
});
