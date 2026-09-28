/**
 * A contagem do expurgo da fila de mídia (migration 0435, issue #1765).
 *
 * A 0434 (#1739) passou a expurgar, no CORPO de
 * `fn_enfileirar_midia_vencida`, a linha `deleted` da RETENÇÃO com mais de 90
 * dias. O DELETE existe, roda todo dia e é medido pelo irmão
 * `poda-de-midia-reenfileiramento-medido.test.ts` — mas a sua CONTAGEM não
 * aparecia em lugar nenhum: a função devolvia só `{vencidas, orfas}`. Duas
 * lacunas nasceiam daí, e este arquivo mede as duas:
 *
 *   1. a rodada que SÓ expurgou (as duas contagens zeradas) não auditava,
 *      porque o cron só audita `retention.sweep_run` quando
 *      `vencidas + orfas > 0` — e é exatamente a rodada em que a fila perde
 *      linhas de verdade que fica sem rastro;
 *   2. a metadata do `retention.sweep_run` não informava quantas linhas
 *      saíram da fila.
 *
 * O que este arquivo vigia, cada um por um modo de falha concreto:
 *   - `expurgadas` bate com as linhas que REALMENTE saíram da fila (valor, não
 *     presença: uma chave que devolvesse sempre 0 passaria num teste de
 *     existência);
 *   - a rodada que só expurgou devolve `vencidas` e `orfas` ZERADOS com
 *     `expurgadas > 0` — é a forma que o cron usa para decidir que houve
 *     efeito, e o fixture é feito para não ter nada a enfileirar;
 *   - a linha `deleted` de pedido LGPD NÃO entra na contagem (o motivo está no
 *     cabeçalho da 0434: é o único registro de que a mídia do titular saiu);
 *   - a segunda chamada expurga 0: a contagem é desta chamada, e uma função
 *     que contasse a fila inteira devolveria a mesma coisa para sempre.
 *
 * ## O INVARIANTE CONGELADO, E POR QUE ELE TAMBÉM FOI EDITADO
 *
 * `tests/invariants/poda-de-midia.test.ts:102`, e o irmão
 * `poda-de-midia-reenfileiramento-medido.test.ts:150` e `:176` (os três
 * CONGELADOS), comparam o retorno com `toEqual({ vencidas, orfas })`, e o
 * `toEqual` do Vitest é EXATO EM CHAVE: acrescentar `expurgadas` ao retorno os
 * tornaria VERMELHOS, e não por defeito — o objeto esperado é o shape ANTIGO,
 * não o shape errado. Foi MEDIDO (ver a seção de sabotagem no corpo do PR), não
 * suposto: sem esta edição o `pnpm test:invariants` saía != 0 com exatamente
 * estes três casos.
 *
 * A alternativa que a doutrina oferece primeiro — o conserto só em arquivo
 * NOVO, deixando os congelados como estavam — não funciona aqui, e é por isso
 * que a edição de congelado é a resposta certa e não um afrouxamento: nenhum
 * conserto no arquivo novo altera o QUE o `toEqual` congelado compara, que é o
 * retorno inteiro da função. A chave nova tem de entrar no objeto esperado de
 * cada um, ou o gate fica vermelho por uma razão que não é defeito.
 *
 * A edição é o mais estreita possível e NÃO AFROUXA NADA: os três `toEqual`
 * continuam exatos, continuam exigindo `vencidas`/`orfas` com o mesmo valor, e
 * passam a fiscalizar TAMBÉM a contagem do expurgo — que antes ninguém vigiava.
 * Trocar por `toMatchObject` (o caminho que AFROUXA) foi considerado e rejeitado:
 * aceitaria também um retorno com a chave a mais errada, que é exatamente o
 * que este arquivo novo precisa detectar. Cada valor foi conferido contra o
 * fixture do seu arquivo (nenhum dos três tem linha `deleted` de retenção com
 * mais de 90 dias, logo `expurgadas` é 0 nos três), e a justificativa está no
 * corpo do PR, com a válvula `DESKCOMM_GOV_INVARIANTS_EDIT=1` exportada.
 *
 * O último caso deste arquivo é a prova de que a lei do congelado continua
 * valendo: ele roda a MESMA sequência do `poda-de-midia.test.ts:99-103` e cobra
 * o objeto inteiro, campo novo incluído. Se alguém encolher o retorno, ele
 * apanha aqui e no congelado — os dois instrumentos cobrem a mesma lei por lados
 * que não podem cair juntos.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

const ORG = "17650000-0000-4000-8000-000000000001";
const CONTATO = "17650000-0000-4000-8000-000000000002";
const SESSAO = "17650000-0000-4000-8000-000000000003";
const CONVERSA = "17650000-0000-4000-8000-000000000004";
const MSG = "17650000-0000-4000-8000-000000000010";
const PEDIDO = "17650000-0000-4000-8000-000000000120";

/** Caminho de mensagem: determinístico por mensagem (`storagePathFor`). */
const MENSAGEM = `${ORG}/${CONVERSA}/contagem.mp4`;
/** Linhas do expurgo, sem objeto no bucket (nunca entram no passo 2). */
const VELHA_1 = `${ORG}/avatars/expurgo-1.jpg`;
const VELHA_2 = `${ORG}/avatars/expurgo-2.jpg`;
const VELHA_3 = `${ORG}/avatars/expurgo-3.jpg`;
const RECENTE = `${ORG}/avatars/expurgo-recente.jpg`;
const DA_PEDIDO_LGPD = `${ORG}/avatars/expurgo-lgpd.jpg`;

const conta = (q: string) => Number(lastLine(sql(q)));
const naFila = (p: string) =>
  conta(`select count(*) from storage_redaction_queue where object_path = '${p}'`);
const rodar = () =>
  JSON.parse(lastLine(sql(`select public.fn_enfileirar_midia_vencida(500)::text`))) as {
    vencidas: number;
    orfas: number;
    expurgadas: number;
  };

/** Linha `deleted` da RETENÇÃO, com a idade que se quer observar. */
function deletadaHa(caminho: string, dias: number, pedido: string | null = null): string {
  return `insert into storage_redaction_queue (organization_id, bucket, object_path, status, attempts, enqueued_at, processed_at, request_id)
          values ('${ORG}', 'whatsapp-media', '${caminho}', 'deleted', 1,
                  now() - interval '${dias} days', now() - interval '${dias} days', ${pedido ? `'${pedido}'` : "null"});`;
}

beforeEach(() => {
  sql(`
    insert into storage.buckets (id, name) values ('whatsapp-media', 'whatsapp-media') on conflict (id) do nothing;
    delete from storage_redaction_queue where organization_id = '${ORG}';
    delete from storage.objects where name like '${ORG}/%';
    delete from messages where organization_id = '${ORG}';
    delete from conversations where organization_id = '${ORG}';
    delete from channel_sessions where organization_id = '${ORG}';
    delete from contacts where organization_id = '${ORG}';
    delete from lgpd_requests where organization_id = '${ORG}';
    insert into organizations (id, slug, legal_name, display_name, media_retention_days)
      values ('${ORG}', 'org-midia-1765', 'Org Midia 1765 LTDA', 'Org Midia 1765', 60)
      on conflict (id) do update set media_retention_days = 60;
    insert into lgpd_requests (id, organization_id, request_type, source, scope, due_at)
      values ('${PEDIDO}', '${ORG}', 'redact', 'manual', 'contact', now() + interval '15 days')
      on conflict (id) do nothing;
    insert into contacts (id, organization_id, name, phone_number)
      values ('${CONTATO}', '${ORG}', 'Cliente', '+551900001765');
    insert into channel_sessions (id, organization_id, waha_session_name, status, webhook_secret_encrypted)
      values ('${SESSAO}', '${ORG}', 'midia-1765', 'WORKING', '\\x00'::bytea);
    insert into conversations (id, organization_id, contact_id, channel_session_id, status, is_group)
      values ('${CONVERSA}', '${ORG}', '${CONTATO}', '${SESSAO}', 'open', false);
    insert into messages (id, organization_id, conversation_id, channel_session_id, contact_id,
                          type, direction, status, body, sent_via, sent_at, created_at, media_storage_path)
      values ('${MSG}', '${ORG}', '${CONVERSA}', '${SESSAO}', '${CONTATO}', 'video', 'inbound', 'delivered',
              'a mensagem que já perdeu o arquivo', 'external_device', now() - interval '100 days', now() - interval '100 days', '${MENSAGEM}');
  `);
});

describe("fn_enfileirar_midia_vencida — a contagem do expurgo (0435)", () => {
  it("expurgadas bate com as linhas que saíram da fila — no valor, não na presença", () => {
    // CONTROLE POSITIVO do instrumento: sem as três linhas velhas, um
    // `toBeGreaterThan(0)` ainda passa por uma função que devolve 1 fixo, e um
    // `toBe(3)` sem fixture não diria nada. As duas coisas juntas dão o valor.
    sql(deletadaHa(VELHA_1, 100));
    sql(deletadaHa(VELHA_2, 120));
    sql(deletadaHa(VELHA_3, 91));
    sql(deletadaHa(RECENTE, 10));

    const r = rodar();

    // As três velhas saíram, a recente ficou: a contagem é a diferença real.
    expect(r.expurgadas).toBe(3);
    expect(naFila(VELHA_1)).toBe(0);
    expect(naFila(VELHA_2)).toBe(0);
    expect(naFila(VELHA_3)).toBe(0);
    expect(naFila(RECENTE)).toBe(1);
  });

  it("a rodada que SÓ expurgou devolve vencidas e orfas zerados com expurgadas > 0", () => {
    // É a forma exata que o cron consome: `vencidas + orfas == 0` e
    // `expurgadas > 0` é a rodada que apagou linha de fila e que, antes da
    // 0435, saía sem auditar nada. O fixture NÃO tem mensagem vencida nem
    // órfão: a message abaixo é zerada justamente para o caso não passar por
    // causa do enfileiramento.
    sql(`update messages set media_storage_path = null where id = '${MSG}';`);
    sql(deletadaHa(VELHA_1, 100));
    sql(deletadaHa(VELHA_2, 100));

    const r = rodar();

    expect(r.vencidas).toBe(0);
    expect(r.orfas).toBe(0);
    expect(r.expurgadas).toBe(2);
  });

  it("a linha deleted de pedido LGPD não entra na contagem — ela não é expurgada", () => {
    // O motivo está no cabeçalho da 0434: a linha de pedido LGPD é o ÚNICO
    // registro por objeto de que a mídia do titular saiu do bucket, porque o
    // worker só troca o `status` e o cron `storage-redaction` não audita a
    // remoção física. Se ela contasse, o operador veria expurgo de algo que
    // continua lá.
    sql(deletadaHa(DA_PEDIDO_LGPD, 100, PEDIDO));
    sql(deletadaHa(VELHA_1, 100));

    const r = rodar();

    expect(r.expurgadas).toBe(1);
    expect(naFila(DA_PEDIDO_LGPD)).toBe(1);
  });

  it("a segunda chamada expurga 0: a contagem é desta chamada, não da fila toda", () => {
    // Sem isto, uma função que contasse a fila inteira devolveria o mesmo
    // número para sempre e o laço de tandas do cron (que roda a função até
    // 10 vezes) somaria a mesma fila 10 vezes na metadata.
    sql(deletadaHa(VELHA_1, 100));
    sql(deletadaHa(VELHA_2, 100));

    expect(rodar().expurgadas).toBe(2);
    expect(rodar().expurgadas).toBe(0);
  });

  it("o retorno tem os três campos, e a lei do congelado continua satisfeita", () => {
    // A MESMA sequência do `poda-de-midia.test.ts:99-103` (enfileira uma vez,
    // enfileira de novo e compara o retorno inteiro), com o campo novo
    // incluído. É o contrapeso do congelado: se alguém encolher o retorno ou
    // trocar a contagem do expurgo por uma fixa, apanha aqui e lá — os dois
    // instrumentos cobrem a mesma lei por lados que não podem cair juntos.
    rodar(); // a primeira chamada enfileira a vencida do fixture
    const segunda = rodar();

    // `toEqual` exato, agora com o campo novo: o retorno CRESCEU em chave, e o
    // `expurgadas` é 0 porque este fixture não tem linha `deleted` vencida.
    expect(segunda).toEqual({ vencidas: 0, orfas: 0, expurgadas: 0 });
    // E o objeto que o congelado espera (agora com a chave nova) também bate.
    expect({ vencidas: segunda.vencidas, orfas: segunda.orfas }).toEqual({
      vencidas: 0,
      orfas: 0,
    });
  });
});
