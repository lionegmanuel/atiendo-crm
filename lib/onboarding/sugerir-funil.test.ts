/**
 * A sugestão do quadro — sobretudo os desfechos em que ela NÃO vem.
 *
 * O caminho feliz é o que menos precisa de guarda: se o modelo devolver um JSON
 * bonito, tudo funciona. O que este passo promete é nunca deixar a pessoa sem
 * quadro — e isso só se prova exercitando o modelo devolvendo prosa, cercando o
 * objeto em crase, inventando passo e estourando.
 */
import { describe, expect, it, vi } from "vitest";

import {
  escolherPacotePorTexto,
  extrairJson,
  pedidoDeSugestao,
  sugerirFunil,
  type Gerar,
} from "@/lib/onboarding/sugerir-funil";
import { PACOTE_PADRAO } from "@/lib/onboarding/pacotes-de-funil";

const CTX = { nome: "Clínica Bem Viver", oQueFaz: "Atendimento odontológico" };

const BOM = JSON.stringify({
  nome: "Agendamentos",
  etapas: [
    { nome: "Novo contato", passo: "new" },
    { nome: "Já respondi", passo: "contacted" },
    { nome: "Entendendo o caso", passo: "qualifying" },
    { nome: "Consulta marcada", passo: "won" },
    { nome: "Não vai marcar", passo: "lost" },
  ],
});

const responde = (texto: string): Gerar => vi.fn(async () => texto);

describe("escolher o pacote pelo que o dono escreveu", () => {
  it("reconhece o ramo pelas palavras que ele usaria", () => {
    expect(escolherPacotePorTexto("Consultório odontológico").id).toBe("clinica");
    expect(escolherPacotePorTexto("Sou corretor de imóveis").id).toBe("imobiliaria");
    expect(escolherPacotePorTexto("Agência de arquitetura").id).toBe("servicos");
    expect(escolherPacotePorTexto("Curso online de inglês").id).toBe("curso");
    expect(escolherPacotePorTexto("Loja de roupas").id).toBe("loja");
  });

  it("cai no genérico quando não reconhece — nunca em nada", () => {
    expect(escolherPacotePorTexto("xyzzy").id).toBe(PACOTE_PADRAO.id);
    expect(escolherPacotePorTexto("").id).toBe(PACOTE_PADRAO.id);
  });

  it("não se importa com acento nem caixa", () => {
    // O dono digita no celular, sem acento e em minúscula.
    expect(escolherPacotePorTexto("CLINICA DE ESTETICA").id).toBe("clinica");
    expect(escolherPacotePorTexto("clinica").id).toBe("clinica");
  });
});

describe("o pedido", () => {
  it("leva o exemplo do ramo, não uma descrição do formato em prosa", () => {
    // Descrever o formato produz JSON válido com conteúdo de manual de vendas.
    const { prompt } = pedidoDeSugestao(CTX, escolherPacotePorTexto("clínica"));
    expect(prompt).toContain("Consulta marcada");
    expect(prompt).toContain("Clínica Bem Viver");
    expect(prompt).toContain("Atendimento odontológico");
  });

  it("manda não copiar o exemplo", () => {
    // Sem isto o modelo devolve o exemplo de volta, e toda clínica do mundo
    // termina com o mesmo quadro.
    const { prompt } = pedidoDeSugestao(CTX, escolherPacotePorTexto("clínica"));
    expect(prompt).toMatch(/não copie/i);
  });

  it("proíbe explicitamente a língua de manual de vendas", () => {
    const { system } = pedidoDeSugestao(CTX, PACOTE_PADRAO);
    expect(system).toMatch(/MQL/);
  });
});

describe("achar o JSON no meio da resposta", () => {
  it("aceita o objeto limpo", () => {
    expect(extrairJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("aceita cercado de crases e de prosa", () => {
    // Instrução de formato não é garantia de formato.
    expect(extrairJson('Claro! Aqui está:\n```json\n{"a":1}\n```\nEspero ter ajudado.')).toEqual({
      a: 1,
    });
  });

  it("devolve null quando não há objeto nenhum", () => {
    expect(extrairJson("Desculpe, não posso ajudar com isso.")).toBeNull();
    expect(extrairJson("")).toBeNull();
    expect(extrairJson("{quebrado")).toBeNull();
  });
});

describe("sugerir", () => {
  it("usa a proposta da IA quando ela serve", async () => {
    const s = await sugerirFunil(CTX, responde(BOM));
    expect(s.origem).toBe("ia");
    expect(s.origem === "ia" && s.proposta.nome).toBe("Agendamentos");
  });

  it("cai no pacote do RAMO quando o modelo não responde JSON", async () => {
    // E o pacote é o da clínica, não o genérico: quem já disse o que faz não
    // deve receber o quadro de "outro tipo de negócio".
    const s = await sugerirFunil(CTX, responde("Desculpe, não entendi."));
    expect(s.origem).toBe("pacote");
    expect(s.origem === "pacote" && s.pacote.id).toBe("clinica");
    expect(s.origem === "pacote" && s.porque).toBeTruthy();
  });

  it("cai no pacote quando a IA devolve um quadro sem onde fechar negócio", async () => {
    const semGanho = JSON.stringify({
      nome: "Coisas",
      etapas: [
        { nome: "A", passo: "new" },
        { nome: "B", passo: "contacted" },
        { nome: "C", passo: "qualifying" },
        { nome: "D", passo: "lost" },
      ],
    });
    const s = await sugerirFunil(CTX, responde(semGanho));
    expect(s.origem).toBe("pacote");
    expect(s.origem === "pacote" && s.porque).toMatch(/fechado/i);
  });

  it("a chave sem saldo vira pacote + motivo, nunca uma tela quebrada", async () => {
    // É o desfecho mais provável de todos: a pessoa acabou de colar uma chave
    // que nunca gerou um token.
    const s = await sugerirFunil(CTX, async () => {
      throw new Error("insufficient_quota");
    });
    expect(s.origem).toBe("pacote");
    expect(s.origem === "pacote" && s.porque).toContain("insufficient_quota");
  });

  it("nenhum desfecho devolve quadro vazio", async () => {
    // A promessa inteira do passo. Sem ela, a pessoa fica com o funil de
    // e-commerce que o gatilho semeou — o defeito que este passo veio corrigir.
    const respostas = ["", "não", "{}", '{"etapas":[]}', BOM];
    for (const r of respostas) {
      const s = await sugerirFunil(CTX, responde(r));
      const etapas = s.origem === "ia" ? s.proposta.etapas : s.pacote.proposta.etapas;
      expect(etapas.length, `resposta ${JSON.stringify(r)}`).toBeGreaterThanOrEqual(4);
    }
  });
});
