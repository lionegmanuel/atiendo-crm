import { beforeAll, describe, expect, it } from "vitest";

import { ORDEM_DA_ESPERA } from "@/lib/inbox/comando-da-conversa";

import { GOV_ORG, GOV_SESSION, columnExists, seedGov, sql } from "./gov-helpers";

/**
 * A Fila ordena pela régua VIVA, e este arquivo prova que ela discrimina.
 *
 * Por que ele existe separado de `gov-5d-queue-assign-unread`, que já afirma
 * "coerência ordem↔posição": aquele arquivo é o eval congelado do épico de
 * governança (`loop/hooks/freeze-invariants.sh` bloqueia modificá-lo), e a cópia
 * do ORDER BY que ele carrega — `last_inbound_at asc` — é a régua ANTERIOR à
 * #990. Ele segue verde porque calcula a ordem em SQL e não pergunta nada ao
 * produto: um gate verde afirmando uma pergunta que o produto deixou de fazer.
 * Congelado não se edita, então a proteção que faltava entra como arquivo novo.
 *
 * Duas propriedades, e a segunda é a que sustenta a primeira:
 *
 *  1. A ordem da Fila é `ORDEM_DA_ESPERA` — a MESMA constante que
 *     `app/api/v1/conversations/_handler.ts` pede ao banco e que
 *     `components/inbox/ConversationList.tsx` usa para numerar "1º, 2º…".
 *     A coluna não se escreve aqui; se ela mudar lá, muda aqui junto.
 *
 *  2. A fixture SEPARA `awaiting_since` de `last_inbound_at`, semeando o defeito
 *     da #990: a conversa mais antiga acabou de insistir. Pela régua certa ela é
 *     a primeira; pela antiga seria a última. Sem essa separação o caso passaria
 *     com QUALQUER uma das duas colunas — verde sem guardar nada. O segundo
 *     `expect` afirma justamente que as duas réguas DIVERGEM nesta fixture, para
 *     que igualar os campos um dia reprove em vez de esvaziar o teste em silêncio.
 *
 * Namespace 4070/3070 (livre: 3040/3050/3060/3061 e 4040/4050/4060/4061 estão tomados).
 */

const CONV_INSISTE = "cccccccc-4070-4000-8000-000000000001"; // espera 30 min, escreveu há 1 min
const CONV_MEIO = "cccccccc-4070-4000-8000-000000000002"; // espera 10 min
const CONV_NOVA = "cccccccc-4070-4000-8000-000000000003"; // espera 2 min
const CONTATO = (n: number) => `cccccccc-3070-4000-8000-00000000000${n}`;

const ESPERADA = `${CONV_INSISTE},${CONV_MEIO},${CONV_NOVA}`;

function ordenaPor(expressao: string): string {
  return sql(
    `select string_agg(id::text, ',' order by ${expressao}, id asc)
       from public.conversations
      where organization_id = '${GOV_ORG}'
        and id in ('${CONV_INSISTE}', '${CONV_MEIO}', '${CONV_NOVA}');`,
  );
}

beforeAll(() => {
  seedGov();
  sql(`
    insert into public.contacts (id, organization_id, display_name)
      values
        ('${CONTATO(1)}', '${GOV_ORG}', 'Fila Regua Insiste'),
        ('${CONTATO(2)}', '${GOV_ORG}', 'Fila Regua Meio'),
        ('${CONTATO(3)}', '${GOV_ORG}', 'Fila Regua Nova')
      on conflict do nothing;

    insert into public.conversations
      (id, organization_id, contact_id, channel_session_id, status, last_inbound_at, awaiting_since)
      values
        ('${CONV_INSISTE}', '${GOV_ORG}', '${CONTATO(1)}', '${GOV_SESSION}', 'open', now() - interval '1 minute',   now() - interval '30 minutes'),
        ('${CONV_MEIO}',    '${GOV_ORG}', '${CONTATO(2)}', '${GOV_SESSION}', 'open', now() - interval '10 minutes', now() - interval '10 minutes'),
        ('${CONV_NOVA}',    '${GOV_ORG}', '${CONTATO(3)}', '${GOV_SESSION}', 'open', now() - interval '2 minutes',  now() - interval '2 minutes')
      on conflict do nothing;
  `);
});

describe("Fila — a ordem vem da régua viva, não de uma cópia", () => {
  it("a coluna de ORDEM_DA_ESPERA existe no banco que o kit instala", () => {
    // Falha aqui é legível ("a coluna não existe"); sem esta asserção, a ausência
    // apareceria como erro de SQL no insert do beforeAll e derrubaria o arquivo
    // inteiro com uma mensagem que não nomeia a causa.
    expect(columnExists("conversations", ORDEM_DA_ESPERA.coluna)).toBe(true);
  });

  it("ordenar por ORDEM_DA_ESPERA põe quem espera há mais tempo em primeiro — mesmo que ele tenha acabado de insistir", () => {
    const direcao = `${ORDEM_DA_ESPERA.opcoes.ascending ? "asc" : "desc"} ${
      ORDEM_DA_ESPERA.opcoes.nullsFirst ? "nulls first" : "nulls last"
    }`;
    expect(ordenaPor(`${ORDEM_DA_ESPERA.coluna} ${direcao}`)).toBe(ESPERADA);
  });

  it("a fixture DISCRIMINA: a régua antiga (last_inbound_at) produz outra ordem", () => {
    // Esta é a guarda da guarda. Se um dia alguém igualar `awaiting_since` a
    // `last_inbound_at` nos três seeds, o caso acima continuaria verde com a régua
    // ERRADA e ninguém saberia. Aqui isso reprova.
    expect(ordenaPor("last_inbound_at asc nulls last")).not.toBe(ESPERADA);
  });
});
