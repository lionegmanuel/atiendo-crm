/**
 * Endereços reutilizáveis na hora de marcar.
 *
 * A lista que a tela mostra é a união de três fontes (salvos de propósito,
 * local do tipo, local de compromissos já marcados). A união mora AQUI, e não
 * na rota nem no componente: se cada um filtrasse do seu jeito, "Sala 2" e
 * "sala 2" virariam duas opções e o botão de salvar apareceria para um
 * endereço que a clínica já usa.
 */

export const TETO_DE_ENDERECO = 300;
export const TETO_DA_LISTA = 30;

export function normalizarEndereco(valor: string): string {
  return valor.trim().replace(/\s+/g, " ");
}

export function enderecoJaConhecido(lista: readonly string[], candidato: string): boolean {
  const n = normalizarEndereco(candidato).toLowerCase();
  if (n.length === 0) return false;
  return lista.some((item) => normalizarEndereco(item).toLowerCase() === n);
}

export function juntarEnderecos(
  salvos: readonly string[],
  usados: readonly string[],
  q = "",
): string[] {
  const termo = normalizarEndereco(q).toLowerCase();
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const bruto of [...salvos, ...usados]) {
    const n = normalizarEndereco(bruto);
    if (n.length === 0) continue;
    const chave = n.toLowerCase();
    if (vistos.has(chave)) continue;
    if (termo.length > 0 && !chave.includes(termo)) continue;
    vistos.add(chave);
    saida.push(n);
    if (saida.length >= TETO_DA_LISTA) break;
  }
  return saida;
}

export function podeSalvarEndereco(conhecidos: readonly string[], digitado: string): boolean {
  const n = normalizarEndereco(digitado);
  return n.length > 0 && n.length <= TETO_DE_ENDERECO && !enderecoJaConhecido(conhecidos, n);
}
