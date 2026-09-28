/**
 * Dropdown digitável do endereço, com a opção de salvar.
 *
 * O que esta suíte protege: ao marcar, o endereço deixa de ser um campo solto.
 * Digitar filtra o que a clínica já usou; um texto novo oferece "salvar para
 * os próximos". Sem o POST o endereço só vive neste compromisso — e some.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EnderecoDaMarcacao } from "./EnderecoDaMarcacao";

const get = vi.fn();
const post = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
}));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (s: string) => s }));

function envolver(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function Campo({ onChange = vi.fn() }: { onChange?: (s: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <EnderecoDaMarcacao
      value={value}
      onChange={(s) => {
        setValue(s);
        onChange(s);
      }}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ data: { addresses: ["Sala 1", "Unidade Centro"] } });
  post.mockResolvedValue({ data: { address: "Sala 2" } });
});

describe("EnderecoDaMarcacao", () => {
  it("filtra os endereços já usados ao digitar", async () => {
    const user = userEvent.setup();
    envolver(<Campo />);

    await user.type(screen.getByLabelText(/Endereço/i), "Sala");

    await waitFor(() => expect(screen.getByRole("option", { name: "Sala 1" })).toBeInTheDocument());
    expect(screen.queryByRole("option", { name: "Unidade Centro" })).not.toBeInTheDocument();
  });

  it("oferece salvar quando o texto ainda não está na lista", async () => {
    get.mockResolvedValue({ data: { addresses: ["Sala 1"] } });
    const user = userEvent.setup();
    envolver(<Campo />);

    await user.type(screen.getByLabelText(/Endereço/i), "Sala 2");

    await waitFor(() =>
      expect(screen.getByTestId("salvar-endereco")).toBeInTheDocument(),
    );
  });

  it("NÃO oferece salvar quando o texto já é um endereço conhecido", async () => {
    const user = userEvent.setup();
    envolver(<Campo />);

    await user.type(screen.getByLabelText(/Endereço/i), "Sala 1");

    await waitFor(() => expect(screen.getByRole("option", { name: "Sala 1" })).toBeInTheDocument());
    expect(screen.queryByTestId("salvar-endereco")).not.toBeInTheDocument();
  });

  it("escolher na lista preenche o campo", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    envolver(<Campo onChange={onChange} />);

    await user.type(screen.getByLabelText(/Endereço/i), "Sala");
    await waitFor(() => expect(screen.getByRole("option", { name: "Sala 1" })).toBeInTheDocument());
    await user.click(screen.getByRole("option", { name: "Sala 1" }));

    expect(onChange).toHaveBeenCalledWith("Sala 1");
  });

  it("salvar grava o texto digitado e devolve o endereço escolhido", async () => {
    get.mockResolvedValue({ data: { addresses: [] } });
    const onChange = vi.fn();
    const user = userEvent.setup();
    envolver(<Campo onChange={onChange} />);

    await user.type(screen.getByLabelText(/Endereço/i), "Sala 2");
    await waitFor(() => expect(screen.getByTestId("salvar-endereco")).toBeInTheDocument());
    await user.click(screen.getByTestId("salvar-endereco"));

    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]?.[1]).toEqual({ address: "Sala 2" });
    expect(onChange).toHaveBeenCalledWith("Sala 2");
  });
});
