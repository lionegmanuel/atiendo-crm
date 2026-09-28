import { z } from "zod";

import { canonicalPhoneBR, phoneLookupVariants } from "@/lib/channels/phone-variants";
import { parseDialablePhone } from "@/lib/messaging/contact-card";

/**
 * O pré-go-live é uma especialização do gate `allowlist`, não um terceiro
 * motor de autorização. O marcador existe para separar duas intenções que
 * usam o mesmo gate:
 *
 * - allowlist comum: origens do negócio autorizam o contato por prazo;
 * - pré-go-live: somente os números escolhidos para teste podem passar.
 *
 * Sem esta distinção, uma campanha ou automação poderia autorizar um contato
 * real enquanto o operador ainda acredita que o canal está fechado ao público.
 */
export const AI_GATE_PRE_GO_LIVE = "pre_go_live" as const;
export const AI_TEST_PHONE_NUMBERS_KEY = "ai_test_phone_numbers" as const;

export const AI_ACCESS_MODES = ["open", "allowlist", "pre_go_live"] as const;
export type AiAccessMode = (typeof AI_ACCESS_MODES)[number];

const numeroDeTesteSchema = z.string().transform((valor, ctx) => {
  const discavel = parseDialablePhone(valor);
  if (discavel === null || !/^\+[1-9][0-9 ()-]*$/.test(valor.trim())) {
    ctx.addIssue({
      code: "custom",
      message: "Use um telefone com DDI, por exemplo +5511999998888.",
    });
    return z.NEVER;
  }
  return canonicalPhoneBR(discavel);
});

/** Contrato da tela: ela substitui a configuração inteira numa gravação. */
export const aiAccessUpdateSchema = z
  .object({
    mode: z.enum(["open", "pre_go_live"]),
    test_phone_numbers: z.array(numeroDeTesteSchema),
  })
  .transform((valor) => ({
    ...valor,
    test_phone_numbers: [...new Set(valor.test_phone_numbers)],
  }));

export type AiAccessUpdate = z.output<typeof aiAccessUpdateSchema>;

function comoObjeto(metadata: unknown): Record<string, unknown> {
  return metadata !== null && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}

/** Lê o estado sem transformar allowlist legado em "aberto" por engano. */
export function lerModoDeAcessoDaIa(metadata: unknown): AiAccessMode {
  const valor = comoObjeto(metadata);
  if (valor.ai_gate !== "allowlist") return "open";
  return valor.ai_gate_mode === AI_GATE_PRE_GO_LIVE ? "pre_go_live" : "allowlist";
}

/**
 * Lista validada e canônica. Metadata antiga ou editada manualmente falha
 * fechado: item inválido é ignorado, nunca vira um match permissivo.
 */
export function lerNumerosDeTeste(metadata: unknown): string[] {
  const raw = comoObjeto(metadata)[AI_TEST_PHONE_NUMBERS_KEY];
  if (!Array.isArray(raw)) return [];

  const numeros: string[] = [];
  for (const item of raw) {
    const lido = numeroDeTesteSchema.safeParse(item);
    if (lido.success) numeros.push(lido.data);
  }
  return [...new Set(numeros)];
}

export function preGoLiveAtivo(metadata: unknown): boolean {
  return lerModoDeAcessoDaIa(metadata) === "pre_go_live";
}

/** Todo canal criado pelo produto nasce fechado até uma abertura explícita. */
export function metadataInicialDoCanal(): Record<string, unknown> {
  return {
    ai_gate: "allowlist",
    ai_gate_mode: AI_GATE_PRE_GO_LIVE,
    [AI_TEST_PHONE_NUMBERS_KEY]: [],
  };
}

/**
 * Compara todas as grafias válidas da identidade. No Brasil, isso cobre o
 * nono dígito sem obrigar o operador a cadastrar o mesmo telefone duas vezes.
 */
export function numeroPodeTestar(
  telefoneDoContato: string | null | undefined,
  numerosDeTeste: readonly string[],
): boolean {
  if (!telefoneDoContato) return false;
  const variantesDoContato = new Set(phoneLookupVariants(telefoneDoContato));
  if (variantesDoContato.size === 0) return false;
  return numerosDeTeste.some((numero) =>
    phoneLookupVariants(numero).some((variante) => variantesDoContato.has(variante)),
  );
}
