/**
 * A GRADE DO ATENDENTE VÊ A OCUPAÇÃO DO GOOGLE DA DONA — PELA FUNÇÃO,
 * NÃO PELA SESSÃO. (issue #896, item 3)
 *
 * ─── O defeito ──────────────────────────────────────────────────────────────
 *
 * A ocupação do Google era lida em `calendar_selected_external_events` com o
 * embed `calendar_connections!inner`, PELA SESSÃO de quem abriu a tela. A RLS
 * de `calendar_connections` só deixa ver a conexão do próprio usuário (o papel
 * não abre exceção), então para o Atendente a leitura devolvia — no melhor caso
 * — a ocupação DELE. O horário do Google da dona não existia na grade, e o
 * clique era recusado no servidor com uma frase que apontava para o lugar
 * errado: "fora dos horários que você publicou".
 *
 * O conserto é ler por `fn_agenda_ocupacao_google_do_dono` (migration 0260 —
 * `security definer`, dono por parâmetro `p_owner`), com a lista de donos vinda
 * do servidor (`donosDaAgenda()`). A RLS deixa de ser o filtro.
 *
 * ─── Como este teste reprova a volta ────────────────────────────────────────
 *
 * O cliente falso IMITA A RLS: `from("calendar_selected_external_events")`
 * devolve só as linhas da conexão de quem olha. Se a leitura voltar a passar
 * pela sessão, o compromisso da dona desaparece das duas provas de uma vez —
 * `c.froms` deixa de ser vazio e a lista de blocos perde a dona.
 *
 * ─── O que NÃO passa por aqui ───────────────────────────────────────────────
 *
 * O teste mede a LEITURA e a FRASE. Não mede banco de verdade (sem Docker nesta
 * máquina): a `fn_agenda_ocupacao_google_do_dono` é falsificada aqui, com as
 * cinco colunas que a migration declara.
 */
import { describe, expect, it } from "vitest";

import { razaoDoBloco } from "@/lib/agenda/grade-interativa";
import { lerOcupacaoExterna } from "@/lib/agenda/ocupacao-externa";

const ORG = "org-1";
const DONA = "u-dona";
const ATENDENTE = "u-atendente";
/** Um dono cuja leitura falha — para medir que a falha de UM não apaga os outros. */
const DONO_QUE_FALHA = "u-quebrado";

const RECORTE = {
  organizationId: ORG,
  de: "2026-09-16T12:00:00.000Z",
  ate: "2026-09-16T18:00:00.000Z",
};

/** Uma linha de `calendar_selected_external_events` como o banco a guarda. */
type LinhaDaConexao = {
  starts_at: string;
  ends_at: string;
  transparency?: string | null;
  status?: string | null;
  /** Dono da conexão — é por aqui que a RLS da sessão corta. */
  dono: string;
};

const COMPROMISSO_DA_DONA: LinhaDaConexao = {
  starts_at: "2026-09-16T14:00:00.000Z",
  ends_at: "2026-09-16T15:00:00.000Z",
  dono: DONA,
};

/** No Google, `transparent` é "livre": existe e não ocupa. */
const LIVRE_DA_DONA: LinhaDaConexao = {
  starts_at: "2026-09-16T15:00:00.000Z",
  ends_at: "2026-09-16T16:00:00.000Z",
  transparency: "transparent",
  dono: DONA,
};

const COMPROMISSO_DO_ATENDENTE: LinhaDaConexao = {
  starts_at: "2026-09-16T16:00:00.000Z",
  ends_at: "2026-09-16T17:00:00.000Z",
  dono: ATENDENTE,
};

const LINHAS = [COMPROMISSO_DA_DONA, LIVRE_DA_DONA, COMPROMISSO_DO_ATENDENTE];

/**
 * Cliente falso com a RLS de `calendar_connections` NO CAMINHO DA SESSÃO.
 *
 * `from(...)` responde como a sessão responderia para `quemOlha`; `rpc(...)`
 * responde como a função `security definer` responde, para o dono que ela
 * recebeu em `p_owner`. É a diferença entre os dois caminhos que este arquivo
 * mede.
 */
function clienteComRls(quemOlha: string) {
  const froms: string[] = [];
  const rpcs: Array<{ nome: string; args: Record<string, unknown> }> = [];

  // A linha como a SESSÃO a vê, com o embed que a leitura antiga pedia. É de
  // propósito que o embed venha preenchido: se a leitura voltar a passar por
  // aqui, ela roda e o teste falha nas ASSERÇÕES (blocos e `froms`), não num
  // TypeError de fixture — a prova fica limpa.
  const colunas = (linha: LinhaDaConexao) => ({
    id: `conexao:${linha.dono}:${linha.starts_at}`,
    starts_at: linha.starts_at,
    ends_at: linha.ends_at,
    transparency: linha.transparency ?? null,
    status: linha.status ?? null,
    calendar_connections: { user_id: linha.dono },
  });

  /** Encadeável que aceita QUALQUER filtro do PostgREST e resolve as linhas. */
  const encadeavelCom = (visiveis: Array<Record<string, unknown>>) => {
    const encadeavel: Record<string, unknown> = new Proxy(
      {},
      {
        get: (_alvo, propriedade) => {
          if (propriedade === "then") {
            return (resolver: (valor: unknown) => unknown) =>
              resolver({ data: visiveis, error: null });
          }
          return () => encadeavel;
        },
      },
    );
    return encadeavel;
  };

  const cliente = {
    from(tabela: string) {
      froms.push(tabela);
      // A sessão só enxerga a conexão de quem olha.
      const visiveis =
        tabela === "calendar_selected_external_events"
          ? LINHAS.filter((linha) => linha.dono === quemOlha).map(colunas)
          : [];
      return encadeavelCom(visiveis);
    },
    async rpc(nome: string, args: Record<string, unknown>) {
      rpcs.push({ nome, args });
      const dono = args.p_owner;
      if (dono === DONO_QUE_FALHA) {
        return { data: null, error: { message: "permission denied (falsificado)" } };
      }
      return {
        data: LINHAS.filter((linha) => linha.dono === dono).map(colunas),
        error: null,
      };
    },
  };

  return { cliente, froms, rpcs };
}

const comoCliente = (falso: ReturnType<typeof clienteComRls>["cliente"]) =>
  falso as unknown as Parameters<typeof lerOcupacaoExterna>[0];

type Blocos = Awaited<ReturnType<typeof lerOcupacaoExterna>>["blocos"];

/** A conta que a grade faz para decidir se a fatia encosta num compromisso. */
function fatiaOcupada(blocos: Blocos, inicio: string, fim: string): boolean {
  const de = new Date(inicio).getTime();
  const ate = new Date(fim).getTime();
  return blocos.some(
    (bloco) => new Date(bloco.iniciaEm).getTime() < ate && new Date(bloco.terminaEm).getTime() > de,
  );
}

describe("lerOcupacaoExterna — a ocupação do dono chega para quem não é dono", () => {
  it("o Atendente recebe o compromisso da dona, e nada é lido pela sessão", async () => {
    const falso = clienteComRls(ATENDENTE);

    const leitura = await lerOcupacaoExterna(comoCliente(falso.cliente), RECORTE, [
      DONA,
      ATENDENTE,
    ]);

    expect(leitura.erro).toBeNull();
    expect(leitura.blocos).toEqual([
      {
        id: `${DONA}:2026-09-16T14:00:00.000Z:2026-09-16T15:00:00.000Z`,
        donoId: DONA,
        iniciaEm: "2026-09-16T14:00:00.000Z",
        terminaEm: "2026-09-16T15:00:00.000Z",
      },
      {
        id: `${ATENDENTE}:2026-09-16T16:00:00.000Z:2026-09-16T17:00:00.000Z`,
        donoId: ATENDENTE,
        iniciaEm: "2026-09-16T16:00:00.000Z",
        terminaEm: "2026-09-16T17:00:00.000Z",
      },
    ]);

    // A prova de que a RLS deixou de ser o filtro: NADA foi pedido à sessão.
    expect(falso.froms).toEqual([]);

    // E a pergunta foi feita POR DONO, à função, dentro da organização e do recorte.
    expect(falso.rpcs).toEqual([
      {
        nome: "fn_agenda_ocupacao_google_do_dono",
        args: { p_org: ORG, p_owner: DONA, p_de: RECORTE.de, p_ate: RECORTE.ate },
      },
      {
        nome: "fn_agenda_ocupacao_google_do_dono",
        args: { p_org: ORG, p_owner: ATENDENTE, p_de: RECORTE.de, p_ate: RECORTE.ate },
      },
    ]);
  });

  it("o compromisso 'transparent' do Google não ocupa a fatia", async () => {
    const falso = clienteComRls(ATENDENTE);

    const leitura = await lerOcupacaoExterna(comoCliente(falso.cliente), RECORTE, [DONA]);

    expect(leitura.blocos.map((bloco) => bloco.donoId)).toEqual([DONA]);
    // 15:00–16:00 era o `transparent`: o único bloco é o compromisso das 14h.
    expect(
      fatiaOcupada(leitura.blocos, "2026-09-16T15:30:00.000Z", "2026-09-16T15:45:00.000Z"),
    ).toBe(false);
    expect(
      fatiaOcupada(leitura.blocos, "2026-09-16T14:30:00.000Z", "2026-09-16T14:45:00.000Z"),
    ).toBe(true);
  });

  it("sem dono na lista, ninguém é perguntado e nada é inventado", async () => {
    const falso = clienteComRls(ATENDENTE);

    const leitura = await lerOcupacaoExterna(comoCliente(falso.cliente), RECORTE, []);

    expect(leitura).toEqual({ blocos: [], erro: null });
    expect(falso.rpcs).toEqual([]);
    expect(falso.froms).toEqual([]);
  });

  it("a falha de um dono não apaga a ocupação dos outros, e é relatada", async () => {
    const falso = clienteComRls(ATENDENTE);

    const leitura = await lerOcupacaoExterna(comoCliente(falso.cliente), RECORTE, [
      DONA,
      DONO_QUE_FALHA,
    ]);

    expect(leitura.erro).toContain("permission denied");
    expect(leitura.blocos.map((bloco) => bloco.donoId)).toEqual([DONA]);
  });
});

describe("a frase da trava distingue 'ocupado' de 'fora da jornada'", () => {
  it("com o compromisso da dona à vista, a frase é a de ocupado — a que a issue cobra", async () => {
    const falso = clienteComRls(ATENDENTE);
    const leitura = await lerOcupacaoExterna(comoCliente(falso.cliente), RECORTE, [DONA]);

    // A fatia que o Atendente tentaria marcar: dentro do compromisso da dona.
    const ocupado = fatiaOcupada(
      leitura.blocos,
      "2026-09-16T14:30:00.000Z",
      "2026-09-16T14:45:00.000Z",
    );

    expect(ocupado).toBe(true);
    const razao = razaoDoBloco({ motivo: null, ocupado, passado: false });
    expect(razao).toBe("já há um compromisso neste horário");
    // O defeito era cair nesta frase, que manda o Atendente procurar no lugar errado.
    expect(razao).not.toBe("fora dos horários que você publicou");
  });

  it("sem ocupação lida (o estado do defeito), a mesma chamada produz a frase da jornada", async () => {
    const falso = clienteComRls(ATENDENTE);
    // Lista vazia de donos: é o que a leitura pela sessão devolvia ao Atendente.
    const leitura = await lerOcupacaoExterna(comoCliente(falso.cliente), RECORTE, []);

    const ocupado = fatiaOcupada(
      leitura.blocos,
      "2026-09-16T14:30:00.000Z",
      "2026-09-16T14:45:00.000Z",
    );

    expect(ocupado).toBe(false);
    expect(razaoDoBloco({ motivo: null, ocupado, passado: false })).toBe(
      "fora dos horários que você publicou",
    );
  });
});
