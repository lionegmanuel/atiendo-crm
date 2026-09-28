/**
 * Fragmentos → a seção do CHANGELOG que a tela da VPS mostra.
 *
 * O que este módulo protege, e que nenhuma ferramenta pronta protegeria: o
 * `CHANGELOG.md` deste produto **é tela**. `lib/system/changelog.ts` extrai a
 * seção de uma versão e a rota de sistema a entrega ao dono do servidor. Por
 * isso a saída aqui não é "um changelog bonito" — é a entrada de um parser
 * conhecido, e cada decisão de forma abaixo existe para não quebrá-lo.
 *
 * Módulo PURO. Sem disco, sem rede, sem marca: `lib/` é varrido por
 * `tests/unit/branding.test.ts`, então a URL de comparação entra por parâmetro.
 */
import type { Fragmento, Secao } from "./fragmento";

/** Exatamente o que `ATTENTION_HEADING` casa, com o U+26A0 que ela espera. */
const HEADING_ATENCAO = "### ⚠️ Requer atenção";

/**
 * O bloco de atenção vem PRIMEIRO, e isso não é estética: o agente do host
 * corta o CHANGELOG em bytes antes de mandar, e `findAttentionRange` acha o
 * bloco em qualquer posição. Na frente, o aviso sobrevive mesmo quando o corpo
 * é decapitado pelo corte.
 */
const ORDEM: readonly Secao[] = ["adicionado", "alterado", "corrigido"];

const TITULO_DA_SECAO: Record<Secao, string> = {
  adicionado: "### Adicionado",
  alterado: "### Alterado",
  corrigido: "### Corrigido",
};

/**
 * Um item vira `- **titulo** corpo`, com as quebras de linha do fragmento
 * PRESERVADAS e a continuação indentada em dois espaços.
 *
 * Nunca refluir: `markdownParaTextoSimples` converte `**...**` com uma regex
 * single-line, então um negrito partido entre duas linhas chega à tela com os
 * asteriscos literais.
 */
function item(f: Fragmento): string {
  const [primeira, ...resto] = f.corpo.split("\n");
  const continuacao = resto.map((l) => (l.trim() === "" ? "" : `  ${l}`));
  return [`- **${f.titulo}** ${primeira ?? ""}`.trimEnd(), ...continuacao].join("\n");
}

export interface SecaoMontada {
  versao: string;
  texto: string;
}

/**
 * @param data no formato `YYYY-MM-DD` — vem de fora porque o módulo é puro e
 *   porque um teste que chama `new Date()` mede o relógio, não a montagem.
 */
export function montarSecao(
  fragmentos: readonly Fragmento[],
  versao: string,
  data: string,
): SecaoMontada {
  if (fragmentos.length === 0) {
    throw new Error("montarSecao sem fragmento: não há seção a escrever");
  }

  const partes: string[] = [`## [${versao}] — ${data}`, ""];

  // TODOS os avisos sob UM heading só. Dois headings de atenção fariam
  // `findAttentionRange` pegar o primeiro e deixar o segundo vazando para
  // dentro de "O que muda" na tela.
  const avisos = fragmentos.filter((f) => f.atencao);
  if (avisos.length > 0) {
    partes.push(HEADING_ATENCAO, "");
    for (const f of avisos) {
      partes.push(`- **${f.titulo}** ${f.atencao?.split("\n")[0] ?? ""}`.trimEnd());
      const resto = (f.atencao ?? "").split("\n").slice(1);
      for (const l of resto) partes.push(l.trim() === "" ? "" : `  ${l}`);
    }
    partes.push("");
  }

  for (const secao of ORDEM) {
    const daSecao = fragmentos.filter((f) => f.secao === secao);
    if (daSecao.length === 0) continue;
    partes.push(TITULO_DA_SECAO[secao], "");
    for (const f of daSecao) {
      partes.push(item(f), "");
    }
  }

  return { versao, texto: partes.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() };
}

/** `## [Não lançado]` — a âncora que a seção nova nasce logo abaixo. */
const ANCORA = /^##\s+\[Não lançado\].*$/m;

/**
 * Insere a seção montada e atualiza o rodapé de referências de link.
 *
 * O rodapé apodrece à mão, e já apodreceu: medido no HEAD b3996c43, o arquivo
 * não tem linha `[1.6.0]:` e o `[Não lançado]` ainda compara contra `v1.5.0` —
 * uma versão inteira depois. Quem escreve à mão esquece; quem monta, não.
 *
 * @param compararUrl função que devolve a URL de comparação entre duas tags.
 *   Entra por parâmetro porque este arquivo não pode nomear o repositório.
 */
export function aplicarNoChangelog(
  raw: string,
  secao: SecaoMontada,
  anterior: string,
  compararUrl: (de: string, para: string) => string,
): string {
  if (!ANCORA.test(raw)) {
    throw new Error("CHANGELOG.md sem `## [Não lançado]`: não sei onde inserir a seção");
  }

  // `replace` com FUNÇÃO, nunca com string: `$&`, `$'` e `` $` `` são
  // sequências especiais no argumento de substituição, e o texto do fragmento
  // é prosa escrita à mão que neste repo rotineiramente carrega shell e regex.
  let saida = raw.replace(ANCORA, (ancora) => `${ancora}\n\n${secao.texto}`);

  const refNova = `[${secao.versao}]: ${compararUrl(`v${anterior}`, `v${secao.versao}`)}`;
  const refNaoLancado = `[Não lançado]: ${compararUrl(`v${secao.versao}`, "HEAD")}`;

  if (/^\[Não lançado\]:\s+\S+$/m.test(saida)) {
    saida = saida.replace(/^\[Não lançado\]:\s+\S+$/m, () => `${refNaoLancado}\n${refNova}`);
  } else {
    saida = `${saida.trimEnd()}\n\n${refNaoLancado}\n${refNova}\n`;
  }

  return saida.endsWith("\n") ? saida : `${saida}\n`;
}
