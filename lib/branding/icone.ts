/**
 * A letra que vai no ícone da aba — e o caso em que NÃO vai letra nenhuma.
 *
 * Mora fora de `app/icon.tsx` de propósito. O loader de metadata do Next
 * re-exporta TODO named export do arquivo do usuário para o módulo de rota
 * gerado (`next-metadata-route-loader.js:43`, exceto `default`,
 * `generateSitemaps` e `dynamicParams`), então uma função auxiliar exportada
 * de lá viraria export de rota — e export desconhecido em módulo de rota é
 * justamente o que o Next reprova no build. Aqui ela é uma função pura,
 * testável sem subir renderizador de imagem nenhum.
 *
 * ─── Por que não dá para reusar `resolveBranding().initial` direto ──────────
 *
 * `resolveBranding` (`lib/branding.ts:47-50`) usa spread em vez de `[0]` para
 * não partir code point — e por isso devolve o EMOJI quando a marca começa com
 * um ("🚀 Foguete" → "🚀"). Na sidebar isso é o comportamento certo: o browser
 * tem as fontes de emoji. No ícone não: quem desenha é o satori (`next/og`),
 * que só carrega a fonte embutida `Geist-Regular.ttf` e renderiza QUALQUER
 * glifo ausente como tofu (▯). Buscar uma fonte de emoji resolveria — e faria
 * o `<head>` de toda página depender de uma requisição de rede, que é
 * exatamente o que o ícone gerado existe para evitar.
 *
 * Então a regra é: a primeira LETRA OU DÍGITO do nome. Não havendo nenhuma
 * (marca só de emoji, ou só de pontuação), devolve `null` — e quem chama
 * desenha o ladrilho do accent SEM letra. Cair na inicial do produto seria
 * pior que não ter letra: a aba do revendedor mostraria a NOSSA letra, que é o
 * defeito de white-label que este épico inteiro existe para fechar.
 */

/**
 * A primeira letra ou dígito de `nome`, em caixa alta. `null` quando o nome não
 * tem nenhum — aí o ícone é só a cor da marca.
 *
 * `\p{L}` e `\p{N}` com a flag `u`, não `[A-Za-z0-9]`: "Ótimo CRM" tem de
 * render "Ó", e "Ácaro" tem de render "Á". Restringir ao ASCII descartaria a
 * primeira letra de boa parte dos nomes em português e devolveria a segunda.
 */
export function letraDoIcone(nome: string): string | null {
  for (const caractere of nome.trim()) {
    if (/\p{L}|\p{N}/u.test(caractere)) return caractere.toUpperCase();
  }
  return null;
}
