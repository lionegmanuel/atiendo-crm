import { describe, expect, it } from "vitest";

import { listConversationsHandler } from "@/app/api/v1/conversations/_handler";

/**
 * O FILTRO POR MARCADOR DO INBOX PERGUNTA ÀS DUAS CAIXAS ONDE SE MARCA.
 *
 * ## O defeito que fez este arquivo existir (relatado 2026-08-17, PR #1206)
 *
 * O Inbox tem duas caixas de marcador no mesmo painel: a do CONTATO (a mesma da
 * ficha e da campanha) e a da CONVERSA (`ConversationTagsEditor`, onde a IA
 * também escreve por `crm_manage_tags`). O filtro da lista buscava só em
 * `conversations.tags`. Resultado na tela: *"adicionei a tag nele para testar e
 * ele n aparece no filtro"*. Escrever num lugar e procurar em outro não dá erro
 * nenhum — dá lista vazia, que o usuário lê como "o CRM perdeu meu marcador".
 *
 * ## Por que as duas, e não a troca
 *
 * Trocar a fonte pelo contato consertaria o relato e tiraria o filtro de quem
 * marca a conversa: o marcador continuaria editável e deixaria de ser
 * filtrável. O filtro casa `tags` (conversa) OU `tags_do_contato` — o campo
 * calculado da migration 0323, que dispensa lista de ids na URL.
 *
 * ## Por que o caso com caracteres reservados
 *
 * Marcador é texto livre. Dentro de um `or=`, `,` e `)` são gramática do
 * PostgREST, e `{`/`}` desligam o reconhecimento do literal de array. O valor
 * vai entre aspas, e o decodificador abaixo reproduz as duas camadas que o
 * servidor desfaz (`pQuotedValue` do PostgREST, depois o literal de array do
 * Postgres) para provar que o marcador chega inteiro.
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

const ctx = {
  organization_id: "org-1",
  requestId: "req-1",
  actor: { type: "user" as const, id: "user-1" },
} as never;

async function rodar(q: Record<string, unknown>) {
  const { client, chamadas } = fakeSupabase();
  await listConversationsHandler(client, ctx, { limit: 50, ...q } as never);
  return chamadas;
}

const selectDe = (chamadas: { metodo: string; args: unknown[] }[]) =>
  String(chamadas.find((c) => c.metodo === "select")?.args[0] ?? "");

/**
 * Desfaz o que o servidor desfaz: separa os termos do `or=` respeitando aspas,
 * tira as aspas do PostgREST (barra escapa o próximo caractere) e depois o
 * literal de array do Postgres de UM elemento entre aspas.
 */
function termosDoOr(or: string): { campo: string; op: string; elemento: string }[] {
  const termos: string[] = [];
  let atual = "";
  let emAspas = false;
  for (let i = 0; i < or.length; i++) {
    const ch = or[i]!;
    if (emAspas && ch === "\\") {
      atual += ch + or[++i]!;
      continue;
    }
    if (ch === '"') emAspas = !emAspas;
    if (ch === "," && !emAspas) {
      termos.push(atual);
      atual = "";
      continue;
    }
    atual += ch;
  }
  termos.push(atual);
  const desescapa = (t: string) => t.replace(/\\(.)/g, "$1");
  return termos.map((t) => {
    const m = /^([a-z_]+)\.([a-z]+)\."(.*)"$/.exec(t);
    if (!m) throw new Error(`termo fora do formato esperado: ${t}`);
    const literal = desescapa(m[3]!);
    const el = /^\{"(.*)"\}$/.exec(literal);
    if (!el) throw new Error(`literal de array fora do formato: ${literal}`);
    return { campo: m[1]!, op: m[2]!, elemento: desescapa(el[1]!) };
  });
}

const orsDe = (chamadas: { metodo: string; args: unknown[] }[]) =>
  chamadas.filter((c) => c.metodo === "or").map((c) => String(c.args[0]));

describe("listConversationsHandler — filtro por marcador", () => {
  it("casa a caixa da conversa OU a do contato, num `or` só", async () => {
    const chamadas = await rodar({ tag: "fidic" });

    expect(orsDe(chamadas)).toHaveLength(1);
    expect(termosDoOr(orsDe(chamadas)[0]!)).toEqual([
      { campo: "tags", op: "cs", elemento: "fidic" },
      { campo: "tags_do_contato", op: "cs", elemento: "fidic" },
    ]);
    // O `contains` de caixa única não pode sobrar ao lado do `or`: seria AND,
    // e o marcador de uma caixa só voltaria a não achar nada.
    expect(chamadas.filter((c) => c.metodo === "contains")).toEqual([]);
  });

  it("marcador com vírgula, parêntese, chave, aspas e barra chega inteiro", async () => {
    const marcador = 'a,b)c{d}"e\\f';
    const [or] = orsDe(await rodar({ tag: marcador }));

    expect(termosDoOr(or!).map((t) => t.elemento)).toEqual([marcador, marcador]);
  });

  it("sem marcador no filtro, nenhum `or` de marcador", async () => {
    expect(orsDe(await rodar({}))).toEqual([]);
  });

  it("a consulta da lista não muda com o filtro — nenhuma junção interna", async () => {
    // Filtrar pelo campo calculado dispensa o `!inner` no contato embutido: a
    // consulta mais lida do Inbox fica a mesma com e sem marcador.
    expect(selectDe(await rodar({ tag: "fidic" }))).toBe(selectDe(await rodar({})));
    expect(selectDe(await rodar({ tag: "fidic" }))).not.toContain("!inner");
  });

  it("continua filtrando por organização — o filtro novo não desloca o de tenant", async () => {
    const chamadas = await rodar({ tag: "fidic" });
    expect(
      chamadas.some(
        (c) => c.metodo === "eq" && c.args[0] === "organization_id" && c.args[1] === "org-1",
      ),
    ).toBe(true);
  });
});
