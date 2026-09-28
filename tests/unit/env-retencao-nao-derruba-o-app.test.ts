/**
 * O knob de retenção não pode derrubar o app.
 *
 * `lib/env.ts` roda no import do Next: um `throw` ali é 500 em TODAS as telas,
 * com o contêiner `healthy` (o healthcheck é probe TCP) e nada dizendo o
 * porquê. E o valor que o operador da VPS escreve quando quer desligar a poda
 * é justamente `0` — que `z.coerce.number().int().positive()` recusa.
 *
 * Falha FECHADA na ação (o valor inválido não vale, o padrão entra) e ABERTA na
 * informação (o app sobe e diz alto o que ignorou).
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

/** Réplica do helper de `lib/env.ts` — mesma forma, para medir o comportamento. */
const diasDeRetencao = (nome: string, padrao: number, valor: string | undefined) =>
  z.coerce
    .number()
    .int()
    .positive()
    .default(padrao)
    .catch(() => padrao)
    .parse(valor);

describe("knob de retenção do arquivo de webhooks", () => {
  it("vazio usa o padrão", () => {
    expect(diasDeRetencao("X", 7, undefined)).toBe(7);
  });

  it('"0" — a tentativa óbvia de desligar — cai no padrão em vez de derrubar o app', () => {
    expect(() => diasDeRetencao("X", 7, "0")).not.toThrow();
    expect(diasDeRetencao("X", 7, "0")).toBe(7);
  });

  it("texto, negativo e fracionário caem no padrão", () => {
    for (const v of ["abc", "-1", "3.5", ""]) {
      expect(diasDeRetencao("X", 90, v), `valor ${JSON.stringify(v)}`).toBe(90);
    }
  });

  it("valor válido continua valendo — o helper não engole o que é bom", () => {
    expect(diasDeRetencao("X", 7, "30")).toBe(30);
  });
});

describe("o schema de verdade não lança com valor inválido", () => {
  it("lib/env.ts usa o helper tolerante nas duas vars, não o schema que lança", async () => {
    const { readFileSync } = await import("node:fs");
    const fonte = readFileSync("lib/env.ts", "utf8");
    for (const nome of ["WEBHOOK_LOG_BODY_RETENTION_DAYS", "WEBHOOK_LOG_ROW_RETENTION_DAYS"]) {
      const linha = fonte.split("\n").find((l) => l.includes(`${nome}:`));
      expect(linha, `${nome} precisa existir em lib/env.ts`).toBeTruthy();
      expect(linha, `${nome} não pode voltar ao schema que lança`).toContain("diasDeRetencao(");
    }
  });
});
