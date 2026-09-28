import { z } from "zod";

export const PUSH_PAYLOAD_MAX = 140;

export const pushPayloadSchema = z.object({
  title: z.string().min(1),
  body: z.string(),
  tag: z.string().optional(),
  href: z.string().optional(),
  icon: z.string().optional(),
});

export type PushPayload = z.infer<typeof pushPayloadSchema>;

export function montarPayloadDeInbound(input: {
  brand: string;
  conversationId: string | null;
  preview: string;
  contactName?: string | null;
  icon?: string | null;
}): PushPayload {
  const title = input.contactName?.trim() || "Nova mensagem";
  void input.brand;
  const body = truncar(input.preview);
  const tag = input.conversationId ? `msg:${input.conversationId}` : "msg";
  const href = input.conversationId ? `/app/inbox?id=${input.conversationId}` : "/app/inbox";
  const icon = input.icon?.trim() || undefined;
  return { title, body, tag, href, icon };
}

export function truncar(text: string): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= PUSH_PAYLOAD_MAX) return t;
  return `${t.slice(0, PUSH_PAYLOAD_MAX - 1)}…`;
}

/** Sem cliente visível o SW mostra a bandeja; aba visível o emit da página cobre. */
export function pushDeveMostrarBandeja(clientesVisiveis: number): boolean {
  return clientesVisiveis === 0;
}
