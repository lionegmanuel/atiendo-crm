/**
 * Tradução do resultado de `sendTemplate` para o que o MODELO lê.
 *
 * Separado da execução de propósito: é a peça que decide se o agente sai do buraco
 * ou entra em loop. Um erro que não diz o que fazer faz o modelo tentar de novo
 * igual — e o turno queima tentativas até morrer, deixando o lead sem resposta.
 *
 * Regra por trás de cada frase: **dizer se vale insistir**. Três desfechos, três
 * condutas diferentes:
 *   - `retriable: true`  → o modelo pode corrigir e chamar de novo (faltou valor)
 *   - `retriable: false` → nada que o modelo faça resolve; encerre e escale
 *   - sucesso            → pare de falar, a mensagem saiu
 */
import type { SendTemplateResult } from "./send-template";

export interface ToolOutcome {
  ok: boolean;
  /** Texto que volta ao modelo. Curto, e sempre com a conduta. */
  message: string;
  /** Vale o modelo chamar a ferramenta de novo neste turno? */
  retriable: boolean;
}

export function explainSendResult(r: SendTemplateResult): ToolOutcome {
  if (r.sent) {
    return {
      ok: true,
      // "Não escreva mais nada" é explícito: sem isso o modelo tende a emendar um
      // texto livre depois do template — que a janela fechada recusaria.
      message:
        "template enviado ao contato. Não escreva mais nada neste turno: fora da " +
        "janela de 24 horas só template é aceito, e a mensagem já saiu.",
      retriable: false,
    };
  }

  switch (r.reason) {
    case "missing_values":
      return {
        ok: false,
        message:
          `faltou valor para o(s) parâmetro(s): ${r.missing.join(", ")}. ` +
          "Preencha todos e chame a ferramenta de novo.",
        retriable: true,
      };
    case "stale":
      return {
        ok: false,
        message:
          "este template mudou na Meta desde que foi configurado e os parâmetros " +
          "salvos não valem mais. Não tente outro valor — encerre o turno; um humano " +
          "precisa reconfigurar.",
        retriable: false,
      };
    case "missing":
      return {
        ok: false,
        message:
          "este template não existe mais na conta do WhatsApp. Encerre o turno sem " +
          "enviar; um humano precisa escolher outro.",
        retriable: false,
      };
    case "not_approved":
      return {
        ok: false,
        message:
          "este template não está aprovado na Meta e não pode ser enviado. Encerre o " +
          "turno; um humano precisa resolver a aprovação.",
        retriable: false,
      };
    case "api_error":
      return {
        ok: false,
        // O código e o detalhe da Meta entram porque são o que um humano lendo o log
        // precisa para agir — mas a CONDUTA do modelo é a mesma: parar.
        message:
          `o canal recusou o envio (${r.code ?? "sem código"}): ${r.message}. ` +
          "Encerre o turno sem tentar de novo.",
        retriable: false,
      };
  }
}
