/**
 * A TABELA QUE GUARDA QUAL MODELO CADA PONTO USA — contra o banco de verdade.
 *
 * `ai_purpose_bindings` (migration 0126) guarda a escolha de provedor,
 * credencial e modelo de cada ponto do sistema que usa IA. Três propriedades
 * dela só existem no Postgres, e nenhuma aparece em teste unitário:
 *
 *  1. **Isolamento por organização.** A tabela guarda credencial escolhida por
 *     cada cliente. Vazar leitura aqui é vazar para quem uma organização paga.
 *  2. **Uma escolha por ponto.** Duas linhas para o mesmo `(org, purpose)`
 *     dariam resolução dependente de ordem — o pior tipo de bug de
 *     configuração, porque muda sozinho entre uma leitura e outra.
 *  3. **Auto-cura do apêndice do baseline.** O `update.sh` do self-hoster roda
 *     SEM `ON_ERROR_STOP`: se a criação da constraint única falhasse por dado
 *     duplicado preexistente, ela seria pulada em silêncio e o clone ficaria
 *     para sempre sem a garantia — verde na tela, quebrado no banco.
 *
 * Roda contra o Postgres nascido do `baseline.sql`, que é o que o self-hoster
 * de fato aplica — não contra as migrations, cuja cadeia fresh não sobe.
 */
import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it } from "vitest";

import { motivoDoErro, sql } from "./psql-transporte";

const ORG_A = "a0000000-0000-4000-8000-00000000000a";
const ORG_B = "b0000000-0000-4000-8000-00000000000b";
const USER_A = "a1000000-0000-4000-8000-00000000000a";
const USER_B = "b1000000-0000-4000-8000-00000000000b";
const CRED_A = "c0000000-0000-4000-8000-00000000000c";

function semear(): void {
  sql(`
    delete from public.ai_purpose_bindings where organization_id in ('${ORG_A}','${ORG_B}');
    delete from public.ai_provider_credentials where id = '${CRED_A}';
    delete from public.user_organizations where user_id in ('${USER_A}','${USER_B}');
    delete from auth.users where id in ('${USER_A}','${USER_B}');
    delete from public.organizations where id in ('${ORG_A}','${ORG_B}');

    insert into public.organizations (id, slug, legal_name, display_name) values
      ('${ORG_A}', 'inv-bind-a', 'Invariante A LTDA', 'Invariante A'),
      ('${ORG_B}', 'inv-bind-b', 'Invariante B LTDA', 'Invariante B');
    insert into auth.users (id, email) values
      ('${USER_A}', 'bind-a@invariant.test'),
      ('${USER_B}', 'bind-b@invariant.test');
    insert into public.user_organizations (user_id, organization_id, role) values
      ('${USER_A}', '${ORG_A}', 'admin'),
      ('${USER_B}', '${ORG_B}', 'admin');
    insert into public.ai_provider_credentials
      (id, organization_id, provider, label, api_key_encrypted, api_key_iv, api_key_tag, api_key_last4, is_active, validated_at)
      values ('${CRED_A}', '${ORG_A}', 'openai', 'chave da A', '\\x00', '\\x00', '\\x00', '1234', true, now());
    insert into public.ai_purpose_bindings (organization_id, purpose, provider, credential_id, model_id) values
      ('${ORG_A}', 'compaction', 'openai', '${CRED_A}', 'SEGREDO-DA-ORG-A'),
      ('${ORG_B}', 'compaction', 'anthropic', null, 'SEGREDO-DA-ORG-B');
    grant select, insert, update, delete on public.ai_purpose_bindings to authenticated;
  `);
}

/** Lê a tabela COMO o usuário, pelo mesmo caminho que a produção usa. */
function modelosVistosPor(userId: string): string {
  const out = sql(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
    select coalesce(string_agg(model_id, ',' order by model_id), '(nada)') from public.ai_purpose_bindings;
  `);
  return out.split("\n").at(-1) ?? "";
}

describe("ai_purpose_bindings — isolamento entre organizações", () => {
  beforeEach(semear);

  it("a fixture existe antes de qualquer conclusão (controle positivo)", () => {
    // Sem isto, uma fixture que falhou deixa a tabela vazia e TODOS os testes
    // de vazamento abaixo passam — "não vazou" é indistinguível de "não havia
    // nada para vazar". Este erro foi cometido ao provar esta migration à mão.
    const total = sql(
      `select count(*) from public.ai_purpose_bindings where organization_id in ('${ORG_A}','${ORG_B}')`,
    );
    expect(total).toBe("2");
  });

  it("cada organização enxerga apenas o próprio binding", () => {
    expect(modelosVistosPor(USER_A)).toBe("SEGREDO-DA-ORG-A");
    expect(modelosVistosPor(USER_B)).toBe("SEGREDO-DA-ORG-B");
  });

  it("escrever na organização alheia é barrado pela RLS", () => {
    let erro = "";
    try {
      sql(`
        set role authenticated;
        select set_config('request.jwt.claims', '{"sub":"${USER_A}"}', false);
        insert into public.ai_purpose_bindings (organization_id, purpose, provider, model_id)
        values ('${ORG_B}', 'flush', 'openai', 'INVASOR');
      `);
    } catch (e) {
      erro = motivoDoErro(e);
    }
    // Exigir a MENSAGEM da RLS, não um erro qualquer: uma FK ou um NOT NULL
    // também derrubariam o insert, e aí o teste passaria verde sem a política
    // existir. Já aconteceu na prova manual desta migration.
    expect(erro).toMatch(/row-level security/i);
    expect(
      sql(`select count(*) from public.ai_purpose_bindings where model_id = 'INVASOR'`),
    ).toBe("0");
  });
});

describe("ai_purpose_bindings — uma escolha por ponto", () => {
  beforeEach(semear);

  it("recusa um segundo binding para o mesmo ponto da mesma organização", () => {
    let erro = "";
    try {
      sql(`
        insert into public.ai_purpose_bindings (organization_id, purpose, provider, model_id)
        values ('${ORG_A}', 'compaction', 'anthropic', 'DUPLICATA');
      `);
    } catch (e) {
      erro = motivoDoErro(e);
    }
    expect(erro).toContain("ai_purpose_bindings_org_purpose_unique");
  });

  it("aceita o MESMO ponto em organizações diferentes", () => {
    // A recíproca. Sem ela, uma constraint única em `purpose` sozinho (sem a
    // organização) passaria no teste acima e quebraria todo cliente novo.
    //
    // A contagem é ESCOPADA às duas organizações do teste. Contar
    // `where purpose = 'compaction'` no banco inteiro passa a depender de o
    // banco estar limpo — e um banco de invariantes nunca está: outras suítes,
    // e no caso desta migration a própria prova manual, deixam linhas para
    // trás. Foi assim que este teste falhou na primeira execução, com 4 onde
    // esperava 2, medindo o mundo em vez do cenário.
    expect(
      sql(
        `select count(*) from public.ai_purpose_bindings
          where purpose = 'compaction' and organization_id in ('${ORG_A}','${ORG_B}')`,
      ),
    ).toBe("2");
  });
});

describe("ai_purpose_bindings — o que acontece quando a chave some", () => {
  beforeEach(semear);

  it("apagar a credencial NÃO apaga a configuração do ponto", () => {
    // ── Este caso foi INVERTIDO (migration 0141), e a razão está medida ──────
    //
    // Ele exigia `ON DELETE CASCADE`, com a justificativa de que um binding com
    // credencial nula "falharia em TODA chamada daquele ponto, em silêncio".
    // Essa premissa é FALSA, e o código diz isso:
    // `lib/agent-engine/edge/llm/credentials.ts:137` — sem `credentialId`, a
    // resolução cai na credencial mais recente ATIVA E VALIDADA do provider e,
    // se não houver nenhuma, na chave da instalação (`cfg.anthropicApiKey` /
    // `cfg.openaiApiKey`). `credential_id is null` não é órfão: é o valor com
    // que TODO binding nasce (`app/api/v1/ai/providers/route.ts:183`,
    // `credential_id` opcional) e o que a tela mostra como "da instalação".
    //
    // O que o CASCADE fazia de fato era APAGAR A LINHA INTEIRA — provider,
    // model_id, base_url e is_enabled junto. O caminho é banal e recomendado:
    // rotacionar uma chave (apagar a antiga, cadastrar a nova) zerava a
    // configuração de todos os pontos que a usavam, e a tela passava a dizer
    // "Usando o padrão da organização" — frase verdadeira sobre um estado que
    // ninguém escolheu, sem nada indicando que houve perda.
    //
    // O que este caso guarda agora: a linha SOBREVIVE, com a escolha de
    // provider/modelo intacta e a credencial desvinculada.
    const bindingsDaOrgA = () =>
      sql(
        `select count(*) from public.ai_purpose_bindings where organization_id = '${ORG_A}'`,
      );
    expect(bindingsDaOrgA()).toBe("1");
    sql(`delete from public.ai_provider_credentials where id = '${CRED_A}'`);
    expect(
      bindingsDaOrgA(),
      "o binding foi APAGADO junto com a credencial — rotacionar a chave zera a configuração dos pontos",
    ).toBe("1");

    // A referência some (é o que `set null` faz), mas a ESCOLHA fica.
    expect(
      sql(
        `select count(*) from public.ai_purpose_bindings
          where organization_id = '${ORG_A}' and credential_id is null`,
      ),
    ).toBe("1");
    expect(
      sql(
        `select provider || '|' || model_id from public.ai_purpose_bindings
          where organization_id = '${ORG_A}'`,
      ),
      "a escolha de provedor/modelo não sobreviveu à remoção da chave",
    ).toBe("openai|SEGREDO-DA-ORG-A");

    // E não levou junto o binding da OUTRA organização.
    expect(
      sql(`select count(*) from public.ai_purpose_bindings where organization_id = '${ORG_B}'`),
    ).toBe("1");
  });

  it("apagar a organização leva os bindings dela", () => {
    expect(
      sql(`select count(*) from public.ai_purpose_bindings where organization_id = '${ORG_B}'`),
    ).toBe("1");
    sql(`delete from public.organizations where id = '${ORG_B}'`);
    expect(
      sql(`select count(*) from public.ai_purpose_bindings where organization_id = '${ORG_B}'`),
    ).toBe("0");
  });
});

describe("ai_purpose_bindings — o apêndice do baseline se auto-cura", () => {
  it("deduplica dado preexistente antes de criar a constraint única", () => {
    // Cenário real: um clone que rodou uma versão intermediária desta frente
    // tem duas linhas para o mesmo ponto. O `update.sh` roda SEM
    // ON_ERROR_STOP, então uma constraint que falhasse seria pulada em
    // silêncio — verde na tela, sem garantia nenhuma no banco.
    sql(`
      delete from public.ai_purpose_bindings where organization_id = '${ORG_A}';
      delete from public.organizations where id = '${ORG_A}';
      insert into public.organizations (id, slug, legal_name, display_name)
        values ('${ORG_A}', 'inv-bind-a', 'Invariante A LTDA', 'Invariante A');
      alter table public.ai_purpose_bindings drop constraint if exists ai_purpose_bindings_org_purpose_unique;
      insert into public.ai_purpose_bindings (organization_id, purpose, provider, model_id, updated_at) values
        ('${ORG_A}', 'flush', 'anthropic', 'MODELO-ANTIGO', now() - interval '2 day'),
        ('${ORG_A}', 'flush', 'openai',    'MODELO-NOVO',   now());
    `);
    expect(
      sql(`select count(*) from public.ai_purpose_bindings where organization_id = '${ORG_A}'`),
    ).toBe("2");

    // O trecho do apêndice, na íntegra — se ele mudar no baseline e deixar de
    // deduplicar, este teste continua rodando a versão antiga e passaria. Por
    // isso o bloco é lido do próprio arquivo, não copiado.
    sql(trechoDeAutoCuraDoBaseline());

    expect(
      sql(`select count(*) from public.ai_purpose_bindings where organization_id = '${ORG_A}'`),
    ).toBe("1");
    expect(
      sql(`select model_id from public.ai_purpose_bindings where organization_id = '${ORG_A}'`),
    ).toBe("MODELO-NOVO");
    expect(
      sql(`select count(*) from pg_constraint where conname = 'ai_purpose_bindings_org_purpose_unique'`),
    ).toBe("1");
  });
});

/**
 * Extrai do `baseline.sql` o bloco de dedup + criação da constraint. Ler o
 * arquivo em vez de repetir o SQL aqui é o que impede o teste de virar prova de
 * si mesmo: se alguém remover a auto-cura do baseline, o teste executa um
 * trecho vazio e a asserção de dedup falha, em vez de continuar verde.
 */
function trechoDeAutoCuraDoBaseline(): string {
  const baseline = readFileSync("supabase/baseline.sql", "utf8");
  const inicio = baseline.indexOf("delete from public.ai_purpose_bindings a");
  const fimMarcador = "end $$;";
  const fim = baseline.indexOf(fimMarcador, inicio);
  if (inicio === -1 || fim === -1) {
    throw new Error(
      "bloco de auto-cura de ai_purpose_bindings não encontrado em supabase/baseline.sql — " +
        "se ele foi removido, clones com dado duplicado ficam sem a constraint única",
    );
  }
  return baseline.slice(inicio, fim + fimMarcador.length);
}
