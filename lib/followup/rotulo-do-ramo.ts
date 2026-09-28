import type { FlowBranch } from "./graph-schema";
import { fraseDaCondicao, type NomesDeValor } from "./vocabulario";

/**
 * Como uma saída do nó se chama para quem lê — na bolinha do canvas, no painel
 * da aresta e na mensagem de erro do publish.
 *
 * Existe como módulo próprio porque os dois lados precisam da MESMA frase:
 * `validate-publish.ts` (servidor, monta o 422) e o construtor (cliente, desenha
 * o rótulo). Escrever isto duas vezes foi exatamente o defeito que a integração
 * trouxe de brinde quando duas frentes convergiram sozinhas — uma vez basta.
 *
 * Não pode morar em `graph-schema.ts`: o vocabulário importa de lá, então a
 * volta fecharia ciclo. Não mora em `vocabulario.ts` só para não disputar
 * arquivo com quem está trabalhando nele agora; quando a FV-W2-LINGUAGEM
 * consolidar os termos fixos, esta função vai junto.
 */
export function rotuloDoRamo(branch: FlowBranch, nomes: NomesDeValor = {}): string {
  if (branch.label !== null) return branch.label;
  if (branch.check !== null) {
    return fraseDaCondicao(branch.check.field, branch.check.op, branch.check.value, nomes);
  }
  // Inalcançável com um ramo vindo de `nodeBranches`: ou o texto já está
  // decidido, ou existe a regra para compor. O id fica como último recurso
  // visível em vez de string vazia — se aparecer na tela, é bug, e dá para ver.
  return branch.id;
}
