/**
 * SALVAR A FICHA NÃO PODE CONGELAR O PADRÃO DO DIA.
 *
 * ─── O defeito, medido em produção (VPS, 2026-08-30) ──────────────────────
 *
 * O dono abriu um chamado dizendo que os agentes "pararam de responder". Era
 * domingo, e `channel_knobs.allow_sunday = false` fazia o turno ser adiado para
 * segunda às 7h. Ele não lembrava de ter desligado o domingo — e a medição diz
 * que provavelmente **não desligou**.
 *
 * A linha foi gravada em 2026-08-06 20:05 (`ai.pacing_knobs_updated` no audit).
 * Naquele dia o default do produto era `allowSunday: false`
 * (`git show 136497e6:lib/agent-engine/pacing/defaults.ts` → linha 55). E a
 * ficha Anti-ban funcionava assim:
 *
 *   - `fromItem` semeia o Switch com `o?.allow_sunday ?? item.defaults.allowSunday`
 *     — sem override, ele nasce mostrando **o default do dia**;
 *   - `handleSave` envia **sempre** o booleano, nunca `null`.
 *
 * Logo: qualquer save daquela ficha, feito por QUALQUER motivo — inclusive só
 * para declarar desde quando o número é usado, que é o que o commit daquele
 * mesmo dia adicionou — gravava o default vigente como **override explícito e
 * permanente**. Quando o default virou `true` em 2026-08-20, esta instalação
 * não foi junto: ela tinha um `false` que ninguém escolheu.
 *
 * Todos os outros knobs da mesma ficha já fazem o certo — campo vazio vira
 * `null` e herda (`intOrNull`, `msOrNull`, e o `timezone.trim() === ""`). Só o
 * Switch não sabia dizer "não mexi".
 *
 * ─── A regra ───────────────────────────────────────────────────────────────
 *
 * Se o valor do Switch é IGUAL ao default vigente, envia `null` (herda). Só um
 * valor que DIVERGE do default é uma escolha, e só ela vira override.
 *
 * O efeito prático: quem herda continua herdando quando o produto muda de ideia,
 * e quem escolheu de verdade mantém a escolha.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { valorDeOverride } from "@/lib/ai/pacing-knobs";

describe("Anti-ban: um Switch que sabe dizer 'não mexi'", () => {
  it("valor igual ao default vira null — salvar a ficha não cria override", () => {
    // É este caso que produziu o defeito: o operador abriu a ficha para mexer no
    // aquecimento, o Switch mostrava o default do dia, e o save o congelou.
    expect(valorDeOverride(false, false)).toBeNull();
    expect(valorDeOverride(true, true)).toBeNull();
  });

  it("valor diferente do default é escolha e vira override", () => {
    // A outra ponta, e ela não é decorativa: um conserto que devolvesse `null`
    // sempre tornaria o Switch decorativo — o operador não conseguiria mais
    // desligar o domingo.
    expect(valorDeOverride(false, true)).toBe(false);
    expect(valorDeOverride(true, false)).toBe(true);
  });

  it("a escolha sobrevive à mudança do default do produto", () => {
    // Quem desligou o domingo quando o default era `true` escolheu de verdade.
    // Esse `false` tem de continuar sendo override — é o que separa este
    // conserto de um que apaga a vontade do operador.
    const escolheuDesligar = valorDeOverride(false, true);
    expect(escolheuDesligar).toBe(false);
  });

  it("A TELA usa a regra — a função certa e não chamada deixa o defeito de pé", () => {
    // Ponto cego clássico: `valorDeOverride` pode estar perfeita e o
    // `handleSave` continuar mandando `form.allow_sunday` cru. Aí a suíte fica
    // verde e a instalação segue congelando o padrão do dia.
    const sheet = readFileSync(
      join(process.cwd(), "components/connections/AntiBanSheet.tsx"),
      "utf8",
    );
    expect(
      /allow_sunday:\s*valorDeOverride\(/.test(sheet),
      "AntiBanSheet não usa valorDeOverride no save — o Switch voltou a gravar o default como override",
    ).toBe(true);
    expect(
      /allow_sunday:\s*form\.allow_sunday\s*,/.test(sheet),
      "AntiBanSheet ainda envia o booleano cru em algum ponto do save",
    ).toBe(false);
  });

  it("herdar é o estado que acompanha o produto quando ele muda de ideia", () => {
    // Em 2026-08-06 o default era false; em 2026-08-20 virou true. Quem salvou a
    // ficha no primeiro dia sem tocar no Switch deveria ter acompanhado a virada.
    const noDiaDoSave = valorDeOverride(false, false); // default de então: false
    expect(noDiaDoSave).toBeNull();
    // Com null gravado, o knob lê o default VIGENTE — hoje, true.
    expect(noDiaDoSave ?? true).toBe(true);
  });
});
