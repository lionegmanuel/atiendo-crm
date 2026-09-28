import { describe, expect, it } from "vitest";

import {
  ABRE_DADOS,
  FECHA_DADOS,
  INSTRUCAO_DA_CONSULTA_INTERNA,
  MARCA_DA_CONSULTA_INTERNA,
  montarBlocoDeDados,
  montarSystem,
  PERSONA_NEUTRA,
  type DadosDoCaso,
} from "./contexto";

const ABERTURA = "2026-03-10T12:00:00Z"; // 09:00 em America/Sao_Paulo
const DEPOIS = "2026-03-10T18:30:00Z"; //   15:30 em America/Sao_Paulo

function dados(over: Partial<DadosDoCaso> = {}): DadosDoCaso {
  return {
    fuso: "America/Sao_Paulo",
    caso: {
      titulo: "Desconto acima da política",
      tipo: "outro",
      estado: "awaiting_human",
      resumo: "O cliente pede 20%",
      bloqueio: "A política permite até 10%",
      abertoEm: ABERTURA,
    },
    primeiroNomeDoContato: "Marina",
    contatoBloqueado: false,
    casoObsoleto: false,
    eventos: [{ rotulo: "O sistema abriu o caso automaticamente", quando: ABERTURA, corpo: null }],
    decisoesDaEquipe: "",
    memoria: null,
    origemDoCaso: [{ de: "cliente", quando: ABERTURA, texto: "Me dá 20% que eu fecho hoje" }],
    depoisDaAbertura: [],
    ...over,
  };
}

/** O recorte entre os dois marcadores — a cerca, medida e não presumida. */
function dentroDaCerca(bloco: string): string {
  const i = bloco.indexOf(ABRE_DADOS);
  const j = bloco.indexOf(FECHA_DADOS);
  expect(i, "o marcador de abertura sumiu do bloco").toBeGreaterThanOrEqual(0);
  expect(j, "o marcador de fechamento sumiu do bloco").toBeGreaterThan(i);
  return bloco.slice(i, j);
}

describe("montarBlocoDeDados — o texto do cliente é DADO, não instrução", () => {
  it("o que o cliente escreveu sai DENTRO da cerca, nunca solto", () => {
    // Esta é a asserção que a sabotagem do fim do arquivo derruba, e a razão de
    // `dentroDaCerca` medir a posição em vez de só procurar a frase: um
    // `toContain` no bloco inteiro ficaria verde com a cerca removida.
    const bloco = montarBlocoDeDados(dados());
    expect(dentroDaCerca(bloco)).toContain("Me dá 20% que eu fecho hoje");
  });

  it("mensagem posterior à abertura sai sob 'depois que o caso foi aberto'", () => {
    // A separação é o que impede a IA de responder sobre um estado que já
    // mudou: o agente segue falando com o cliente depois que o caso abre.
    const bloco = montarBlocoDeDados(
      dados({ depoisDaAbertura: [{ de: "nos", quando: DEPOIS, texto: "Vou confirmar com a equipe" }] }),
    );
    const cabecalho = bloco.indexOf("--- depois que o caso foi aberto ---");
    expect(cabecalho).toBeGreaterThan(bloco.indexOf("--- o que originou o caso ---"));
    expect(bloco.indexOf("Vou confirmar com a equipe")).toBeGreaterThan(cabecalho);
  });

  it("TELEFONE E E-MAIL não aparecem em lugar nenhum — só o primeiro nome", () => {
    // O binding do ponto aceita `base_url` arbitrária: o que vai ao modelo pode
    // sair para um endpoint de terceiro escolhido por quem administra.
    const bloco = montarBlocoDeDados(dados());
    expect(bloco).toContain("Cliente: Marina");
    expect(bloco).not.toMatch(/\+?\d{2}\s?\d{2}\s?9?\d{4}-?\d{4}/);
    expect(bloco).not.toMatch(/[\w.]+@[\w.]+/);
    // E nada de sobrenome: o campo que entra é o PRIMEIRO nome, e o teste mede
    // o contrato do dado de entrada, não a esperança de quem chama.
    expect(bloco).not.toContain("Marina ");
  });

  it("os horários são hora de PAREDE da organização, não UTC", () => {
    // `2026-03-10T12:00:00Z` é 09:00 em São Paulo. O comentário de
    // `get-lead-context.ts` registra o defeito medido em produção com UTC cru.
    const bloco = montarBlocoDeDados(dados());
    expect(bloco).toContain("10/03 às 09:00");
    expect(bloco).not.toContain("12:00");
  });

  it("outro fuso muda o horário — o campo não é decorativo", () => {
    // Sem esta recíproca, um `rotuloLocal` que ignorasse o fuso e usasse o do
    // processo passaria no caso acima sempre que a máquina fosse de São Paulo.
    const bloco = montarBlocoDeDados(dados({ fuso: "America/Manaus" }));
    expect(bloco).toContain("10/03 às 08:00");
  });

  it("caso obsoleto acrescenta o aviso", () => {
    expect(montarBlocoDeDados(dados({ casoObsoleto: true }))).toContain(
      "encerrado e reaberto",
    );
    expect(montarBlocoDeDados(dados())).not.toContain("encerrado e reaberto");
  });

  it("contato bloqueado acrescenta o aviso — e a consulta continua acontecendo", () => {
    // Bloqueado NÃO recusa: é justamente quando o atendente mais precisa
    // entender quem pediu para sair. O que muda é o modelo saber que nada pode
    // ser enviado antes de sugerir "mande uma mensagem dizendo que…".
    const bloco = montarBlocoDeDados(dados({ contatoBloqueado: true }));
    expect(bloco).toContain("pediu para não receber mensagens");
    expect(dentroDaCerca(bloco)).toContain("Me dá 20% que eu fecho hoje");
  });

  it("seção vazia é OMITIDA, não impressa vazia", () => {
    // Cabeçalho seguido de nada convida o modelo a preencher a lacuna — e o que
    // ele preenche é invenção sobre uma pessoa real.
    const bloco = montarBlocoDeDados(dados({ decisoesDaEquipe: "   ", eventos: [] }));
    expect(bloco).not.toContain("--- o que a equipe já decidiu ---");
    expect(bloco).not.toContain("--- linha do tempo do caso ---");
  });

  it("SABOTAGEM: sem os marcadores, o caso (1) reprova", () => {
    // O controle da própria sonda. Se `dentroDaCerca` fosse um `toContain`
    // frouxo, remover a cerca deixaria o teste verde — e a cerca é a única
    // coisa que separa registro de terceiro de instrução ao modelo.
    const semCerca = montarBlocoDeDados(dados()).replace(ABRE_DADOS, "").replace(FECHA_DADOS, "");
    expect(() => dentroDaCerca(semCerca)).toThrow();
  });
});

describe("montarSystem — o prefixo estável do cache", () => {
  it("leva a persona, a memória da organização e o bloco fixo, nesta ordem", () => {
    const s = montarSystem({ persona: "Você é a Clara.", memoriaDaOrganizacao: "Loja de tênis." });
    expect(s.indexOf("Você é a Clara.")).toBe(0);
    expect(s.indexOf("Loja de tênis.")).toBeLessThan(s.indexOf(MARCA_DA_CONSULTA_INTERNA));
  });

  it("sem memória da organização, não sobra linha em branco de sobra", () => {
    const s = montarSystem({ persona: "Você é a Clara.", memoriaDaOrganizacao: null });
    expect(s).toBe(`Você é a Clara.\n\n${INSTRUCAO_DA_CONSULTA_INTERNA}`);
  });

  it("NADA do caso entra no system — senão o cache de prefixo quebra a cada pergunta", () => {
    const s = montarSystem({ persona: "Você é a Clara.", memoriaDaOrganizacao: null });
    expect(s).not.toContain(ABRE_DADOS);
    expect(s).not.toContain("Marina");
  });

  it("o bloco fixo proíbe ação e manda atribuir a fonte", () => {
    // É a única defesa contra injeção indireta que não depende do humano: o
    // texto do cliente vai cercado, e o modelo é instruído a RELATAR o pedido
    // dele em vez de tratá-lo como decisão da empresa.
    expect(INSTRUCAO_DA_CONSULTA_INTERNA).toContain("NÃO tem ferramenta nenhuma");
    expect(INSTRUCAO_DA_CONSULTA_INTERNA).toContain("nunca diga que fez");
    expect(INSTRUCAO_DA_CONSULTA_INTERNA).toContain("Atribua sempre a fonte");
  });

  it("a marca do dublê de e2e abre o bloco fixo", () => {
    // O fixture do e2e IMPORTA esta constante. Literal duplicado é a divergência
    // que este repositório já pagou várias vezes.
    expect(INSTRUCAO_DA_CONSULTA_INTERNA.startsWith(MARCA_DA_CONSULTA_INTERNA)).toBe(true);
  });

  it("a persona neutra não tem nome próprio nenhum", () => {
    // O gate da MARCA é `tests/unit/branding.test.ts`, que varre `lib/**` — e
    // este arquivo está dentro dele. Escrever aqui o literal que aquele gate
    // procura faria ESTE arquivo virar um vazamento de marca: medido, foi
    // exatamente o que aconteceu na primeira rodada da suíte.
    //
    // O que sobra aqui, e que aquele gate não mede, é o outro eixo: a persona
    // de fallback não pode se apresentar com nome de gente nem de empresa, ou o
    // atendente acha que está falando com o agente do caso quando não está.
    expect(PERSONA_NEUTRA).toBe("Você é o assistente interno desta equipe de atendimento.");
    expect(PERSONA_NEUTRA).not.toMatch(/\b(Clara|Sofia|Assistente [A-Z])\b/);
  });
});
