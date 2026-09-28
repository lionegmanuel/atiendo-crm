/**
 * Nenhum passo do wizard decide sozinho qual é o próximo.
 *
 * ACHADO PERCORRENDO O PRODUTO, não em teste: depois de acrescentar o passo
 * "Ver ele atender" entre treinar e chamar o time, o caminho de SUCESSO pulava
 * ele. A action de criar o agente redirecionava para `/onboarding/invite-team`
 * — destino escrito quando esse passo não existia. A pessoa terminava o
 * onboarding sem nunca ver o funcionário responder, que é exatamente o que o
 * passo existe para evitar.
 *
 * Os testes unitários não pegaram porque conferem o destino que a action
 * escolhe, não se ele ainda é o passo certo. E não é o primeiro caso: as
 * actions de loja já tinham mandado gente para um passo oculto quando a
 * integração estava desligada.
 *
 * A regra: quem sabe a sequência é `lib/onboarding/passos.ts`, e quem a aplica
 * é o roteador em `/onboarding`. Toda action termina lá.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const RAIZ = resolve(__dirname, "../..");
const DIR_ACTIONS = resolve(RAIZ, "app/actions/onboarding");

const ACTIONS = readdirSync(DIR_ACTIONS).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

/** Um destino DENTRO do wizard, isto é, com segmento depois de /onboarding. */
const DESTINO_FIXO = /["'`]\/onboarding\/[a-z-]+["'`]/;

describe("as actions do onboarding", () => {
  it("existem actions para vigiar (guarda de vacuidade)", () => {
    expect(ACTIONS.length).toBeGreaterThanOrEqual(4);
  });

  it("nenhuma manda a pessoa para um passo ESPECÍFICO", () => {
    const comDestinoFixo = ACTIONS.filter((arquivo) => {
      const fonte = readFileSync(resolve(DIR_ACTIONS, arquivo), "utf8");
      // Só o que está em código; comentário citando um caminho é prosa.
      const semComentarios = fonte
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      return DESTINO_FIXO.test(semComentarios);
    });

    expect(
      comDestinoFixo,
      "destino fixo numa sequência que muda pula o passo novo em silêncio — " +
        "termine em `/onboarding` e deixe o roteador escolher",
    ).toEqual([]);
  });

  it("e as telas do wizard também não", () => {
    // O mesmo vale para `window.location.href` nos botões de escape: eles
    // levavam para o passo seguinte de então, não para o seguinte de agora.
    const telas = readdirSync(resolve(RAIZ, "app/onboarding"), { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
      .flatMap((d) =>
        readdirSync(resolve(RAIZ, "app/onboarding", d.name))
          .filter((f) => f.endsWith(".tsx"))
          .map((f) => `${d.name}/${f}`),
      );

    const comDestinoFixo = telas.filter((rel) => {
      const fonte = readFileSync(resolve(RAIZ, "app/onboarding", rel), "utf8");
      const semComentarios = fonte
        .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      return /location\.href\s*=\s*["'`]\/onboarding\/[a-z-]+["'`]/.test(semComentarios);
    });

    expect(comDestinoFixo).toEqual([]);
  });
});
