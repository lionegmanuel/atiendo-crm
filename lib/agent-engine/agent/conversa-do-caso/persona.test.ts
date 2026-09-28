import { describe, expect, it, vi } from "vitest";

import type { PublishedAgentConfig } from "../agent-config";
import { resolverPersona, type FatosDoAgenteDoCaso, type LeitorDaPersona } from "./persona";

const AGENTE = { agentName: "Clara", agentId: "a-1" } as unknown as PublishedAgentConfig;

function leitor(
  fatos: FatosDoAgenteDoCaso | null,
  publicado: PublishedAgentConfig | null = AGENTE,
): LeitorDaPersona & { carregarPublicado: ReturnType<typeof vi.fn> } {
  return {
    fatosDoAgente: vi.fn().mockResolvedValue(fatos),
    carregarPublicado: vi.fn().mockResolvedValue(publicado),
  };
}

const NO_AR: FatosDoAgenteDoCaso = {
  archived_at: null,
  paused_at: null,
  published_version_id: "v-1",
};

describe("resolverPersona — quem responde sobre o caso", () => {
  it("agente no ar → responde a persona DO CASO", () => {
    // O controle positivo. Sem ele, "cai no padrão da organização" passaria em
    // todos os casos abaixo e a promessa da feature nunca seria exercida.
    return expect(resolverPersona(leitor(NO_AR), "a-1")).resolves.toEqual({
      fonte: "agente_do_caso",
      agente: AGENTE,
      nome: "Clara",
    });
  });

  it("`agent_id` nulo → `sem_agente`, e o banco nem é consultado", async () => {
    // Caminho REAL: o fail-safe do guardrail grava `agentId ?? null` e a FK é
    // `on delete set null`.
    const l = leitor(NO_AR);
    await expect(resolverPersona(l, null)).resolves.toEqual({
      fonte: "padrao_da_organizacao",
      motivo: "sem_agente",
    });
    expect(l.carregarPublicado).not.toHaveBeenCalled();
  });

  it("linha do agente sumiu → `sem_agente`, não `despublicado`", () => {
    // Tratar como `despublicado` mandaria a pessoa publicar um agente que não
    // existe mais — a frase da tela mandaria para um botão inexistente.
    return expect(resolverPersona(leitor(null), "a-1")).resolves.toEqual({
      fonte: "padrao_da_organizacao",
      motivo: "sem_agente",
    });
  });

  it("arquivado → `arquivado`", () => {
    return expect(
      resolverPersona(leitor({ ...NO_AR, archived_at: "2026-01-01T00:00:00Z" }), "a-1"),
    ).resolves.toEqual({ fonte: "padrao_da_organizacao", motivo: "arquivado" });
  });

  it("PAUSADO → `pausado`, e `loadPublishedAgentConfigById` NÃO é chamado", async () => {
    // ⚠️ O CASO QUE JUSTIFICA O PASSO 2 EXISTIR. `loadPublishedAgentConfigById`
    // filtra `archived_at` e `status='published'` e **não filtra `paused_at`**:
    // sozinha, ela devolveria a config de um agente que o dono acabou de pausar,
    // e ele seguiria falando com a equipe com a tela dizendo que está parado.
    const l = leitor({ ...NO_AR, paused_at: "2026-02-02T00:00:00Z" });
    await expect(resolverPersona(l, "a-1")).resolves.toEqual({
      fonte: "padrao_da_organizacao",
      motivo: "pausado",
    });
    expect(l.carregarPublicado).not.toHaveBeenCalled();
  });

  it("sem versão publicada → `despublicado` (e NÃO `pausado`)", async () => {
    // `estadoDoAgente` devolve `parado` para os DOIS. Para a tela são gestos
    // diferentes: um se resolve despausando, o outro publicando. Se este caso e
    // o de cima devolvessem a mesma coisa, metade das instalações receberia a
    // instrução errada.
    const l = leitor({ ...NO_AR, published_version_id: null });
    await expect(resolverPersona(l, "a-1")).resolves.toEqual({
      fonte: "padrao_da_organizacao",
      motivo: "despublicado",
    });
    expect(l.carregarPublicado).not.toHaveBeenCalled();
  });

  it("no ar, mas a versão sumiu entre as duas leituras → `despublicado`", () => {
    // Corrida real (alguém despublicou no meio) e clone com versão ausente.
    // Falhar ABERTO na informação: a persona padrão responde e a tela diz por quê.
    return expect(resolverPersona(leitor(NO_AR, null), "a-1")).resolves.toEqual({
      fonte: "padrao_da_organizacao",
      motivo: "despublicado",
    });
  });
});
