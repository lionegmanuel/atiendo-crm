import { describe, expect, it } from "vitest";

import { avaliarRespostaDeTeste } from "@/lib/ai/agents/avaliar-resposta-de-teste";
import { BEFORE_SEND_GATES } from "@/lib/agent-engine/guardrails/before-send";

/**
 * O botão "Testar" avalia a resposta — e diz o que não avaliou.
 *
 * O defeito que isto conserta: a rota de teste chama o runtime `@deprecated`,
 * que não importa `runBeforeSend`. Medido em 2026-08-05, com controle positivo:
 * nenhum literal da cadeia (`internal_vocabulary`, `case_promise_without_case`,
 * `messaging_window_closed`) aparece no build do app Next. O self-hoster testava,
 * via limpo, publicava, e produção divergia.
 */
describe("avaliação da resposta no botão Testar", () => {
  it("pega o vazamento REAL medido em produção", () => {
    // O texto é o que um modelo de verdade respondeu (RELATORIO da medição,
    // cenário 7): código de erro cru copiado do resultado da ferramenta.
    const r = avaliarRespostaDeTeste(
      "As execuções mais recentes deram erro na ação de webhook: unsafe_url:https_required",
    );
    expect(r.passou).toBe(false);
    expect(r.termos.length).toBeGreaterThan(0);
  });

  it("aprova a resposta traduzida — a que o gate produziu depois do veto", () => {
    // Também medida: é o que o cliente recebeu depois de o modelo reescrever.
    // Se isto reprovasse, o teste viraria ruído e o time desligaria a checagem.
    const r = avaliarRespostaDeTeste(
      "Verifiquei as regras automáticas. A integração foi bloqueada porque o endereço " +
        "configurado não atende ao requisito de conexão segura. Posso encaminhar para a equipe.",
    );
    expect(r.passou).toBe(true);
    expect(r.termos).toEqual([]);
  });

  it("resposta ausente NÃO é aprovada por omissão", () => {
    // "Sem texto, logo passou" seria o mesmo silêncio-que-parece-aprovação que
    // este módulo existe para corrigir.
    expect(avaliarRespostaDeTeste(undefined).naoAvaliados.length).toBeGreaterThan(0);
  });

  it("declara o que NÃO avaliou — a lista é o conserto, não um detalhe", () => {
    const r = avaliarRespostaDeTeste("olá, tudo bem?");
    expect(r.passou).toBe(true);
    // Passar sem dizer o que ficou de fora é a mentira mais bonita: tem
    // aparência de prova e não é.
    expect(r.naoAvaliados.length).toBeGreaterThan(0);
    for (const n of r.naoAvaliados) {
      expect(n.porque, `${n.gate} sem motivo legível`).not.toBe("");
    }
  });

  it("o motivo de cada não-avaliado é escrito para o DONO DO NEGÓCIO", () => {
    // A lista aparece na tela de quem configura. "depende do send_ledger" não
    // informa nada a um dono de clínica — e repetiria, na tela de configuração,
    // o mesmo defeito de vocabulário que a spec 16 existe para matar.
    const texto = avaliarRespostaDeTeste("oi")
      .naoAvaliados.map((n) => n.porque)
      .join(" ")
      .toLowerCase();
    for (const jargao of ["ledger", "send_", "gate", "trace", "payload", "jsonb"]) {
      expect(texto, `jargão no motivo mostrado ao usuário: ${jargao}`).not.toContain(jargao);
    }
  });

  it("a lista de não-avaliados cobre os gates da cadeia REAL — não uma lista inventada", () => {
    // Amarra a declaração à cadeia de verdade: se alguém acrescentar um gate a
    // `BEFORE_SEND_GATES`, este teste vermelha e força a decisão de que lado ele
    // cai — avaliável no teste, ou declarado como não-avaliável.
    const declarados = new Set(avaliarRespostaDeTeste("oi").naoAvaliados.map((n) => n.gate));
    // `internal_vocabulary` é o único que o teste consegue avaliar; todos os
    // outros da cadeia têm de estar declarados.
    const esperados = BEFORE_SEND_GATES.map((g) => g.name).filter((n) => n !== "internal_vocabulary");
    expect([...declarados].sort()).toEqual([...esperados].sort());
  });
});
