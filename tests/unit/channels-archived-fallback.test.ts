/**
 * O fallback de `archived_at` só pode cobrir UMA coisa: a migration 0106 que não
 * rodou neste banco.
 *
 * O risco desta função não é ela falhar — é ela funcionar demais. Afrouxar a
 * detecção para "qualquer 42703" faria uma consulta genuinamente quebrada (um
 * `select` com nome de coluna errado, escrito hoje) cair no caminho alternativo e
 * devolver dado como se estivesse tudo bem. O defeito viraria silêncio, que é
 * exatamente a classe que este helper existe para fechar.
 */
import { describe, expect, it, vi } from "vitest";

import {
  isArchivedColumnMissing,
  queryTolerantToMissingArchived,
  type DbErrorLike,
} from "@/lib/channels/archived";

/** A forma que o PostgREST devolve — as duas closures precisam falar o mesmo tipo. */
type Resposta = { data: string[] | null; error: DbErrorLike | null };

const semColuna: DbErrorLike = {
  code: "42703",
  message: "column channel_sessions_1.archived_at does not exist",
};

describe("isArchivedColumnMissing", () => {
  it("reconhece a coluna ausente do 0100", () => {
    expect(isArchivedColumnMissing(semColuna)).toBe(true);
  });

  it("42703 de OUTRA coluna não é o nosso caso — erro de verdade não vira fallback", () => {
    expect(
      isArchivedColumnMissing({ code: "42703", message: 'column "locale" does not exist' }),
    ).toBe(false);
  });

  it("erro com outro SQLSTATE não é o nosso caso, nem citando archived_at", () => {
    expect(isArchivedColumnMissing({ code: "42501", message: "permission denied archived_at" })).toBe(
      false,
    );
    expect(isArchivedColumnMissing(null)).toBe(false);
  });
});

describe("queryTolerantToMissingArchived", () => {
  it("banco em dia: roda só a consulta com o filtro", async () => {
    const com = vi.fn(async (): Promise<Resposta> => ({ data: ["a"], error: null }));
    const sem = vi.fn(async (): Promise<Resposta> => ({ data: ["a", "arquivado"], error: null }));

    const r = await queryTolerantToMissingArchived(com, sem);

    expect(r.data).toEqual(["a"]);
    expect(r.schemaOutdated).toBe(false);
    expect(sem).not.toHaveBeenCalled();
  });

  it("coluna ausente: repete sem o filtro e SINALIZA — o operador precisa saber que falta migrar", async () => {
    const com = vi.fn(async (): Promise<Resposta> => ({ data: null, error: semColuna }));
    const sem = vi.fn(async (): Promise<Resposta> => ({ data: ["a"], error: null }));

    const r = await queryTolerantToMissingArchived(com, sem);

    expect(r.data).toEqual(["a"]);
    expect(r.error).toBeNull();
    expect(r.schemaOutdated).toBe(true);
  });

  it("erro de verdade sobe como erro — nada de segunda tentativa que o mascare", async () => {
    const com = vi.fn(async (): Promise<Resposta> => ({ data: null, error: { code: "42501", message: "permission denied" } }));
    const sem = vi.fn(async (): Promise<Resposta> => ({ data: ["a"], error: null }));

    const r = await queryTolerantToMissingArchived(com, sem);

    expect(r.error).toEqual({ code: "42501", message: "permission denied" });
    expect(r.data).toBeNull();
    expect(sem).not.toHaveBeenCalled();
  });
});
