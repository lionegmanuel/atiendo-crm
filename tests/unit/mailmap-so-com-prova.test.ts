import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * O `.mailmap` diz QUEM é o autor de cada commit — e quem mexe nele está
 * atribuindo trabalho de uma pessoa a outra identidade. Errar aqui é pior que
 * não ter o arquivo: mapear a pessoa errada credita a alguém trabalho que não
 * é dele, em silêncio, e ninguém confere autoria duas vezes.
 *
 * ─── Por que este gate cobra COMENTÁRIO e não o número ─────────────────────
 *
 * A verificação óbvia seria `git log --author=Jowani | wc -l` valendo 60. Ela
 * NÃO funciona aqui: o `actions/checkout` do CI clona com `fetch-depth: 1`, o
 * histórico tem um commit, e a sonda devolveria zero por não enxergar nada —
 * passando verde exatamente quando o arquivo estivesse quebrado. Gate que não
 * distingue "está certo" de "não consegui olhar" é pior que gate nenhum.
 *
 * Então este gate guarda a REGRA, que é verificável sem histórico: toda linha
 * de mapeamento vem precedida de comentário, e o comentário nomeia a prova
 * (o PR, ou a consulta à API do GitHub que associa o commit à conta).
 *
 * **O que ele NÃO cobre, para ninguém achar que cobre:** se a prova citada é
 * verdadeira. Um comentário pode mentir. O que ele impede é o mapeamento
 * ANÔNIMO — aquele que entra sem que ninguém tenha escrito de onde tirou.
 * Para conferir o efeito de verdade, com o clone completo:
 *
 *   git log --author=Jowani --oneline | wc -l    # 60, não 1
 *   git shortlog -sne | grep -ci softia          # 0
 */
// `process.cwd()` e não `import.meta.url`: sob o vitest o segundo resolveu
// para `/.mailmap` — raiz do sistema —, e o `existsSync` disso é sempre falso.
const CAMINHO = resolve(process.cwd(), ".mailmap");

/** Linha de mapeamento: tem um `<email>` e não começa com `#`. */
function ehMapeamento(linha: string): boolean {
  const t = linha.trim();
  return t !== "" && !t.startsWith("#") && t.includes("<");
}

describe(".mailmap — nenhuma identidade entra sem prova escrita", () => {
  it("o arquivo existe", () => {
    expect(existsSync(CAMINHO), `.mailmap não encontrado em ${CAMINHO}`).toBe(true);
  });

  const linhas = existsSync(CAMINHO)
    ? readFileSync(CAMINHO, "utf8").split("\n")
    : [];

  it("toda linha de mapeamento tem comentário logo acima", () => {
    // Sem este piso o caso passa VAZIO quando o arquivo não é lido — é o
    // defeito que este gate inteiro existe para não repetir.
    expect(
      linhas.filter(ehMapeamento).length,
      "nenhum mapeamento lido: o arquivo sumiu ou o caminho está errado. O piso\n" +
      "é contra o VÁCUO (gate que passa por não enxergar), não uma contagem exata:\n" +
      "remover um mapeamento legítimo não deve reprovar por si só.",
    ).toBeGreaterThanOrEqual(3);
    const orfas: string[] = [];
    linhas.forEach((linha, i) => {
      if (!ehMapeamento(linha)) return;
      // vale o bloco de comentário imediatamente acima, pulando as outras
      // linhas de mapeamento do mesmo bloco (uma pessoa pode ter 2 e-mails)
      let j = i - 1;
      while (j >= 0 && ehMapeamento(linhas[j]!)) j--;
      if (j < 0 || !linhas[j]!.trim().startsWith("#")) orfas.push(linha.trim());
    });
    expect(
      orfas,
      `mapeamento sem comentário de prova acima — quem mapeia diz de onde tirou:\n  ${orfas.join("\n  ")}`,
    ).toEqual([]);
  });

  it("o comentário acima de cada mapeamento nomeia a prova (PR ou API)", () => {
    // Ancorado no MAPEAMENTO, não em "bloco de texto que começa com `# @`":
    // a primeira versão fatiava por esse prefixo e quebrava quando a prosa
    // citava um handle no início de uma linha. O gate media a vizinhança do
    // dado em vez do dado — e reprovava o arquivo por defeito próprio.
    const semProva: string[] = [];
    linhas.forEach((linha, i) => {
      if (!ehMapeamento(linha)) return;
      // sobe pelo bloco contíguo de comentários imediatamente acima
      const comentario: string[] = [];
      let j = i - 1;
      while (j >= 0 && (ehMapeamento(linhas[j]!) || linhas[j]!.trim().startsWith("#"))) {
        if (linhas[j]!.trim().startsWith("#")) comentario.unshift(linhas[j]!);
        j--;
      }
      const texto = comentario.join("\n");
      if (!/#\d{2,}/.test(texto) && !/\bAPI\b/.test(texto)) semProva.push(linha.trim());
    });
    expect(
      semProva,
      `mapeamento cujo comentário não cita PR nem API — de onde saiu?:\n  ${semProva.join("\n  ")}`,
    ).toEqual([]);
  });

  it("mapeamento sob bloco AGUARDANDO não entra por descuido", () => {
    // O arquivo guarda a linha pronta, comentada, para quando a confirmação
    // vier — e isso é um convite a descomentá-la. Medido: sem este caso,
    // descomentar passava VERDE, porque o bloco acima cita a API (ela prova
    // que as contas são DIFERENTES, o oposto do que o mapeamento afirmaria).
    // O gate não sabe ler o sentido da prova; sabe ver o marcador. Tirar a
    // linha da espera passa a exigir tirar o `AGUARDANDO` junto — ato
    // deliberado, que é exatamente o que falta hoje.
    const presos: string[] = [];
    linhas.forEach((linha, i) => {
      if (!ehMapeamento(linha)) return;
      const comentario: string[] = [];
      let j = i - 1;
      while (j >= 0 && (ehMapeamento(linhas[j]!) || linhas[j]!.trim().startsWith("#"))) {
        if (linhas[j]!.trim().startsWith("#")) comentario.unshift(linhas[j]!);
        j--;
      }
      if (/AGUARDANDO/.test(comentario.join("\n"))) presos.push(linha.trim());
    });
    expect(
      presos,
      "mapeamento sob um bloco marcado AGUARDANDO — a confirmação chegou? então\n" +
        `tire a marca junto, no mesmo commit:\n  ${presos.join("\n  ")}`,
    ).toEqual([]);
  });

  it("nenhuma identidade é mapeada para dois canônicos diferentes", () => {
    const destino = new Map<string, string>();
    const conflitos: string[] = [];
    for (const linha of linhas.filter(ehMapeamento)) {
      const emails = [...linha.matchAll(/<([^>]+)>/g)].map((m) => m[1]!);
      if (emails.length < 2) continue;
      const canonico = emails[0]!;
      for (const antigo of emails.slice(1)) {
        const jaTem = destino.get(antigo);
        if (jaTem && jaTem !== canonico) conflitos.push(`${antigo}: ${jaTem} e ${canonico}`);
        destino.set(antigo, canonico);
      }
    }
    expect(conflitos, `a mesma identidade apontando para duas pessoas:\n  ${conflitos.join("\n  ")}`).toEqual([]);
  });
});
