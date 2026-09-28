import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

/**
 * A GRADE PODE SE MOVER SOZINHA — E SÓ A TABELA CERTA PUBLICA.
 *
 * Sem `calendar_appointments` na publicação, o `.channel()` sobe, o `subscribe`
 * devolve SUBSCRIBED e nenhum evento chega nunca. É silêncio sem erro, e nesta
 * base ele tem um sósia: o canal também morre calado quando o token não chega ao
 * socket. Dois defeitos com o mesmo sintoma fazem o segundo custar o dobro.
 *
 * As duas asserções são igualmente necessárias. Publicar tudo é tão errado
 * quanto não publicar nada: `calendar_external_events` é espelho reescrito em
 * lote, e um sync de 200 eventos viraria 200 pulsos — o "pulso que mente".
 */

const container = process.env.TEST_DB_CONTAINER;
if (!container) throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db`");
const containerName: string = container;

function publicadas(): string[] {
  return execFileSync(
    "docker",
    ["exec", "-i", containerName, "psql", "-U", "postgres", "-d", "postgres", "-tA", "-c",
      "select tablename from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' order by 1"],
    { encoding: "utf8" },
  ).trim().split("\n").map((s) => s.trim()).filter(Boolean);
}

describe("a agenda na publicação de realtime", () => {
  it("a sonda enxerga a publicação (guarda de vacuidade)", () => {
    // Publicação inexistente devolveria lista vazia, e as duas asserções abaixo
    // passariam medindo o vácuo — uma delas por acidente.
    expect(publicadas().length).toBeGreaterThan(5);
  });

  it("calendar_appointments PUBLICA — marcar e cancelar é mudança de estado", () => {
    expect(publicadas()).toContain("calendar_appointments");
  });

  it("calendar_external_events NÃO publica — espelho em lote seria pulso que mente", () => {
    expect(publicadas()).not.toContain("calendar_external_events");
  });

  it("calendar_connections NÃO publica — guarda token e não tem consumidor", () => {
    expect(publicadas()).not.toContain("calendar_connections");
  });
});
