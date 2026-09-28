/** Contrato central de reconciliação. Checkpoints outbound guardam hashes, não PII. */
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  doEventoDoGoogle,
  paraEventoDoGoogle,
  type AgendamentoParaGoogle,
  type EventoDoGoogle,
} from "./evento";

export const sharedSchema = z
  .object({
    starts_at: z.string(),
    ends_at: z.string(),
    time_zone: z.string(),
    cancelled: z.boolean(),
  })
  .strict();
const hashesSchema = z
  .object({ title: z.string(), description: z.string(), location: z.string(), guest: z.string() })
  .strict();
export const projectionSchema = z.object({ shared: sharedSchema, outbound: hashesSchema }).strict();
export const baseSchema = z
  .object({ shared: sharedSchema, local: hashesSchema, remote: hashesSchema })
  .strict();
export const groups = ["title", "description", "location", "guest"] as const;
export type Group = (typeof groups)[number];
export type Shared = z.infer<typeof sharedSchema>;
export type Projection = z.infer<typeof projectionSchema>;
export type Base = z.infer<typeof baseSchema>;
export const claimSchema = z.object({
  token: z.uuid(),
  epoch: z.string(),
  lease_until: z.string(),
});
export type GoogleClaim = z.infer<typeof claimSchema>;
export const cursorSchema = z.object({
  generation: z.uuid(),
  mode: z.enum(["full", "incremental"]),
  base_sync_token: z.string().nullable(),
  page_token: z.string().nullable(),
  window_start: z.string(),
  window_end: z.string(),
});
export type SyncCursor = z.infer<typeof cursorSchema>;
export const coverageSchema = z
  .object({
    generation: z.uuid(),
    window_start: z.string(),
    window_end: z.string(),
    completed_at: z.string(),
  })
  .strict();

export const writeSchema = z.object({
  conference_request_id: z.uuid().optional(),
  operation_id: z.uuid(),
  method: z.enum(["POST", "PATCH", "DELETE"]),
  etag: z.string().nullable(),
  revision: z.string(),
  local_revision: z.string(),
  desired: projectionSchema,
  groups: z.array(z.enum(groups)),
  shared: z.boolean(),
});
export type PendingWrite = z.infer<typeof writeSchema>;
export const pendingSchema = z.union([
  writeSchema,
  z.object({ reservation: z.literal(true) }).strict(),
]);
export const conflictSchema = z.object({
  reason: z.enum([
    "shared",
    "outbound",
    "legacy",
    "series",
    "outcome",
    "overlap",
    "missing",
    "identity",
  ]),
  local: sharedSchema,
  remote: sharedSchema.nullable(),
  groups: z.array(z.enum(groups)),
  etag: z.string().nullable(),
  revision: z.string(),
  local_revision: z.string(),
  resolution: z
    .object({ choice: z.enum(["google", "local", "preserve_remote"]), actor_id: z.uuid() })
    .optional(),
});
export type GoogleConflict = z.infer<typeof conflictSchema>;
export const hash = (value: string | null | undefined) =>
  createHash("sha256")
    .update(value?.trim() ?? "")
    .digest("hex");
export const sameShared = (a: Shared, b: Shared) =>
  a.cancelled === b.cancelled &&
  (a.cancelled ||
    (Date.parse(a.starts_at) === Date.parse(b.starts_at) &&
      Date.parse(a.ends_at) === Date.parse(b.ends_at) &&
      a.time_zone === b.time_zone));
export function localProjection(
  a: AgendamentoParaGoogle & { guest_email?: string | null },
): Projection {
  const body = paraEventoDoGoogle(a);
  return {
    shared: {
      starts_at: body.start.dateTime,
      ends_at: body.end.dateTime,
      time_zone: body.start.timeZone,
      cancelled: a.status === "cancelled",
    },
    outbound: {
      title: hash(body.summary),
      description: hash(body.description),
      location: hash(body.location),
      guest: hash(a.guest_email?.toLowerCase()),
    },
  };
}
export function remoteProjection(
  e: EventoDoGoogle,
  local: Projection,
  base: Base | null,
): Projection {
  const read = doEventoDoGoogle(e, { fusoDoCalendario: local.shared.time_zone });
  if (read.tipo === "recusado") throw new Error(read.motivo);
  const managed = new Set(
    [local.outbound.guest, base?.remote.guest, base?.local.guest].filter(Boolean),
  );
  const guests = (e.attendees ?? []).filter(
    (p) => !p.organizer && managed.has(hash(p.email?.toLowerCase())),
  );
  return {
    shared:
      read.tipo === "cancelado"
        ? { ...local.shared, cancelled: true }
        : {
            starts_at: read.evento.starts_at,
            ends_at: read.evento.ends_at,
            time_zone: e.start?.timeZone || local.shared.time_zone,
            cancelled: false,
          },
    outbound: {
      title: hash(e.summary),
      description: hash(e.description),
      location: hash(e.location),
      guest: hash(
        guests
          .map((p) => p.email?.trim().toLowerCase())
          .sort()
          .join(","),
      ),
    },
  };
}
export type Comparison = {
  kind: "accept_remote" | "publish" | "converged" | "conflict";
  shared: boolean;
  groups: Group[];
  reason?: "legacy" | "shared" | "outbound";
};
export function compare(base: Base | null, local: Projection, remote: Projection): Comparison {
  if (!base)
    return sameShared(local.shared, remote.shared) &&
      groups.every((g) => local.outbound[g] === remote.outbound[g])
      ? { kind: "converged", shared: true, groups: [...groups] }
      : {
          kind: "conflict",
          shared: false,
          groups: groups.filter((g) => local.outbound[g] !== remote.outbound[g]),
          reason: "legacy",
        };
  const lc = !sameShared(base.shared, local.shared),
    rc = !sameShared(base.shared, remote.shared);
  if (lc && rc && !sameShared(local.shared, remote.shared))
    return { kind: "conflict", shared: true, groups: [], reason: "shared" };
  const dirty = groups.filter((g) => base.local[g] !== local.outbound[g]);
  const conflicting = dirty.filter(
    (g) => remote.outbound[g] !== base.remote[g] && remote.outbound[g] !== local.outbound[g],
  );
  if (conflicting.length)
    return { kind: "conflict", shared: lc || rc, groups: conflicting, reason: "outbound" };
  if (rc && !lc) return { kind: "accept_remote", shared: true, groups: [] };
  const send = dirty.filter((g) => local.outbound[g] !== remote.outbound[g]);
  return {
    kind: (lc && !sameShared(local.shared, remote.shared)) || send.length ? "publish" : "converged",
    shared: lc || rc,
    groups: dirty,
  };
}
/**
 * O convite do Google para o e-mail da FICHA vai junto de uma ALTERAÇÃO, nunca
 * sozinho.
 *
 * O e-mail da ficha não entra no stamp (`fn_google_projection_stamp` só vê
 * `guest_email`), então `compare` não enxerga quando ele falta no evento. A
 * primeira versão deste PR forçava o grupo `guest` também no `converged` — e
 * `sendUpdates=all` transformava isso em convite: na 1ª sincronização depois
 * da atualização, TODO compromisso futuro já publicado com e-mail na ficha
 * mandava e-mail real ao cliente, de uma vez, sem o dono da empresa ter pedido.
 *
 * Decisão do dono (doc 36, opção b): o convite vale só para compromisso
 * criado ou alterado DEPOIS da atualização. Criado sai pelo POST, que já leva
 * os participantes. Alterado é `publish` — há um grupo local sujo indo para o
 * Google de qualquer jeito, e o e-mail da ficha vai junto. `converged`, que é
 * o compromisso antigo que ninguém tocou, fica como está.
 */
export function comConviteDaFicha(
  decision: Comparison,
  ficha: { temEmail: boolean; eventoJaTemOEmail: boolean; cancelado: boolean },
): Comparison {
  if (decision.kind !== "publish") return decision;
  if (!ficha.temEmail || ficha.eventoJaTemOEmail || ficha.cancelado) return decision;
  if (decision.groups.includes("guest")) return decision;
  return { ...decision, groups: [...decision.groups, "guest"] };
}
export function checkpoint(
  base: Base | null,
  local: Projection,
  remote: Projection,
  changed: readonly Group[],
  shared: boolean,
): Base {
  const next: Base = base
    ? structuredClone(base)
    : { shared: remote.shared, local: { ...local.outbound }, remote: { ...remote.outbound } };
  if (shared) next.shared = remote.shared;
  for (const g of changed) {
    next.local[g] = local.outbound[g];
    next.remote[g] = remote.outbound[g];
  }
  return next;
}
/** Só grupos locais dirty entram no PATCH; RSVP e participantes externos sobrevivem. */
export function delta(
  a: AgendamentoParaGoogle & {
    guest_email?: string | null;
    contact_email?: string | null;
    contact_nome?: string | null;
  },
  e: EventoDoGoogle,
  base: Base | null,
  changed: readonly Group[],
  shared: boolean,
): Record<string, unknown> {
  const body = paraEventoDoGoogle(a);
  const patch: Record<string, unknown> = {};
  if (shared) {
    patch.start = body.start;
    patch.end = body.end;
  }
  for (const g of changed) {
    if (g === "title") patch.summary = body.summary;
    if (g === "description") patch.description = body.description ?? "";
    if (g === "location") patch.location = body.location ?? "";
    if (g === "guest") {
      const wantedGuest = a.guest_email?.trim().toLowerCase();
      const wantedContact = a.contact_email?.trim().toLowerCase();
      const existing = e.attendees ?? [];
      const kept = existing.filter(
        (p) =>
          p.organizer ||
          hash(p.email?.toLowerCase()) !== base?.remote.guest ||
          p.email?.toLowerCase() === wantedGuest,
      );
      if (wantedGuest && !kept.some((p) => p.email?.toLowerCase() === wantedGuest))
        kept.push({ email: wantedGuest, responseStatus: "needsAction" });
      // O e-mail da ficha não entra no hash `guest` (stamp SQL só vê
      // `guest_email`). Sem esta linha, um compromisso já publicado nunca
      // ganharia o lead como convidado. ponytail: troca de e-mail na ficha
      // depois da primeira ida não dispara push sozinha — o teto é o stamp;
      // upgrade é incluir o e-mail do contato em `fn_google_projection_stamp`.
      if (
        wantedContact &&
        !kept.some((p) => p.email?.toLowerCase() === wantedContact)
      ) {
        const convidado: { email: string; responseStatus: "needsAction"; displayName?: string } = {
          email: wantedContact,
          responseStatus: "needsAction",
        };
        if (a.contact_nome?.trim()) convidado.displayName = a.contact_nome.trim();
        kept.push(convidado);
      }
      patch.attendees = kept;
    }
  }
  return patch;
}
