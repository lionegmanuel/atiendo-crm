import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

/**
 * O EDITOR DE INSTRUÇÕES NÃO PODE COMER O TEXTO EM SILÊNCIO.
 *
 * ─── O defeito, medido em produção ──────────────────────────────────────────
 *
 * Um agente de atendimento rodou com o prompt cortado no meio de uma frase, e
 * ninguém soube. As CINCO versões salvas tinham exatamente 19.999 caracteres —
 * o teto é 20.000 — e a última terminava em "• Nunca".
 *
 * A causa: o `<Textarea>` declarava `maxLength={20000}`. O navegador aplica esse
 * atributo na COLAGEM, sem evento, sem erro e sem aviso: o que passa do limite
 * simplesmente não entra no campo. E o aviso que existia —
 * "As instruções passaram de 20.000 caracteres." — era inalcançável por
 * construção, porque o valor no estado nunca podia exceder o teto que o
 * atributo já tinha imposto.
 *
 * Um limite que corta sem avisar é pior que um limite que recusa: o autor
 * publica achando que publicou o que escreveu.
 *
 * ─── O que cada caso vigia ──────────────────────────────────────────────────
 *
 * O primeiro é o conserto: sem o atributo, o texto inteiro entra e o autor vê o
 * que colou. O segundo é o aviso que o atributo tornava morto — ele volta a
 * poder disparar, e é o que transforma "sumiu" em "não coube".
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/app/ai/agents/new",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

import { AgentForm } from "@/app/app/ai/agents/[id]/_components/AgentForm";

const CREDENCIAIS = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    provider: "anthropic",
    label: "chave da casa",
    is_active: true,
  },
];
const SESSOES = [
  { id: "22222222-2222-4222-8222-222222222222", label: "WhatsApp da clínica", status: "WORKING" },
];

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AgentForm
        mode="create"
        credentials={CREDENCIAIS as never}
        channelSessions={SESSOES as never}
      />
    </QueryClientProvider>,
  );
  // O campo de instruções é o único textarea em fonte monoespaçada da tela.
  const campos = screen.getAllByRole("textbox");
  const prompt = campos.find(
    (el) => el.tagName === "TEXTAREA" && el.className.includes("font-mono"),
  );
  if (!prompt) throw new Error("não achei o campo de instruções do agente");
  return prompt as HTMLTextAreaElement;
}

describe("editor de instruções do agente", () => {
  it("não declara maxLength — é o atributo que corta a colagem em silêncio", () => {
    const prompt = montar();
    expect(
      prompt.getAttribute("maxlength"),
      "com maxLength o navegador corta o texto colado sem avisar, e o autor publica menos do que escreveu",
    ).toBeNull();
  });

  it("guarda o texto inteiro quando ele passa do limite, em vez de comer o fim", () => {
    const prompt = montar();
    const gigante = "a".repeat(20_500);
    fireEvent.change(prompt, { target: { value: gigante } });
    expect(
      prompt.value.length,
      "o campo comeu o fim do texto — é exatamente assim que um prompt vira 19.999 caracteres",
    ).toBe(20_500);
  });

  it("mostra o tamanho contra o limite enquanto o autor escreve", () => {
    // O aviso que chega ANTES do erro: quem cola um texto grande vê na hora que
    // ele não cabe, em vez de descobrir no salvamento — ou nunca.
    const prompt = montar();
    fireEvent.change(prompt, { target: { value: "a".repeat(20_500) } });
    expect(screen.getByTestId("contador-do-prompt")).toHaveTextContent("20.500/20.000");
  });

  it("recusa o salvamento dizendo quanto passou", () => {
    const prompt = montar();
    fireEvent.change(prompt, { target: { value: "a".repeat(20_500) } });
    fireEvent.click(screen.getByRole("button", { name: /salvar|criar/i }));
    expect(
      screen.getByText(/corte 500 para conseguir salvar/i),
      "o aviso precisa dizer QUANTO cortar — sem isso o autor corta no escuro",
    ).toBeInTheDocument();
  });

  it("mede o texto como o servidor mede, sem contar espaço de sobra", () => {
    // O servidor grava `z.string().trim().max(20000)` — o trim roda ANTES do
    // max. Se a tela contasse os brancos, ela barraria texto que o servidor
    // aceita, e o autor ficaria preso sem entender o motivo.
    const prompt = montar();
    fireEvent.change(prompt, { target: { value: "a".repeat(20_000) + "\n\n   " } });
    expect(screen.getByTestId("contador-do-prompt")).toHaveTextContent("20.000/20.000");
    fireEvent.click(screen.getByRole("button", { name: /salvar|criar/i }));
    expect(screen.queryByText(/conseguir salvar/i)).not.toBeInTheDocument();
  });
});
