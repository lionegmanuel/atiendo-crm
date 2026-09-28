/**
 * O VIGIA: o verde de um PR de schema é uma foto, e o número dele pode ser
 * tomado depois.
 *
 * O `verify` mede colisão no minuto em que roda. Medido em 19/09/2026: o
 * `verify` do #965 terminou em 16/09 às 20:09Z e seguia VERDE com cinco números
 * que a `main` ganhou depois — nenhuma lógica dentro do job conserta um job de
 * três dias atrás. Este script é o que fecha a classe: ele remede os PRs de
 * schema abertos contra a `main` de AGORA e avisa quem foi atropelado.
 *
 * Quatro limites, cada um pago numa madrugada de triagem:
 *
 *   (a) NÃO dispara CI. Mede por `git` e pela API — a cura não pode custar mais
 *       fila que a doença.
 *   (b) UM comentário por PR, editado quando o estado muda. O marcador
 *       `MARCADOR` reencontra o comentário anterior. Bot que comenta de novo a
 *       cada rodada polui o PR de quem contribuiu de graça.
 *   (c) Só fala com colisão REAL medida no minuto, dizendo QUAL número, tomado
 *       por QUEM, e a quem pedir o próximo.
 *   (d) Declara o que NÃO mede (ordem semântica), no próprio comentário.
 *
 * O que ele NÃO mede, e nenhum script infere: **ordem semântica**. Duas
 * migrations podem não colidir em número e mesmo assim depender da ordem entre
 * si (uma refaz o que a outra fez). Isso é leitura humana.
 *
 * Uso: `pnpm tsx scripts/vigia-colisao-de-migration.ts [--escrever]`
 *   sem `--escrever`, imprime o que faria e não toca em PR nenhum.
 */
import { execFileSync } from "node:child_process";

export const MARCADOR = "<!-- vigia:colisao-de-migration -->";
export const ROTULO = "colisao-de-migration";

/** Nome de migration → identidade. `null` para o que não segue o padrão. */
export function identidade(caminho: string): { nnnn: string; ts: string; nome: string } | null {
  const nome = caminho.split("/").pop() ?? "";
  const m = nome.match(/^(\d{14})_(\d{4})_.+\.sql$/);
  return m ? { ts: m[1]!, nnnn: m[2]!, nome } : null;
}

export type Colisao = { nnnn?: string; ts?: string; meu: string; tomadoPor: string };

/**
 * O que o PR acrescenta × o que a base tem HOJE. Só conta colisão com arquivo
 * que o PR NÃO tem — dois caminhos iguais são o mesmo arquivo, não disputa.
 */
export function colisoes(doPr: string[], naBase: string[]): Colisao[] {
  const meus = doPr.map(identidade).filter((x): x is NonNullable<typeof x> => x !== null);
  const deles = naBase.map(identidade).filter((x): x is NonNullable<typeof x> => x !== null);
  const achados: Colisao[] = [];
  for (const meu of meus) {
    for (const outro of deles) {
      if (outro.nome === meu.nome) continue;
      if (outro.nnnn === meu.nnnn) achados.push({ nnnn: meu.nnnn, meu: meu.nome, tomadoPor: outro.nome });
      else if (outro.ts === meu.ts) achados.push({ ts: meu.ts, meu: meu.nome, tomadoPor: outro.nome });
    }
  }
  return achados;
}

/** O maior NNNN da base, para sugerir o próximo — sugestão, nunca reserva. */
export function proximoLivre(naBase: string[]): string {
  const maior = naBase
    .map(identidade)
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .reduce((acc, x) => Math.max(acc, Number(x.nnnn)), 0);
  return String(maior + 1).padStart(4, "0");
}

export function corpoDoAviso(achados: Colisao[], naBase: string[]): string {
  const linhas = achados.map((c) =>
    c.nnnn
      ? `- **${c.nnnn}** — o seu \`${c.meu}\` disputa o número com \`${c.tomadoPor}\`, que já está na \`main\`.`
      : `- **${c.ts}** — o seu \`${c.meu}\` tem o mesmo timestamp de \`${c.tomadoPor}\`. O Supabase usa o timestamp como identidade da migration.`,
  );
  return [
    MARCADOR,
    "## O número da sua migration foi tomado",
    "",
    "Isto **não é um erro seu**: o número estava livre quando você escolheu. Outro PR entrou depois e ficou com ele — não há reserva, quem mescla primeiro leva.",
    "",
    ...linhas,
    "",
    `Para consertar: renumere o arquivo — **o \`NNNN\` e o \`TIMESTAMP\` juntos, no mesmo commit**. O próximo número livre agora é **${proximoLivre(naBase)}**, mas confirme com quem estiver alocando números na rodada antes de escolher: há outros PRs de schema em voo.`,
    "",
    "<sub>Eu **não** meço ordem semântica: duas migrations podem não disputar número e mesmo assim depender da ordem entre si. Isso continua sendo leitura humana.</sub>",
  ].join("\n");
}

/**
 * O comentário quando a colisão SUMIU. Deixar o aviso antigo afirmando "o número
 * foi tomado" num PR que já renumerou é prosa de estado vencida — quem abre o PR
 * lê uma acusação que não vale mais (achado 8 da revisão do #1268).
 */
export function corpoResolvido(): string {
  return [
    MARCADOR,
    "## Resolvido — o número da sua migration está livre",
    "",
    "Numa rodada anterior eu avisei que um número deste PR tinha sido tomado. Na medição de agora, contra a `main` atual, nenhuma migration deste PR disputa número nem timestamp. Obrigado por renumerar.",
    "",
    "<sub>Eu **não** meço ordem semântica: duas migrations podem não disputar número e mesmo assim depender da ordem entre si. Isso continua sendo leitura humana.</sub>",
  ].join("\n");
}

/**
 * A decisão idempotente: um comentário por PR, editado, nunca repetido.
 * `corpo === null` = sem colisão agora. Se havia aviso, ele vira "resolvido" UMA
 * vez; se já é o "resolvido", nada. Sem aviso anterior e sem colisão, silêncio.
 */
export function acao(
  anterior: { id: number; body: string } | null,
  corpo: string | null,
): { tipo: "criar" | "editar" | "nada"; id?: number; corpo?: string } {
  if (corpo === null) {
    if (!anterior) return { tipo: "nada" };
    const resolvido = corpoResolvido();
    if (anterior.body.trim() === resolvido.trim()) return { tipo: "nada" };
    return { tipo: "editar", id: anterior.id, corpo: resolvido };
  }
  if (!anterior) return { tipo: "criar", corpo };
  if (anterior.body.trim() === corpo.trim()) return { tipo: "nada" };
  return { tipo: "editar", id: anterior.id, corpo };
}

/**
 * `gh api --paginate` com `--jq` de ARRAY emite **um array por página**, e o
 * `JSON.parse` morre no segundo. Medido em 19/09/2026 no #677 (112 comentários,
 * 2 páginas): "Unexpected non-whitespace character after JSON at position 1".
 * Achado do @Maestro PRs na revisão do #1268 — a primeira versão deste script
 * morria no 16º PR da fila, ANTES dos que motivaram o trabalho.
 */
export function juntaPaginas<T>(saida: string): T[] {
  const itens: T[] = [];
  for (const pedaco of saida.split("\n")) {
    const linha = pedaco.trim();
    if (!linha) continue;
    const parcial = JSON.parse(linha) as T[] | T;
    if (Array.isArray(parcial)) itens.push(...parcial);
    else itens.push(parcial);
  }
  return itens;
}

// ── daqui para baixo, só I/O ────────────────────────────────────────────────
function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 });
}

function main(): void {
  const escrever = process.argv.includes("--escrever");
  const repo = process.env.GITHUB_REPOSITORY ?? "melgarafael/DeskcommCRM";
  const naBase = execFileSync("git", ["ls-tree", "-r", "--name-only", "origin/main", "--", "supabase/migrations"], {
    encoding: "utf-8",
  })
    .split("\n")
    .filter((l) => l.endsWith(".sql"));
  if (naBase.length < 100) throw new Error(`li ${naBase.length} migrations na base — a sonda perdeu o caminho`);

  // O rótulo não nasce sozinho: `gh pr edit --add-label` com rótulo inexistente
  // ABORTA — e abortaria DEPOIS de já ter comentado. Criar é idempotente.
  if (escrever) {
    try {
      gh(["label", "create", ROTULO, "--color", "B60205", "--description", "o número da migration deste PR foi tomado depois", "--force"]);
    } catch {
      // já existe, ou sem permissão para criar: o `--add-label` abaixo dirá.
    }
  }

  const abertos = juntaPaginas<{ number: number }>(
    gh(["pr", "list", "--state", "open", "--limit", "200", "--json", "number"]),
  );
  let avisados = 0;
  const falhas: string[] = [];
  for (const { number } of abertos) {
    // Um PR que falha NÃO derruba a rodada: os que motivaram este trabalho
    // estão no fim da fila (#1130, #965, #819 e os sete do financeiro).
    try {
      const arquivos = gh(["api", "--paginate", `repos/${repo}/pulls/${number}/files`, "--jq", '.[]|select(.status=="added")|.filename'])
        .split("\n")
        .filter((f) => /^supabase\/migrations\/[^/]+\.sql$/.test(f));
      if (arquivos.length === 0) continue;

      const achados = colisoes(arquivos, naBase);
      const comentarios = juntaPaginas<{ id: number; body: string }>(
        gh(["api", "--paginate", `repos/${repo}/issues/${number}/comments`, "--jq", "[.[]|{id,body}]"]),
      );
      const anterior = comentarios.find((c) => c.body.includes(MARCADOR)) ?? null;
      const corpo = achados.length > 0 ? corpoDoAviso(achados, naBase) : null;
      const decisao = acao(anterior, corpo);

      console.log(`#${number}: ${arquivos.length} migration(ões), ${achados.length} colisão(ões) → ${decisao.tipo}`);
      if (!escrever) continue;

      if (decisao.tipo === "criar") {
        gh(["pr", "comment", String(number), "--body", decisao.corpo!]);
        avisados++;
      } else if (decisao.tipo === "editar") {
        gh(["api", "-X", "PATCH", `repos/${repo}/issues/comments/${decisao.id}`, "-f", `body=${decisao.corpo}`]);
        avisados++;
      }
      // O rótulo acompanha o estado de AGORA, e entra depois do comentário: se
      // ele falhar, o aviso já está lá (que é o que serve a quem contribuiu).
      if (achados.length > 0) gh(["pr", "edit", String(number), "--add-label", ROTULO]);
      else if (anterior) gh(["pr", "edit", String(number), "--remove-label", ROTULO]);
    } catch (erro) {
      falhas.push(`#${number}: ${(erro as Error).message.split("\n")[0]}`);
    }
  }
  console.log(`${abertos.length} PR(s) abertos lidos; ${avisados} aviso(s) escrito(s).`);
  if (falhas.length > 0) {
    // Rodada com buraco não é rodada boa: quem lê o log precisa ver o que ficou
    // sem medida, e o job precisa reprovar.
    console.error(`NÃO MEDIDO em ${falhas.length} PR(s):`);
    for (const f of falhas) console.error(`  ${f}`);
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("vigia-colisao-de-migration.ts")) main();
