/**
 * O passo do telefone PERGUNTA antes de assumir o código no celular.
 *
 * ─── O defeito que este teste guarda ────────────────────────────────────────
 *
 * O produto conecta um número de três formas — código lido no celular, conta
 * oficial na Meta, e provedor parceiro —, e a tela de Conexões oferece as três.
 * O wizard oferecia UMA, e nem isso: ele não perguntava. A tela montava e o
 * primeiro efeito já disparava `POST /api/v1/onboarding/whatsapp/session`, que
 * grava a linha do canal sem informar a coluna do provedor — e ela nasce com o
 * default do transporte por código. Quem tinha conta oficial já estava no
 * caminho errado antes de clicar em coisa nenhuma, e só descobria depois, em
 * outra tela, com o funcionário já montado por cima.
 *
 * O teste cobra as DUAS metades, porque uma sem a outra não conserta nada:
 *   1. a pergunta aparece, com as três formas; e
 *   2. nada é criado enquanto ela não é respondida.
 *
 * A segunda é a que tem dente. Uma tela que pergunta e cria o canal mesmo assim
 * seria o controle decorativo que este repo já pagou caro (PR #295): a tela
 * oferece e o motor ignora.
 *
 * ─── E a metade que NÃO se vê ───────────────────────────────────────────────
 *
 * A escolha não pode ser gravada. `cumprido` do passo é `Boolean(state.whatsapp)`
 * (`lib/onboarding/passos.ts`), então persistir no clique marcaria o passo como
 * resolvido: quem fechasse o navegador cairia no passo seguinte sem telefone e
 * sem volta, porque o roteador só devolve o primeiro passo NÃO cumprido. O caso
 * "voltar para a pergunta" abaixo é o que guarda isso pela porta da frente —
 * se a escolha virasse estado gravado, ela não teria como voltar a ser nula.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/app/actions/onboarding/skipWhatsapp", () => ({
  skipWhatsapp: vi.fn(),
  markWhatsappConfigured: vi.fn(),
}));

/**
 * Os dois clientes de canal por credencial são substituídos por marcadores.
 * O que está sob teste é a BIFURCAÇÃO — que a escolha leve ao lugar certo —,
 * não o formulário deles, que tem dono e teste próprios em Conexões. Montá-los
 * de verdade traria `useQuery` e as rotas junto, e o teste passaria a falhar
 * por motivo alheio ao que ele afirma.
 */
vi.mock("@/components/connections/CanalOficialClient", () => ({
  CanalOficialClient: () => <div data-testid="dublê-oficial" />,
}));
vi.mock("@/components/connections/CanalParceiroClient", () => ({
  CanalParceiroClient: () => <div data-testid="dublê-parceiro" />,
}));

import { ConnectWhatsappClient } from "@/app/onboarding/connect-whatsapp/_client";

/** Toda chamada de rede que a tela tentar fazer passa por aqui. */
let chamadas: string[] = [];

beforeEach(() => {
  chamadas = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: { method?: string }) => {
      chamadas.push(`${init?.method ?? "GET"} ${String(url)}`);
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { status: "SCAN_QR_CODE", session: "org_teste" } }),
      } as unknown as Response;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function montar(props?: { oficialPodeReceber?: boolean }) {
  return render(
    <ConnectWhatsappClient
      wahaConfigured
      sessionName="org_teste"
      oficialPodeReceber={props?.oficialPodeReceber ?? true}
    />,
  );
}

/** As chamadas que CRIAM ou consultam a sessão do canal por código. */
function chamadasDeSessao(): string[] {
  return chamadas.filter((c) => c.includes("/onboarding/whatsapp/session"));
}

describe("o passo do telefone pergunta como a pessoa já usa o número", () => {
  it("abre com a pergunta e as três formas, não com o código", () => {
    montar();

    expect(screen.getByText(/como você já usa esse número/i)).toBeTruthy();
    expect(screen.getByTestId("forma-qr")).toBeTruthy();
    expect(screen.getByTestId("forma-oficial")).toBeTruthy();
    expect(screen.getByTestId("forma-parceiro")).toBeTruthy();

    // O código não pode estar na tela antes de alguém escolher lê-lo.
    expect(screen.queryByAltText(/código qr/i)).toBeNull();
  });

  it("NÃO cria a sessão do canal enquanto ninguém escolheu", () => {
    montar();

    // É este o defeito: o canal nascia só por a pessoa pisar na rota.
    expect(chamadasDeSessao()).toEqual([]);
  });

  it("escolher o código no celular é o que sobe a sessão", async () => {
    montar();
    expect(chamadasDeSessao()).toEqual([]);

    fireEvent.click(screen.getByTestId("forma-qr").querySelector("input")!);

    await waitFor(() => {
      expect(chamadasDeSessao().some((c) => c.startsWith("POST"))).toBe(true);
    });
  });

  it("escolher conta oficial leva ao canal oficial, e NÃO cria sessão de código", async () => {
    montar();

    fireEvent.click(screen.getByTestId("forma-oficial").querySelector("input")!);

    await waitFor(() => expect(screen.getByTestId("dublê-oficial")).toBeTruthy());
    expect(screen.queryByTestId("dublê-parceiro")).toBeNull();
    // O ponto todo: escolher outra forma não pode deixar um canal por código
    // pendurado, nem seguir consultando o transporte por trás do formulário.
    expect(chamadasDeSessao()).toEqual([]);
  });

  it("escolher provedor parceiro leva ao canal do parceiro", async () => {
    montar();

    fireEvent.click(screen.getByTestId("forma-parceiro").querySelector("input")!);

    await waitFor(() => expect(screen.getByTestId("dublê-parceiro")).toBeTruthy());
    expect(screen.queryByTestId("dublê-oficial")).toBeNull();
    expect(chamadasDeSessao()).toEqual([]);
  });

  it("dá para voltar e trocar de forma — escolher não tranca a porta", async () => {
    montar();

    fireEvent.click(screen.getByTestId("forma-oficial").querySelector("input")!);
    await waitFor(() => expect(screen.getByTestId("dublê-oficial")).toBeTruthy());

    fireEvent.click(screen.getByTestId("voltar-para-escolha"));

    // A pergunta volta inteira. Se a escolha fosse gravada em vez de viver em
    // memória, não haveria como desfazê-la — e o passo já estaria "cumprido".
    await waitFor(() => expect(screen.getByText(/como você já usa esse número/i)).toBeTruthy());
    expect(screen.getByTestId("forma-qr")).toBeTruthy();
  });

  it("as saídas existem já na pergunta — nenhum estado é beco", () => {
    montar();

    // c2f88e83: um aviso correto que nasceu sem botão prendeu quem instalava
    // sem chave. A pergunta é um estado novo, e estados novos precisam de saída.
    expect(screen.getByRole("button", { name: /pular por enquanto/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /conectei em outro lugar/i })).toBeTruthy();
  });

  it("avisa que o servidor ainda não recebe pelo caminho oficial, ANTES do formulário", async () => {
    montar({ oficialPodeReceber: false });

    fireEvent.click(screen.getByTestId("forma-oficial").querySelector("input")!);

    // O `install.sh` não escreve o valor de que a volta depende: numa instalação
    // recém-feita este é o estado NORMAL, e a hora de dizer isso é antes de a
    // pessoa ir buscar três credenciais no painel — não depois de conectar.
    await waitFor(() =>
      expect(screen.getByText(/ainda não está pronto para RECEBER/i)).toBeTruthy(),
    );
  });

  it("com o servidor pronto, o aviso não aparece", async () => {
    montar({ oficialPodeReceber: true });

    fireEvent.click(screen.getByTestId("forma-oficial").querySelector("input")!);

    await waitFor(() => expect(screen.getByTestId("dublê-oficial")).toBeTruthy());
    expect(screen.queryByText(/ainda não está pronto para RECEBER/i)).toBeNull();
  });
});
