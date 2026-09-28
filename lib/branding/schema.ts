/**
 * A FORMA do que se grava para a cor de uma instalação — o envelope.
 *
 * Este arquivo tem três exceções deliberadas à convenção do repo. Cada uma está
 * escrita aqui com o porquê porque as três parecem descuido de fora, e a próxima
 * sessão "consertaria" por consistência.
 *
 * ── 1. `.catchall(z.unknown())`, e não `.strict()` ─────────────────────────────
 *
 * O kit self-host coloca código VELHO sobre schema NOVO por construção: o
 * `update.sh` aplica o baseline ANTES de puxar a imagem, e o rollback do
 * `agent.sh` reverte só o `APP_IMAGE` — o dado gravado pela versão nova continua
 * lá. Com `.strict()`, uma chave desconhecida faz o parse LANÇAR; e como o
 * resolvedor é chamado no `app/layout.tsx`, um throw ali é 500 em TODAS as telas
 * do produto. Uma chave que não entendemos é informação que não usamos, nunca
 * motivo para derrubar a instalação inteira.
 *
 * ── 2. O envelope `{ format, algo }` nasce agora, sem tela que o use ───────────
 *
 * Não é especulação: é a única superfície do sistema que atravessa INSTALAÇÕES e
 * VERSÕES, e retrofit é impossível. Sem o envelope, no dia em que a primeira
 * linha versionada aparecer, TODA linha já existente vira "algo desconhecido" —
 * indistinguível de lixo, porque não há campo onde dizer de que versão ela é.
 *
 *   `format` = versão da FORMA do dado (o que os campos significam).
 *   `algo`   = versão do ALGORITMO de derivação (como a semente vira rampa).
 *
 * São eixos independentes de propósito, e a regra de quando mexer em cada um é o
 * que faz o degrade do rollback ser correto:
 *
 *   - Campo novo, opcional, que o leitor velho pode ignorar → NÃO bump nada; ele
 *     entra pelo `.catchall` e o leitor velho segue funcionando.
 *   - Melhoria no gerador (curva, clamp, piso) → bump `algo`. O leitor velho
 *     continua derivando com o algoritmo DELE, que é o certo: o dado gravado é a
 *     entrada, não a saída.
 *   - `semente_hex`/`papel_da_semente` deixarem de significar o que significam →
 *     bump `format`. Aí o leitor velho NÃO pode adivinhar, e cair no padrão do
 *     produto é a resposta segura.
 *
 * ── 3. Guarda ENTRADA, nunca SAÍDA ────────────────────────────────────────────
 *
 * O que se grava é `{ semente_hex, papel_da_semente }` — jamais os 11 stops
 * derivados, jamais os tokens por tema. Guardar a saída congelaria cada
 * instalação no gerador do dia em que ela foi configurada: uma correção de
 * contraste (e `lib/branding/contraste.ts` existe exatamente para isso) nunca
 * alcançaria quem já tinha configurado. Guardando a entrada, a melhoria chega a
 * todo mundo no primeiro deploy.
 */

import { z } from "zod";

import { ehHexValido, normalizarHex } from "./rampa";

/** Versão da FORMA do dado. Ver regra de bump no cabeçalho. */
export const FORMATO_ATUAL = 1;

/** Versão do ALGORITMO de derivação. Ver regra de bump no cabeçalho. */
export const ALGORITMO_ATUAL = 1;

/**
 * O papel que a semente exerce. `accent` pinta o produto; `marca` mantém o hex
 * só como identidade (logo, selo, cabeçalho de e-mail) sem tocar na interface.
 *
 * O campo é `string` no esquema, e não `z.enum`, DE PROPÓSITO: um papel novo
 * gravado por uma versão futura não pode invalidar o envelope inteiro. Quem
 * decide o que fazer com um papel desconhecido é o resolvedor, que tem onde
 * registrar o motivo — o esquema aqui só descreve forma.
 */
export const PAPEIS_DA_SEMENTE = ["accent", "marca"] as const;
export type PapelDaSemente = (typeof PAPEIS_DA_SEMENTE)[number];

export function ehPapelConhecido(papel: string): papel is PapelDaSemente {
  return (PAPEIS_DA_SEMENTE as readonly string[]).includes(papel);
}

export const CAMINHO_DA_SEMENTE = "semente_hex";

export const esquemaDaCorDaMarca = z
  .object({
    format: z.number().int().min(1),
    algo: z.number().int().min(1),
    semente_hex: z
      .string()
      // O validador de hex é o do domínio (`lib/branding/rampa.ts`), não um
      // regex recém-escrito aqui: duas definições de "hex válido" divergem, e a
      // que perde é sempre a que ninguém está olhando.
      .refine(ehHexValido, { message: "semente_hex não é um hex de cor" }),
    papel_da_semente: z.string().min(1).default("accent"),
  })
  .catchall(z.unknown());

export type CorDaMarca = z.infer<typeof esquemaDaCorDaMarca>;

/**
 * Monta o envelope da versão de HOJE a partir de um hex cru.
 *
 * Nesta fase a fonte é o `.env` (`APP_ACCENT_HEX`), que é só um hex — o envelope
 * nasce aqui. Quando a tabela por organização entrar, ela grava o envelope
 * inteiro e este helper continua servindo o caminho do `.env`, que não deixa de
 * existir: é ele que pinta a tela de login, onde ainda não há organização.
 */
export function envelopeDeSemente(
  hex: string,
  papel: PapelDaSemente = "accent",
): CorDaMarca {
  const cru = hex.trim();
  return {
    format: FORMATO_ATUAL,
    algo: ALGORITMO_ATUAL,
    // Normaliza só o que JÁ é hex, e passa o resto adiante intacto. Chamar
    // `normalizarHex` em lixo LANÇA (rampa.ts o faz de propósito), e esta função
    // roda no caminho de render do `app/layout.tsx`. Quem recusa a semente e diz
    // o motivo é o resolvedor — aqui só se monta a forma.
    semente_hex: ehHexValido(cru) ? normalizarHex(cru) : cru,
    papel_da_semente: papel,
  };
}
