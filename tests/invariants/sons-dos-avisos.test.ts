/**
 * O bucket dos sons dos avisos (migration 0441) existe como a lib supõe:
 * privado, com o teto e os tipos de `lib/notifications/sons-da-org.ts`, e sem
 * policy nenhuma — só o service_role lê e grava.
 */
import { describe, expect, it } from "vitest";

import { TAMANHO_MAXIMO_DO_SOM, TIPOS_DE_AUDIO_ACEITOS } from "@/lib/notifications/sons-da-org";

import { lastLine, sql } from "./gov-helpers";

describe("org-sounds — o bucket que os sons supõem", () => {
  it("existe PRIVADO, com o teto e os tipos da lib", () => {
    const linha = lastLine(
      sql(`select public::text || '|' || file_size_limit::text || '|' ||
                  coalesce(array_to_string(allowed_mime_types, ','), 'NULO')
             from storage.buckets where id = 'org-sounds';`),
    );
    expect(linha).toBe(`false|${TAMANHO_MAXIMO_DO_SOM}|${TIPOS_DE_AUDIO_ACEITOS.join(",")}`);
  });

  it("NENHUMA policy de storage.objects nomeia o bucket", () => {
    const policies = lastLine(
      sql(`select coalesce(string_agg(policyname, ',' order by policyname), 'NENHUMA')
             from pg_policies
            where schemaname = 'storage' and tablename = 'objects'
              and (coalesce(qual, '') || coalesce(with_check, '')) like '%org-sounds%';`),
    );
    expect(policies).toBe("NENHUMA");
  });
});
