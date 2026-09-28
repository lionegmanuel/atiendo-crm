import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { relativoEmBarraNormal } from "./helpers/caminho";

/**
 * VARREDURA: tela de servidor que consulta tabela de inquilino filtra a
 * organização ATIVA, e não só a RLS.
 *
 * ─── Por que este arquivo existe ────────────────────────────────────────────
 * O dono do produto instalou a v1.7.0 na VPS dele, abriu a Agenda e viu SEIS
 * tipos de agendamento onde há três. Clicar em metade deles devolvia
 * "Tipo de agendamento não encontrado. ID: <uuid>".
 *
 * Não havia duplicata nenhuma no banco. Ele é admin de DUAS organizações na
 * mesma instalação, e cada uma tem exatamente um de cada tipo. A Agenda
 * consultava as três tabelas sem filtrar `organization_id`, confiando só na
 * policy — e a `fn_user_org_ids()` que as policies usam devolve TODAS as
 * organizações do usuário.
 *
 * É a distinção que este gate existe para prender:
 *   RLS  = PISO   — impede que o inquilino A veja o inquilino B.
 *   `.eq("organization_id", activeOrg.orgId)` = ESCOPO — escolhe QUAL das
 *                    organizações DELE a tela está mostrando agora.
 *
 * As duas são necessárias, e o `CLAUDE.md` já mandava a segunda, literalmente:
 * "Toda query que cruza tabelas tenant-aware filtra `organization_id`
 * explicitamente". A prosa não é um gate; este arquivo é.
 *
 * ─── Por que varrer em vez de consertar as instâncias ───────────────────────
 * Eram SETE consultas, em cinco telas que não se parecem por fora (Agenda,
 * contato, lead, funil, habilidades). A oitava chega na tela seguinte e repete.
 *
 * ─── O que a lista de tabelas NÃO é ─────────────────────────────────────────
 * Ela não é escrita à mão: sai do `baseline.sql`, que é o schema que o
 * self-hoster realmente aplica. Tabela de inquilino nova entra na varredura sem
 * ninguém lembrar de editar este arquivo.
 */
const RAIZ = process.cwd();

/** Tabelas com `organization_id`, lidas do schema que o kit aplica. */
function tabelasDeInquilino(): Set<string> {
  const sql = fs.readFileSync(path.join(RAIZ, "supabase/baseline.sql"), "utf8");
  const out = new Set<string>();
  // O dump escreve `CREATE TABLE IF NOT EXISTS "public"."x" (`; o apêndice
  // idempotente escreve `create table if not exists public.x (`. As duas formas.
  const criacao = /create table\s+(?:if not exists\s+)?(?:"?public"?\.)?"?([a-z_]+)"?\s*\(([\s\S]*?)\n\);/gi;
  for (const m of sql.matchAll(criacao)) {
    if (/"?organization_id"?\s/.test(m[2] ?? "")) out.add(m[1] as string);
  }
  const alteracao =
    /alter table\s+(?:if exists\s+)?(?:"?public"?\.)?"?([a-z_]+)"?\s+add column if not exists\s+"?organization_id"?/gi;
  for (const m of sql.matchAll(alteracao)) out.add(m[1] as string);
  return out;
}

const TENANT = tabelasDeInquilino();

/**
 * `.eq("organization_id", …)` e irmãos — o FILTRO, nunca a substring.
 *
 * A primeira versão desta sonda procurava a string `organization_id` na cadeia
 * inteira e deu falso verde em `app/app/contacts/[id]/page.tsx`, que tinha
 * `.select("id, organization_id")` e filtro nenhum. Nomear a coluna no select
 * não escopa nada.
 *
 * `.is("organization_id", null)` conta de propósito: é como se pede a linha de
 * PLATAFORMA (habilidade do catálogo, que não é de organização nenhuma), e isso
 * é uma decisão de escopo escrita, não uma omissão.
 */
const FILTRO_DE_ORG = /\.(?:eq|in|is|neq|match|contains|filter)\(\s*"organization_id"/;

/**
 * Consultas que a varredura aceita sem filtro de organização — cada uma com o
 * motivo escrito. Esta lista só ENCOLHE.
 */
const JUSTIFICADAS: Record<string, string> = {
  "app/app/ai/skills/page.tsx:skill_versions":
    "Resolve por `.in('id', versionIds)`, e os ids vêm dos DOIS ponteiros logo " +
    "acima — o da org (já filtrado por organization_id) e o de plataforma " +
    "(`.is('organization_id', null)`). O conjunto já nasce escopado; filtrar a " +
    "org aqui esconderia justamente as habilidades do catálogo.",
};

function telasDeServidor(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return telasDeServidor(p);
    return e.isFile() && p.endsWith(".tsx") ? [p] : [];
  });
}

interface Consulta {
  chave: string;
  onde: string;
  tabela: string;
  temFiltro: boolean;
}

function consultas(): Consulta[] {
  const out: Consulta[] = [];
  for (const arquivo of telasDeServidor(path.join(RAIZ, "app/app"))) {
    const fonte = fs.readFileSync(arquivo, "utf8");
    const rel = relativoEmBarraNormal(RAIZ, arquivo);
    for (const m of fonte.matchAll(/\.from\("([a-z_]+)"\)/g)) {
      const tabela = m[1] as string;
      if (!TENANT.has(tabela)) continue;
      const inicio = m.index ?? 0;
      // A cadeia acaba no `;` OU na próxima `.from(` — o que vier primeiro.
      //
      // ⚠️ O `;` sozinho não basta, e isto foi MEDIDO por sabotagem: as duas
      // consultas da Agenda vivem dentro de um `Promise.all([…])`, cujo `;` só
      // aparece depois das DUAS. Removi o filtro de uma delas e o gate ficou
      // verde — ele estava contando o `.eq("organization_id", …)` da vizinha.
      // Falso verde num gate é pior que gate nenhum: ele afirma o que não mediu.
      const proximaFrom = fonte.indexOf('.from("', inicio + 1);
      const pontoEVirgula = fonte.indexOf(";", inicio);
      const candidatos = [proximaFrom, pontoEVirgula].filter((n) => n !== -1);
      const fim = candidatos.length > 0 ? Math.min(...candidatos) : fonte.length;
      const cadeia = fonte.slice(inicio, fim);
      out.push({
        chave: `${rel}:${tabela}`,
        onde: `${rel}:${fonte.slice(0, inicio).split("\n").length}`,
        tabela,
        temFiltro: FILTRO_DE_ORG.test(cadeia),
      });
    }
  }
  return out;
}

const TODAS = consultas();

describe("telas de servidor consultam a organização ATIVA", () => {
  it("a varredura enxerga schema e telas (senão ela mede o vazio)", () => {
    // Controle do instrumento. Sem isto, mudar a forma do dump, renomear
    // `app/app/` ou quebrar o extrator deixaria o gate verde por não medir nada.
    expect(TENANT.size).toBeGreaterThanOrEqual(80);
    expect(TENANT.has("calendar_event_types")).toBe(true);
    expect(TENANT.has("contacts")).toBe(true);
    expect(TENANT.has("crm_pipelines")).toBe(true);
    expect(TODAS.length).toBeGreaterThanOrEqual(20);
  });

  it("a sonda mede o FILTRO, não a coluna citada no select", () => {
    // A regressão que esta asserção prende: `.select("id, organization_id")`
    // com filtro nenhum passava pela primeira versão da varredura.
    const soNoSelect = '.from("contacts").select("id, organization_id").eq("id", id)';
    expect(FILTRO_DE_ORG.test(soNoSelect)).toBe(false);
    expect(FILTRO_DE_ORG.test(`${soNoSelect}.eq("organization_id", org)`)).toBe(true);
  });

  it("toda consulta a tabela de inquilino filtra organization_id", () => {
    const faltando = TODAS.filter((c) => !c.temFiltro && !(c.chave in JUSTIFICADAS)).map(
      (c) => `${c.onde} → ${c.tabela}`,
    );

    expect(
      faltando,
      "A RLS é PISO, não ESCOPO: `fn_user_org_ids()` devolve todas as organizações " +
        "do usuário, então quem é membro de duas vê as duas misturadas — foi assim " +
        "que a Agenda mostrou seis tipos onde havia três, e clicar no da outra org " +
        'deu "Tipo de agendamento não encontrado". Resolva a org com ' +
        "`resolveActiveOrg(user)` e aplique `.eq(\"organization_id\", activeOrg.orgId)`. " +
        "Se a consulta REALMENTE não deve ser escopada, declare em JUSTIFICADAS com o motivo.",
    ).toEqual([]);
  });

  it("nenhuma justificativa sobra depois de o código ser consertado", () => {
    // Impede que a lista de exceções vire depósito: entrada que já não casa
    // nenhuma consulta sem filtro tem de sair daqui.
    const orfas = Object.keys(JUSTIFICADAS).filter(
      (k) => !TODAS.some((c) => c.chave === k && !c.temFiltro),
    );
    expect(orfas, "Justificativa sem consulta correspondente — remova.").toEqual([]);
  });
});
