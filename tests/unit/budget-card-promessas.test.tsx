import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * O CARD DE ORÇAMENTO NÃO PODE PROMETER O QUE O MOTOR NÃO FAZ.
 *
 * Este arquivo guarda três frases visíveis — e cada uma existe porque a versão
 * anterior dela era falsa numa instalação real:
 *
 *  1. **"Parar a IA ao chegar em US$ X" sem ressalva.** O gasto que decide vem de
 *     `llm_calls.cost_cents`, e `lib/agent-engine/edge/llm/pricing.ts` casa o
 *     `model` por PREFIXO contra três chaves da Anthropic. Um id de gateway
 *     (`anthropic/claude-sonnet-4-6`) ou da OpenRouter (`z-ai/glm-4.7`) não casa
 *     nenhuma, o custo é gravado NULO, e o gasto somado fica menor que o real —
 *     no limite, zero. Nessa instalação o card prometia uma parada que nunca
 *     dispararia, com "US$ 0,00 gastos" na tela e o dinheiro saindo.
 *  2. **"Período iniciado em <data>".** O rótulo vinha de `current_period_start`,
 *     coluna cujo único escritor (`runBudgetReset`) nunca teve agendador e foi
 *     apagada; o gasto ao lado dela passou a vir de `fn_gasto_de_ia_do_mes`, que
 *     soma o MÊS CORRENTE. Numa organização nascida em março o card dizia
 *     "Período iniciado em 2026-03-01" ao lado do gasto de agosto.
 *  3. **'Disponível depois de um tempo em "Me avisar"'.** A regra do servidor é
 *     de ESTADO (`modoAntes !== 'off'`), não de tempo: dá para salvar "Me avisar",
 *     reabrir e armar a parada em segundos. Quem garante tempo é a carência.
 *
 * Rótulo visível é contrato. As três eram afirmações sobre o comportamento do
 * produto, e as três eram falsas.
 */

vi.mock("@/lib/api/client", () => ({
  apiClient: { get: vi.fn(), patch: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));

import { BudgetCard } from "@/components/ai/BudgetCard";
import type { BudgetStatus } from "@/lib/ai/budget/check";

function estado(over: Partial<BudgetStatus> = {}): BudgetStatus {
  return {
    organization_id: "22222222-2222-4222-8222-222222222222",
    monthly_limit_cents: 5000,
    current_month_consumed_cents: 1234,
    pct: 24.68,
    alarm_threshold_pct: 80,
    enforcement_mode: "off",
    enforcement_effective_at: null,
    enforcement_env: "on",
    blocked_now: false,
    gasto_incompleto: false,
    // Propositalmente ANTIGO: é o valor que a coluna congelada devolve para uma
    // organização instalada meses atrás.
    current_period_start: "2026-03-01",
    last_alarm_sent_at: null,
    updated_at: "2026-08-15T00:00:00.000Z",
    ...over,
  };
}

function montar(status: BudgetStatus) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BudgetCard initialData={status} isAdmin />
    </QueryClientProvider>,
  );
}

describe("o card diz a verdade sobre a MEDIÇÃO", () => {
  it("com modelo sem preço conhecido, avisa que o gasto está incompleto", () => {
    montar(estado({ gasto_incompleto: true }));
    const aviso = screen.getByTestId("aviso-medicao-incompleta");
    expect(aviso.textContent ?? "").toMatch(/não sabe.*preço do modelo/iu);
    expect(
      aviso.textContent ?? "",
      "a ressalva precisa dizer a CONSEQUÊNCIA — o número é menor e a parada pode não disparar",
    ).toMatch(/menor que o real/iu);
  });

  it("com a medição completa, o aviso NÃO aparece (controle negativo)", () => {
    // Uma ressalva permanente é ruído, e ruído permanente treina a pessoa a não
    // ler a faixa no dia em que ela importa.
    montar(estado({ gasto_incompleto: false }));
    expect(screen.queryByTestId("aviso-medicao-incompleta")).toBeNull();
  });
});

describe("o card diz a verdade sobre o PERÍODO", () => {
  it("não repete `current_period_start` — o gasto ao lado é o do mês corrente", () => {
    montar(estado());
    expect(
      screen.queryByText(/2026-03-01/),
      "o rótulo do período contradiz o número que ele rotula",
    ).toBeNull();
  });

  it("nomeia o mês corrente, derivado do mesmo relógio da régua", () => {
    montar(estado());
    const agora = new Date();
    const mes = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1))
      .toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
    expect(screen.getByText(new RegExp(`Gasto de ${mes}`, "iu"))).toBeInTheDocument();
  });
});

describe("o card diz a verdade sobre a PARADA", () => {
  it("no modo bloquear já vigente, promete a fila humana E o caminho de volta", () => {
    // `performHumanHandoff` grava `force_human = true`, e o ÚNICO escritor de
    // `force_human = false` no repositório é `lib/escalacao/retomada.ts`,
    // acionado por um botão POR CONVERSA. Prometer que "volta sozinho ao virar o
    // mês" seria mandar a pessoa esperar por algo que não acontece.
    montar(
      estado({
        enforcement_mode: "bloquear",
        enforcement_effective_at: "2026-01-01T00:00:00.000Z",
      }),
    );
    const frase = screen.getByText(/A IA para de responder ao chegar em/);
    expect(frase.textContent ?? "").toMatch(/fila de atendimento humano/iu);
    expect(
      frase.textContent ?? "",
      "sem o caminho de volta, quem lê acha que aumentar o limite religa as conversas paradas",
    ).toMatch(/uma a uma/iu);
  });

  it("a faixa do kill switch aparece quando a instalação afrouxa a proteção", () => {
    // Um controle que o processo ignora é pior que controle nenhum.
    //
    // A faixa deixou de citar `AI_BUDGET_ENFORCEMENT=off` e passou a apontar a
    // TELA (Comportamento, no Admin), porque a escolha deixou de morar só no
    // `.env` — o `.env` virou piso, e quem manda é o banco (issue #1034). Cobrar
    // o nome da variável aqui mandaria o leitor a um lugar onde mexer já não
    // resolve; o que a faixa precisa entregar é o mesmo de antes: dizer que o
    // controle não vale AGORA e para onde ir.
    montar(estado({ enforcement_mode: "bloquear", enforcement_env: "off" }));
    const faixa = screen.getByText(/proteção de gasto está desligada nesta instalação/iu);
    expect(faixa.textContent ?? "").toMatch(/não vale/iu);
    expect(
      faixa.textContent ?? "",
      "sem o destino, a pessoa sabe que o controle não vale e não sabe onde religar",
    ).toMatch(/Comportamento/u);
  });

  it("no modo só-avisar, a faixa diz que a IA continua respondendo — e onde foi escolhido", () => {
    // O par do caso acima: `avisar` é o estado em que o botão existe, a pessoa
    // escolhe "Parar a IA" e nada para. Sem este caso, trocar o texto de um dos
    // dois ramos passaria batido.
    montar(estado({ enforcement_mode: "bloquear", enforcement_env: "avisar" }));
    const faixa = screen.getByText(/proteção só avisa/iu);
    expect(faixa.textContent ?? "").toMatch(/continuar respondendo/iu);
    expect(faixa.textContent ?? "").toMatch(/Comportamento/u);
  });
});
