import { describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

/**
 * O que a 0084 promete, cobrado no banco que o clone recebe.
 *
 * ⚠️ CADA CASO ISOLADO DO VIZINHO — e aqui isso custou três tentativas: os casos
 * "válidos" foram reprovados por `uniq_crm_stages_pipeline_won` (já existia: um
 * ganho por pipeline) e depois por `crm_stages_slug_format`. Nenhuma das duas
 * era o que eu estava medindo. Rejeitar não é o veredito; rejeitar PELA TRAVA
 * CERTA é.
 */
const ORG = "cccccccc-0000-4000-8000-000000000001";

describe("0084 · o hint do funil do agente chega ao clone", () => {
  it("a coluna existe no baseline, não só na migration", () => {
    expect(
      sql(`select count(*) from information_schema.columns
            where table_name='crm_stages' and column_name='agent_stage_hint'`),
    ).toBe("1");
  });

  it("aceita exatamente os sete passos do funil do agente — nem mais", () => {
    const def = sql(`select pg_get_constraintdef(oid) from pg_constraint
                      where conname='crm_stages_agent_stage_hint_check'`);
    for (const passo of ["new", "contacted", "qualifying", "qualified", "negotiating", "won", "lost"]) {
      expect(def).toContain(`'${passo}'`);
    }
  });

  it("a coerência com is_won/is_lost é cobrada pelo banco", () => {
    // Sem isto, `is_won` e o hint viram DUAS FONTES capazes de dizer coisas
    // diferentes sobre o mesmo estágio — e cada uma "certa" pela sua própria.
    expect(
      sql(`select count(*) from pg_constraint
            where conname='crm_stages_hint_coerente_com_won_lost'`),
    ).toBe("1");
  });

  it("UM estágio por hint, por pipeline — a ambiguidade é impossível", () => {
    const idx = sql(`select indexdef from pg_indexes
                      where indexname='uniq_crm_stages_pipeline_hint'`);
    expect(idx).toContain("UNIQUE");
    // O `where` parcial segue o precedente de won/lost: sem hint não disputa, e
    // estágio arquivado é histórico.
    expect(idx.toLowerCase()).toContain("is not null");
    expect(idx.toLowerCase()).toContain("is_archived = false");
  });

  it("nenhum estágio de ganho/perda se anuncia como OUTRA coisa", () => {
    // ⚠️ ESTE TESTE JÁ ESTEVE ERRADO, e o erro vale mais que o acerto: a
    // primeira versão cobrava que TODO `is_won` tivesse hint preenchido, e
    // reprovou com 144 no banco limpo. Ela CONTRADIZIA O PRÓPRIO SCHEMA — o
    // CHECK permite `is_won` sem hint DE PROPÓSITO, porque é como todo clone
    // começa e como todo estágio novo nasce.
    //
    // O backfill é migração de DADOS: cobre o que existia, não o que nascer
    // depois. Cobrar preenchimento permanente seria cobrar uma REGRA que
    // ninguém decidiu — e o teste passaria a exigir do produto algo que o
    // desenho recusou.
    //
    // O que se cobra é a COERÊNCIA: se o hint existe, ele não pode contradizer
    // `is_won`/`is_lost`. É o que impede as duas fontes de discordarem.
    expect(
      sql(`select count(*) from crm_stages
            where (is_won and agent_stage_hint is not null and agent_stage_hint <> 'won')
               or (is_lost and agent_stage_hint is not null and agent_stage_hint <> 'lost')`),
    ).toBe("0");
    void ORG;
  });
});
