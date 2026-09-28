/**
 * Fixture VERMELHA da catraca de motivo de parada (#1090).
 *
 * Imita uma ação que passou a emitir motivos NOVOS sem que ninguém escrevesse a
 * frase: um por `detail.reason` e outro só em `error` (o desenho do
 * `assign_owner`, que devolve `user_not_in_org` sem detalhe). Os dois têm de
 * REPROVAR, com arquivo e linha.
 *
 * Nenhum import: o arquivo é lido por AST, não executado.
 */
export function acaoDaFixtureVermelha(): { type: string; status: string; detail: unknown } {
  const motivoNovoNoDetalhe = {
    type: "fixture",
    status: "skipped",
    detail: { reason: "motivo_novo_sem_frase" },
  };
  const motivoNovoSemDetalhe = { type: "fixture", status: "failed", error: "outro_motivo_sem_frase" };
  return motivoNovoNoDetalhe.type === motivoNovoSemDetalhe.type
    ? motivoNovoNoDetalhe
    : motivoNovoNoDetalhe;
}
