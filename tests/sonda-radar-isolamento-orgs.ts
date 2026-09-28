/**
 * PROVA PELO CÓDIGO: `carregaRadarDeRisco` não vaza demanda entre inquilinos, e
 * só lista o que o invariante 4 define.
 *
 * ## Por que esta sonda existe fora do `test:db`
 *
 * `scripts/test-db.sh` sobe **apenas Postgres** — não há PostgREST, e
 * `carregaRadarDeRisco` fala por supabase-js. Um invariante lá só conseguiria
 * reescrever o predicado em SQL, o que é testar o teste. A defesa real aqui é o
 * `.eq("organization_id", …)` no TypeScript, porque o radar usa **service
 * role**, que bypassa RLS: se o filtro cair, o banco não impede nada.
 *
 * Por isso a prova chama a FUNÇÃO, contra o Supabase local, com dois inquilinos
 * de verdade. O teste unitário irmão (`tests/unit/mcp-retencao-tools.test.ts`)
 * guarda que o filtro é EMITIDO; esta guarda que ele SEPARA.
 *
 * Os quatro casos, cada um protegendo uma decisão:
 *   A1  aberta, sem próximo passo, org A  → aparece   (controle positivo: sem
 *                                                      ele, tudo-vazio passaria)
 *   A2  aberta, COM próximo passo         → não aparece
 *   A3  FECHADA, sem próximo passo        → não aparece
 *   B1  aberta, sem próximo passo, org B  → não aparece em A  ← o vazamento
 *
 * Uso: `npx tsx tests/sonda-radar-isolamento-orgs.ts`
 * Requer Supabase local de pé. Semeia e limpa o que semeou.
 */
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

import { carregaRadarDeRisco } from "@/lib/leads/radar-de-risco";

const URL = "http://127.0.0.1:54321";
const SERVICE =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const ORG_A = "50d0a111-0000-4000-8000-00000000000a";
const ORG_B = "50d0a222-0000-4000-8000-00000000000b";
const CT_A = "50d0c111-0000-4000-8000-00000000000a";
const CT_B = "50d0c222-0000-4000-8000-00000000000b";

function psql(script: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_deskcomm-crm", "psql", "-U", "postgres", "-d", "postgres", "-tA"],
    { input: script, encoding: "utf8" },
  );
}

const limpar = `
  delete from public.demandas where organization_id in ('${ORG_A}','${ORG_B}');
  delete from public.contacts  where id in ('${CT_A}','${CT_B}');
  delete from public.organizations where id in ('${ORG_A}','${ORG_B}');
`;

function semear(): void {
  psql(`
    ${limpar}
    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'sonda-radar-a', 'Sonda Radar A', 'Sonda Radar A'),
      ('${ORG_B}', 'sonda-radar-b', 'Sonda Radar B', 'Sonda Radar B');
    insert into public.contacts (id, organization_id, display_name) values
      ('${CT_A}', '${ORG_A}', 'Contato A'),
      ('${CT_B}', '${ORG_B}', 'Contato B');

    -- A1: o caso que DEVE aparecer.
    insert into public.demandas (organization_id, contact_id, origem, estado, aberta_em)
      values ('${ORG_A}', '${CT_A}', 'inbound', 'aberta', now() - interval '10 hours');
    -- A2: aberta, mas alguém já marcou o que vem — não é vazamento, é trabalho em dia.
    insert into public.demandas (organization_id, contact_id, origem, estado, aberta_em, proximo_passo, proximo_passo_em)
      values ('${ORG_A}', '${CT_A}', 'inbound', 'aberta', now() - interval '10 hours',
              'ligar amanhã', now() + interval '1 day');
    -- A3: sem próximo passo, mas ACABOU. Cobrar o que já terminou é o outro modo
    -- de errar, e enche a lista de ruído até ninguém mais olhar.
    insert into public.demandas (organization_id, contact_id, origem, estado, aberta_em, desfecho, fechada_em)
      values ('${ORG_A}', '${CT_A}', 'inbound', 'resolvida', now() - interval '20 hours',
              'resolvida', now() - interval '1 hour');
    -- B1: o vizinho. Aberta há MENOS tempo que A1 de propósito: a ordenação é
    -- \`aberta_em asc\`, então sob vazamento a lista de A continua começando por
    -- A1 e o caso do nome não vira moeda ao ar. Sabotagem cujo resultado depende
    -- de empate de timestamp não mede nada.
    insert into public.demandas (organization_id, contact_id, origem, estado, aberta_em)
      values ('${ORG_B}', '${CT_B}', 'inbound', 'aberta', now() - interval '5 hours');
  `);
}

async function main(): Promise<void> {
  semear();
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

  const a = await carregaRadarDeRisco(admin, { organizationId: ORG_A });
  const b = await carregaRadarDeRisco(admin, { organizationId: ORG_B });

  const idsDeA = new Set(a.sem_proximo_passo.map((d) => d.contact_id));
  const idsDeB = new Set(b.sem_proximo_passo.map((d) => d.contact_id));

  const casos: Array<[string, boolean, string]> = [
    ["A1 aberta sem próximo passo aparece em A", a.total_sem_proximo_passo === 1, `total=${a.total_sem_proximo_passo}`],
    // Pertinência (`has`) não distingue: num conjunto que vazou o mundo inteiro
    // ela continua verdadeira. Medido — sob vazamento este caso passava. A
    // asserção certa é de IGUALDADE do conjunto.
    [
      "a lista de A é EXATAMENTE {A1}",
      idsDeA.size === 1 && idsDeA.has(CT_A),
      [...idsDeA].join(",") || "vazio",
    ],
    ["A2 com próximo passo NÃO aparece", a.total_sem_proximo_passo === 1, "senão seriam 2"],
    ["A3 fechada NÃO aparece", a.total_sem_proximo_passo === 1, "senão seriam 2"],
    ["B1 NÃO vaza para A", !idsDeA.has(CT_B), [...idsDeA].join(",")],
    ["e a recíproca: A não vaza para B", !idsDeB.has(CT_A) && b.total_sem_proximo_passo === 1, `B total=${b.total_sem_proximo_passo}`],
    ["nome do contato veio do join", a.sem_proximo_passo[0]?.contact_name === "Contato A", String(a.sem_proximo_passo[0]?.contact_name)],
    ["horas_aberta calculado", (a.sem_proximo_passo[0]?.horas_aberta ?? -1) >= 9, String(a.sem_proximo_passo[0]?.horas_aberta)],
  ];

  let falhas = 0;
  for (const [nome, ok, detalhe] of casos) {
    console.log(`${ok ? "  ok  " : "FALHA "} ${nome}  (${detalhe})`);
    if (!ok) falhas += 1;
  }

  psql(limpar);
  console.log(falhas === 0 ? "\nTODOS OS CASOS PASSARAM" : `\n${falhas} CASO(S) FALHARAM`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => {
  psql(limpar);
  console.error(e);
  process.exit(1);
});
