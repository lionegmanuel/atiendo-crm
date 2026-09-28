import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * VARIÁVEL QUE O `.env.example` ENTREGA **VAZIA** NÃO PODE CAIR NO DEFAULT COM `??`.
 *
 * ═══ O defeito que esta varredura fecha (achado triando o PR #432) ═══
 *
 * `??` só cai no padrão em `null`/`undefined`. **String vazia é valor e passa.**
 * Quando o `.env.example` entrega a chave vazia — e o comentário ao lado promete
 * que "vazio usa o padrão" —, quem faz `cp .env.example .env` e não preenche
 * aquela linha recebe `""` no lugar do default.
 *
 * Medido no `zernioBaseUrl()`: com a variável **ausente**, `base` resolvia para
 * `https://zernio.com/api` e a URL era válida; com ela **presente e vazia**,
 * `base` virava `""` e `new URL("/v1/...")` estourava `Invalid URL`. Todo envio
 * pelo canal quebrava, nos dois caminhos de credencial.
 *
 * ⚠️ E repare por que nenhum gate pegou: a doutrina de QA desta casa manda testar
 * **com os envs opcionais AUSENTES**, que é o estado de um primeiro deploy. Quem
 * copia o `.env.example` não tem a variável ausente — tem ela **presente e
 * vazia**, que é um terceiro estado que ninguém exercitava.
 *
 * ═══ A regra é estreita de propósito ═══
 *
 * Só reprova quando as TRÊS valem juntas: a variável aparece no `.env.example`,
 * ela vem **vazia** lá, e o código usa `?? "<default não-vazio>"`. `?? ""` não
 * entra — ali vazio já é o valor esperado, e exigir `||` seria trocar um
 * comportamento correto por outro igual. Proibir `??` em toda leitura de env
 * acusaria dezenas de casos certos, e gate que reprova o comportamento certo é
 * desligado na terceira vez que atrapalha.
 */
const RAIZ = path.resolve(__dirname, "../..");
const DIRS = ["lib", "app", "workers", "scripts"];

/**
 * Variáveis que `lib/env.ts` declara OBRIGATÓRIAS — elas saem da varredura.
 *
 * ⚠️ Esta exclusão nasceu de um FALSO POSITIVO do próprio gate, e o registro
 * importa. Ele acusou `lib/auth/invite-token.ts:16`
 * (`INVITE_TOKEN_SECRET ?? INTERNAL_SECRET ?? "dev-fallback"`), porque
 * `INTERNAL_SECRET` vem vazia no `.env.example`. Parecia grave: segredo de
 * assinatura virando `""`.
 *
 * Testei antes de exigir, e caiu. `lib/env.ts:30` define
 * `required = isProd ? z.string().min(1) : z.string().default("")` — em
 * produção a variável vazia **reprova na validação e o app não sobe**, com
 * mensagem própria. O caminho do `??` é inalcançável lá, e em desenvolvimento o
 * fallback declarado (`dev-fallback`) é a intenção escrita no cabeçalho do
 * arquivo: *"Production deployments MUST set one of the first two."*
 *
 * Um gate que reprovasse isso mandaria alguém consertar um defeito que não
 * existe — que é o que o passe 7 da triagem desta casa proíbe.
 */
function obrigatoriasNoEnvTs(): Set<string> {
  const src = fs.readFileSync(path.join(RAIZ, "lib/env.ts"), "utf8");
  const obrig = new Set<string>();
  for (const m of src.matchAll(/([A-Z][A-Z0-9_]*)\s*:\s*required(?:Always)?\(/g)) obrig.add(m[1]!);
  return obrig;
}

/** Variáveis que o `.env.example` entrega presentes e VAZIAS. */
function varsVaziasNoExemplo(): Set<string> {
  const src = fs.readFileSync(path.join(RAIZ, ".env.example"), "utf8");
  const vazias = new Set<string>();
  for (const linha of src.split("\n")) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(linha.trim());
    if (m && m[2]!.trim() === "") vazias.add(m[1]!);
  }
  return vazias;
}

/** `process.env.X ?? "algo"` — com `algo` NÃO vazio. */
function coalescenciasComDefaultReal(): Array<{ arquivo: string; linha: number; var: string }> {
  const achados: Array<{ arquivo: string; linha: number; var: string }> = [];
  const varrer = (dir: string) => {
    const abs = path.join(RAIZ, dir);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const p = path.join(abs, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".next") continue;
        varrer(path.relative(RAIZ, p));
        continue;
      }
      if (!/\.(ts|tsx)$/.test(e.name)) continue;
      const src = fs.readFileSync(p, "utf8");
      src.split("\n").forEach((linha, i) => {
        const m = /process\.env\.([A-Z][A-Z0-9_]*)\s*\?\?\s*"([^"]*)"/.exec(linha);
        if (m && m[2] !== "") {
          achados.push({ arquivo: path.relative(RAIZ, p), linha: i + 1, var: m[1]! });
        }
      });
    }
  };
  for (const d of DIRS) varrer(d);
  return achados;
}

describe("env vazia no .env.example não cai no default com `??`", () => {
  it("CONTROLE: a varredura enxerga as leituras de env que existem", () => {
    // Sem isto, um regex que deixasse de casar devolveria "nenhum problema" e
    // leria como aprovação — a sonda morta que devolve zero.
    expect(
      coalescenciasComDefaultReal().length,
      "a varredura não achou NENHUM `process.env.X ?? \"...\"` no repositório — " +
        "o regex parou de casar, e o resultado abaixo não vale nada",
    ).toBeGreaterThanOrEqual(3);
  });

  it("CONTROLE: a lista de obrigatórias não engole tudo", () => {
    // Se `obrigatoriasNoEnvTs()` casasse demais, o cruzamento ficaria vazio por
    // exclusão e o gate viraria verde permanente — a forma mais silenciosa de
    // um gate morrer.
    const obrig = obrigatoriasNoEnvTs();
    expect(obrig.size, "nenhuma obrigatória reconhecida — o regex de lib/env.ts parou de casar").toBeGreaterThan(3);
    expect(obrig.size, "obrigatórias demais — a exclusão está engolindo o cruzamento").toBeLessThan(60);
  });

  it("CONTROLE: o .env.example tem variáveis vazias para cruzar", () => {
    expect(varsVaziasNoExemplo().size, "nenhuma var vazia no .env.example — cruzamento vazio").toBeGreaterThan(5);
  });

  it("nenhuma variável vazia no exemplo usa `??` com default real", () => {
    const vazias = varsVaziasNoExemplo();
    const obrigatorias = obrigatoriasNoEnvTs();
    const ruins = coalescenciasComDefaultReal()
      .filter((a) => vazias.has(a.var) && !obrigatorias.has(a.var))
      .map((a) => `${a.arquivo}:${a.linha} — ${a.var}`);

    expect(
      ruins,
      "Estas leem uma variável que o `.env.example` entrega VAZIA e usam `??`, que só cai no " +
        "default em null/undefined. Quem copia o exemplo recebe string vazia no lugar do padrão " +
        "— foi assim que todo envio pelo canal Zernio quebrou (PR #432, de @jmschmitzco). " +
        "Use `process.env.X?.trim() || \"default\"`.",
    ).toEqual([]);
  });
});
