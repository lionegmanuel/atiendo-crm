/**
 * O material "não entrou" porque a chave da OpenAI não alcança os modelos de
 * embeddings — não porque o arquivo tenha algum problema.
 *
 * É o caso mais comum de primeira instalação: projetos da OpenAI podem limitar
 * os modelos permitidos (Settings › Project › Limits), e a chave que responde
 * o chat normalmente recusa o `text-embedding-3-small`. A mensagem crua da
 * OpenAI ("Project `proj_…` does not have access to model …") não diz a quem
 * opera o que fazer; quem reconhece o caso aqui é a tela, que troca o texto
 * cru por instrução.
 *
 * Reconhece pelo TEXTO do erro gravado em `last_index_error`, porque é o que a
 * tela tem na mão — o código HTTP não sobrevive até lá.
 */
const PADROES = [
  /does not have access to model/i,
  /model_not_found/i,
  /The model `?text-embedding[^`\s]*`? does not exist/i,
  /insufficient permissions.*embeddings/i,
];

export function ehFaltaDeAcessoAEmbeddings(erro: string | null | undefined): boolean {
  if (!erro) return false;
  return PADROES.some((p) => p.test(erro));
}
