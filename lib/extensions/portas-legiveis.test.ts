import { describe, expect, it } from "vitest";

import { EXTENSION_PERMISSIONS } from "./capacidades";
import { nomeDaPorta, portasLegiveis } from "./portas-legiveis";

/**
 * A LISTA DE PORTAS É A ÚNICA COISA QUE A PESSOA TEM PARA DECIDIR — E ELA PRECISA ESTAR INTEIRA.
 *
 * O defeito que este arquivo previne já existiu: a tela derivava uma frase de
 * `permissions.includes("navigation.tasks")`. Com uma permissão só, era a verdade inteira.
 * Com a lista fechada, a mesma frase passou a esconder tudo que não fosse Tarefas — e uma
 * extensão que abre Conversas e Contatos, sem incluir Tarefas, caía no ramo "não recebe
 * acesso aos dados do CRM", que é o oposto do que ela faz.
 */
describe("as portas que a tela mostra", () => {
  it("toda permissão do vocabulário tem nome legível — nenhuma aparece como código", () => {
    for (const permissao of EXTENSION_PERMISSIONS) {
      const nome = nomeDaPorta(permissao);
      expect(nome, `${permissao} sem nome`).toBeTruthy();
      expect(nome, `${permissao} vazou o valor técnico para a tela`).not.toContain("navigation.");
    }
  });

  it("cita TODAS as portas, não só a primeira", () => {
    const frase = portasLegiveis(["navigation.inbox", "navigation.contacts"]);
    expect(frase).toContain("Conversas");
    expect(frase).toContain("Contatos");
  });

  it("uma extensão sem Tarefas não é descrita como se não abrisse nada", () => {
    // O ramo exato do defeito anterior: sem `navigation.tasks`, a frase dizia
    // "Não recebe acesso aos dados do CRM" para uma extensão que abre duas telas.
    const frase = portasLegiveis(["navigation.inbox", "navigation.agenda"]);
    expect(frase).not.toContain("Não recebe acesso");
    expect(frase).toContain("Conversas");
    expect(frase).toContain("Agenda");
  });

  it("diz o limite junto com o alcance — abrir e ler são coisas diferentes", () => {
    expect(portasLegiveis(["navigation.tasks"])).toContain("não lê seus dados");
  });

  it("a ordem é estável: a mesma lista, em qualquer ordem, produz a mesma frase", () => {
    expect(portasLegiveis(["navigation.inbox", "navigation.agenda"])).toBe(
      portasLegiveis(["navigation.agenda", "navigation.inbox"]),
    );
  });

  it("lista vazia é dita como vazia, sem inventar alcance", () => {
    expect(portasLegiveis([])).toContain("Não abre nenhuma tela");
  });
});
