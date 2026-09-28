/**
 * O teto por IP do login virou configurável — e isso precisa de guarda nos DOIS lados.
 *
 * Por que existe: no CI todo teste sai do mesmo IP (um runner). Com 28 specs, o e2e
 * estourava 60 logins/5min e `risk-radar` (13ª de 15 na parte 1) reprovava com
 * "Muitas tentativas. Aguarde alguns minutos." — visível só no `error-context` do
 * Playwright, porque o bloqueio é RENDERIZADO na tela e não logado no servidor. Quem
 * procurar `429` no log do CI acha zero e conclui, errado, que não houve rate limit.
 *
 * O risco de tornar algo configurável é o default vazar: alguém afrouxa produção e
 * nenhum gate reclama, porque "passa" continua passando. Por isso a metade mais
 * importante deste arquivo é a primeira — o valor SEM env.
 *
 * O que NÃO é configurável, de propósito: o teto por CONTA (`id`), que é quem barra
 * brute force de verdade, inclusive contra quem distribui tentativas por muitos IPs.
 * Se um dia alguém o tornar configurável, o teste do fim deste arquivo reprova.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

const ENV = "AUTH_RATE_LIMIT_LOGIN_IP";

/** Reimporta o módulo com o env corrente — `AUTH_LIMITS` é avaliado na carga. */
async function carregaLimites(valor?: string) {
  vi.resetModules();
  if (valor === undefined) delete process.env[ENV];
  else process.env[ENV] = valor;
  return import("@/lib/auth/rate-limit");
}

describe("teto por IP do login", () => {
  const original = process.env[ENV];
  beforeEach(() => {
    delete process.env[ENV];
  });
  afterEach(() => {
    if (original === undefined) delete process.env[ENV];
    else process.env[ENV] = original;
    vi.resetModules();
  });

  it("SEM env, vale o default de produção (a guarda que impede o default vazar)", async () => {
    const m = await carregaLimites(undefined);
    expect(m.AUTH_LIMITS.login.ip).toBe(m.__LOGIN_IP_DEFAULT_PARA_TESTE);
    expect(m.AUTH_LIMITS.login.ip, "o default de produção mudou sem alguém decidir").toBe(60);
  });

  it("COM env válida, o CI consegue afrouxar (senão o conserto não conserta nada)", async () => {
    const m = await carregaLimites("500");
    expect(m.AUTH_LIMITS.login.ip).toBe(500);
  });

  it.each([
    ["texto", "muitos"],
    ["zero", "0"],
    ["negativo", "-1"],
    ["vazio", ""],
  ])("env inválida (%s) cai no default — falha FECHADA, não aberta", async (_n, v) => {
    const m = await carregaLimites(v);
    expect(m.AUTH_LIMITS.login.ip).toBe(60);
  });

  it("o teto por CONTA continua NÃO configurável (é ele que barra brute force)", async () => {
    // Sabotagem futura provável: "já que o de IP é configurável, o de conta também".
    // O de conta vale mesmo contra ataque distribuído por muitos IPs — afrouxá-lo por
    // env transformaria uma variável de ambiente em desligar-proteção-de-senha.
    const comEnv = await carregaLimites("500");
    expect(comEnv.AUTH_LIMITS.login.id, "o teto por conta reagiu ao env de IP").toBe(5);

    const semEnv = await carregaLimites(undefined);
    expect(semEnv.AUTH_LIMITS.login.id).toBe(5);
    expect(semEnv.AUTH_LIMITS.login.windowSec).toBe(300);
  });
});
