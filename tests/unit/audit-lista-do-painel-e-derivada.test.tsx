import * as fs from "node:fs";
import * as path from "node:path";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AuditFiltersAdmin } from "@/components/admin/audit/AuditFiltersAdmin";
import { AUDIT_ACTIONS, type AuditAction } from "@/lib/audit/actions";

/**
 * O FILTRO DO PAINEL DE AUDITORIA É DERIVADO DO VOCABULÁRIO — NÃO UMA CÓPIA.
 *
 * ─── O que existia, medido ──────────────────────────────────────────────────
 *
 * Duas listas mantidas à mão: o union `AuditAction` (`lib/audit/actions.ts`) e
 * `ACTION_CODES` (`components/admin/audit/action-codes.ts`), o segundo com o
 * comentário "keep in sync manually". Medido no SHA 66924aad: **209 códigos no
 * union, 89 no painel, 120 emitidos e não-filtráveis** (o inverso, 0). Havia uma
 * catraca — `tests/unit/audit-listas-nao-divergem-mais.test.ts` — que congelava
 * os 120 e impedia a dívida de CRESCER. Ela foi apagada junto com a cópia: gate
 * que guarda uma classe extinta é ruído que a próxima pessoa tenta entender.
 *
 * Agora `AUDIT_ACTIONS` é um array (fonte única em runtime), `AuditAction` é
 * `(typeof AUDIT_ACTIONS)[number]`, e o painel mapeia o array. Não há como
 * divergir: não há segunda lista.
 *
 * ─── O que este arquivo guarda ──────────────────────────────────────────────
 *
 * Não a sincronia (essa deixou de ser possível de quebrar), e sim as quatro
 * formas de RESSUSCITAR a cópia — que é o defeito de verdade:
 *
 *  1. a lista foi mesmo lida (sem isto, um import quebrado deixaria tudo verde);
 *  2. ninguém recriou um arquivo-cópia sob `components/admin/audit/`;
 *  3. o painel não redigitou os códigos dentro de si mesmo;
 *  4. `lib/audit/actions.ts` continua sem `import` — é o que torna barato um
 *     componente `"use client"` importá-lo;
 *  5. e a prova positiva: o popover renderiza EXATAMENTE o vocabulário, de modo
 *     que um código novo no array aparece na tela sem ninguém lembrar de nada.
 */

const RAIZ = process.cwd();

function leia(relativo: string): string {
  return fs.readFileSync(path.join(RAIZ, relativo), "utf8");
}

/** Todo literal de string do fonte, já sem comentários. */
function literais(fonte: string): string[] {
  const semComentario = fonte
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*/g, "");
  return [...semComentario.matchAll(/"([^"\n]*)"/g)].map((m) => m[1]!);
}

/** `contact.field_proposed` sim; `@/lib/audit/actions` e `h-9 gap-1.5` não. */
const FORMA_DE_CODIGO = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

const VOCABULARIO = new Set<string>(AUDIT_ACTIONS);

/**
 * A guarda que o TYPECHECK faz, e que nenhum caso de runtime faria.
 *
 * O tipo `AuditAction` agora DERIVA de `AUDIT_ACTIONS` — e a única coisa que o
 * segura é o `as const` no fim do array. Medido por uma revisão adversarial:
 * removendo essas duas palavras, `tsc --noEmit` sai **0** e os 5 casos deste
 * arquivo passam **verdes**, enquanto o tipo silenciosamente vira `string[]` e
 * ~200 call sites deixam de ser verificados.
 *
 * Antes da derivação isso era irredutível (o union era literal). Agora um
 * `pnpm format`, um "vou tipar isso direito" (`: string[]`) ou um refactor
 * desligam a garantia sem acender nada. Esta linha acende.
 */
type NaoDegradouParaString<T> = string extends T ? never : true;
// A regex cobre `export … from` porque re-export arrasta o módulo inteiro
// para o mesmo grafo — medido: um `export { env } from "@/lib/env"` passava
// batido pela versão que só olhava `import`/`require`.
const _tipoNaoDegradou: NaoDegradouParaString<AuditAction> = true;
void _tipoNaoDegradou;

describe("audit: a lista do painel é derivada do vocabulário", () => {
  it("o vocabulário foi REALMENTE lido (guarda de vacuidade)", () => {
    expect(
      AUDIT_ACTIONS.length,
      "AUDIT_ACTIONS implausivelmente curto — import quebrado deixaria todo este arquivo verde sobre nada",
    ).toBeGreaterThan(150);
    expect(new Set(AUDIT_ACTIONS).size, "código repetido em AUDIT_ACTIONS").toBe(
      AUDIT_ACTIONS.length,
    );
    // Âncora de conteúdo: se o import trouxesse outro módulo, isto cai.
    expect(AUDIT_ACTIONS).toContain("org.branding_updated");
    expect(AUDIT_ACTIONS).toContain("auth.login_success");
  });

  it("nenhum arquivo do painel voltou a redigitar a lista", () => {
    const dir = path.join(RAIZ, "components/admin/audit");
    const arquivos = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));

    // Sem esta linha, uma varredura que achasse 0 arquivos (diretório renomeado,
    // glob quebrado) passaria — e "não achei cópia" ficaria indistinguível de
    // "não olhei". A regra é da CLASSE, não do nome `action-codes.ts`: recriar a
    // cópia sob qualquer outro nome é o mesmo defeito.
    expect(arquivos.length, "varredura não achou arquivo nenhum em components/admin/audit").toBeGreaterThan(0);

    const copias = arquivos
      .map((f) => ({
        arquivo: f,
        quantos: literais(leia(`components/admin/audit/${f}`)).filter((s) =>
          VOCABULARIO.has(s),
        ).length,
      }))
      .filter((x) => x.quantos > 0);

    expect(
      copias,
      "Arquivo do painel redigitando código de auditoria. A lista tem UMA fonte — " +
        "`AUDIT_ACTIONS` em lib/audit/actions.ts. Toda cópia envelhece: a anterior " +
        "(components/admin/audit/action-codes.ts) parou 120 códigos atrás do que o " +
        "produto emite, e o filtro que não oferece a opção lê-se como 'isso não " +
        "acontece' em vez de 'isso não está aqui'.\n",
    ).toEqual([]);

    expect(
      fs.existsSync(path.join(dir, "action-codes.ts")),
      "components/admin/audit/action-codes.ts voltou a existir — arquivo que existe é arquivo onde alguém volta a digitar strings",
    ).toBe(false);
  });

  it("o painel consome a derivação em vez de literais", () => {
    const fonte = leia("components/admin/audit/AuditFiltersAdmin.tsx");

    expect(
      /import\s*\{[^}]*\bAUDIT_ACTIONS\b[^}]*\}\s*from\s*"@\/lib\/audit\/actions"/.test(fonte),
      "AuditFiltersAdmin.tsx deixou de importar AUDIT_ACTIONS de @/lib/audit/actions",
    ).toBe(true);

    const suspeitos = literais(fonte).filter((s) => FORMA_DE_CODIGO.test(s));
    expect(
      suspeitos,
      "Literal com forma de código de auditoria dentro do componente do filtro. " +
        "Se a lista precisa de exceção, ela se declara em lib/audit/actions.ts, " +
        "onde quem acrescenta código vai olhar.\n",
    ).toEqual([]);
  });

  it("lib/audit/actions.ts não importa nada (é o que o cliente carrega)", () => {
    const fonte = leia("lib/audit/actions.ts");
    const importa = /^\s*(import|require)\b|^\s*export\b[^;]*\bfrom\b/m.exec(fonte);
    expect(
      importa?.[0] ?? null,
      "lib/audit/actions.ts passou a importar algo, e um componente \"use client\" o importa: " +
        "o que for importado aqui viaja para o bundle do browser junto com as 209 strings.\n",
    ).toBeNull();
  });

  it("o popover oferece EXATAMENTE o vocabulário, e a busca recorta a família", () => {
    render(<AuditFiltersAdmin filters={{}} onChange={() => {}} tenants={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Actions" }));

    const painel = screen.getByRole("dialog");
    const opcoes = () =>
      within(painel)
        .getAllByRole("button")
        .map((b) => b.textContent ?? "");

    // Igualdade de CONJUNTO, não contagem: acrescentar um código no array faz a
    // opção nascer aqui sem tocar em nada — é este caso que prova a derivação.
    expect(new Set(opcoes())).toEqual(new Set(AUDIT_ACTIONS));

    const busca = within(painel).getByPlaceholderText("Buscar...");
    fireEvent.change(busca, { target: { value: "followup" } });

    // Esperado calculado do vocabulário, nunca fixado num literal: fixar 15 aqui
    // faria este caso reprovar no dia em que alguém acrescentasse um follow-up —
    // castigando exatamente o comportamento que a derivação existe para permitir.
    const esperado = AUDIT_ACTIONS.filter((a) => a.includes("followup"));
    expect(esperado.length, "vocabulário sem nenhum código de follow-up — caso virou vacuidade").toBeGreaterThan(5);
    expect(new Set(opcoes())).toEqual(new Set(esperado));
  });
});
