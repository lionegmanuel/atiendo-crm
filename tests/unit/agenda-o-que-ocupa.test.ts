/**
 * O QUE OCUPA UM HORÁRIO — e as três decisões que erram em silêncio se invertidas.
 *
 * O motor recebe uma lista de `Ocupado` e não pergunta de onde veio. Quem
 * decide o que entra nessa lista é este arquivo, e cada regra aqui tem um
 * desfecho concreto do lado de fora: oferecer um horário que não existe, ou
 * esconder um que existe.
 *
 * A assimetria que governa as três: **oferecer de menos é recuperável; marcar
 * em cima não é.** Um horário perdido volta quando alguém remarca. Um paciente
 * chegando para uma consulta que não existe custa a confiança, e não tem
 * desfazer.
 */
import { describe, expect, it } from "vitest";

import {
  agendaExternaNuncaLida,
  ocupadosDoDono,
  SITUACOES_QUE_LIBERAM,
  SITUACOES_QUE_OCUPAM,
  type LinhaDeAgendamento,
  type LinhaDeEventoExterno,
} from "@/lib/agenda/ocupados";
import { SITUACOES_DO_AGENDAMENTO } from "@/lib/agenda/tipos";

const jan = (h: number) => new Date(`2026-03-09T${String(h).padStart(2, "0")}:00:00Z`);

const agendamento = (status: string, h = 12): LinhaDeAgendamento => ({
  starts_at: jan(h).toISOString(),
  ends_at: jan(h + 1).toISOString(),
  status,
});

const externo = (
  transparency: string,
  status: string,
  situacaoDaConexao: string,
  h = 15,
): LinhaDeEventoExterno => ({
  starts_at: jan(h).toISOString(),
  ends_at: jan(h + 1).toISOString(),
  transparency,
  status,
  situacaoDaConexao,
});

describe("agendamentos do próprio CRM", () => {
  it("confirmado e concluído ocupam", () => {
    const r = ocupadosDoDono([agendamento("confirmed"), agendamento("completed", 14)], []);
    expect(r.ocupados).toHaveLength(2);
  });

  it("PENDENTE ocupa — senão dois pacientes pedem o mesmo horário", () => {
    // "Aguardando confirmação" é um pedido em cima daquele horário. Não contar
    // faria o segundo pedido ser aceito e um dos dois levar bolo.
    expect(ocupadosDoDono([agendamento("pending")], []).ocupados).toHaveLength(1);
  });

  it("cancelado NÃO ocupa — o horário voltou a existir", () => {
    expect(ocupadosDoDono([agendamento("cancelled")], []).ocupados).toEqual([]);
  });

  it("não compareceu NÃO ocupa horário futuro", () => {
    expect(ocupadosDoDono([agendamento("no_show")], []).ocupados).toEqual([]);
  });

  it("status desconhecido OCUPA — falha fechada na ação", () => {
    // Vocabulário aberto: se alguém acrescentar uma situação no banco e
    // esquecer daqui, o desfecho seguro é bloquear, não oferecer.
    expect(ocupadosDoDono([agendamento("um_status_que_nao_existe_ainda")], []).ocupados).toHaveLength(1);
  });
});

describe("eventos que vieram do Google", () => {
  it("opaco e confirmado ocupa", () => {
    expect(ocupadosDoDono([], [externo("opaque", "confirmed", "healthy")]).ocupados).toHaveLength(1);
  });

  it("TRANSPARENTE não ocupa — é o 'livre' do Google", () => {
    // Quem marca um evento como "disponível" na agenda do Google está dizendo
    // que aceita compromisso por cima. Contar isso esconderia o dia inteiro de
    // quem usa a agenda para anotar lembretes.
    expect(ocupadosDoDono([], [externo("transparent", "confirmed", "healthy")]).ocupados).toEqual([]);
  });

  it("cancelado no Google não ocupa; TENTATIVO ocupa", () => {
    expect(ocupadosDoDono([], [externo("opaque", "cancelled", "healthy")]).ocupados).toEqual([]);
    expect(ocupadosDoDono([], [externo("opaque", "tentative", "healthy")]).ocupados).toHaveLength(1);
  });
});

describe("a conexão expirada — DECISÃO 3.2, na versão corrigida", () => {
  it("evento de conexão EXPIRADA CONTINUA ocupando", () => {
    // A primeira versão da decisão mandava parar de contar, com a justificativa
    // de que contar "marcaria em cima de compromisso real". O argumento estava
    // invertido: PARAR de contar é que causa o marcar em cima — o compromisso
    // segue existindo no Google, só parou de ser sincronizado.
    // ⚠️ `disconnected` SAIU desta lista e ganhou caso próprio abaixo. Ele estava aqui
    // por engano de categoria: os quatro que sobram são decididos pelo SISTEMA
    // (`estadoDaConexaoApos` grava só estes), e `disconnected` é o único que uma PESSOA
    // decide. A pergunta do mapa não é "esta conexão é confiável?" — é "alguém nos pediu
    // para deixar de contar?".
    for (const situacao of ["token_expired", "scope_missing", "rate_limited", "error"]) {
      const r = ocupadosDoDono([], [externo("opaque", "confirmed", situacao)]);
      expect({ situacao, ocupa: r.ocupados.length }).toEqual({ situacao, ocupa: 1 });
    }
  });

  it("DESCONECTADA não ocupa — é o único estado que uma PESSOA escolhe", () => {
    // A regra numa linha: BLOQUEIA, A MENOS QUE UM HUMANO TENHA MANDADO PARAR.
    //
    // `estadoDaConexaoApos` (google/erros.ts) nunca grava `disconnected` — só
    // `token_expired`, `scope_missing`, `error`, `healthy` e `rate_limited`. O único ponto
    // do produto que grava `disconnected` é a rota de desconectar, ou seja, alguém pediu.
    // Nos outros o compromisso segue existindo na agenda do Google e só parou de
    // atualizar; aqui a pessoa disse para parar de contar.
    const r = ocupadosDoDono([], [externo("opaque", "confirmed", "disconnected")]);
    expect(r.ocupados).toEqual([]);
  });

  it("e a defasagem é DEVOLVIDA, não engolida", () => {
    // Falha fechada na ação, aberta na informação: a tela precisa poder dizer
    // "sua agenda do Google desconectou; estes horários podem estar defasados".
    const r = ocupadosDoDono([], [externo("opaque", "confirmed", "token_expired")]);
    expect(r.fontesDefasadas).toEqual(["token_expired"]);
  });

  it("conexão saudável não gera aviso de defasagem", () => {
    const r = ocupadosDoDono([], [externo("opaque", "confirmed", "healthy")]);
    expect(r.fontesDefasadas).toEqual([]);
  });

  it("a mesma situação em dois eventos aparece UMA vez no aviso", () => {
    const r = ocupadosDoDono(
      [],
      [externo("opaque", "confirmed", "token_expired", 15), externo("opaque", "confirmed", "token_expired", 17)],
    );
    expect(r.ocupados).toHaveLength(2);
    expect(r.fontesDefasadas).toEqual(["token_expired"]);
  });
});

describe("o que o banco pode devolver e não pode derrubar a rota", () => {
  it("intervalo invertido ou vazio é descartado, não vira ocupado negativo", () => {
    const r = ocupadosDoDono(
      [{ starts_at: jan(14).toISOString(), ends_at: jan(12).toISOString(), status: "confirmed" }],
      [],
    );
    expect(r.ocupados).toEqual([]);
  });

  it("data ilegível é descartada em vez de virar Invalid Date no motor", () => {
    const r = ocupadosDoDono([{ starts_at: "nao-e-data", ends_at: "tambem-nao", status: "confirmed" }], []);
    expect(r.ocupados).toEqual([]);
  });
});

/**
 * A CLASSIFICAÇÃO É EXAUSTIVA — e este é o consumidor que faltava.
 *
 * `SITUACOES_QUE_OCUPAM` existia exportada, sem ninguém importar, sob um
 * comentário que a chamava de "guarda". Não guardava nada: era órfã com
 * promessa, que é pior que órfã calada — quem lê acha que está protegido.
 *
 * Agora ela é lida aqui. Se alguém acrescentar uma situação ao vocabulário do
 * agendamento e não decidir se ela libera ou ocupa, este teste nomeia qual.
 */
describe("toda situação do vocabulário está classificada", () => {
  it("a classificação é EXATAMENTE esta — status novo tem de passar por aqui", () => {
    // ⚠️ A PRIMEIRA VERSÃO DESTE TESTE NÃO PODIA FALHAR, e a sabotagem provou:
    // acrescentei "remarcando" ao vocabulário sem classificar e os 16 seguiram
    // verdes. A causa é que `SITUACOES_QUE_OCUPAM` é derivada por `filter` —
    // tudo que não libera ocupa, por construção — então "a união cobre o
    // vocabulário" é trivialmente verdadeiro, e afirmar isso não vigia nada.
    //
    // O que precisa travar é a DECISÃO, não a cobertura. Fixando as duas listas,
    // um status novo quebra aqui e alguém tem de escrever em qual lado ele cai.
    // O desfecho seguro continua sendo o padrão (quem não libera, ocupa); este
    // teste só garante que ninguém receba esse padrão sem saber.
    expect([...SITUACOES_QUE_LIBERAM]).toEqual(["cancelled", "no_show"]);
    expect([...SITUACOES_QUE_OCUPAM]).toEqual(["pending", "confirmed", "completed"]);
    expect([...SITUACOES_QUE_OCUPAM, ...SITUACOES_QUE_LIBERAM].sort()).toEqual(
      [...SITUACOES_DO_AGENDAMENTO].sort(),
    );
  });

  it("e o desfecho SEGURO é o padrão: quem ocupa é a maioria", () => {
    // Não é estética: a lista de quem LIBERA é a exceção enumerada, e tudo o
    // mais ocupa. Se um dia a relação se inverter, alguém trocou blocklist por
    // allowlist — e aí um status novo passa a liberar por omissão.
    expect(SITUACOES_QUE_OCUPAM.length).toBeGreaterThan(SITUACOES_QUE_LIBERAM.length);
  });
});

/**
 * "NÃO TEM GOOGLE" E "TEM GOOGLE QUE NUNCA FOI LIDO" dão a mesma lista vazia.
 *
 * Levantado pelo maestro como risco de ORDEM entre as frentes: se o POST entrar
 * antes de o sync existir, a agenda do atendente é oferecida inteira como livre
 * — inclusive na hora da cirurgia que está no Google e que ninguém trouxe.
 *
 * O risco é de ordem, mas o SINAL é do motor: quem lê a lista vazia precisa
 * saber se ela significa "livre" ou "não perguntei ainda".
 */
describe("a agenda externa é confiável agora?", () => {
  it("sem conexão nenhuma NÃO é alerta — não há nada lá fora", () => {
    expect(agendaExternaNuncaLida([])).toBe(false);
  });

  it("conexão que JÁ sincronizou não é alerta", () => {
    expect(
      agendaExternaNuncaLida([{ status: "healthy", last_sync_at: "2026-08-26T10:00:00Z" }]),
    ).toBe(false);
  });

  it("conexão que NUNCA sincronizou é alerta — há compromisso lá que não veio", () => {
    expect(agendaExternaNuncaLida([{ status: "healthy", last_sync_at: null }])).toBe(true);
  });

  it("uma sincronizada entre várias já basta para não alertar", () => {
    expect(
      agendaExternaNuncaLida([
        { status: "healthy", last_sync_at: null },
        { status: "healthy", last_sync_at: "2026-08-26T10:00:00Z" },
      ]),
    ).toBe(false);
  });

  it("conexão DESCONECTADA não conta — quem desconectou sabe que desconectou", () => {
    // Diferente de "nunca li": aqui houve um ato deliberado, e a tela da agenda
    // já mostra a faixa de reconectar.
    expect(agendaExternaNuncaLida([{ status: "disconnected", last_sync_at: null }])).toBe(false);
  });
});
