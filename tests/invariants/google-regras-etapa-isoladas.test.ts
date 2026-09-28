import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { GOV_ORG, GOV_STAGE, seedGov, sql } from "./gov-helpers";
beforeAll(seedGov);
const migration = readFileSync(
  "supabase/migrations/20260927100000_0436_conversao_google_por_etapa.sql",
  "utf8",
);
describe("regras Google por etapa", () => {
  it("browser não lê nem altera regras; service role mantém acesso", () => {
    expect(
      sql(
        "select has_table_privilege('anon','public.google_ads_conversion_rules','select'),has_table_privilege('authenticated','public.google_ads_conversion_rules','update'),has_table_privilege('service_role','public.google_ads_conversion_rules','select');",
      ),
    ).toBe("f|f|t");
  });
  it("etapa de outra organização não pode receber regra", () => {
    expect(() =>
      sql(`begin;
  insert into public.organizations(id,slug,legal_name,display_name) values ('99999999-9999-4999-8999-999999999998','google-rules-other','Outra','Outra');
  insert into public.google_ads_conversion_rules(organization_id,stage_id,event_name,label,google_action_id) values ('99999999-9999-4999-8999-999999999998','${GOV_STAGE}','Etapa:${GOV_STAGE}','Teste','42'); rollback;`),
    ).toThrow(/google_ads_conversion_rules_stage_org_fk/);
  });
  it("migração preserva carimbo legado e reaplicação não altera regra editada", () => {
    const output = sql(`begin;
  insert into public.ad_platform_connections(organization_id,platform,google_qualification_stage_id,google_qualification_action_id) values ('${GOV_ORG}','google_ads','${GOV_STAGE}','42') on conflict (organization_id,platform) do update set google_qualification_stage_id='${GOV_STAGE}',google_qualification_action_id='42';
  delete from public.google_ads_conversion_rules where organization_id='${GOV_ORG}';
  ${migration}
  select 'legacy=' || (r.configured_at=c.google_qualification_configured_at)::text from public.google_ads_conversion_rules r join public.ad_platform_connections c on c.organization_id=r.organization_id and c.platform='google_ads' where r.organization_id='${GOV_ORG}' and r.event_name='QualifiedLead';
  update public.google_ads_conversion_rules set label='Editada',google_action_id='99' where organization_id='${GOV_ORG}' and stage_id='${GOV_STAGE}';
  ${migration}
  select label,google_action_id,event_name from public.google_ads_conversion_rules where organization_id='${GOV_ORG}' and stage_id='${GOV_STAGE}'; rollback;`);
    expect(output).toContain("legacy=true");
    expect(output).toContain("Editada|99|QualifiedLead");
  });
  it("carimbo explícito só é aceito ao criar; edição comum não retroage", () => {
    expect(
      sql(`begin;
  delete from public.google_ads_conversion_rules where organization_id='${GOV_ORG}';
  insert into public.google_ads_conversion_rules(organization_id,stage_id,event_name,label,google_action_id,configured_at) values ('${GOV_ORG}','${GOV_STAGE}','QualifiedLead','Teste','42','2020-01-01');
  update public.google_ads_conversion_rules set configured_at='1999-01-01',label='Nome' where organization_id='${GOV_ORG}' and stage_id='${GOV_STAGE}';
  select configured_at='2020-01-01' from public.google_ads_conversion_rules where organization_id='${GOV_ORG}' and stage_id='${GOV_STAGE}'; rollback;`),
    ).toContain("\nt\n");
  });
});
