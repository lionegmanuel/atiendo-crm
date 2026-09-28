/**
 * A VERSÃO DA API DO GOOGLE ADS TEM UM LUGAR SÓ.
 *
 * Irmão declarado de `lib/graph-version.ts`, e pelo mesmo motivo: o número
 * copiado em dois arquivos é o defeito, porque no dia do bump o esquecido não
 * falha — ele responde com a versão antiga. Quem cobra é
 * `tests/unit/versao-do-google-ads-num-lugar-so.test.ts`.
 *
 * ─── Por que isto existe: a v17 entrou na main já desativada ─────────────────
 *
 * O transporte nasceu com `"v17"` escrito à mão. O Google desativa versões por
 * cronograma público, e a v17 já não respondia: toda chamada voltava 404 com
 * uma página HTML. O 404 é lido como erro PERMANENTE (`classificaErro`), então
 * cada venda virava `recusado_pela_plataforma` sem nova tentativa — o envio
 * inteiro morto, com o sintoma apontando para "a plataforma recusou".
 *
 * ─── A janela, medida em 18/09/2026 na página oficial ────────────────────────
 *
 * https://developers.google.com/google-ads/api/docs/sunset-dates
 *
 *   v22  desativação out/2026 (tentativa)   ← a mais velha ainda viva
 *   v23  fev/2027 · v24  mai/2027 · v25  ago/2027 · v26  lançamento out/2026
 *
 * Escolhida a v25: a mais nova já lançada, com a desativação mais distante.
 * Quando esta versão entrar em aviso de desativação, o bump é AQUI, e é
 * manutenção esperada, não bug. Reconfira o corpo do `uploadClickConversions`
 * contra a referência da versão nova antes de subir.
 */
export const VERSAO_DA_API_DO_GOOGLE_ADS = "v25";
