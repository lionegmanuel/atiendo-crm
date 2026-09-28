import { describe, expect, it } from "vitest";

import { podarHistoricoDeCaptacao } from "@/lib/webhooks/retencao-da-captacao";
import {
  RETENCAO_CAPTACAO_DIAS_PADRAO,
  RETENCAO_CAPTACAO_DIAS_PISO,
} from "@/lib/retencao/politica";

/**
 * O PISO É A PARTE QUE DECIDE — e é onde uma poda vira apagador de evidência.
 *
 * `webhook_lead_captures` responde DE ONDE um contato veio: a página, o IP, a
 * campanha, o consentimento implícito de ter preenchido. Um horizonte curto
 * demais — por engano no `.env`, ou por alguém querendo "limpar o banco" —
 * transforma a poda no instrumento que apaga justamente isso.
 *
 * Por isso o piso mora no CÓDIGO QUE APAGA, e não em quem chama: `LEAD_CAPTURE_
 * RETENTION_DAYS=1` no `.env` não pode virar "apague tudo de ontem". Estes
 * casos são o que impede a proteção de sumir num refactor.
 *
 * Os demais casos são sobre o que a poda NÃO faz: não filtra por organização
 * (não sabe ser dirigida), não pede lote sem teto (não segura a tabela), e — no
 * que o #1721 mudou de doutrina — não engole a falha do banco. A ordem do
 * DELETE e o canal de reporte da falha são medidos em
 * `retencao-captacao-ordena-e-fala-a-falha.test.ts`, que é o arquivo criado
 * junto com o conserto.
 *
 * A política (padrão, piso, aviso) vem de `lib/retencao/politica.ts`, o mesmo
 * módulo da poda da fila e do expurgo da auditoria — estes casos provam que ela
 * é OBEDECIDA aqui, não que ela existe (isso é do teste daquele módulo).
 */

interface Pedido {
  tabela: string;
  op: string;
  limiteRecebido?: string;
  colunaDoLt?: string;
  loteRecebido?: number;
  filtrouOrganizacao: boolean;
}

/** Duble mínimo do client: registra o que foi pedido, devolve o que mandarem. */
function fakeAdmin(resposta: { data?: { id: string }[]; error?: { message: string } } = {}) {
  const pedidos: Pedido[] = [];
  const admin = {
    from(tabela: string) {
      const p: Pedido = { tabela, op: "", filtrouOrganizacao: false };
      const q: Record<string, unknown> = {
        delete() {
          p.op = "delete";
          return q;
        },
        lt(coluna: string, valor: string) {
          p.colunaDoLt = coluna;
          p.limiteRecebido = valor;
          return q;
        },
        eq(coluna: string) {
          if (coluna === "organization_id") p.filtrouOrganizacao = true;
          return q;
        },
        select() {
          return q;
        },
        // O `order` existe no dublê porque a poda o chama (issue #1721) — sem
        // isto o teste do PISO quebraria por um detalhe de superfície, e o
        // defeito (a ordem) ficaria escondido atrás de um erro de dublê.
        order() {
          return q;
        },
        limit(n: number) {
          p.loteRecebido = n;
          pedidos.push(p);
          return Promise.resolve({
            data: resposta.data ?? [],
            error: resposta.error ?? null,
          });
        },
      };
      return q;
    },
  };
  return { admin: admin as never, pedidos };
}

/** Quantos dias atrás está o limite que a poda mandou ao banco. */
function diasNoLimite(iso: string): number {
  return Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

describe("poda do histórico de captação — o piso", () => {
  it("um horizonte ABAIXO do piso é elevado ao piso, não obedecido", () => {
    const { admin, pedidos } = fakeAdmin();
    return podarHistoricoDeCaptacao(admin, { diasBrutos: "1" }).then((r) => {
      expect(r.diasAplicados).toBe(RETENCAO_CAPTACAO_DIAS_PISO);
      expect(diasNoLimite(pedidos[0]!.limiteRecebido!)).toBe(RETENCAO_CAPTACAO_DIAS_PISO);
    });
  });

  it("zero não desliga a poda nem apaga tudo — e cai no PADRÃO, não no piso", () => {
    // `0` é o valor que alguém escreve querendo "sem retenção". Interpretá-lo
    // ao pé da letra apagaria o histórico inteiro na primeira rodada.
    //
    // E o desfecho é o PADRÃO (365), não o piso (30): `interpretarRetencao`
    // trata `<= 0` como LIXO, e lixo resolve para o lado seguro — que aqui é
    // guardar mais, não menos. Escrevi este caso esperando o piso e o módulo
    // canônico provou estar mais certo que eu: cair no piso encurtaria a
    // retenção de um ano para um mês por causa de um zero digitado.
    const { admin } = fakeAdmin();
    return podarHistoricoDeCaptacao(admin, { diasBrutos: "0" }).then((r) => {
      expect(r.diasAplicados).toBe(RETENCAO_CAPTACAO_DIAS_PADRAO);
    });
  });

  it("NEGATIVO também cai no padrão — nunca vira uma data no futuro", () => {
    // Sem a guarda, `-30` daria um limite 30 dias À FRENTE de agora, e o
    // `lt(received_at, limite)` apagaria o histórico INTEIRO, inclusive o de
    // hoje. É o pior desfecho possível desta função.
    const { admin, pedidos } = fakeAdmin();
    return podarHistoricoDeCaptacao(admin, { diasBrutos: "-30" }).then((r) => {
      expect(r.diasAplicados).toBe(RETENCAO_CAPTACAO_DIAS_PADRAO);
      expect(diasNoLimite(pedidos[0]!.limiteRecebido!)).toBeGreaterThan(0);
    });
  });

  it("um horizonte ACIMA do piso é obedecido — o piso é chão, não teto", () => {
    const { admin, pedidos } = fakeAdmin();
    return podarHistoricoDeCaptacao(admin, { diasBrutos: "365" }).then((r) => {
      expect(r.diasAplicados).toBe(365);
      expect(diasNoLimite(pedidos[0]!.limiteRecebido!)).toBe(365);
    });
  });

  it("o piso não é generoso demais a ponto de nunca podar", () => {
    // Controle da direção oposta: um piso alto demais (digamos, 3650) faria a
    // poda existir no papel e nunca agir. 30 dias é curto o bastante para o
    // default de 365 mandar mais que o piso.
    expect(RETENCAO_CAPTACAO_DIAS_PISO).toBeGreaterThanOrEqual(30);
    expect(RETENCAO_CAPTACAO_DIAS_PISO).toBeLessThan(RETENCAO_CAPTACAO_DIAS_PADRAO);
  });
});

describe("poda do histórico de captação — o que ela NÃO faz", () => {
  it("não sabe escolher organização — não é apagador dirigido", () => {
    const { admin, pedidos } = fakeAdmin();
    return podarHistoricoDeCaptacao(admin, { diasBrutos: "365" }).then(() => {
      expect(pedidos[0]!.filtrouOrganizacao).toBe(false);
    });
  });

  it("varre pela ponta mais velha, por received_at (a coluna do índice da 0174)", () => {
    const { admin, pedidos } = fakeAdmin();
    return podarHistoricoDeCaptacao(admin, { diasBrutos: "365" }).then(() => {
      expect(pedidos[0]!.tabela).toBe("webhook_lead_captures");
      expect(pedidos[0]!.op).toBe("delete");
      expect(pedidos[0]!.colunaDoLt).toBe("received_at");
    });
  });

  it("pede no máximo o tamanho do lote — nunca uma varredura sem teto", () => {
    const { admin, pedidos } = fakeAdmin();
    return podarHistoricoDeCaptacao(admin, { diasBrutos: "365", lote: 42 }).then(() => {
      expect(pedidos[0]!.loteRecebido).toBe(42);
    });
  });

  it("lote CHEIO significa fila — a próxima rodada continua", () => {
    const cheio = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}` }));
    const { admin } = fakeAdmin({ data: cheio });
    return podarHistoricoDeCaptacao(admin, { diasBrutos: "365", lote: 10 }).then((r) => {
      expect(r.apagadas).toBe(10);
      expect(r.temMais).toBe(true);
    });
  });

  it("lote com FOLGA significa que acabou", () => {
    const { admin } = fakeAdmin({ data: [{ id: "c1" }] });
    return podarHistoricoDeCaptacao(admin, { diasBrutos: "365", lote: 10 }).then((r) => {
      expect(r.temMais).toBe(false);
    });
  });

  it("erro do banco SOBE — a poda não engole a falha (issue #1721)", async () => {
    // Este caso mudou de doutrina no #1721, e é a mudança que a issue pediu.
    // Antes: `logger.warn` + `{ apagadas: 0 }`, porque o cron do arquivo
    // forense roda antes e uma exceção aqui perderia aquele trabalho. O
    // conserto é do MESMOJEITO que a casa já aplicou nas podas irmãs: a falha
    // sobe, e quem chama a pega num `try` PRÓPRIO — cada lote fecha a sua
    // transação, então o que já foi apagado no banco não se perde com ela.
    //
    // O que NÃO pode voltar é o `apagadas: 0`: na resposta do cron, "o banco
    // recusou o DELETE" e "não havia nada vencido" eram a mesma linha, e o
    // único sinal vivia num log de contêiner. O canal da falha agora é o das
    // irmãs — medido em `retencao-captacao-ordena-e-fala-a-falha.test.ts`.
    const { admin } = fakeAdmin({ error: { message: "connection reset" } });
    await expect(podarHistoricoDeCaptacao(admin, { diasBrutos: "365" })).rejects.toThrow(
      /webhook_lead_captures: connection reset/,
    );
  });
});

describe("poda do histórico de captação — a chave ausente e o lixo", () => {
  it("chave AUSENTE usa o padrão sem aviso — é o caminho de toda instalação que nunca editou .env", () => {
    const { admin, pedidos } = fakeAdmin();
    return podarHistoricoDeCaptacao(admin, { diasBrutos: undefined }).then((r) => {
      expect(r.diasAplicados).toBe(RETENCAO_CAPTACAO_DIAS_PADRAO);
      expect(diasNoLimite(pedidos[0]!.limiteRecebido!)).toBe(RETENCAO_CAPTACAO_DIAS_PADRAO);
    });
  });

  it("valor NÃO-NUMÉRICO cai no padrão, não no piso — lixo não encurta a retenção", () => {
    // `LEAD_CAPTURE_RETENTION_DAYS=trezentos` digitado às 2h não pode virar
    // "apague tudo com mais de 30 dias". Lixo resolve para o lado SEGURO, que
    // aqui é guardar mais, não menos.
    const { admin } = fakeAdmin();
    return podarHistoricoDeCaptacao(admin, { diasBrutos: "trezentos" }).then((r) => {
      expect(r.diasAplicados).toBe(RETENCAO_CAPTACAO_DIAS_PADRAO);
    });
  });

  it("sufixo silencioso é lixo, não 365 — `365d` não passa como número", () => {
    const { admin } = fakeAdmin();
    return podarHistoricoDeCaptacao(admin, { diasBrutos: "365d" }).then((r) => {
      expect(r.diasAplicados).toBe(RETENCAO_CAPTACAO_DIAS_PADRAO);
    });
  });
});
