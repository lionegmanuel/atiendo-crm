import { describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

/**
 * O que a migration 0078 PROMETE, cobrado no banco que o clone recebe.
 *
 * POR QUE ISTO EXISTE E NÃO BASTA "a migration passou": eu apliquei a 0078 no
 * banco de desenvolvimento, rodei `npm run test:db` e vi 338 verdes — e 338 é
 * exatamente o número que já me enganou uma vez, quando um script abortou em
 * silêncio e o gate rodou sobre o baseline ANTIGO. Verde de suíte grande não
 * fala sobre a mudança de hoje; ele fala sobre tudo menos ela.
 *
 * O que este arquivo cobra é o par que a doutrina do repo separa: a migration é
 * o CAMINHO (para quem já tem banco), o baseline é o DESTINO (para quem clona).
 * Uma mudança que existe só no primeiro não chega ao self-hoster, e nada
 * reclama — o clone simplesmente não tem a tabela, e descobre no primeiro erro
 * de runtime.
 *
 * ⚠️ A publicação de realtime é a asserção menos óbvia e a mais fácil de perder:
 * `crm_lead_scores` fica FORA dela de propósito e esta fica DENTRO, então quem
 * copiar o bloco da 0075 sem ler o cabeçalho da 0078 inverte o sinal e o card
 * para de reagir sem reload — falha que não aparece em teste de API nenhum.
 */
describe("0078 · estado de risco chega ao clone", () => {
  it("a tabela existe no baseline, não só na migration", () => {
    const n = sql(
      `select count(*) from information_schema.tables
        where table_schema = 'public' and table_name = 'crm_lead_risk_states'`,
    );
    expect(n).toBe("1");
  });

  it("as três travas de coerência estão lá, pelo nome", () => {
    const nomes = sql(
      `select conname from pg_constraint
        where conrelid = 'public.crm_lead_risk_states'::regclass and contype = 'c'`,
    ).split("\n");
    // Nomeadas de propósito: "rejeitou" sem saber POR QUÊ passaria igual se a
    // linha caísse por FK, por NOT NULL ou por RLS.
    expect(nomes).toContain("crm_lead_risk_states_bucket_check");
    expect(nomes).toContain("crm_lead_risk_states_since_no_passado");
    expect(nomes).toContain("crm_lead_risk_states_cold_hours_positivo");
  });

  it("RLS ligada e a policy de tenant existe", () => {
    expect(
      sql(`select relrowsecurity from pg_class where relname = 'crm_lead_risk_states'`),
    ).toBe("t");
    expect(
      sql(`select count(*) from pg_policies
            where tablename = 'crm_lead_risk_states'
              and policyname = 'tenant_isolation_crm_lead_risk_states_all'`),
    ).toBe("1");
  });

  it("DENTRO da publicação de realtime — e o score continua FORA", () => {
    // As duas asserções juntas de propósito: a segunda é o que impede alguém de
    // "uniformizar" as duas tabelas achando que corrigiu uma inconsistência.
    // Elas divergem porque significam coisas diferentes — telemetria x estado.
    const publicadas = sql(
      `select tablename from pg_publication_tables
        where pubname = 'supabase_realtime'
          and tablename in ('crm_lead_risk_states', 'crm_lead_scores')`,
    ).split("\n").filter(Boolean);
    expect(publicadas).toContain("crm_lead_risk_states");
    expect(publicadas).not.toContain("crm_lead_scores");
  });

  it("o índice que o radar usa para listar por org existe", () => {
    expect(
      sql(`select count(*) from pg_indexes
            where tablename = 'crm_lead_risk_states'
              and indexname = 'idx_crm_lead_risk_states_org_bucket'`),
    ).toBe("1");
  });
});
