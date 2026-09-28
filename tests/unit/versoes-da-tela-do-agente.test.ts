/**
 * "ABRI O AGENTE E O PROMPT SUMIU" — os dois caminhos que produziam isso.
 *
 * Relatado da produção, com o agente atendendo normalmente no WhatsApp: a tela
 * mostrava 21 tokens de texto padrão e o botão dizia "Publicar v6", enquanto a
 * v7 publicada, de 16.714 caracteres, era quem respondia.
 *
 * Os casos abaixo são os dois caminhos, e o segundo é o que fazia o trabalho se
 * perder sozinho: agente pausado não tem rascunho nem publicada (pausar
 * despublica e a versão vira `superseded`), então o formulário caía no texto
 * padrão — e salvar dali gravava esse texto como rascunho novo.
 */
import { describe, expect, it } from "vitest";

import { escolherVersoesDaTela } from "@/lib/ai/agents/versoes-da-tela";

const v = (version_number: number, status: string) => ({
  id: `v${version_number}`,
  version_number,
  status,
});

describe("qual versão o editor do agente abre", () => {
  it("abre o rascunho vigente quando ele é mais novo que a publicada", () => {
    const r = escolherVersoesDaTela([v(7, "published"), v(8, "draft"), v(6, "superseded")]);
    expect(r.draft?.id).toBe("v8");
    expect(r.base?.id).toBe("v8");
    expect(r.draftObsoleto).toBeNull();
  });

  it("IGNORA o rascunho anterior à publicada — foi superado por ela", () => {
    // O caso exato do relato: rascunho v6 (texto padrão) e publicada v7 (a boa).
    const r = escolherVersoesDaTela([v(6, "draft"), v(7, "published"), v(5, "superseded")]);
    expect(r.base?.id, "a tela abriu o rascunho velho por cima da publicada").toBe("v7");
    expect(r.draft, "o rascunho obsoleto não pode ser oferecido para publicar").toBeNull();
    expect(r.draftObsoleto?.id, "e não pode sumir sem explicação").toBe("v6");
  });

  it("abre a publicada quando não há rascunho", () => {
    const r = escolherVersoesDaTela([v(3, "published"), v(2, "superseded")]);
    expect(r.base?.id).toBe("v3");
    expect(r.draft).toBeNull();
  });

  it("agente PAUSADO abre a última versão, não o texto padrão", () => {
    // Pausar despublica e a versão vira superseded: sem este fallback, o
    // formulário nascia com o texto padrão e o prompt "sumia" — e um salvamento
    // dali gravava o padrão como rascunho novo.
    const r = escolherVersoesDaTela([v(5, "superseded"), v(4, "superseded")]);
    expect(r.base?.id, "o prompt sumiria num agente pausado").toBe("v5");
    expect(r.draft).toBeNull();
    expect(r.published).toBeNull();
  });

  it("agente sem versão nenhuma não tem de onde partir — aí o padrão é a verdade", () => {
    const r = escolherVersoesDaTela([]);
    expect(r.base).toBeNull();
    expect(r.draft).toBeNull();
    expect(r.published).toBeNull();
  });

  it("entre dois rascunhos, o mais novo", () => {
    const r = escolherVersoesDaTela([v(9, "draft"), v(10, "draft"), v(8, "published")]);
    expect(r.draft?.id).toBe("v10");
  });
});

describe("quem é a versão publicada: o PONTEIRO, não o rótulo", () => {
  // Medido em produção: um agente com `ai_agent_versions.status = 'published'` e
  // `ai_agents.published_version_id` NULO. O runtime não o atende (o join é pelo
  // ponteiro), mas a tela dizia "Publicado v1" — e o badge ao lado, que já lia o
  // ponteiro, dizia "Rascunho". Duas respostas contraditórias, e a errada era a
  // que tranquilizava.
  it("ignora o rótulo quando o ponteiro está vazio", () => {
    const r = escolherVersoesDaTela([v(1, "published")], null);
    expect(r.published, "a tela diria 'no ar' um agente que o runtime não atende").toBeNull();
    expect(r.base?.id, "mesmo assim o editor abre a última versão").toBe("v1");
  });

  it("segue o ponteiro mesmo que o rótulo aponte para outra", () => {
    const r = escolherVersoesDaTela([v(2, "superseded"), v(3, "published")], "v2");
    expect(r.published?.id).toBe("v2");
  });

  it("sem o ponteiro informado, mantém o comportamento antigo", () => {
    // Chamador que ainda não passa o argumento não perde a versão publicada.
    const r = escolherVersoesDaTela([v(4, "published")]);
    expect(r.published?.id).toBe("v4");
  });
});
