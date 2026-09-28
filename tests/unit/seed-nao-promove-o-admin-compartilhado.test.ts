/**
 * GATE DE CLASSE: nenhum seed E2E promove o admin de tenant COMPARTILHADO a
 * dono do servidor.
 *
 * ═══ O DEFEITO (medido em 2026-08-14) ═══
 *
 * `scripts/seed-e2e-system-update.ts` chamava `ensurePlatformAdmin` com
 * `creds.users.admin` — o usuário que 10 specs usam como *admin de tenant* — e
 * nenhum seed revogava. As duas partes do job `e2e` compartilham banco SEM
 * reset, então a parte 2 inteira rodava com um admin promovido.
 *
 * Consequência, MEDIDA (não a versão forte, que é falsa): para quem já é `admin`
 * de tenant (rank 5, o teto), a promoção não muda navegação nem os gates por
 * rank — ela abre as superfícies EXCLUSIVAS do dono (`/app/settings/atualizacao`,
 * `/admin/*`, `updateBranding`). Nenhuma spec contaminada abria uma dessas
 * quando isto foi escrito: é uma MINA, e ela detona na primeira que abrir. A
 * medição completa está em `tests/e2e/utils/precondicao.ts`.
 *
 * ═══ POR QUE UM GATE, E NÃO SÓ O CONSERTO ═══
 *
 * O conserto é por INSTÂNCIA: trocar o argumento de uma chamada. O padrão
 * ("preciso de um platform admin no seed; o admin já está aqui, uso ele")
 * continua disponível para o próximo seed. Este teste pega a CLASSE: qualquer
 * `scripts/seed-e2e-*.ts` que faça uma CONCESSÃO em `platform_admins` cujo alvo
 * derive do admin compartilhado reprova.
 *
 * Revogar é permitido, e essa distinção é o coração do teste: o próprio
 * `seed-e2e-system-update.ts` referencia `creds.users.admin` — para REVOGAR.
 * Um gate que só procurasse a co-ocorrência dos dois textos reprovaria o
 * arquivo já corrigido.
 *
 * ⚠️ O QUE ESTE GATE **NÃO** COBRE — e a lista agora é MEDIDA, não imaginada.
 *
 * Uma revisão adversarial montou um laboratório com os 18 seeds reais e este
 * arquivo byte-idêntico, com controle positivo vivo, e mediu **quatro** fugas
 * que a primeira versão deixava passar batido: arrow function
 * (`const ensureX = async (id) => {…}`), o `insert` escrito inline no corpo de
 * `main()` (que é chamada sem argumento, então o cruzamento por argumento não
 * achava nada), destructuring (`const { admin: dono } = creds.users`) e RPC.
 *
 * As três primeiras foram fechadas. A sabotagem confirma **1 reprovação para
 * cada**, e um seed que NÃO promove (controle negativo) **não** reprova.
 *
 * Continuam fora, por serem fora do alcance de varredura **estática**:
 *   - `admin.rpc("fn_que_concede", …)` — o nome da função vive no banco;
 *   - SQL cru por outro cliente;
 *   - concessão feita por um helper importado de outro módulo.
 *
 * A versão anterior deste comentário afirmava que "o caminho ÓBVIO não volta em
 * silêncio" e nomeava três fugas exóticas (env var, outro JSON, outro módulo).
 * As quatro medidas eram **mais ordinárias que as três nomeadas**: escrever o
 * `insert` inline é mais óbvio que extrair um helper, e arrow function é o
 * estilo dominante do repo. Declarar o que não se cobre vale mais do que
 * afirmar uma cobertura que não se mediu.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

const DIR = path.join(process.cwd(), "scripts");

/**
 * Dívida congelada. Só pode ENCOLHER: entrada nova aqui é o gate sendo
 * desligado, não uma exceção. Está vazia porque, no commit que criou este
 * arquivo, nenhum seed promove o admin compartilhado.
 */
// Vazia HOJE, e o teste abaixo assere isso explicitamente: um `it` que itera
// sobre lista vazia passa sem executar asserção nenhuma, e o vitest não reprova
// suíte sem asserção — a passagem significaria nada.
const PERMITIDOS: readonly string[] = [];

function seeds(): string[] {
  return fs
    .readdirSync(DIR)
    .filter((f) => /^seed-e2e-.*\.ts$/.test(f))
    .sort();
}

/** Corpo de uma função, do `{` da assinatura até a chave que o fecha. */
function corpoDaFuncao(texto: string, inicioDaAssinatura: number): string {
  const abre = texto.indexOf("{", inicioDaAssinatura);
  if (abre === -1) return "";
  let profundidade = 0;
  for (let i = abre; i < texto.length; i++) {
    if (texto[i] === "{") profundidade++;
    else if (texto[i] === "}") {
      profundidade--;
      if (profundidade === 0) return texto.slice(abre, i + 1);
    }
  }
  return texto.slice(abre);
}

/**
 * Uma CONCESSÃO é `insert`/`upsert` em `platform_admins`, ou o `update` que
 * ressuscita a linha zerando `revoked_at`. `update` que PREENCHE `revoked_at`
 * é revogação — e é permitida.
 */
function concede(corpo: string): boolean {
  if (!/platform_admins/.test(corpo)) return false;
  if (/\.(insert|upsert)\s*\(/.test(corpo)) return true;
  return /\.update\s*\(\s*\{[^}]*revoked_at\s*:\s*null/s.test(corpo);
}

/**
 * Funções do arquivo cujo corpo concede platform admin.
 *
 * Duas formas de declaração, e a segunda foi acrescentada depois de uma revisão
 * adversarial MEDIR a fuga num laboratório com os 18 seeds reais e o controle
 * positivo vivo: `const ensureX = async (id) => {…}` passava batido, e arrow
 * function é o estilo dominante do repo. Cobrir só `function nome(` era cobrir
 * a forma que o defeito original tinha, não a classe.
 */
function funcoesQueConcedem(texto: string): string[] {
  const nomes: string[] = [];
  for (const assinatura of [
    /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?\(/g,
  ]) {
    let m: RegExpExecArray | null;
    while ((m = assinatura.exec(texto)) !== null) {
      if (concede(corpoDaFuncao(texto, m.index))) nomes.push(m[1]!);
    }
  }
  return nomes;
}

/**
 * A concessão escrita DENTRO da própria função, sem helper e sem argumento.
 *
 * A mesma revisão mediu que pôr o `insert` inline no corpo de `main()` escapa:
 * `main` é detectada como concessora, mas ela é chamada como `main()` — sem
 * argumento —, então o cruzamento por argumento não acha nada. E escrever
 * inline é MAIS óbvio que extrair um helper, não menos.
 *
 * Aqui o teste é outro: o corpo que concede referencia o admin compartilhado
 * (pelo literal ou por apelido) em qualquer lugar dele.
 */
function concedeAoAdminNoProprioCorpo(texto: string, apelidos: string[]): string[] {
  const achados: string[] = [];
  for (const assinatura of [
    /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?\(/g,
  ]) {
    let m: RegExpExecArray | null;
    while ((m = assinatura.exec(texto)) !== null) {
      const corpo = corpoDaFuncao(texto, m.index);
      if (!concede(corpo)) continue;
      const tocaOAdmin =
        REFERENCIA_AO_ADMIN.test(corpo) ||
        apelidos.some((a) => new RegExp(`\\b${a}\\b`).test(corpo));
      if (tocaOAdmin) achados.push(m[1]!);
    }
  }
  return achados;
}

const REFERENCIA_AO_ADMIN = /\.users\.admin\b|\.users\s*\[\s*["']admin["']\s*\]/;

/**
 * Nomes locais que apontam para o admin compartilhado — `const adminUser =
 * creds.users.admin` conta tanto quanto o literal. Sem isto, renomear em uma
 * linha basta para o gate deixar de ver.
 */
function apelidosDoAdmin(texto: string): string[] {
  const apelidos: string[] = [];
  const atribuicao = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*([^;\n]+)/g;
  let m: RegExpExecArray | null;
  while ((m = atribuicao.exec(texto)) !== null) {
    if (REFERENCIA_AO_ADMIN.test(m[2]!)) apelidos.push(m[1]!);
  }
  // `const { admin: dono } = creds.users` — medido como fuga: a regex acima
  // exige identificador logo depois do `const`, e `{` não casa.
  const desestrutura = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*([^;\n]+)/g;
  while ((m = desestrutura.exec(texto)) !== null) {
    if (!/\.users\b|\bcreds\b/.test(m[2]!)) continue;
    for (const parte of m[1]!.split(",")) {
      const [chave, alias] = parte.split(":").map((x) => x.trim());
      if (chave === "admin") apelidos.push(alias || chave);
    }
  }
  return apelidos;
}

/** Argumentos de cada chamada a `nome(...)` — só o primeiro nível de parênteses. */
function argumentosDasChamadas(texto: string, nome: string): string[] {
  const chamada = new RegExp(`\\b${nome}\\s*\\(([^)]*)\\)`, "g");
  const args: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = chamada.exec(texto)) !== null) args.push(m[1]!);
  return args;
}

interface Achado {
  arquivo: string;
  funcao: string;
  argumento: string;
}

function promocoesDoAdminCompartilhado(arquivo: string): Achado[] {
  const texto = fs.readFileSync(path.join(DIR, arquivo), "utf8");
  const apelidos = apelidosDoAdmin(texto);
  const achados: Achado[] = [];
  for (const funcao of concedeAoAdminNoProprioCorpo(texto, apelidos)) {
    achados.push({ arquivo, funcao, argumento: "(no corpo da própria função)" });
  }
  for (const funcao of funcoesQueConcedem(texto)) {
    for (const argumento of argumentosDasChamadas(texto, funcao)) {
      const alcancaOAdmin =
        REFERENCIA_AO_ADMIN.test(argumento) ||
        apelidos.some((a) => new RegExp(`\\b${a}\\b`).test(argumento));
      if (alcancaOAdmin) achados.push({ arquivo, funcao, argumento: argumento.trim() });
    }
  }
  return achados;
}

describe("nenhum seed E2E promove o admin de tenant compartilhado", () => {
  it("a varredura acha seeds — glob quebrado devolveria verde sobre nada", () => {
    // Uma varredura vazia é indistinguível de "nenhum seed promove". Este caso
    // separa as duas leituras antes de qualquer conclusão.
    const achados = seeds();
    expect(achados.length, `nenhum scripts/seed-e2e-*.ts encontrado em ${DIR}`).toBeGreaterThan(0);
    // Piso, não contagem exata: 18 seeds no commit que criou este arquivo. Um
    // glob que degradasse para "achou 1" passaria no `> 0` acima e o gate
    // varreria quase nada em silêncio. Se seeds forem removidos de verdade,
    // baixe o piso conscientemente — nunca apague a asserção.
    expect(achados.length, `varredura degradada: só ${achados.length} seed(s)`).toBeGreaterThan(10);
  });

  it("o detector de concessão está vivo (controle positivo)", () => {
    // Sem este caso, quebrar `concede()`/`funcoesQueConcedem()` deixaria o gate
    // verde por não achar nada — o modo de falha exato que ele existe para
    // impedir. `seed-e2e-system-update.ts` É o arquivo que concede (ao `dono`).
    const texto = fs.readFileSync(path.join(DIR, "seed-e2e-system-update.ts"), "utf8");
    expect(funcoesQueConcedem(texto)).toContain("ensurePlatformAdmin");
    // E a revogação NÃO pode ser lida como concessão, senão o arquivo corrigido
    // reprovaria e a única saída seria afrouxar o gate.
    expect(funcoesQueConcedem(texto)).not.toContain("revogarPlatformAdmin");
  });

  it("o rastreador de apelido está vivo (controle positivo)", () => {
    const exemplo = `const adminUser = creds.users.admin;\nconst outro = creds.users.dono;`;
    expect(apelidosDoAdmin(exemplo)).toEqual(["adminUser"]);
  });

  it("nenhum seed concede platform_admin ao admin compartilhado", () => {
    const achados = seeds()
      .filter((f) => !PERMITIDOS.includes(f))
      .flatMap(promocoesDoAdminCompartilhado);

    expect(
      achados,
      achados.length === 0
        ? ""
        : `Seed promovendo o admin COMPARTILHADO a dono do servidor:\n` +
          achados.map((a) => `  ${a.arquivo}: ${a.funcao}(${a.argumento})`).join("\n") +
          `\n\nUse o usuário dedicado \`creds.users.dono\` (scripts/seed-e2e-credentials.ts). ` +
          `Promover \`users.admin\` contamina as 10 specs que o usam como admin de TENANT — ` +
          `o banco do job \`e2e\` é compartilhado entre as duas partes e ninguém o reseta.`,
    ).toEqual([]);
  });

  it("a allowlist só encolhe — entrada morta não sobrevive", () => {
    // Com `PERMITIDOS` vazia, o laço abaixo não executa asserção nenhuma e o
    // vitest não reprova suíte sem asserção: o caso passaria por NÃO FAZER NADA.
    // Esta linha faz a passagem significar alguma coisa, e vira o registro do
    // dia em que alguém acrescentar a primeira exceção.
    expect(PERMITIDOS, "a allowlist deve estar vazia — se não está, diga por quê aqui").toEqual([]);
    const existentes = seeds();
    for (const permitido of PERMITIDOS) {
      expect(existentes, `${permitido} está na allowlist e não existe mais`).toContain(permitido);
    }
  });
});
