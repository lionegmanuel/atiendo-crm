/**
 * DESLIGAR UMA CAMADA DE SEGURANÇA É AÇÃO DE ADMIN — NO BANCO, NÃO NA ROTA.
 *
 * ## O que se pagava
 *
 * `org_guardrail_layers` nasceu com UMA policy `for all` org-flat, e o único gate de
 * papel vivia em `app/api/v1/ai/guardrail-layers/route.ts` (`admin` no PUT). Rota não
 * é fronteira: o `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO authenticated`
 * do baseline vale para toda tabela criada depois dele, então com a anon key — que vai
 * para o browser — e o próprio JWT, qualquer membro escrevia direto pelo PostgREST.
 *
 * Medido antes do conserto, num pg17 do zero com o baseline aplicado: um `viewer`
 * desligou `jailbreak` e gravou `promessa_semantica=false` (UPDATE 1 + INSERT 1). Sem
 * passar pela rota e sem linha de auditoria, porque o `audit()` vive na rota.
 *
 * ## Por que este arquivo, e não o de schema
 *
 * `camadas-de-seguranca-schema.test.ts` conecta como `postgres`, que é
 * `rolbypassrls = t`. Ele prova CATÁLOGO (a tabela existe, a RLS está ligada, a policy
 * tem tal nome) e o WHERE da aplicação — nunca a policy em vigor. A distinção não é
 * teórica: com a policy sabotada para `... or true`, aquele arquivo e o
 * `rls-isolation` seguiam verdes, 31 de 31, num banco em que o vizinho lia e escrevia.
 *
 * Aqui se roda como `authenticated` com o JWT de cada papel — o mesmo seam que
 * `gov-1-rbac-config-write.test.ts` usa para provar que `agent` não escreve em
 * `crm_stages`. Guardrail é config de segurança; o padrão do repo para config é papel
 * no banco.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  GOV_ADMIN,
  GOV_AGENT_A,
  GOV_MANAGER,
  GOV_ORG,
  GOV_VIEWER,
  countAs,
  seedGov,
  sql,
  writeCountAs,
} from "./gov-helpers";

/** Uma linha para exercitar UPDATE; o INSERT é exercitado em outra camada. */
const CAMADA_EXISTENTE = "jailbreak";
const CAMADA_NOVA = "promessa_semantica";
/** Nome fora do vocabulário real, só para o caso do admin não colidir com os demais. */
const CAMADA_SO_DO_ADMIN = "sonda_do_invariante";

beforeAll(() => {
  seedGov();
  sql(`
    delete from public.org_guardrail_layers where organization_id = '${GOV_ORG}';
    insert into public.org_guardrail_layers (organization_id, layer, enabled)
      values ('${GOV_ORG}', '${CAMADA_EXISTENTE}', true);
  `);
});

describe("escrita em org_guardrail_layers exige admin", () => {
  for (const [rotulo, usuario] of [
    ["viewer", GOV_VIEWER],
    ["agent", GOV_AGENT_A],
    ["manager", GOV_MANAGER],
  ] as const) {
    it(`${rotulo} NÃO desliga uma camada já escolhida`, () => {
      const escritas = writeCountAs(
        usuario,
        `update public.org_guardrail_layers set enabled = false
           where organization_id = '${GOV_ORG}' and layer = '${CAMADA_EXISTENTE}'`,
      );
      expect(escritas).toBe(0);
    });

    it(`${rotulo} NÃO cria escolha para uma camada sem linha`, () => {
      // O caminho do PUT é upsert, então INSERT precisa do mesmo gate: sem ele,
      // "não consigo atualizar" viraria "então eu insiro", e a linha nova ganha da
      // ausência (ausência = vale o ambiente).
      const escritas = writeCountAs(
        usuario,
        `insert into public.org_guardrail_layers (organization_id, layer, enabled)
           values ('${GOV_ORG}', '${CAMADA_NOVA}', false)`,
      );
      expect(escritas).toBe(0);
    });
  }

  it("admin ESCREVE — guarda de vacuidade da suíte", () => {
    // Sem este caso, uma policy que barra TODO MUNDO passaria em todos os de cima e
    // deixaria a tela de segurança sem efeito nenhum para quem tem direito a ela.
    const atualizadas = writeCountAs(
      GOV_ADMIN,
      `update public.org_guardrail_layers set enabled = false
         where organization_id = '${GOV_ORG}' and layer = '${CAMADA_EXISTENTE}'`,
    );
    expect(atualizadas).toBe(1);

    // Camada PRÓPRIA, não a que os casos de cima tentam inserir: com a policy
    // sabotada, aquelas inserções passam e este INSERT colidiria na chave primária,
    // produzindo uma reprovação COLATERAL que não fala do que este caso mede.
    // Medido: numa sabotagem do `with check` a contagem veio 4 em vez de 3 por isso.
    const inseridas = writeCountAs(
      GOV_ADMIN,
      `insert into public.org_guardrail_layers (organization_id, layer, enabled)
         values ('${GOV_ORG}', '${CAMADA_SO_DO_ADMIN}', false)`,
    );
    expect(inseridas).toBe(1);
  });

  it("o valor barrado NÃO mudou no banco — contar 0 escrita não é o mesmo que não escrever", () => {
    // `writeCountAs` devolve 0 tanto quando a policy barra quanto quando o WHERE não
    // casa. Este caso confere o EFEITO: depois das seis tentativas barradas acima e do
    // caso do admin, o estado é o que o admin deixou.
    const comoAdmin = sql(`
      select enabled from public.org_guardrail_layers
        where organization_id = '${GOV_ORG}' and layer = '${CAMADA_EXISTENTE}';
    `).trim();
    expect(comoAdmin).toBe("f");
  });
});

describe("leitura é org-flat, e isso é escolha declarada", () => {
  it("membro de papel baixo LÊ a configuração", () => {
    // Precedência do repo (`crm_stages_select`): SELECT de config é org-flat. O
    // `manager` exigido no GET da rota é gate de TELA. Tela que oferece menos que o
    // banco permite é decisão de produto; o que não pode é escrever.
    expect(
      countAs(
        GOV_VIEWER,
        `select count(*) from public.org_guardrail_layers where organization_id = '${GOV_ORG}';`,
      ),
    ).toBeGreaterThan(0);
  });
});

describe("a anon key não alcança a tabela", () => {
  it("`anon` não tem privilégio nenhum — o revoke da 0142 está no baseline", () => {
    // A RLS já devolveria zero linha (anon não tem organização), mas o precedente da
    // 0123 revoga de todo jeito. Aqui se mede o PRIVILÉGIO, que é a camada que sobra
    // se a policy for enfraquecida um dia.
    const privilegios = sql(`
      select coalesce(string_agg(privilege_type, ',' order by privilege_type), 'NENHUM')
        from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name = 'org_guardrail_layers'
         and grantee = 'anon';
    `).trim();
    expect(privilegios).toBe("NENHUM");
  });

  it("mas `authenticated` CONTINUA com privilégio — a rota usa client de sessão", () => {
    // Controle positivo do caso acima: se a sonda estivesse medindo errado (nome de
    // tabela trocado, schema errado), ela devolveria NENHUM para os dois e o teste de
    // cima passaria por acidente.
    const privilegios = sql(`
      select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type), 'NENHUM')
        from information_schema.role_table_grants
       where table_schema = 'public'
         and table_name = 'org_guardrail_layers'
         and grantee = 'authenticated';
    `).trim();
    expect(privilegios).toContain("SELECT");
    expect(privilegios).toContain("UPDATE");
  });
});
