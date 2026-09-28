/**
 * Nenhum `HANDOFF*.md` volta para a raiz do repositório, e nenhum carrega
 * identificador de produção (#638).
 *
 * ## O buraco que este guarda fecha
 *
 * A raiz do repo acumulou 12 arquivos `HANDOFF*.md`. Pelo próprio critério de
 * `docs/index.md` ("épico **vivo** mantém o HANDOFF na raiz"), um épico
 * encerrado podia ficar na raiz por anos de boa vontade — e a lista da
 * convenção citava 3 dos 12. O custo não foi a desorganização: foi que
 * **a raiz é o diretório que o mundo lê primeiro**. Arquivo de épico encerrado
 * na raiz vira documentação de produto sem revisão, e quatro deles carregavam
 * identificador de produção. Repositório é público, e o valor não pode viajar
 * com o arquivo.
 *
 * ## Por que um gate e não um item de doutrina
 *
 * Porque doutrina envelhece e não reprova. A convenção de `docs/index.md`
 * descrevia o comportamento certo e não impedia nada — 9 dos 12 já violavam
 * enquanto a regra estava escrita. Este teste é o que **impede**, e ele cobre
 * as duas metades do defeito ao mesmo tempo:
 *
 * - **Posição** — a raiz não tem `HANDOFF*`; todo arquivo movido está
 *   indexado; o índice não nomeia arquivo que não existe; e nenhum documento
 *   versionado ficou apontando para caminho morto (é o custo de `git mv` em
 *   massa: quem citava `HANDOFF-x.md` passa a citar o vazio).
 * - **Conteúdo** — o identificador de produção não viaja com o arquivo.
 *   **O formato sobrevive, o valor não**: é o que mantém o defeito e a
 *   reprodução legíveis, e é o que dá ao gate algo para casar. Um conserto que
 *   apagasse a linha inteira passaria o gate apagando a evidência.
 *
 * ## Por que a allowlist só encolhe
 *
 * Cada item de `PERMITIDOS` nomeia ARQUIVO e MOTIVO. Três regras:
 *
 * 1. **Toda exceção é um arquivo, nunca um padrão.** "Este telefone é a fixture
 *    do `canais-oficial`" é defensável; "telefones são permitidos" não é — o
 *    próximo telefone entra por baixo da regra.
 * 2. **Toda exceção se cobra sozinha** (último caso): consertou o arquivo, ela
 *    perde a razão de ser e o teste manda removê-la. Exceção que ninguém
 *    revisa vira permissão permanente. O caso varre **ignorando** a allowlist
 *    de propósito: com a lista aplicada, o arquivo apareceria como limpo mesmo
 *    com o dado intacto, e a exceção nunca se cobraria — o mecanismo de
 *    apodrecimento seria exatamente o que apodrece.
 * 3. **A exceção é da HISTÓRIA, não deste PR.** As entradas abaixo já estavam
 *    versionadas antes do movimento: `canais-oficial` e `wave1-devvivo` vivem
 *    em `docs/handoffs/` desde sempre. Nenhuma é dívida introduzida aqui, e
 *    apagar dado de cliente em silêncio repetiria o defeito em outro endereço —
 *    mudar dado de produção sem o mantenedor saber. Estão nomeadas para ele
 *    decidir.
 *
 * ## Verde vazio
 *
 * O primeiro caso exige que a varredura alcance documento e que as regras
 * casem em algum lugar: instrumento que não mede nada é indistinguível de
 * instrumento que aprovou.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();
const PASTA = "docs/handoffs";

/** O que o git ENTREGA — não o que o disco tem. */
function versionados(padrao: string): string[] {
  return execFileSync("git", ["ls-files", "-z", "--", padrao], { cwd: RAIZ, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

/**
 * O valor é rótulo sintético, ou é número de verdade?
 *
 * **Este é o terceiro mecanismo, e os dois anteriores derrubaram guarda por
 * motivo errado — o que é tão ruim quanto deixar passar.**
 *
 * 1. Medir o token inteiro contava **domínio**: `…@s.whatsapp.net` tem 12
 *    letras, o rótulo sintético alcançava contagem alta só de carregar o
 *    sufixo, e o guarda passava apanhando o identificador que existe para
 *    reprovar.
 * 2. Medir só os dígitos resolveu o (1) e criou o (2): **número de 12–13
 *    dígitos tem no máximo 10 valores distintos**, então o limiar que separava
 *    "sintético" de "real" reprovava telefone de verdade — um conserto que
 *    rodasse a guarda em cima de um JID real a deixaria passar.
 *
 * O que separa os dois de forma **estrutural** é o HISTÓRICO do valor, não a
 * contagem de símbolos distintos: rótulo de pseudonimização é escrito com
 * dígitos repetidos (`5500000000000`, UUID-nil), e número de produção é
 * aleatório. Sete dígitos iguais em sequência é a fronteira: um celular ou
 * JID real tem 7+ idênticos consecutivos com probabilidade de ~1 em 100 mil
 * por número, e a semente de teste do repo (`5531999998888@c.us`) cai **fora**
 * do rótulo — é por isso que ela está na allowlist, nomeada, e não absorvida
 * por heurística. Reprovar telefone de cliente como se fosse etiqueta é
 * exatamente o defeito que a allowlist existe para nomear.
 */
function ehRotuloSintetico(valor: string): boolean {
  // Sete ou mais dígitos iguais em sequência: a marca do rótulo.
  if (/(\d)\1{6,}/.test(valor)) return true;
  // UUID de baixa variedade (o nil-UUID e companhia): quatro caracteres
  // distintos ou menos em 32 posições hex é escrita, não geração aleatória.
  const soHex = valor.replace(/-/g, "");
  if (/^[0-9a-f]+$/i.test(soHex) && new Set(soHex.toLowerCase()).size <= 4) return true;
  return false;
}

const UUID_V4 = /\b[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/g;
/**
 * JID de WhatsApp: o número da conversa, com ou sem `@lid`.
 *
 * **O teto é 20, não 13.** O `remoteJid` de um WhatsApp LID tem **quatorze**
 * dígitos, e a primeira versão do limite (`{8,13}`) o deixou passar inteiro —
 * o identificador de produção ficou no arquivo e o gate, feito para pegar
 * exatamente aquilo, não viu. A amostra de formato abaixo existe para fechar
 * essa classe de buraco: ela cobre 13 e 14 dígitos, e qualquer regex que
 * encolher de novo deixa a amostra muda e o vermelho aparece.
 */
const JID = /\b\d{8,20}@(?:s\.whatsapp\.net|c\.us|lid)\b/g;
/** Celular BR: DDD + 9 + oito dígitos, com ou sem `+55` e pontuação. */
const CELULAR = /(?:\+?55[\s-]?)?(?:\(\d{2}\)|\d{2})[\s-]?9\d{4}[-\s]?\d{4}\b/g;
/**
 * E-mail de domínio REAL.
 *
 * O TLD negativo é o que separa dado de cliente de semente de teste: `e2e-*@…test`
 * e `*.invalid` são as convenções do repo para e-mail que não existe
 * (`scripts/seed-e2e-credentials.ts`), e `.test` é reservado por RFC 2606.
 * Os endereços `@deskcomm.com.br`/`@deskcomm.app` são o **produto** — estão em
 * tela, é o contato público, e não é dado de cliente.
 *
 * **Os domínios de JID ficam de fora de propósito.** `5500…@s.whatsapp.net`
 * casa a forma de e-mail (`algo@dominio.tld`) e é o **mesmo dado** que a regra
 * de JID já varre: contar as duas vezes é contar uma. E a pseudonimização
 * depende disso — o rótulo sintético tem que continuar passando pela regra de
 * JID (onde a entropia o reconhece) sem virar falso positivo aqui.
 */
const EMAIL_REAL =
  /\b[\w.%+-]+@(?!deskcomm\.(?:com\.br|app)\b)(?!(?:s\.whatsapp\.net|c\.us)\b)[\w-]+(?:\.[\w-]+)*\.(?!test\b|invalid\b|example\b|local\b)[A-Za-z]{2,}\b/g;
/** Referência de projeto Supabase: vinte letras minúsculas entre crases. */
const REF_PROJETO = /`[a-z]{20}`/g;

type Classe = "telefone" | "conversa" | "email" | "org" | "infra";

const REGRAS: { classe: Classe; rotulo: string; rx: RegExp }[] = [
  { classe: "conversa", rotulo: "JID de conversa", rx: JID },
  { classe: "telefone", rotulo: "celular BR", rx: CELULAR },
  { classe: "org", rotulo: "UUID v4", rx: UUID_V4 },
  { classe: "email", rotulo: "e-mail de domínio real", rx: EMAIL_REAL },
  { classe: "infra", rotulo: "referência de projeto Supabase", rx: REF_PROJETO },
];

/** Classes cujo valor precisa passar pela checagem de rótulo para contar como dado. */
const EXIGEM_ROTULO: Classe[] = ["conversa", "org", "telefone"];

/**
 * Toda exceção nomeia ARQUIVO e MOTIVO, e só encolhe: consertou o arquivo, o
 * último caso manda tirar a linha. Todas são de ANTES deste PR.
 */
const PERMITIDOS: Record<string, string> = {
  "docs/handoffs/HANDOFF-canais-oficial.md":
    "PRÉ-EXISTENTE: `@c.us` com DDD e número de exemplo, citado como esperado de spec unitária. A heurística de rótulo NÃO o classifica como etiqueta (o número é varied), e é exatamente por isso que ele precisa de nome: fixture é exceção declarada, não deduzida.",
  "docs/handoffs/HANDOFF-crm-vivo.md":
    "PRÉ-EXISTENTE a este PR; tratamento com o mantenedor em canal privado (#638).",
  "docs/handoffs/HANDOFF-inbox-multimodal.md":
    "PRÉ-EXISTENTE a este PR; tratamento com o mantenedor em canal privado (#638).",
  "docs/handoffs/HANDOFF-wave1-devvivo.md":
    "PRÉ-EXISTENTE a este PR; tratamento com o mantenedor em canal privado (#638).",
};

const handoffsVersionados = versionados(`${PASTA}/HANDOFF*.md`);

function ler(arq: string): string {
  return fs.readFileSync(path.join(RAIZ, arq), "utf8");
}

interface Acerto {
  arquivo: string;
  classe: Classe;
  rotulo: string;
  linhas: number[];
}

function linhaDoIndice(conteudo: string, indice: number): number {
  let linha = 1;
  for (let i = 0; i < indice; i++) if (conteudo[i] === "\n") linha++;
  return linha;
}

/** Escaneia ignorando a allowlist — é o que permite detectar que ela apodreceu. */
function varrerIgnorandoPermissao(arquivos: string[]): Acerto[] {
  return varrer(arquivos, true);
}

function varrer(arquivos: string[], ignorarPermissao = false): Acerto[] {
  const achados: Acerto[] = [];
  for (const arq of arquivos) {
    if (!ignorarPermissao && PERMITIDOS[arq]) continue;
    const conteudo = ler(arq);
    for (const { classe, rotulo, rx } of REGRAS) {
      const linhas = new Set<number>();
      // `lastIndex` é global: sem o reset, a regra casaria a partir do meio da
      // string anterior e a contagem viraria lixo do teste, não do arquivo.
      rx.lastIndex = 0;
      for (const achado of conteudo.matchAll(rx)) {
        const valor = achado[0];
        if (EXIGEM_ROTULO.includes(classe) && ehRotuloSintetico(valor)) continue;
        // `CELULAR` casaria o DDD+número dentro do próprio JID: contaria uma
        // vez só.
        if (classe === "telefone" && new RegExp(JID.source).test(valor)) continue;
        linhas.add(linhaDoIndice(conteudo, achado.index!));
      }
      if (linhas.size > 0) achados.push({ arquivo: arq, classe, rotulo, linhas: [...linhas].sort((a, b) => a - b) });
    }
  }
  return achados;
}

function descrever(achados: Acerto[]): string {
  return achados
    .map(
      (a) =>
        `  ${a.classe} (${a.rotulo}) em ${a.arquivo}:${a.linhas.join(",")} — ` +
        `${a.linhas.length} ocorrência(s) em formato de produção`,
    )
    .join("\n");
}

function porClasse(classe: Classe): Acerto[] {
  return varrer(handoffsVersionados).filter((a) => a.classe === classe);
}

describe("HANDOFF fora da raiz e sem identificador de produção (#638)", () => {
  it("cada regra ainda casa o formato de produção (verde vazio reprovado)", () => {
    expect(
      handoffsVersionados.length,
      `nenhum HANDOFF versionado em ${PASTA}/ — a varredura passaria vazia`,
    ).toBeGreaterThan(0);

    // **A forma do anti-verde-vazio é o que a primeira versão errou.** Ela pedia
    // que cada regra encontrasse uma ocorrência REAL em `docs/handoffs/` — e o
    // conserto, funcionando, deixa o repositório limpo. O guarda passou a exigir
    // que o defeito continuasse existindo para poder ser medido: green por
    // perversão, o pior tipo de verde, porque é indistinguível de "nada foi
    // encontrado porque nada foi procurado".
    //
    // O que precisa ser provado é outro: que o REGEX casa o formato de
    // produção. A amostra sintética abaixo é essa prova, e ela é
    // independente do conteúdo do repositório — vale para hoje e para quando o
    // próximo `HANDOFF` chegar com telefone de novo.
    const AMOSTRA: { classe: Classe; rotulo: string; casando: string }[] = [
      { classe: "conversa", rotulo: "JID de conversa", casando: "5531988887777@s.whatsapp.net" },
      { classe: "conversa", rotulo: "JID lid", casando: "83729164502817@lid" },
      { classe: "telefone", rotulo: "celular BR", casando: "(11) 98888-7777" },
      { classe: "org", rotulo: "UUID v4", casando: "3f9c2a71-5b8e-4d06-9e1a-7c4b2d8f6a13" },
      { classe: "email", rotulo: "e-mail de pessoa", casando: "pessoa@dominio-real.com.br" },
      { classe: "infra", rotulo: "projeto Supabase", casando: "`qmzvtrkplwhxnbyfgdsc`" },
    ];

    const mutas: string[] = [];
    for (const { classe, rotulo, casando } of AMOSTRA) {
      const regra = REGRAS.find((r) => r.classe === classe)!;
      regra.rx.lastIndex = 0;
      const casou = regra.rx.test(casando);
      // A amostra tem a FORMA de produção e valor inventado: nenhum destes
      // números existe fora deste arquivo. Não é rótulo (passa pela heurística
      // como dado), e é esse o caminho que o guarda tem de reprovar.
      const aceito = casou && (!EXIGEM_ROTULO.includes(classe) || !ehRotuloSintetico(casando));
      if (!aceito) mutas.push(`${rotulo} (exemplo: ${casando.replace(/[^@\s]/g, "#")})`);
    }
    expect(
      mutas,
      `estas regras não casam mais o formato de produção — o guarda virou decorativo:\n` +
        mutas.map((m) => `  ${m}`).join("\n"),
    ).toEqual([]);
  });

  it("nenhum HANDOFF* é versionado na raiz do repositório", () => {
    const naRaiz = versionados("HANDOFF*.md");
    expect(
      naRaiz,
      `estes estão versionados na raiz — arquive em ${PASTA}/ e indexe:\n` +
        naRaiz.map((f) => `  ${f}`).join("\n"),
    ).toEqual([]);
  });

  it("nenhum HANDOFF* existe na raiz do disco, nem sem versionar", () => {
    // Um `HANDOFF` no `.gitignore` não sai do disco de quem já clonou antes,
    // não aparece na revisão de PR e não é visto por quem abre o repositório.
    // Se a defesa é "não versiona", é o mesmo buraco, só invisível.
    const naRaiz = fs
      .readdirSync(RAIZ, { withFileTypes: true })
      .filter((e) => e.isFile() && /^HANDOFF.*\.md$/.test(e.name))
      .map((e) => e.name);
    expect(naRaiz, "HANDOFF na raiz do disco — mova para docs/handoffs/ e apague da raiz:").toEqual([]);
  });

  it("o HANDOFF do silêncio não carrega identificador de produção (aceite da #638)", () => {
    // A #534 já avisara este arquivo, e o aceite da #638 o nomeia: um conserto
    // que arrumasse onze e esquecesse este passaria verde nos demais.
    const alvo = `${PASTA}/HANDOFF-silencio-retomada-humana-nao-gruda.md`;
    expect(versionados(alvo), `${alvo} não está versionado`).toContain(alvo);
    const achados = varrer([alvo]);
    expect(achados, `identificador de produção em ${alvo}:\n${descrever(achados)}`).toEqual([]);
  });

  it("nenhum HANDOFF arquivado carrega telefone ou JID de conversa de produção", () => {
    const achados = porClasse("telefone").concat(porClasse("conversa"));
    expect(achados, `telefone ou JID de conversa em formato de produção:\n${descrever(achados)}`).toEqual([]);
  });

  it("nenhum HANDOFF arquivado carrega UUID de organização real", () => {
    const achados = porClasse("org");
    expect(achados, `UUID v4 de produção:\n${descrever(achados)}`).toEqual([]);
  });

  it("nenhum HANDOFF arquivado carrega e-mail de pessoa física", () => {
    const achados = porClasse("email");
    expect(achados, `e-mail de domínio real:\n${descrever(achados)}`).toEqual([]);
  });

  it("nenhum HANDOFF arquivado carrega referência de infraestrutura de produção", () => {
    const achados = porClasse("infra");
    expect(achados, `referência de projeto Supabase:\n${descrever(achados)}`).toEqual([]);
  });

  it("o índice de docs/handoffs/ cobre todo arquivo movido", () => {
    // Sem o índice o movimento some da navegação: o arquivo continua no
    // repositório e ninguém chega nele.
    const indice = path.join(RAIZ, PASTA, "README.md");
    expect(fs.existsSync(indice), `${PASTA}/README.md não existe — é o índice do que foi movido`).toBe(true);
    const texto = fs.readFileSync(indice, "utf8");
    const faltando = handoffsVersionados.map((f) => path.basename(f)).filter((b) => !texto.includes(b));
    expect(
      faltando,
      `o índice não menciona ${faltando.length} arquivo(s) que vivem em ${PASTA}/:\n` +
        faltando.map((f) => `  ${f}`).join("\n"),
    ).toEqual([]);
  });

  it("o índice não nomeia arquivo que não existe", () => {
    // O outro lado: índice que cresce sem parar vira mapa do que um dia existiu.
    // É a mesma matéria da quarentena de `evidencia-citada.test.ts`, pelo outro
    // lado: lá a exceção se cobra sozinha, aqui o nome fantasma é dívida de
    // navegação.
    //
    // **`*` é PADRÃO, não nome** — a mesma lição que aquele arquivo já pagou
    // para aprender: o extrator casava `evidence/wave-<n>-*.png` e tratava
    // `<n>`/`*` como nome literal. Aqui a prosa precisa poder escrever
    // `HANDOFF*.md` ao falar da FAMÍLIA, e o guarda precisa distinguir "o
    // índice aponta para este arquivo" de "o índice descreve a regra". A linha
    // do padrão fica de fora do comparativo; o resto do nome é conferido.
    const texto = fs.readFileSync(path.join(RAIZ, PASTA, "README.md"), "utf8");
    const existentes = new Set(handoffsVersionados.map((f) => path.basename(f)));
    const citados = [...texto.matchAll(/`(HANDOFF[^`]*\.md)`/g)]
      .map((m) => m[1]!)
      // Globby é nome de família, não arquivo: ninguém prometeu versionar um
      // arquivo chamado `HANDOFF*.md`.
      .filter((c) => !/[<>*?{}]/.test(c));
    const fantasmas = citados.filter((c) => !existentes.has(c));
    expect(
      fantasmas,
      `o índice nomeia ${fantasmas.length} arquivo(s) que não estão em ${PASTA}/:\n` +
        fantasmas.map((f) => `  ${f}`).join("\n"),
    ).toEqual([]);
  });

  it("o movimento não deixou citação apontando para caminho morto", () => {
    // O custo de `git mv` em massa: documento que citava `HANDOFF-x.md` na raiz
    // passa a citar arquivo que não está mais lá, e ninguém corrige.
    const quebradas: string[] = [];
    for (const doc of versionados("*.md")) {
      if (doc.startsWith(`${PASTA}/`)) continue;
      const texto = ler(doc);
      for (const m of texto.matchAll(/\]\((HANDOFF[^)\s]*\.md)\)/g)) {
        const alvo = m[1]!;
        const resolvido = path.posix.join(path.posix.dirname(doc), alvo);
        if (!versionados(resolvido).includes(resolvido)) quebradas.push(`${doc} -> ${alvo}`);
      }
    }
    expect(
      quebradas,
      `citação que o movimento quebrou (aponte para ${PASTA}/):\n` +
        quebradas.map((b) => `  ${b}`).join("\n"),
    ).toEqual([]);
  });

  it("a exceção não guarda arquivo que já não é exceção", () => {
    // Exceção que ninguém revisa vira permissão permanente: consertou o arquivo,
    // ela PRECISA perder a razão de ser, ou a próxima pessoa lê "PERMITIDOS" e
    // conclui que aquele dado é intencional.
    const semRazao = Object.keys(PERMITIDOS).filter(
      (arq) => !versionados(arq).includes(arq) || varrerIgnorandoPermissao([arq]).length === 0,
    );
    expect(
      semRazao,
      `estas exceções já não têm exceção que as sustente — REMOVA:\n` +
        semRazao.map((a) => `  ${a}`).join("\n"),
    ).toEqual([]);
  });
});
