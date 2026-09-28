/**
 * O CONVITE DO GOOGLE PARA O E-MAIL DA FICHA NÃO É RETROATIVO.
 *
 * Decisão do dono (doc 36, opção b): o convite vale só para compromisso criado
 * ou alterado DEPOIS da atualização. A primeira versão do #1123 forçava o grupo
 * `guest` também quando `compare` dizia `converged` — com `sendUpdates=all`,
 * isso é e-mail real saindo, na 1ª sincronização, para todo cliente com hora
 * marcada e e-mail na ficha. Uma clínica com 300 compromissos futuros
 * dispararia 300 convites numa tarde, sem ter pedido.
 *
 * Os casos cobrem o PAR: parado → nenhum convite; alterado → convite junto.
 * Só o primeiro lado passaria com um `return decision` cravado; só o segundo
 * passaria com o comportamento antigo. O último caso amarra o executor à regra.
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  checkpoint,
  comConviteDaFicha,
  compare,
  localProjection,
  remoteProjection,
} from "@/lib/agenda/google/sync-model";
import type { AgendamentoParaGoogle } from "@/lib/agenda/google/evento";

const antigo: AgendamentoParaGoogle & { guest_email: string | null } = {
  id: "a",
  organization_id: "o",
  title: "Consulta",
  starts_at: "2026-10-10T12:00:00Z",
  ends_at: "2026-10-10T13:00:00Z",
  time_zone: "America/Sao_Paulo",
  status: "confirmed",
  location_kind: "in_person",
  guest_email: null,
};
/** Já publicado ANTES da atualização: no Google, sem o e-mail da ficha. */
const evento = {
  id: "remote",
  summary: "Consulta",
  start: { dateTime: antigo.starts_at, timeZone: antigo.time_zone },
  end: { dateTime: antigo.ends_at },
};
const local = localProjection(antigo);
const remoto = remoteProjection(evento, local, null);
const base = checkpoint(null, local, remoto, ["title", "description", "location", "guest"], true);

const FICHA_SEM_CONVITE = { temEmail: true, eventoJaTemOEmail: false, cancelado: false };

describe("convite da ficha só acompanha alteração (doc 36 = b)", () => {
  it("compromisso antigo que ninguém tocou: continua convergido, sem grupo guest", () => {
    const decisao = comConviteDaFicha(compare(base, local, remoto), FICHA_SEM_CONVITE);
    expect(decisao.kind).toBe("converged");
    expect(decisao.groups).not.toContain("guest");
  });

  it("compromisso alterado depois da atualização: o convite vai junto da alteração", () => {
    const remarcado = { ...antigo, starts_at: "2026-10-10T14:00:00Z", ends_at: "2026-10-10T15:00:00Z" };
    const l = localProjection(remarcado);
    const decisao = comConviteDaFicha(compare(base, l, remoteProjection(evento, l, base)), FICHA_SEM_CONVITE);
    expect(decisao.kind).toBe("publish");
    expect(decisao.groups).toContain("guest");
  });

  it("alterado, mas o evento já tem o e-mail: nada a acrescentar", () => {
    const remarcado = { ...antigo, starts_at: "2026-10-10T14:00:00Z", ends_at: "2026-10-10T15:00:00Z" };
    const l = localProjection(remarcado);
    const decisao = comConviteDaFicha(compare(base, l, remoteProjection(evento, l, base)), {
      ...FICHA_SEM_CONVITE,
      eventoJaTemOEmail: true,
    });
    expect(decisao.groups).not.toContain("guest");
  });

  it("cancelado ou ficha sem e-mail: nunca convida", () => {
    const publish = { kind: "publish" as const, shared: true, groups: [] };
    expect(comConviteDaFicha(publish, { ...FICHA_SEM_CONVITE, cancelado: true }).groups).toEqual([]);
    expect(comConviteDaFicha(publish, { ...FICHA_SEM_CONVITE, temEmail: false }).groups).toEqual([]);
  });

  it("o executor decide pela regra — não por uma condição própria", () => {
    const fonte = fs.readFileSync(
      path.join(__dirname, "..", "..", "lib", "agenda", "google", "sync-executor.ts"),
      "utf8",
    );
    expect(fonte).toMatch(/const decision = comConviteDaFicha\(compare\(base, local, remote\)/);
    expect(fonte).not.toMatch(/decision\.kind === "converged" \|\| decision\.kind === "publish"/);
  });
});
