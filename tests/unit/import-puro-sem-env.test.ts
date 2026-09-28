import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * MÓDULO COM FUNÇÃO PURA NÃO PODE EXIGIR AMBIENTE PARA SER IMPORTADO.
 *
 * O defeito que este teste existe para impedir derrubou a main inteira
 * (run 30182066284): `tests/unit/timeline-eixo.test.ts` importava
 * `eixoDoDossie` — função pura, sem I/O nenhum — de um módulo que tinha, no
 * topo, `import { createAdminClient } from "@/lib/supabase/admin"` e
 * `import { isServiceRoleConfigured } from "@/lib/audit"`. Os dois puxam
 * `@/lib/env`, que VALIDA o ambiente ao carregar e LANÇA se faltar variável.
 *
 * No CI não existe `.env` no disco. Resultado: a suíte falhou ao CARREGAR —
 * "Failed Suites 1", 134 passaram, nenhuma asserção do arquivo chegou a rodar.
 * E o modo de falha é traiçoeiro por dois motivos:
 *
 *   1. PASSA NA MÁQUINA DE QUEM ESCREVE. Localmente o `.env.local` existe e o
 *      setup do vitest o carrega — o teste fica verde e vermelho só no CI.
 *   2. QUEBRA QUEM NÃO MEXEU EM NADA. A main vermelha trava todos os PRs
 *      abertos, e o autor do PR bloqueado não tem relação com o arquivo.
 *
 * ⚠️ ESTE TESTE NÃO PODE RODAR NO MESMO PROCESSO DA SUÍTE: o setup do vitest
 * já carregou o `.env` para dentro de `process.env`, e qualquer import daqui
 * encontraria o ambiente completo — o teste passaria SEMPRE, medindo nada. Por
 * isso ele abre um processo filho com o ambiente LIMPO. É a diferença entre
 * verificar e parecer que verificou.
 */

const RAIZ = join(__dirname, "..", "..");

/**
 * O CLI do tsx como ARQUIVO JS, chamado pelo `process.execPath` — nunca por
 * `npx`.
 *
 * `execFileSync` não resolve extensão de executável, e no Windows o `npx` é
 * `npx.cmd`: o filho morria com `spawnSync npx ENOENT` antes de importar
 * coisa nenhuma. Chamar o `.mjs` direto dispensa PATH, dispensa `.cmd` e usa
 * exatamente o tsx deste `node_modules`, em vez do que o PATH oferecer.
 */
const TSX_CLI = join(RAIZ, "node_modules", "tsx", "dist", "cli.mjs");

/**
 * O filho chegou a RODAR e responder?
 *
 * É a distinção que faltava, e ela é o conserto de verdade. Um filho que nunca
 * nasceu devolvia `ok:false` — indistinguível de "o módulo falhou ao
 * importar", que é justamente o resultado que o controle positivo ESPERA. O
 * controle ficava VERDE com o aparato inteiramente quebrado, ao lado do caso
 * real vermelho, afirmando que o instrumento estava bom.
 */
function respondeu(saida: string): boolean {
  return saida.includes("OK") || saida.includes("ERRO:");
}

/**
 * Os módulos vigiados: os que um teste unitário importa por causa de função
 * pura. A lista é explícita porque a alternativa (varrer tudo) acusaria os
 * módulos que PRECISAM de env — e um teste que acusa o correto é pior que
 * teste nenhum: some por ruído.
 */
const MODULOS_PUROS = [
  "@/lib/leads/timeline-query",
  // O texto do aviso de caso no WhatsApp (migration 0292). Ele monta uma
  // mensagem que sai SEM DOM, e é importado por um teste puro — se um dia
  // alguém puxar `marcaDaSaida` ou `env` para o topo dele em vez de receber a
  // marca e a URL já resolvidas, a suíte inteira falha ao CARREGAR no CI, onde
  // não existe `.env` no disco. É o mesmo defeito que derrubou a main no run
  // 30182066284, num arquivo que nasceu depois dele.
  "@/lib/escalacao/texto-do-aviso",
] as const;

/** Importa o módulo num processo filho SEM as variáveis do app. */
function importaComAmbienteLimpo(modulo: string): { ok: boolean; respondeu: boolean; erro: string } {
  const script = `import(${JSON.stringify(modulo)}).then(()=>{console.log("OK")},(e)=>{console.log("ERRO:"+String(e && e.message).split("\\n")[0]);});`;
  // Só PATH e HOME. Nenhuma variável do app — é justamente a ausência delas
  // que o teste mede.
  // `NODE_ENV` fica de fora de propósito; o cast existe porque o tipo do Node o
  // exige e aqui a omissão é o ponto.
  const limpo = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
  } as unknown as NodeJS.ProcessEnv;
  try {
    const saida = execFileSync(process.execPath, [TSX_CLI, "--eval", script], {
      cwd: RAIZ,
      env: limpo,
      encoding: "utf8",
      timeout: 120_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: saida.includes("OK"), respondeu: respondeu(saida), erro: saida.trim() };
  } catch (e) {
    // O filho pode ter RODADO e saído com código != 0 — é assim que o
    // `--eval` termina quando a promessa rejeita. Ali o texto dele ainda vale,
    // e é ele que separa "importou e falhou" de "nunca nasceu".
    const bruto = typeof e === "object" && e !== null && "stdout" in e ? String((e as { stdout?: unknown }).stdout ?? "") : "";
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, respondeu: respondeu(bruto), erro: `${bruto} ${msg}`.trim().slice(0, 400) };
  }
}

describe("módulo de função pura importa sem ambiente", () => {
  // Timeout explícito: estes dois casos abrem um PROCESSO FILHO (`npx tsx`), que
  // custa ~5s em máquina livre e mais em máquina carregada — acima do padrão de
  // 5s do vitest. O timeout interno do execFileSync já é 120s; quem estourava
  // era o do vitest, e o teste ficava vermelho por LENTIDÃO, não por defeito.
  // Justamente o estrago que o cabeçalho deste arquivo descreve: main vermelha
  // travando PR de quem não mexeu em nada (aconteceu no PR #81, que só mexia em
  // documentação).
  it("o aparato consegue detectar o defeito (controle positivo)", { timeout: 60_000 }, () => {
    // Sem isto, um `npx tsx` que falhasse por qualquer motivo daria "ok:false"
    // e o teste principal ficaria vermelho pelo motivo errado — ou, pior, um
    // script que sempre imprime OK deixaria tudo verde medindo nada.
    // `@/lib/env` DEVE falhar sem ambiente: é literalmente o trabalho dele.
    const controle = importaComAmbienteLimpo("@/lib/env");
    // DUAS asserções, e a primeira é a que faltava. Um filho que nunca nasceu
    // devolve `ok:false`, que é exatamente o que a segunda espera — então o
    // controle passava com o aparato quebrado.
    expect(
      controle.respondeu,
      `o processo filho não chegou a responder — o aparato não rodou, então ` +
        `nada foi medido. Saída: ${controle.erro}`,
    ).toBe(true);
    expect(controle.ok, `esperava @/lib/env FALHAR sem env, veio: ${controle.erro}`).toBe(false);
  });

  it.each(MODULOS_PUROS)("%s importa com ambiente vazio", { timeout: 60_000 }, (modulo) => {
    const r = importaComAmbienteLimpo(modulo);
    expect(
      r.ok,
      `${modulo} não pôde ser importado sem variáveis de ambiente — ` +
        `algum import do TOPO puxa @/lib/env. Mova-o para dentro da função que o usa ` +
        `(import tardio). Saída: ${r.erro}`,
    ).toBe(true);
  });
});

describe("o vigiado não regride pelo caminho estático", () => {
  it("timeline-query não tem import de topo que valide env", () => {
    // Rede de segurança BARATA: o teste acima abre processo (segundos); este
    // lê o arquivo (milissegundos) e pega o caso comum na hora, com mensagem
    // que aponta a linha exata. Os dois cobrem o mesmo defeito por caminhos
    // diferentes — se um for desligado por lentidão, o outro continua.
    const src = readFileSync(join(RAIZ, "lib/leads/timeline-query.ts"), "utf8");
    const topo = src.slice(0, src.indexOf("\nexport "));
    const proibidos = ["@/lib/supabase/admin", "@/lib/audit", "@/lib/env"];
    const achados = proibidos.filter((m) =>
      new RegExp(`^import\\s+(?!type\\b)[^;]*from\\s+["']${m}["']`, "m").test(topo),
    );
    expect(
      achados,
      `import de VALOR no topo de timeline-query.ts: ${achados.join(", ")}. ` +
        `Esses módulos validam env ao carregar e quebram quem importa só a função pura.`,
    ).toEqual([]);
  });
});

describe("a lista de vigiados não mente", () => {
  it("todo módulo vigiado existe no disco", () => {
    // Um caminho com typo viraria "0 módulos vigiados" e o `it.each` passaria
    // sem rodar nada — o verde vazio que a §7.292 proíbe.
    const faltando = MODULOS_PUROS.filter((m) => {
      const rel = m.replace("@/", "") + ".ts";
      const dir = join(RAIZ, rel.slice(0, rel.lastIndexOf("/")));
      const arquivo = rel.slice(rel.lastIndexOf("/") + 1);
      try {
        return !readdirSync(dir).includes(arquivo);
      } catch {
        return true;
      }
    });
    expect(faltando, `módulo vigiado não existe: ${faltando.join(", ")}`).toEqual([]);
    expect(MODULOS_PUROS.length).toBeGreaterThan(0);
  });
});
