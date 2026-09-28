/**
 * O ORÇAMENTO DO MÊS NÃO PODE CRESCER PORQUE ALGUÉM ATUALIZOU O SISTEMA.
 *
 * `fn_update_budget_consumption` é um trigger AFTER INSERT que soma
 * `NEW.cost_cents` a `ai_budgets.current_month_consumed_cents` **sem olhar a
 * data da linha** — ele existe para contar gasto NOVO, e para isso "agora" é
 * sempre o mês corrente. A 0095 pendurou esse trigger em `llm_calls`. A 0130
 * fez o backfill de `ai_invocations` para dentro de `llm_calls`.
 *
 * O backfill é um INSERT. Cada linha migrada disparou o trigger — inclusive as
 * de meses passados —, e o recomputo da 0095 somava as duas tabelas inteiras,
 * contando a mesma linha nas duas pontas. Medido antes do conserto, com a
 * fixture deste arquivo: gasto real do mês 1600, contador em 3000 depois de um
 * `update.sh` e estabilizando em 2600. Numa organização sem gasto no mês, o
 * contador saltava de 0 para o histórico inteiro.
 *
 * Isso não era estatística: `lib/ai/dispatcher/budget.ts` lia esse número para
 * decidir throttle, e era ele que a tela mostrava. Uma instalação podia ver a IA
 * parar sem nenhuma chamada nova ter sido feita.
 *
 * ATUALIZAÇÃO (0159): aquele leitor foi APAGADO, e a decisão de parar passou a
 * usar `public.fn_gasto_de_ia_do_mes` — a régua única, que soma `llm_calls` do
 * mês corrente e não depende deste contador. A coluna materializada segue viva
 * (o dashboard de plataforma a lê), então a propriedade abaixo continua valendo
 * a pena: um número errado na tela ainda é um número errado na tela.
 *
 * ## O que este arquivo mede, e por que assim
 *
 * Os dois blocos são EXTRAÍDOS do `supabase/baseline.sql` e executados como
 * texto — não reimplementados aqui. Reimplementar mediria a minha cópia, e a
 * cópia continuaria certa com o baseline sabotado (é o modo mais comum de um
 * teste de migration ficar decorativo).
 *
 * A propriedade fixada é a que ninguém media: depois de aplicar backfill +
 * recomputo, `current_month_consumed_cents` é EXATAMENTE o gasto real do mês
 * corrente — e re-aplicar não muda o número.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "./psql-transporte";

const BASELINE = join(process.cwd(), "supabase", "baseline.sql");

const ORG = "d0000000-0000-4000-8000-0000000000d0";
const AGENTE = "d1000000-0000-4000-8000-0000000000d1";

/**
 * Recorta um bloco do baseline entre o cabeçalho `-- ---- <marca>` e o próximo
 * cabeçalho `-- ---- `. Devolver `null` quando a marca sumiu é deliberado: sem
 * isso, um bloco renomeado viraria string vazia, o psql aceitaria e o teste
 * passaria medindo nada.
 */
function blocoDoBaseline(marca: string): string | null {
  const texto = readFileSync(BASELINE, "utf8");
  const inicio = texto.indexOf(marca);
  if (inicio === -1) return null;
  const resto = texto.slice(inicio + marca.length);
  const fim = resto.indexOf("\n-- ---- ");
  return resto.slice(0, fim === -1 ? undefined : fim);
}

const BACKFILL = blocoDoBaseline("-- ---- uma tabela de telemetria de IA, não duas (migration 0130) ----");
const RECOMPUTO = blocoDoBaseline(
  "-- ---- o orçamento do mês não conta o backfill como gasto novo (migration 0140) ----",
);

/** Gasto REAL do mês corrente: 6 linhas legadas + 6 novas, 100 centavos cada. */
const GASTO_REAL_DO_MES = 1200;

function semear(): void {
  sql(`
    delete from public.llm_calls where organization_id = '${ORG}';
    delete from public.ai_invocations where organization_id = '${ORG}';
    delete from public.ai_budgets where organization_id = '${ORG}';
    delete from public.ai_agents where id = '${AGENTE}';
    delete from public.organizations where id = '${ORG}';

    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG}', 'inv-orcamento', 'Invariante Orcamento LTDA', 'Invariante Orcamento');
    insert into public.ai_agents (id, organization_id, name, system_prompt)
      values ('${AGENTE}', '${ORG}', 'agente do invariante', 'prompt do invariante');

    -- 6 do MÊS CORRENTE (600) + 4 de TRÊS MESES ATRÁS (400, que não entram na
    -- conta do mês e eram somadas mesmo assim).
    insert into public.ai_invocations
      (organization_id, agent_id, invocation_kind, model, prompt_tokens, completion_tokens, latency_ms, cost_cents, created_at)
    select '${ORG}'::uuid, '${AGENTE}'::uuid, 'bot_respond', 'claude-legado', 10, 10, 100, 100, date_trunc('month', now()) + interval '1 hour'
      from generate_series(1, 6)
    union all
    select '${ORG}'::uuid, '${AGENTE}'::uuid, 'bot_respond', 'claude-legado', 10, 10, 100, 100, date_trunc('month', now()) - interval '3 months'
      from generate_series(1, 4);

    -- 6 do agent-engine, mês corrente (600).
    insert into public.llm_calls
      (organization_id, purpose, provider, model, input_tokens, output_tokens, cost_cents, latency_ms, created_at)
    select '${ORG}'::uuid, 'agent_turn', 'anthropic', 'claude-novo', 10, 10, 100, 100, date_trunc('month', now()) + interval '1 hour'
      from generate_series(1, 6);

    -- O contador começa do zero, como numa instalação que acabou de recomputar.
    insert into public.ai_budgets (organization_id, current_month_consumed_cents)
      values ('${ORG}', 0)
      on conflict (organization_id) do update set current_month_consumed_cents = 0;
  `);
}

function consumo(): number {
  return Number(
    sql(`select current_month_consumed_cents from public.ai_budgets where organization_id = '${ORG}';`),
  );
}

/** Uma passada do `update.sh`: os dois blocos do baseline, na ordem do arquivo. */
function aplicarUpdate(): void {
  sql(`${BACKFILL}\n${RECOMPUTO}`);
}

describe("update.sh não inventa gasto de IA", () => {
  beforeAll(() => {
    expect(
      BACKFILL,
      "não achei o bloco do backfill da 0130 no baseline.sql — o instrumento perdeu o alvo, não é aprovação",
    ).not.toBeNull();
    expect(
      RECOMPUTO,
      "não achei o bloco do recomputo da 0140 no baseline.sql — sem ele o contador infla a cada update.sh",
    ).not.toBeNull();
    semear();
  });

  it("o cenário está montado como o teste supõe (controle positivo)", () => {
    // Sem isto, uma fixture que não semeou nada faria as asserções abaixo
    // passarem com 0 == 0 — verde por não medir.
    expect(Number(sql(`select count(*) from public.ai_invocations where organization_id = '${ORG}';`))).toBe(10);
    expect(Number(sql(`select count(*) from public.llm_calls where organization_id = '${ORG}';`))).toBe(6);
    expect(consumo()).toBe(0);
  });

  it("depois de um update.sh, o consumo do mês é o gasto REAL", () => {
    aplicarUpdate();
    expect(
      consumo(),
      "o contador do mês saiu do gasto real — foi assim que uma organização que não gastou nada a mais " +
        "viu o agente pausar no dia da atualização",
    ).toBe(GASTO_REAL_DO_MES);
  });

  it("as linhas de meses passados não entram na conta do mês", () => {
    // As 4 linhas de três meses atrás existem, foram migradas, e o consumo
    // continua sendo só o do mês. É a asserção que separa "não conta duas
    // vezes" de "não conta o que não é do mês".
    expect(
      Number(sql(`select count(*) from public.llm_calls
                   where organization_id = '${ORG}' and legacy_invocation_id is not null;`)),
    ).toBe(10);
    expect(consumo()).toBe(GASTO_REAL_DO_MES);
  });

  it("re-aplicar o baseline não muda o número", () => {
    aplicarUpdate();
    const depoisDaSegunda = consumo();
    aplicarUpdate();
    expect(consumo()).toBe(depoisDaSegunda);
    expect(
      consumo(),
      "o número estabilizou, mas no valor errado — estabilidade sozinha não é correção",
    ).toBe(GASTO_REAL_DO_MES);
  });

  it("gasto NOVO depois do update continua sendo contado", () => {
    // A recíproca. Um recomputo que zerasse tudo também passaria nas asserções
    // acima e desligaria o enforcement de orçamento em silêncio.
    sql(`insert into public.llm_calls
           (organization_id, purpose, provider, model, input_tokens, output_tokens, cost_cents, latency_ms)
         values ('${ORG}', 'agent_turn', 'anthropic', 'claude-novo', 10, 10, 250, 100);`);
    expect(consumo()).toBe(GASTO_REAL_DO_MES + 250);
  });
});
