/**
 * Os avisos que pedem gente vão ao CELULAR, no idioma da organização.
 *
 * O som da Central só toca com o CRM aberto. Os mesmos momentos que têm som
 * (passagem para pessoa, IA sem saldo no provedor, negócio que entrou numa
 * etapa que avisa) viram push; o resto da Central não. E o push não carrega
 * dado do cliente: ele aparece na tela bloqueada.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/notifications/vapid", () => ({ vapidPronto: () => true, vapidPublica: () => "pub", vapidSubject: async () => "mailto:x@y" }));
vi.mock("@/lib/notifications/web_push", () => ({
  enviarPushDaOrg: vi.fn().mockResolvedValue({ sent: 1, gone: 0 }),
  enviarPushAoUsuario: vi.fn().mockResolvedValue({ sent: 1, gone: 0 }),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { enviarPushDaOrg } from "@/lib/notifications/web_push";
import { webPushInboundHandler } from "@/lib/notifications/push.handler";
import type { EventRow } from "@/lib/event-log/dispatcher";
import { corpoDoAvisoDeEtapa, tituloDoAvisoDeEtapa } from "@/lib/leads/aviso-de-etapa";

const ORG = "11111111-1111-4111-8111-111111111111";

const filtros: Array<[string, string, unknown]> = [];

function banco(linhas: Record<string, Record<string, unknown> | null>) {
  return {
    from(tabela: string) {
      const q = {
        select: () => q,
        eq: (coluna: string, valor: unknown) => {
          filtros.push([tabela, coluna, valor]);
          return q;
        },
        maybeSingle: async () => ({ data: linhas[tabela] ?? null, error: null }),
      };
      return q;
    },
  };
}

const evento = (event_type: string, payload: Record<string, unknown>): EventRow => ({
  id: "evt", organization_id: ORG, event_type, entity_kind: "agent_inbox_item", entity_id: null,
  payload, metadata: {}, consumed_by: [], attempts: 0, created_at: new Date().toISOString(),
});

beforeEach(() => {
  vi.mocked(enviarPushDaOrg).mockClear();
  filtros.length = 0;
});

describe("aviso da Central → celular", () => {
  it("escuta o anúncio do aviso (migration 0442)", () => {
    expect(webPushInboundHandler.events).toContain("central.aviso_criado");
  });

  it("etapa que avisa: o texto do aviso, sem o nome do cliente, abrindo o negócio no funil", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco({
      agent_inbox_items: {
        id: "i1", kind: "other", ref_kind: "lead", ref_id: "l1",
        title: tituloDoAvisoDeEtapa("Pedido confirmado", "es"),
        body: corpoDoAvisoDeEtapa("es"),
      },
      organizations: { locale: "es" },
      crm_leads: { title: "Maria Souza +5511999990000", pipeline_id: "p1" },
    }) as never);
    const r = await webPushInboundHandler.handle(evento("central.aviso_criado", { item_id: "i1" }));
    expect(r.status).toBe("ok");
    const payload = vi.mocked(enviarPushDaOrg).mock.calls[0]![1];
    expect(payload).toEqual({
      title: "Negocio entró en «Pedido confirmado»",
      body: "Abre el negocio para dar el siguiente paso. Este aviso se pidió en la configuración de la etapa.",
      tag: "aviso:i1",
      href: "/app/pipelines/p1?lead=l1",
    });
    expect(JSON.stringify(payload)).not.toContain("Maria");
    // O aviso e o negócio são lidos com o filtro da organização do evento.
    expect(filtros).toContainEqual(["agent_inbox_items", "organization_id", ORG]);
    expect(filtros).toContainEqual(["crm_leads", "organization_id", ORG]);
  });

  it("passagem para pessoa: em espanhol, abrindo a conversa", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco({
      agent_inbox_items: { id: "i2", kind: "handoff", ref_kind: "conversation", ref_id: "c1", title: "Handoff humano solicitado — assumir a conversa", body: null },
      organizations: { locale: "es" },
    }) as never);
    await webPushInboundHandler.handle(evento("central.aviso_criado", { item_id: "i2" }));
    expect(vi.mocked(enviarPushDaOrg).mock.calls[0]![1]).toEqual({
      title: "La IA pasó una conversación al equipo",
      body: "Abre la conversación para responder al cliente.",
      tag: "aviso:i2",
      href: "/app/inbox/c1",
    });
  });

  it("passagem de clone antigo (ref no contato) abre o contato", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco({
      agent_inbox_items: { id: "i3", kind: "handoff", ref_kind: "contact", ref_id: "k1", title: "Handoff", body: null },
      organizations: { locale: "pt-BR" },
    }) as never);
    await webPushInboundHandler.handle(evento("central.aviso_criado", { item_id: "i3" }));
    expect(vi.mocked(enviarPushDaOrg).mock.calls[0]![1]).toMatchObject({
      title: "A IA passou uma conversa para a equipe",
      href: "/app/contacts/k1",
    });
  });

  it("IA sem saldo: o título da Central e o remédio, levando às credenciais", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco({
      agent_inbox_items: {
        id: "i4", kind: "other", ref_kind: "ai_provider_credential", ref_id: "cred-1",
        title: "La IA se quedó sin saldo en el proveedor", body: "…",
      },
      organizations: { locale: "es" },
    }) as never);
    await webPushInboundHandler.handle(evento("central.aviso_criado", { item_id: "i4" }));
    expect(vi.mocked(enviarPushDaOrg).mock.calls[0]![1]).toEqual({
      title: "La IA se quedó sin saldo en el proveedor",
      body: "Recarga el saldo en la cuenta del proveedor: las respuestas salen solas cuando vuelva.",
      tag: "aviso:i4",
      href: "/app/ai/credentials",
    });
  });

  it("aviso que não pede gente fica só na tela", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco({
      agent_inbox_items: { id: "i5", kind: "channel_template_review", ref_kind: null, ref_id: null, title: "Modelo aprovado", body: null },
      organizations: { locale: "es" },
    }) as never);
    const r = await webPushInboundHandler.handle(evento("central.aviso_criado", { item_id: "i5" }));
    expect(r.status).toBe("skipped");
    expect(enviarPushDaOrg).not.toHaveBeenCalled();
  });

  it("o espelho de etapa recusado (também `other` + negócio) NÃO vira push de etapa", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco({
      agent_inbox_items: {
        id: "i6", kind: "other", ref_kind: "lead", ref_id: "l1",
        title: "O assistente quis mover um negócio — o funil exige campos antes", body: "…",
      },
      organizations: { locale: "pt-BR" },
    }) as never);
    const r = await webPushInboundHandler.handle(evento("central.aviso_criado", { item_id: "i6" }));
    expect(r.status).toBe("skipped");
    expect(enviarPushDaOrg).not.toHaveBeenCalled();
  });

  it("aviso que sumiu antes do dreno não manda nada", async () => {
    vi.mocked(createAdminClient).mockReturnValue(banco({ agent_inbox_items: null }) as never);
    const r = await webPushInboundHandler.handle(evento("central.aviso_criado", { item_id: "ausente" }));
    expect(r.status).toBe("skipped");
    expect(enviarPushDaOrg).not.toHaveBeenCalled();
  });
});
