/**
 * COMO SE ATENDE — o vocabulário de `calendar_event_types.location_kind`, em
 * português, num lugar só.
 *
 * ─── Por que este arquivo existe ─────────────────────────────────────────────
 * O mapa vivia dentro de `app/app/settings/tenant/agenda/_client.tsx`, a tela
 * que CONFIGURA o tipo. A tela que MARCA não tinha como alcançá-lo, e o painel
 * de marcação resolvia isso com um default de parâmetro:
 * `local = "Presencial · Sala 2"`. Como a Agenda nunca passava a prop, esse
 * default venceu em 100% das marcações do produto — toda clínica, de toda
 * instalação, lia "Sala 2" numa tela real.
 *
 * Copiar o mapa para o segundo lugar seria o anti-pattern nº 2 da doutrina
 * (duplicação sem fonte da verdade declarada): o dia em que um valor novo
 * entrasse no CHECK do banco, uma das duas telas passaria a mostrar o código
 * cru e ninguém saberia qual.
 *
 * Client-safe de propósito: zero import de zod, supabase ou next/headers — as
 * duas telas que o consomem são Client Components.
 *
 * ⚠️ Os valores espelham o `calendar_appointments_location_kind_check` e o de
 * `calendar_event_types`. Valor novo entra aqui E no banco; o vocabulário
 * dessas colunas é fechado por CHECK, então o invariante
 * `tests/invariants/vocabulario-banco-x-typescript.test.ts` já cobre a
 * divergência.
 */
export const LOCAIS_DE_ATENDIMENTO: ReadonlyArray<{ valor: string; rotulo: string }> = [
  { valor: "in_person", rotulo: "Presencial" },
  { valor: "phone", rotulo: "Telefone" },
  { valor: "whatsapp", rotulo: "WhatsApp" },
  { valor: "video_link", rotulo: "Link de vídeo" },
  { valor: "google_meet", rotulo: "Google Meet" },
];

/**
 * "Presencial · Consultório 3" — o rótulo e o detalhe que quem configurou
 * escreveu, quando há um.
 *
 * Devolve `undefined` quando não há tipo de local, e não uma string vazia nem um
 * palpite: o painel esconde a linha inteira nesse caso. Inventar "Presencial"
 * para um tipo que não declarou nada é a mesma classe de defeito que o default
 * de parâmetro que este módulo veio substituir.
 */
export function rotuloDoLocal(
  kind: string | null | undefined,
  detalhes?: string | null,
): string | undefined {
  if (!kind) return undefined;
  const base = LOCAIS_DE_ATENDIMENTO.find((l) => l.valor === kind)?.rotulo ?? kind;
  const extra = detalhes?.trim();
  return extra ? `${base} · ${extra}` : base;
}
