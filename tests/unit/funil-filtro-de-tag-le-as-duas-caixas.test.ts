import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { applyFilters } from "@/lib/kanban/filters";
import { marcadoresDoCard, cardTemMarcador } from "@/lib/kanban/marcadores-do-card";
import type { Lead } from "@/lib/types/leads";

/**
 * O FILTRO POR MARCADOR DO FUNIL PERGUNTA ÀS DUAS CAIXAS.
 *
 * ## O defeito que fez este arquivo existir
 *
 * O produto marca em dois lugares: `crm_leads.tags` (do negócio, em "Editar
 * lead") e `contacts.tags` (da pessoa, no Inbox e na ficha — a que a campanha
 * lê). O filtro do quadro lia só o primeiro. Quem marcava o cliente e depois
 * filtrava não achava o card, e o seletor sequer oferecia o marcador novo:
 * montava a lista da mesma fonte errada. Relatado como "o filtro só mostra
 * Todas ou desqualificados" — a única etiqueta que alguém digitara num card.
 *
 * ## Por que o controle do negócio, e não só o caso do contato
 *
 * A saída fácil seria trocar `tags` por `contact_tags`. Isso consertaria o
 * relato e apagaria o filtro de quem já usa o campo do card — marcador que
 * continua editável e deixa de ser filtrável. O terceiro caso é essa catraca.
 */

const base: Lead = {
  id: "lead-1",
  organization_id: "org-1",
  pipeline_id: "pil-1",
  stage_id: "st-1",
  contact_id: "c-1",
  title: "Negócio",
  description: null,
  status: "open",
  lost_reason: null,
  position_in_stage: 1000,
  value_cents: null,
  currency: null,
  owner_user_id: null,
  owner_kind: null,
  owner_agent_id: null,
  assigned_at: null,
  last_activity_at: null,
  expected_close_date: null,
  closed_at: null,
  source: "manual",
  source_metadata: {},
  external_id: null,
  custom_fields: {},
  tags: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  created_by_user_id: null,
};

const card = (patch: Partial<Lead>): Lead => ({ ...base, ...patch });

describe("marcadoresDoCard — as duas caixas numa lista só", () => {
  it("une o marcador do negócio com o do contato", () => {
    expect(marcadoresDoCard(card({ tags: ["recompra"], contact_tags: ["vip"] }))).toEqual([
      "recompra",
      "vip",
    ]);
  });

  it("não repete o marcador que existe nas duas", () => {
    expect(marcadoresDoCard(card({ tags: ["vip"], contact_tags: ["vip"] }))).toEqual(["vip"]);
  });

  it("une também os marcadores das CONVERSAS do contato (decisão do dono, 19/09)", () => {
    expect(
      marcadoresDoCard(
        card({ tags: ["recompra"], contact_tags: ["vip"], conversation_tags: ["reclamacao", "vip"] }),
      ),
    ).toEqual(["recompra", "vip", "reclamacao"]);
  });

  it("negócio sem contato não quebra — `contact_tags` é opcional", () => {
    expect(marcadoresDoCard(card({ tags: ["recompra"], contact_id: null }))).toEqual(["recompra"]);
  });
});

describe("applyFilters — filtro por marcador", () => {
  const filtrar = (leads: Lead[], tag: string) =>
    applyFilters(leads, { tag }).map((l) => l.id);

  it("acha o card pelo marcador do CONTATO — o defeito relatado", () => {
    const leads = [
      card({ id: "com", contact_tags: ["vip"] }),
      card({ id: "sem", contact_tags: ["outro"] }),
    ];
    expect(filtrar(leads, "vip")).toEqual(["com"]);
  });

  it("⛔ CONTROLE: continua achando pelo marcador do NEGÓCIO", () => {
    const leads = [card({ id: "com", tags: ["recompra"] }), card({ id: "sem", tags: [] })];
    expect(filtrar(leads, "recompra")).toEqual(["com"]);
  });

  it("acha o card pelo marcador da CONVERSA — a terceira caixa", () => {
    const leads = [
      card({ id: "com", conversation_tags: ["reclamacao"] }),
      card({ id: "sem", conversation_tags: ["outro"] }),
    ];
    expect(filtrar(leads, "reclamacao")).toEqual(["com"]);
  });

  it("marcador que não existe em nenhuma das duas não casa", () => {
    const leads = [card({ id: "a", tags: ["recompra"], contact_tags: ["vip"] })];
    expect(filtrar(leads, "inexistente")).toEqual([]);
    expect(cardTemMarcador(leads[0]!, "inexistente")).toBe(false);
  });
});

describe("os pontos de chamada — a regra só vale se quem a usa a chama", () => {
  // `marcadoresDoCard`/`cardTemMarcador` podem estar certas e nunca rodar: o
  // defeito original morava justamente num ponto de chamada (o filtro lia
  // `l.tags`). Cada caso abaixo prende UM elo, para a sabotagem de um só
  // reprovar exatamente o dele.
  it("a rota do quadro anexa os marcadores do contato e os devolve", () => {
    const fonte = readFileSync("app/api/v1/pipelines/[id]/board/route.ts", "utf8");
    expect(fonte, "withMarcadoresDoContato não é chamada na rota").toMatch(
      /leadsComMarcadores\s*=\s*await withMarcadoresDoContato\(/,
    );
    expect(fonte, "o resultado de withMarcadoresDoContato não chega à resposta").toMatch(
      /leads:\s*leadsComMarcadores\.leads/,
    );
  });

  it("a consulta de conversas do quadro traz as `tags` e as devolve no card", () => {
    const fonte = readFileSync("app/api/v1/pipelines/[id]/board/route.ts", "utf8");
    expect(fonte, "withConversas não seleciona `tags` das conversas").toMatch(
      /from\("conversations"\)\s*\.select\("[^"]*\btags\b[^"]*"\)/,
    );
    expect(fonte, "o card não recebe `conversation_tags`").toContain("conversation_tags:");
  });

  it("o seletor OFERECE os marcadores pela mesma regra", () => {
    const fonte = readFileSync("components/kanban/FilterBar.tsx", "utf8");
    expect(fonte, "FilterBar não monta as opções com marcadoresDoCard(l)").toContain(
      "marcadoresDoCard(l)",
    );
  });

  it("o filtro CASA pela mesma regra", () => {
    const fonte = readFileSync("lib/kanban/filters.ts", "utf8");
    expect(fonte, "applyFilters não filtra com cardTemMarcador(l, f.tag)").toContain(
      "cardTemMarcador(l, f.tag)",
    );
  });
});
