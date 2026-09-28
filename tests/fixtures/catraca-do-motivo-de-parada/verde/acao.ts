/**
 * Fixture VERDE da catraca de motivo de parada (#1090).
 *
 * Imita uma ação de `lib/automation/actions`: devolve resultado de execução com
 * `status` e detalhe. Os dois motivos que saem daqui JÁ têm frase no mapa da
 * aba Atividade (um por `detail.reason`, outro porque quem montou o desfecho
 * escreveu a frase em `detail.explicacao`), então a guarda tem de passar.
 *
 * Nenhum import: o arquivo é lido por AST, não executado.
 */
export function acaoDaFixtureVerde(): { type: string; status: string; detail: unknown } {
  const motivoConhecido = { type: "fixture", status: "skipped", detail: { reason: "no_phone" } };
  const desfechoComFrase = {
    type: "fixture",
    status: "postponed",
    detail: { explicacao: "A frase já vem pronta de quem montou o desfecho." },
  };
  return motivoConhecido.type === desfechoComFrase.type ? motivoConhecido : motivoConhecido;
}
