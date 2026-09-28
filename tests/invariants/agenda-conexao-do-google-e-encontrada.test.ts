import { execFileSync } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * A CONEXÃO QUE O CALLBACK GRAVA É A QUE O WORKER PROCURA.
 *
 * ═══ O defeito, medido contra Postgres real ══════════════════════════════════
 * `calendar_connections.provider` tem `check (provider = 'google_calendar')`, e
 * o callback do Google grava exatamente isso. Três leituras filtravam por
 * `"google"`:
 *
 *   app/app/agenda/page.tsx                        → o cartão da conexão
 *   app/api/v1/cron/agenda-google-push/route.ts    → o worker da ida
 *   app/api/v1/agenda/google/desconectar/route.ts  → a rota de desconectar
 *
 * Não é "às vezes não acha": inserir `provider='google'` é BARRADO pelo CHECK, e
 * a linha que essas consultas procuram **não pode existir**. Zero linhas por
 * construção, em toda instalação, desde sempre.
 *
 * Para quem usa: conectava o Google, e o botão "Conectar Google" continuava na
 * tela; desconectar devolvia 404; e o compromisso nunca saía para o Google, sem
 * rastro nenhum (rodada de cron sem efeito não audita — o que é doutrina e está
 * certo: o defeito era não haver efeito, não a ausência de log).
 *
 * ═══ Por que este arquivo é NOVO e não um caso a mais no vizinho ═════════════
 * `agenda-ida-ao-google-termina.test.ts` prova que a LINHA entra e sai da fila
 * (`needs_google_push`) e nunca insere em `calendar_connections` — ele mede o
 * outro lado da junção, e está certo no escopo dele. Acrescentar um caso ali
 * seria EDITAR invariante existente, que a catraca do repo proíbe pela razão
 * certa: invariante se escala, não se edita.
 *
 * O worker faz DUAS perguntas — acha o compromisso, depois acha a conexão. A
 * segunda era a quebrada, e não tinha guarda nenhuma.
 *
 * ═══ Por que aqui e não num teste com dublê ══════════════════════════════════
 * A propriedade é do BANCO: que o valor escrito e o valor procurado são o mesmo,
 * e que o outro valor é impossível. Um dublê aceitaria os dois — foi exatamente
 * assim que o defeito atravessou os testes unitários existentes.
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error(
    "TEST_DB_CONTAINER not set — rode esta suíte via `pnpm test:db` (scripts/test-db.sh)",
  );
}
const containerName: string = container;

function sql(script: string): string {
  return execFileSync(
    "docker",
    [
      "exec", "-i", containerName, "psql", "-U", "postgres", "-d", "postgres",
      "-v", "ON_ERROR_STOP=1", "-tA", "-f", "-",
    ],
    { input: script, encoding: "utf8" },
  ).trim();
}

/** A mensagem do Postgres — é ela que distingue "o CHECK barrou" de outro erro. */
function motivoDoErro(err: unknown): string {
  const e = err as { stderr?: Buffer | string; message?: string };
  return String(e.stderr ?? e.message ?? err);
}

const ORG = "cccccccc-0201-4000-8000-000000000001";
const DONO = "cccccccc-0201-4000-8000-000000000002";

beforeAll(() => {
  sql(`
    insert into auth.users (id, email) values ('${DONO}', 'dono-conexao@deskcomm.test')
      on conflict (id) do nothing;
    insert into public.organizations (id, slug, display_name, legal_name)
      values ('${ORG}', 'org-conexao-google', 'Org Conexão', 'Org Conexão')
      on conflict (id) do nothing;
    delete from public.calendar_connections where organization_id = '${ORG}';
  `);
});

afterAll(() => {
  sql(`delete from public.calendar_connections where organization_id = '${ORG}';`);
});

describe("o provider da conexão do Google", () => {
  it("o CHECK PROÍBE o valor que as três consultas procuravam", () => {
    // O controle NEGATIVO, e é ele que explica por que o defeito era TOTAL e não
    // intermitente: não é que a linha `google` costumava faltar — ela é
    // impossível. Se este caso passar a aceitar a inserção, o CHECK afrouxou e a
    // varredura de literais (`tests/unit/consulta-usa-o-vocabulario-do-banco`)
    // perde o fundamento.
    const erro = (() => {
      try {
        sql(`
          insert into public.calendar_connections
            (organization_id, user_id, provider, status, account_email)
          values ('${ORG}', '${DONO}', 'google', 'healthy', 'x@y.z');
        `);
        return null;
      } catch (err) {
        return motivoDoErro(err);
      }
    })();
    expect(erro, "o banco aceitou provider='google' — o CHECK deixou de proteger").not.toBeNull();
    expect(erro).toContain("calendar_connections_provider_check");
  });

  it("a conexão gravada pelo callback é ENCONTRADA pelo predicado do worker", () => {
    // ⚠️ `\\xDEADBEEF` e não `\\xCIFRADO`: o segundo não é hexadecimal válido e o
    // Postgres recusa com `invalid hexadecimal digit: "I"` — medido ao rodar o
    // SQL à mão. O caso morreria por erro de FIXTURE antes de chegar à asserção,
    // e o vermelho não diria nada sobre o defeito.
    sql(`
      insert into public.calendar_connections
        (organization_id, user_id, provider, status, account_email, oauth_access_token_encrypted)
      values ('${ORG}', '${DONO}', 'google_calendar', 'healthy', 'dono@clinica.com.br', '\\xDEADBEEF')
      on conflict do nothing;
    `);

    // O MESMO predicado do worker (`agenda-google-push/route.ts`): organização,
    // pessoa, provider e status healthy. Se alguém trocar o literal de volta,
    // este caso devolve 0.
    const achadas = sql(`
      select count(*) from public.calendar_connections
       where organization_id = '${ORG}'
         and user_id = '${DONO}'
         and provider = 'google_calendar'
         and status = 'healthy';
    `).trim();
    expect(
      achadas,
      "o worker não encontraria a conexão que o callback acabou de gravar — é o " +
        "defeito da v1.9.0: a ida CRM→Google nunca saía, e sem rastro nenhum",
    ).toBe("1");
  });

  it("o valor antigo não encontra a linha nova — a divergência era total", () => {
    // A outra metade da mesma medição, e ela existe para o número aparecer no
    // relatório: 1 contra 0. Sem este caso alguém poderia ler o de cima como
    // "achou 1 de 2" em vez de "achou a única que existe".
    const comOValorAntigo = sql(`
      select count(*) from public.calendar_connections
       where organization_id = '${ORG}'
         and user_id = '${DONO}'
         and provider = 'google'
         and status = 'healthy';
    `).trim();
    expect(comOValorAntigo, "o valor antigo achou linha — o CHECK deixou de valer").toBe("0");
  });
});
