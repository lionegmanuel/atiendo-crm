/**
 * O expurgo da fila de mídia (migration 0434, issue #1739) NÃO apaga a linha
 * `deleted` de pedido LGPD.
 *
 * `storage_redaction_queue.request_id` liga a linha a `lgpd_requests`, e a
 * remoção física do arquivo não é auditada em lugar nenhum: o worker
 * (`lib/lgpd/storage-redaction-queue.ts`) só troca o `status`, e o cron
 * `storage-redaction` não chama `audit()`. A linha `deleted` com `request_id` é,
 * portanto, o único registro por objeto de que a mídia do titular saiu do
 * bucket. O expurgo de 90 dias existe para a fila da RETENÇÃO (`request_id`
 * nulo), que é a que cresce todo dia.
 *
 * Arquivo próprio porque `tests/invariants/**` é congelado; o irmão
 * `poda-de-midia-reenfileiramento-medido.test.ts` cobre o resto da 0434.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

const ORG = "17390000-0000-4000-8000-000000000101";
const PEDIDO = "17390000-0000-4000-8000-000000000120";
const DO_PEDIDO = `${ORG}/avatars/lgpd-antigo.jpg`;
const DA_RETENCAO = `${ORG}/avatars/retencao-antigo.jpg`;

const naFila = (p: string) =>
  Number(lastLine(sql(`select count(*) from storage_redaction_queue where object_path = '${p}'`)));

function deletadaHa100Dias(caminho: string, pedido: string | null): string {
  return `insert into storage_redaction_queue (organization_id, bucket, object_path, status, attempts, enqueued_at, processed_at, request_id)
          values ('${ORG}', 'whatsapp-media', '${caminho}', 'deleted', 1,
                  now() - interval '100 days', now() - interval '100 days', ${pedido ? `'${pedido}'` : "null"});`;
}

beforeEach(() => {
  sql(`
    delete from storage_redaction_queue where organization_id = '${ORG}';
    delete from lgpd_requests where organization_id = '${ORG}';
    insert into organizations (id, slug, legal_name, display_name)
      values ('${ORG}', 'org-midia-1739-lgpd', 'Org Midia 1739 LGPD LTDA', 'Org Midia 1739 LGPD')
      on conflict (id) do nothing;
    insert into lgpd_requests (id, organization_id, request_type, source, scope, due_at)
      values ('${PEDIDO}', '${ORG}', 'redact', 'manual', 'contact', now() + interval '15 days');
  `);
});

describe("fn_enfileirar_midia_vencida — expurgo preserva o rastro LGPD (0434)", () => {
  it("deleted de pedido LGPD fica mesmo com mais de 90 dias; a da retenção sai", () => {
    sql(deletadaHa100Dias(DO_PEDIDO, PEDIDO));
    sql(deletadaHa100Dias(DA_RETENCAO, null));

    sql(`select public.fn_enfileirar_midia_vencida(500)`);

    expect(naFila(DO_PEDIDO)).toBe(1);
    expect(naFila(DA_RETENCAO)).toBe(0);
  });
});
