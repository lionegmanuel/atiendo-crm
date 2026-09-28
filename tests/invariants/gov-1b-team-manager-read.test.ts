import { beforeAll, describe, expect, it } from "vitest";

import {
  GOV_AGENT_A,
  GOV_MANAGER,
  GOV_ORG,
  countAs,
  seedGov,
  sql,
} from "./gov-helpers";

/**
 * Eixo 1 — RBAC: SELECT de user_organizations org-wide para manager+ (G6-06,
 * INB-14; migration 0044). Matriz spec 13 §4: team=org:read a manager. Antes a
 * policy user_orgs_select dava org-wide read só ao admin — manager caía no
 * self-read e GET /api/v1/team devolvia 1 membro. Este invariante prova a
 * correção no banco: manager lê todo o roster, agent segue self-read, cross-org
 * fica em 0. Complementa gov-1-rbac (não o edita — congelado).
 */

// Segunda org (namespace dddd-) para a prova cross-org: manager da GOV_ORG
// NÃO pode enxergar membros de outra org. Idempotente / race-safe.
const ORG_B = "dddddddd-0000-4000-8000-000000000001";
const ORG_B_MANAGER = "dddddddd-1111-4000-8000-000000000004";
const ORG_B_AGENT = "dddddddd-1111-4000-8000-000000000002";

function seedOrgB(): void {
  sql(`
    insert into auth.users (id, email) values
      ('${ORG_B_MANAGER}', 'gov-b-manager@invariant.test'),
      ('${ORG_B_AGENT}', 'gov-b-agent@invariant.test')
      on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG_B}', 'gov-inv-b', 'Gov Invariant Org B', 'Gov Inv B')
      on conflict do nothing;
    insert into public.user_organizations (user_id, organization_id, role, accepted_at) values
      ('${ORG_B_MANAGER}', '${ORG_B}', 'manager', now()),
      ('${ORG_B_AGENT}', '${ORG_B}', 'agent', now())
      on conflict do nothing;
  `);
}

beforeAll(() => {
  seedGov();
  seedOrgB();
});

describe("eixo 1 — user_organizations SELECT (G6-06)", () => {
  it("manager lê TODAS as linhas de user_organizations da própria org", () => {
    // seedGov cria 5 membros na GOV_ORG (viewer, agent_a, agent_b, manager, admin).
    const total = Number(
      sql(`select count(*) from public.user_organizations where organization_id = '${GOV_ORG}';`),
    );
    expect(total).toBeGreaterThanOrEqual(5);
    const asManager = countAs(
      GOV_MANAGER,
      `select count(*) from public.user_organizations where organization_id = '${GOV_ORG}';`,
    );
    expect(asManager).toBe(total);
  });

  it("agent segue lendo SÓ a própria linha (self-read preservado)", () => {
    const asAgent = countAs(
      GOV_AGENT_A,
      `select count(*) from public.user_organizations where organization_id = '${GOV_ORG}';`,
    );
    expect(asAgent).toBe(1);
    // Self-read: a única linha da GOV_ORG que o agent enxerga é a PRÓPRIA — não
    // vaza nenhum outro membro. (Não conto user_id=agent org-wide: os arquivos
    // de invariante paralelos reusam este UUID fixo em outras orgs, e o agent
    // self-lê a própria linha em cada uma — correto, mas fora do escopo aqui.)
    const foreign = countAs(
      GOV_AGENT_A,
      `select count(*) from public.user_organizations
         where organization_id = '${GOV_ORG}' and user_id <> '${GOV_AGENT_A}';`,
    );
    expect(foreign).toBe(0);
  });

  it("cross-org: manager da org A NÃO lê linhas da org B (0 rows)", () => {
    const crossOrg = countAs(
      GOV_MANAGER,
      `select count(*) from public.user_organizations where organization_id = '${ORG_B}';`,
    );
    expect(crossOrg).toBe(0);
    // e o manager da org B enxerga o roster da própria org B (org-wide por-org).
    const asOrgBManager = countAs(
      ORG_B_MANAGER,
      `select count(*) from public.user_organizations where organization_id = '${ORG_B}';`,
    );
    expect(asOrgBManager).toBe(2);
  });
});
