import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { recalculaScoreDoLead } from "../../lib/leads/score-writer";
import { GOV_ORG, GOV_PIPELINE, GOV_STAGE, seedGov, sql } from "./gov-helpers";

/**
 * O ESCRITOR REAL DO SCORE SATISFAZ A CONSTRAINT — provado chamando o emissor,
 * não montando o INSERT à mão.
 *
 * ═══ Por que este invariante existe (CRMV5W) ═══
 *
 * A wave 5 pôs no banco `crm_lead_scores_needs_reason`, que exige — quando há
 * `ai_probability` — razão não vazia, `factors` não vazio **e pelo menos um
 * fator com `ancora`** (`supabase/baseline.sql`, a constraint). Ela foi provada
 * com `INSERT` à mão: o banco recusa uma linha sem evidência, e isso é verdade.
 *
 * O que ficou sem prova é o outro lado, e é o que o QAVivo apontou na revisão
 * fria: **o escritor de produção sempre produz o que a constraint exige?** Se
 * não, o sintoma NÃO é "score sem evidência" — é `23514` estourando dentro do
 * worker e o lead ficando **sem score nenhum**, com a tela mostrando vazio e a
 * causa só no log. Constraint boa transforma corrupção silenciosa em falha
 * ruidosa; ela não faz o produtor estar certo.
 *
 * ═══ O caso que este teste prende ═══
 *
 * Um negócio cujo conteúdo é SÓ qualificação (BANT), sem compromisso nem
 * objeção. Ele passa nas duas recusas de `calculaScore` — tem dois sinais
 * substantivos e tem checkpoint —, então o cálculo devolve score. Mas os
 * fatores com âncora são exatamente os de compromisso e objeção
 * (`lib/leads/score-formula.ts`); o de qualificação e o de recência nascem sem
 * âncora, e o de recência **deliberadamente** ("ela não é um ponto no tempo da
 * conversa, é a AUSÊNCIA de pontos").
 *
 * Medido na fórmula pura antes de escrever isto: `score: 60`, dois fatores,
 * **nenhum com âncora**. É a linha que a constraint recusa.
 *
 * ═══ Por que pelo Pool e não por `sql()` ═══
 *
 * `sql()` roda SQL. Ele provaria de novo o que a wave 5 já provou — que o banco
 * recusa. A pergunta aqui é sobre o PRODUTOR, então o teste chama
 * `recalculaScoreDoLead`, a mesma função que `lib/agent-engine/agent/inbound-turn.ts`
 * chama em produção. Molde de `escalacao-ciclo-humano.test.ts`, inclusive o
 * controle positivo do pool.
 */

/** O container publica em 127.0.0.1:${TEST_DB_PORT:-54329} (scripts/test-db.sh). */
const PORTA = process.env.TEST_DB_PORT ?? "54329";
const pool = new pg.Pool({
  connectionString: `postgres://postgres:postgres@127.0.0.1:${PORTA}/postgres`,
  max: 2,
});

const CONTATO_SO_BANT = "cccccccc-3333-4000-8000-0000000005a1";
const LEAD_SO_BANT = "cccccccc-6666-4000-8000-0000000005a1";
const CONTATO_COM_LASTRO = "cccccccc-3333-4000-8000-0000000005a2";
const LEAD_COM_LASTRO = "cccccccc-6666-4000-8000-0000000005a2";

beforeAll(async () => {
  seedGov();
  sql(`
    insert into public.contacts (id, organization_id, display_name) values
      ('${CONTATO_SO_BANT}', '${GOV_ORG}', 'So Qualificacao'),
      ('${CONTATO_COM_LASTRO}', '${GOV_ORG}', 'Com Compromisso')
      on conflict do nothing;

    insert into public.crm_leads (id, organization_id, pipeline_id, stage_id, contact_id, title, status) values
      ('${LEAD_SO_BANT}', '${GOV_ORG}', '${GOV_PIPELINE}', '${GOV_STAGE}', '${CONTATO_SO_BANT}', 'So qualificacao', 'open'),
      ('${LEAD_COM_LASTRO}', '${GOV_ORG}', '${GOV_PIPELINE}', '${GOV_STAGE}', '${CONTATO_COM_LASTRO}', 'Com compromisso', 'open')
      on conflict do nothing;

    -- QUALIFICAÇÃO nos dois: quatro campos preenchidos, acima do mínimo de dois
    -- sinais substantivos que a fórmula exige.
    insert into public.lead_state (organization_id, contact_id, qualification) values
      ('${GOV_ORG}', '${CONTATO_SO_BANT}', '{"budget":"10k","authority":"dono","need":"sim","timeline":"mes"}'::jsonb),
      ('${GOV_ORG}', '${CONTATO_COM_LASTRO}', '{"budget":"10k","authority":"dono","need":"sim","timeline":"mes"}'::jsonb)
      on conflict (organization_id, contact_id) do update set qualification = excluded.qualification;

    -- CHECKPOINT nos dois. As colunas commitments/objections sao JSONB
    -- (baseline linha 6661, comentadas la como string[]) e nao array Postgres:
    -- semear com chaves vira "invalid input syntax for type json". Sem o
    -- checkpoint a formula recusa
    -- por 'sem_lastro_citavel' e o caso não chegaria a existir. A diferença entre os dois leads é APENAS o
    -- conteúdo do checkpoint.
    -- A coluna seq NAO entra: e identity GENERATED ALWAYS (baseline linha 6657),
    -- e inserir valor nela morre com "cannot insert a non-DEFAULT value".
    -- Idempotencia por "where not exists" em vez de "on conflict", porque nao ha
    -- unique por contato aqui — o writer le o checkpoint de maior seq.
    insert into public.lead_checkpoints (organization_id, contact_id, commitments, objections)
    select '${GOV_ORG}', '${CONTATO_SO_BANT}', '[]'::jsonb, '[]'::jsonb
     where not exists (select 1 from public.lead_checkpoints
                        where organization_id = '${GOV_ORG}' and contact_id = '${CONTATO_SO_BANT}');
    insert into public.lead_checkpoints (organization_id, contact_id, commitments, objections)
    select '${GOV_ORG}', '${CONTATO_COM_LASTRO}', '["ligar terca","mandar proposta"]'::jsonb, '[]'::jsonb
     where not exists (select 1 from public.lead_checkpoints
                        where organization_id = '${GOV_ORG}' and contact_id = '${CONTATO_COM_LASTRO}');
  `);

  // Controle positivo do instrumento: um pool que não conecta faria tudo
  // estourar, mas um pool no banco ERRADO passaria com contagens zeradas e
  // pareceria medição.
  const { rows } = await pool.query<{ n: string }>(
    `select count(*)::text as n from public.crm_leads where id = $1`,
    [LEAD_SO_BANT],
  );
  if (rows[0]?.n !== "1") {
    throw new Error(
      `o pool não está no mesmo banco que o helper psql (lead de seed não encontrado na porta ${PORTA})`,
    );
  }
});

afterAll(async () => {
  await pool.end();
});

async function scoreGravado(leadId: string) {
  const { rows } = await pool.query<{
    ai_probability: number | null;
    ai_probability_reason: string | null;
    tem_ancora: boolean;
  }>(
    `select ai_probability, ai_probability_reason,
            coalesce(ai_probability_evidence @? '$.factors[*].ancora', false) as tem_ancora
       from crm_lead_scores where lead_id = $1`,
    [leadId],
  );
  return rows[0] ?? null;
}

describe("o escritor real do score satisfaz a constraint (CRMV5W)", () => {
  it("CONTROLE: com compromisso, o escritor grava e a linha entra", async () => {
    // Sem este caso, o teste abaixo não distinguiria "o escritor está errado"
    // de "o cenário nunca chega a gravar nada".
    const r = await recalculaScoreDoLead(pool, GOV_ORG, LEAD_COM_LASTRO);
    expect(r.gravou, `o escritor recusou o caso de controle: ${r.motivo ?? "sem motivo"}`).toBe(
      true,
    );
    const linha = await scoreGravado(LEAD_COM_LASTRO);
    expect(linha?.ai_probability, "score não entrou no controle").not.toBeNull();
    expect(linha?.tem_ancora, "o controle gravou sem âncora — o cenário está errado").toBe(true);
  });

  it("só qualificação: o escritor NÃO pode estourar 23514 nem deixar o lead sem score", async () => {
    // O desfecho aceitável é um dos dois, e os dois são silenciosos para o
    // worker: ou grava com evidência completa, ou RECUSA com motivo legível
    // (`semSinal`), como a própria fórmula promete no cabeçalho — "melhor
    // recusar aqui, com motivo legível, do que descobrir no INSERT".
    //
    // O que NÃO é aceitável é a terceira via: tentar gravar e o banco recusar.
    let erro: unknown = null;
    const r = await recalculaScoreDoLead(pool, GOV_ORG, LEAD_SO_BANT).catch((e) => {
      erro = e;
      return null;
    });

    expect(
      (erro as { code?: string } | null)?.code,
      "o escritor tentou gravar score sem âncora e o BANCO recusou (23514): o lead fica sem " +
        "score nenhum, a tela mostra vazio e a causa só aparece no log do worker",
    ).not.toBe("23514");
    expect(erro, `o escritor estourou: ${String(erro)}`).toBeNull();

    const linha = await scoreGravado(LEAD_SO_BANT);
    if (r?.gravou) {
      expect(
        linha?.tem_ancora,
        "gravou score sem nenhum fator com âncora — a constraint deveria ter recusado, " +
          "e se não recusou é a constraint que está frouxa",
      ).toBe(true);
    } else {
      // Recusa é desfecho legítimo, desde que tenha MOTIVO — recusa muda sem
      // razão é indistinguível de falha engolida.
      expect(r?.motivo, "o escritor recusou sem dizer por quê").toBeTruthy();
    }
  });
});
