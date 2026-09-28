/**
 * MODELO E PROVIDER VÊM DO MESMO LUGAR (PR #151, @Gervanno).
 *
 * ## O defeito
 *
 * Os classificadores auxiliares (estágio, jailbreak, promessa) e a compactação
 * pegam emprestado o modelo do agente publicado quando o knob de env está
 * vazio. Emprestavam **só a string do modelo**: provider e credencial seguiam
 * sendo o default da organização.
 *
 * Num tenant com default Anthropic e um `mcp_agent` publicado em OpenAI, o
 * classificador mandava `gpt-5-mini` para o endpoint da Anthropic, tomava 404
 * `not_found_error`, e o **turno inteiro** morria (`status='dead'`) antes de o
 * agente responder. Para quem instalou, o sintoma é o pior possível: o agente
 * simplesmente não responde no WhatsApp, sem erro em tela nenhuma.
 *
 * E o dry-run passava — ele não chama classificador. O caminho que funciona não
 * era o caminho que quebrava, que é o que fez isso sobreviver até produção.
 *
 * ## Por que este teste existe, e não só a correção
 *
 * O PR chegou sem teste. O defeito é de ACOPLAMENTO — duas informações que
 * precisam viajar juntas — e esse é justamente o tipo que volta na próxima
 * refatoração, porque nada no tipo obriga. Aqui o par fica preso por asserção.
 */
import { describe, expect, it } from "vitest";

import { auxModelArgs, type AgenteParaAux } from "@/lib/agent-engine/agent/aux-model-args";

const AGENTE_OPENAI: AgenteParaAux = {
  model: "openai/gpt-5-mini",
  provider: "openai",
  credentialId: "cred-openai-1",
};

describe("de onde o classificador auxiliar tira modelo e provider", () => {
  it("herdando do agente, o provider e a credencial vêm JUNTO", () => {
    const args = auxModelArgs(undefined, AGENTE_OPENAI);
    expect(args.model).toBe("openai/gpt-5-mini");
    expect(
      args.llmOverride,
      "modelo do agente sem o provider dele é o defeito: model id certo para o endpoint errado, 404, turno morto",
    ).toEqual({ provider: "openai", credentialId: "cred-openai-1" });
  });

  it("com knob de env, NÃO força override — o operador escolheu, e a escolha pressupõe o default da org", () => {
    const args = auxModelArgs("anthropic/claude-haiku-4-5", AGENTE_OPENAI);
    expect(args.model).toBe("anthropic/claude-haiku-4-5");
    expect(
      args.llmOverride,
      "carregar o provider do agente por cima de um modelo escolhido no env inverteria o defeito",
    ).toBeUndefined();
  });

  it("sem knob e sem agente, não inventa modelo", () => {
    expect(auxModelArgs(undefined, null)).toEqual({});
  });

  it("agente sem modelo publicado cai no default da org, sem override", () => {
    // `model` ausente é o self-host que configurou tudo pela tela e nunca
    // preencheu `default_model`. Herdar o provider sem o modelo apontaria o
    // default da org para um provider que não é o dela.
    const args = auxModelArgs(undefined, { provider: "openai", credentialId: null });
    expect(args).toEqual({});
  });

  it("credencial nula viaja como nula, não some", () => {
    // `credentialId: null` significa "use a credencial default deste provider" —
    // é informação, não ausência. Se ela sumisse, o resolver cairia no provider
    // da org de novo, que é o defeito com outra roupa.
    const args = auxModelArgs(undefined, { model: "openai/gpt-5-mini", provider: "openai", credentialId: null });
    expect(args.llmOverride).toEqual({ provider: "openai", credentialId: null });
  });
});
