import { readFileSync } from "node:fs";

import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DetalheDoCompromisso } from "@/components/agenda/DetalheDoCompromisso";
import { IdiomaProvider } from "@/lib/i18n/IdiomaProvider";

const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiClient: api }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1>,
}));

/**
 * A ANOTAÇÃO INTERNA DO COMPROMISSO APARECE PARA QUEM VAI ATENDER.
 *
 * ## O defeito que este arquivo vigia
 *
 * O assistente coleta a qualificação inteira do lead, marca a reunião e grava o
 * resumo na anotação do agendamento — coluna que a rota aceita, o handler
 * persiste e a ferramenta MCP oferece como "anotação INTERNA da equipe". Nenhuma
 * tela lia a coluna: quem ia atender chegava à reunião sem nada. O contraste
 * denunciava o buraco — no caminho da TRANSFERÊNCIA o mesmo resumo chegava, pelo
 * `reason` do handoff, e virava item visível na Central. Quanto melhor o
 * assistente trabalhava, menos o humano recebia.
 *
 * ## O que a régua mede — e o que ela NÃO mede
 *
 * Aqui se RENDERIZA o painel de detalhe com uma anotação gravada e se exige que
 * ela apareça, com o rótulo; e se renderiza sem anotação, exigindo que o bloco
 * não nasça vazio. Nada é medido por amostragem de texto: é o DOM.
 *
 * **NÃO MEDIDO aqui:** a leitura no banco. Quem a cobre é a asserção de forma do
 * `select` da rota, no fim do arquivo — o mesmo desenho de
 * `agenda-local-e-observacao-na-marcacao.test.ts`.
 *
 * ## As mutações que este arquivo reprova
 *
 *   · tirar a anotação do `select` da rota do detalhe — o defeito volta: a
 *     coluna é gravada e ninguém a lê;
 *   · apagar o bloco que a mostra no painel;
 *   · mostrar o bloco quando não há anotação (um rótulo órfão na tela);
 *   · levar a anotação para dentro de `listaAgendamentos`, que a devolveria ao
 *     assistente — que fala com o CLIENTE.
 */
const ANOTACAO =
  "Reunião — Clalber / Cloudtracking / SaaS / De 71 a 100 mil\nDecisor: o próprio Clalber";

const compromisso = {
  id: "appointment",
  title: "Reunião",
  description: null,
  notes: null as string | null,
  location_kind: null,
  location_details: null,
  // No PASSADO, de propósito: com o compromisso no futuro o painel desabilita as
  // decisões, e o que este arquivo mede é a LEITURA — que não depende disso.
  starts_at: "2026-09-02T12:00:00Z",
  ends_at: "2026-09-02T13:00:00Z",
  time_zone: "America/Sao_Paulo",
  status: "confirmed",
  revision: 1,
  contact_id: null,
  conversation_id: null,
  outcome_source_kind: null,
  outcome_recorded_at: null,
  recovery: null,
  evidence_messages: [],
};

let client: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});

function abrir() {
  render(
    <IdiomaProvider locale="pt-BR">
      <QueryClientProvider client={client}>
        <DetalheDoCompromisso id="appointment" onClose={() => {}} />
      </QueryClientProvider>
    </IdiomaProvider>,
  );
}

describe("a anotação interna do compromisso chega à tela de quem atende", () => {
  it("o painel do compromisso mostra o resumo que o assistente gravou", async () => {
    api.get.mockResolvedValue({ data: { ...compromisso, notes: ANOTACAO } });
    abrir();
    const bloco = await screen.findByTestId("compromisso-anotacao");
    expect(bloco.textContent).toContain("Reunião — Clalber / Cloudtracking / SaaS / De 71 a 100 mil");
    // As duas quebras de linha sobrevivem: o resumo é lido, não embaralhado.
    expect(bloco.textContent).toContain("Decisor: o próprio Clalber");
    // Com rótulo, e não o texto solto: a observação publicável pode estar logo
    // acima, e sem rótulo ninguém sabe qual das duas é interna.
    expect(bloco.textContent).toContain("Anotação");
  });

  it("sem anotação, o painel não inventa um rótulo órfão", async () => {
    api.get.mockResolvedValue({ data: { ...compromisso, notes: "   " } });
    abrir();
    await screen.findByTestId("compromisso-horario");
    expect(screen.queryByTestId("compromisso-anotacao")).toBeNull();
  });

  it("a rota do detalhe lê a coluna que o assistente escreve", () => {
    const get = readFileSync("app/api/v1/agenda/agendamentos/[id]/route.ts", "utf8");
    expect(get).toMatch(/select\(\s*"id,title,description,notes,location_kind,location_details,/);
  });

  it("a anotação NÃO entra na listagem — ela é interna, e a listagem também serve o assistente", () => {
    const consulta = readFileSync("lib/agenda/consulta.ts", "utf8");
    const inicio = consulta.indexOf('.from("calendar_appointments")');
    const bloco = consulta.slice(inicio, consulta.indexOf("contacts(name, display_name)", inicio));
    expect(bloco, "anotação na listagem volta a expor o texto interno ao assistente").not.toContain(
      "notes",
    );
  });
});
