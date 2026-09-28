/**
 * O nome do provider de canal não pode chegar ao cliente — e isso não estava vigiado.
 *
 * Medido por sabotagem: zerando `PROVIDERES_DE_CANAL` no detector, os 143 testes de
 * vazamento continuavam VERDES. A cobertura existia no código e não existia em teste
 * nenhum, então qualquer refactor podia removê-la sem sintoma no CI.
 *
 * ⚠️ A primeira versão deste comentário dizia que a guarda era "improibível de escrever",
 * porque `lint-channels` reprovaria o nome do provider dentro de um teste. **Falso, e medido:**
 * o literal num arquivo sob `tests/` passa (exit 0); o mesmo literal em `lib/` reprova
 * (exit 1) — `ROOTS` é `["app","lib","components","workers"]` e nunca incluiu `tests/`.
 * A causa real da ausência é a chata: ninguém escreveu o teste. Fica registrado porque a
 * explicação elegante sobreviveu cercada de medição de verdade (sabotagem, controle
 * positivo, exit codes) — que é exatamente quando ninguém a checa.
 *
 * O teste DERIVA os nomes de `CHANNEL_CAPABILITIES` mesmo assim, por um motivo que se
 * sustenta sozinho: provider novo entra na cobertura sem ninguém lembrar de vir aqui.
 *
 * Derivar da mesma fonte não torna isto tautológico: o que se guarda é a propriedade
 * "todo provider conhecido é barrado". Se alguém esvaziar ou desligar a lista lá dentro,
 * este teste continua sabendo quais deveriam ser — e reprova.
 */
import { describe, expect, it } from "vitest";

import { detectarVazamentoInterno } from "@/lib/agent-engine/guardrails/vazamento-interno";
import { CHANNEL_CAPABILITIES } from "@/lib/channels/capabilities";

const PROVIDERS = Object.keys(CHANNEL_CAPABILITIES);

describe("nome de provider de canal é vazamento", () => {
  /**
   * Guarda de vacuidade. Sem ela, um `CHANNEL_CAPABILITIES` vazio faria o `it.each`
   * abaixo rodar zero caso e o arquivo passar sem ter medido nada — o mesmo verde
   * silencioso que a sabotagem expôs, só que um andar acima.
   */
  it("a fonte derivada não está vazia (senão o resto deste arquivo é vácuo)", () => {
    expect(PROVIDERS.length).toBeGreaterThanOrEqual(2);
  });

  it.each(PROVIDERS)("barra o nome do provider: %s", (p) => {
    const r = detectarVazamentoInterno(`Não consegui enviar pelo ${p}, tente de novo.`);
    expect(r.achou, `o nome do provider chegou ao cliente`).toBe(true);
    expect(r.categorias).toContain("arquitetura");
  });

  /**
   * O risco deste gate é barrar demais: no follow-up determinístico o veto é drop
   * silencioso. A palavra do cliente que mais se aproxima aqui é "canal" — ele fala
   * "outro canal", "canal de atendimento", e isso NÃO pode morrer.
   */
  it("não barra a palavra do cliente que orbita o termo", () => {
    for (const frase of [
      "Prefere que eu te chame em outro canal?",
      "Esse é o nosso canal de atendimento.",
      "Te respondo pelo mesmo canal, combinado?",
    ]) {
      const r = detectarVazamentoInterno(frase);
      expect(r.achou, `barrado por ${r.categorias.join(",")}: ${r.termos.join(", ")}`).toBe(false);
    }
  });
});
