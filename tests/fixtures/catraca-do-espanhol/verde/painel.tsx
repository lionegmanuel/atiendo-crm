/**
 * Fixture da catraca da #603 — o código do componente é o MESMO nos dois casos
 * (verde e vermelho): quem muda é a tabela irmã (`./rotulos`).
 *
 * `t()` recebe a chave de uma tabela IMPORTADA de outro módulo. Era exatamente
 * esse desenho que a catraca antiga não via: `TRIGGER_LABELS`, `ACTION_LABELS`,
 * `SEVERITY_LABEL` e `ROTULO_DO_PAPEL` moram fora do arquivo que chama `t()`.
 *
 * O `t` local é de mentira de propósito: a fixture prova o ANALISADOR, não o
 * runtime da tradução.
 */
import { ROTULO_DA_ETAPA } from "./rotulos";

const t = (texto: string) => texto;

export function PainelDaEtapa({ etapa }: { etapa: keyof typeof ROTULO_DA_ETAPA }) {
  return <p>{t(ROTULO_DA_ETAPA[etapa])}</p>;
}
