/**
 * DOIS SEEDS NÃO CRIAM A MESMA ORGANIZAÇÃO.
 *
 * ═══ A classe de defeito que esta varredura fecha ═══
 *
 * `scripts/seed-e2e-funis.ts` e `scripts/seed-e2e-duas-organizacoes.ts`
 * inseriam em `organizations` com o MESMO slug (`e2e-segunda-org`) e colunas
 * DIFERENTES — o de funis sem `onboarded_at`, o outro com. Os dois fazem
 * "procurar por slug, senão criar", então **quem rodasse primeiro vencia**: na
 * parte 2 do e2e o `pipelines-gestao` roda antes, a org nascia sem onboarding,
 * o segundo seed a reusava sem corrigir, e `app/app/layout.tsx:51` mandava essa
 * organização para o wizard. O shell de `/app` saía da árvore levando o
 * `tenant-switcher` junto, e `agenda-escopo-da-organizacao` reprovava com
 * `element(s) not found` — na `main`, travando todo mundo.
 *
 * Separar os slugs conserta a INSTÂNCIA. A classe é *dois seeds independentes
 * construindo a mesma linha com estados incompatíveis*, e o terceiro seed que
 * precisar de uma segunda organização repete — a coincidência de slug não dói,
 * o que dói é ela passar despercebida por quem escreve o terceiro. Achado
 * levantado pelo autor da spec, que chegou à mesma causa por medição própria.
 *
 * Regra que sobrou, e ela é estreita de propósito: **inserir**, não referenciar.
 * Vários seeds legitimamente PROCURAM a org principal por slug para reusá-la —
 * `seed-e2e-agente-mcp` e `seed-e2e-credentials` compartilham `e2e-test-org`, e
 * só o segundo a cria. Proibir a coincidência quebraria o reúso, que é o
 * comportamento certo. O que não pode existir é a mesma organização nascendo em
 * dois lugares.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = path.resolve(__dirname, "../..");
const SCRIPTS = path.join(RAIZ, "scripts");

/**
 * Os slugs que um arquivo INSERE em `organizations`.
 *
 * O padrão no repo é uniforme (`.from("organizations")` seguido de `.insert({`),
 * e a varredura casa exatamente isso — um `select` pelo mesmo slug não entra,
 * que é o ponto. O valor pode vir de literal ou de uma constante do módulo;
 * ambos são resolvidos, porque os dois estilos existem hoje.
 */
function slugsQueOArquivoCria(src: string): string[] {
  const constantes = new Map<string, string>();
  for (const m of src.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*(?::\s*string\s*)?=\s*"([^"]+)"/g)) {
    constantes.set(m[1]!, m[2]!);
  }

  const achados: string[] = [];
  for (const bloco of src.matchAll(
    /\.from\("organizations"\)\s*\n?\s*\.insert\(\s*\{([\s\S]*?)\}\s*(?:as never\s*)?\)/g,
  )) {
    const corpo = bloco[1]!;
    const slug = /(?:^|[\s{,])slug:\s*("([^"]+)"|[A-Za-z_$][\w$]*)/m.exec(corpo);
    if (!slug) continue;
    const bruto = slug[1]!;
    const valor = slug[2] ?? constantes.get(bruto);
    if (valor) achados.push(valor);
  }
  return achados;
}

describe("os seeds não disputam a mesma organização", () => {
  const arquivos = fs
    .readdirSync(SCRIPTS)
    .filter((f) => f.startsWith("seed") && f.endsWith(".ts"))
    .map((f) => ({ nome: f, src: fs.readFileSync(path.join(SCRIPTS, f), "utf8") }));

  it("a varredura enxerga os inserts que existem — controle positivo", () => {
    // Sem isto, uma regex que deixasse de casar devolveria "nenhum conflito" e
    // leria como aprovação. Se o padrão dos seeds mudar, é AQUI que quebra —
    // e o teste passa a dizer "a sonda cegou", não "está tudo bem".
    const total = arquivos.flatMap((a) => slugsQueOArquivoCria(a.src));
    expect(
      total.length,
      "a varredura não encontrou NENHUM insert em `organizations` — a regex " +
        "deixou de casar o padrão dos seeds, e a ausência de conflito abaixo não vale nada",
    ).toBeGreaterThanOrEqual(3);
  });

  it("nenhum slug de organização é criado por dois seeds", () => {
    const donos = new Map<string, string[]>();
    for (const a of arquivos) {
      for (const slug of slugsQueOArquivoCria(a.src)) {
        donos.set(slug, [...(donos.get(slug) ?? []), a.nome]);
      }
    }

    const disputados = [...donos.entries()]
      .filter(([, arqs]) => new Set(arqs).size > 1)
      .map(([slug, arqs]) => `${slug} ← ${[...new Set(arqs)].join(" + ")}`);

    expect(
      disputados,
      "Dois seeds criam a MESMA organização, e o estado dela passa a depender de " +
        "qual spec rodou primeiro. Foi assim que a org de teste chegou sem " +
        "`onboarded_at` e derrubou a `main`: o layout manda toda organização nesse " +
        "estado para o wizard, e o seletor de organização sai da tela junto. " +
        "Dê um slug próprio ao seed novo, ou importe o que já existe.",
    ).toEqual([]);
  });
});
