/**
 * A MESMA regra de normalização nos dois lados do marcador de contato.
 *
 * O editor normalizava ao GRAVAR (`raw.trim().toLowerCase().slice(0, 40)`) e a
 * rota de sugestões devolvia a tag CRUA. Para toda tag armazenada fora dessa
 * forma o chip mentia sobre si mesmo: clicar em "+ VIP" gravava "vip", o chip
 * continuava na tela porque o filtro comparava com sensibilidade a caixa, e do
 * segundo clique em diante não fazia nada — controle decorativo, e a duplicação
 * que a sugestão veio impedir.
 *
 * Tag de contato em caixa mista é alcançável pelo caminho NORMAL do produto, e
 * a razão é uma assimetria: a tag de CONVERSA é normalizada pelo próprio schema
 * (`conversationTagSchema`, lib/schemas/messaging.ts:147, com `.trim()
 * .toLowerCase()`), enquanto a de CONTATO era `z.array(z.string())` e o handler
 * gravava verbatim — o diálogo de novo contato, o de edição, a importação por
 * CSV e a API só aparam as pontas.
 *
 * ⚠️ ESCOPO: os DOIS lados estão consertados (issue #1224). A escrita passou a
 * normalizar por aqui — `contactCreateSchema`, `contactPatchSchema`,
 * `contactListQuerySchema` (o filtro `?tag=`), a ficha, a importação por CSV e
 * o `crm_manage_tags` —, e a migration 0324 leva a regra aos marcadores que já
 * estavam gravados em caixa mista.
 *
 * O que NÃO mora aqui é o teto de 20 marcadores: `normalizarTags` só apara as
 * pontas, passa a minúscula, corta em 40, descarta o vazio e tira o repetido.
 * Quem tem teto o aplica depois (a importação por CSV corta em 20) ou recusa ao
 * estourar (`conversationTagsSchema`) — descartar em silêncio o que passa do
 * teto apagaria marcador de quem lê uma planilha.
 */
export const TAMANHO_MAXIMO_DA_TAG = 40;

export function normalizarTag(cru: string): string {
  return cru.trim().toLowerCase().slice(0, TAMANHO_MAXIMO_DA_TAG);
}

/**
 * Normaliza uma LISTA de marcadores como um conjunto: aplica `normalizarTag` em
 * cada um, descarta o que vira vazio, não repete e preserva a ordem da primeira
 * aparição. É a forma que o banco guarda — e, por ser a mesma dos dois lados, a
 * forma que o filtro `?tag=` casa.
 */
export function normalizarTags(cruas: readonly string[]): string[] {
  const vistas = new Set<string>();
  const saida: string[] = [];
  for (const crua of cruas) {
    const tag = normalizarTag(crua);
    if (tag === "" || vistas.has(tag)) continue;
    vistas.add(tag);
    saida.push(tag);
  }
  return saida;
}
