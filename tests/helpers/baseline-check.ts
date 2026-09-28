/**
 * Vocabulário de uma coluna lido do CHECK do `supabase/baseline.sql` — o arquivo
 * que o self-hoster realmente aplica.
 *
 * Existe como função compartilhada de propósito: a guarda que ela serve é
 * justamente contra vocabulário repetido à mão, e um segundo leitor escrito à
 * mão reproduz o defeito dentro da própria rede de proteção.
 *
 * Falha ALTO em vez de devolver lista vazia ou parcial. Zero valores faria o
 * `for` de quem chama passar verde sem exercitar nada — teste vacuamente verde é
 * pior que teste nenhum, porque parece cobertura.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Os literais que `<constraint>` admite, na ordem em que o baseline os declara.
 *
 * @param constraint nome da constraint, ex.: `tenant_integrations_status_check`
 */
export function valoresDoCheckNoBaseline(constraint: string): string[] {
  const caminho = resolve(process.cwd(), "supabase/baseline.sql");
  const sql = readFileSync(caminho, "utf8");

  // Âncora na DEFINIÇÃO (`CONSTRAINT "<nome>" CHECK`), não no nome solto: o
  // baseline também CITA nomes de constraint em prosa (o comentário da migration
  // 0026 menciona `channel_sessions_status_check`), e casar com a citação
  // devolveria mais de uma linha.
  const definicoes = sql
    .split("\n")
    .filter((linha) => linha.includes(`CONSTRAINT "${constraint}" CHECK`));

  if (definicoes.length !== 1) {
    throw new Error(
      `esperava 1 definição de ${constraint} em ${caminho}, achei ${definicoes.length}`,
    );
  }

  const valores = [...definicoes[0]!.matchAll(/'([A-Za-z_]+)'::"text"/g)].map(
    (m) => m[1]!,
  );

  if (valores.length < 2) {
    throw new Error(
      `não consegui ler os valores de ${constraint} no baseline: ${definicoes[0]}`,
    );
  }

  return valores;
}
