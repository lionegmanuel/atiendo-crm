import { beforeAll, describe, expect, it } from "vitest";
import { GOV_ORG, seedGov, sql } from "./gov-helpers";
beforeAll(seedGov);
const link = "12345678-1234-4123-8123-123456789012";
const other = "99999999-9999-4999-8999-999999999997";
const insert = `insert into public.ad_tracking_links(id,organization_id,name,whatsapp_e164,message_template,use_case) values ('${link}','${GOV_ORG}','Teste','+5511999999999','Olá','site');`;
describe("links rastreáveis: banco", () => {
  it("anon/authenticated não alcançam configuração ou métricas, service_role pode ler", () => {
    expect(
      sql(
        `select has_table_privilege('anon','public.ad_tracking_links','select'),has_table_privilege('authenticated','public.ad_tracking_links','update'),has_function_privilege('authenticated','public.fn_metricas_links_rastreaveis(uuid)','execute'),has_function_privilege('anon','public.fn_metricas_links_rastreaveis(uuid)','execute'),has_function_privilege('service_role','public.fn_metricas_links_rastreaveis(uuid)','execute');`,
      ),
    ).toBe("f|f|f|f|t");
  });
  it.each(["google_ads_click_refs", "meta_ads_click_refs"])(
    "FK composta recusa link de outra organização em %s",
    (table) => {
      expect(() =>
        sql(`begin; ${insert}
  insert into public.organizations(id,slug,legal_name,display_name) values ('${other}','track-isolation','Outra','Outra');
  insert into public.${table}(organization_id,token,tracking_link_id${table.startsWith("google") ? ",gclid" : ",utm"}) values ('${other}','2ABCDE','${link}'${table.startsWith("google") ? ",'teste'" : ',\'{"utm_source":"site"}\''}); rollback;`),
      ).toThrow(/tracking_link_org_fk/);
    },
  );
  it("métricas não vazam cliques de outra organização e contam ambas as capturas", () => {
    expect(
      sql(`begin; ${insert}
  insert into public.google_ads_click_refs(organization_id,token,tracking_link_id,gclid) values ('${GOV_ORG}','2ABCDE','${link}','teste');
  insert into public.meta_ads_click_refs(organization_id,token,tracking_link_id,utm) values ('${GOV_ORG}','3ABCDE','${link}','{"utm_source":"site"}');
  select clicks,contacts,leads from public.fn_metricas_links_rastreaveis('${GOV_ORG}') where link_id='${link}';
  select count(*) from public.fn_metricas_links_rastreaveis('${other}'); rollback;`),
    ).toContain("2|0|0\n0");
  });
});
