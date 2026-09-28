import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { PROVEDORES_DE_AGENDA } from "@/lib/agenda/tipos";

/**
 * VARREDURA: consulta não filtra por um valor que a coluna PROÍBE existir.
 *
 * ─── O defeito que gerou este arquivo ────────────────────────────────────────
 * `calendar_connections.provider` tem `check (provider in ('google_calendar'))`,
 * e o callback grava exatamente isso. Três leituras filtravam por `"google"`:
 *
 *   app/app/agenda/page.tsx                        → o cartão da conexão
 *   app/api/v1/cron/agenda-google-push/route.ts    → o worker da ida
 *   app/api/v1/agenda/google/desconectar/route.ts  → a rota de desconectar
 *
 * As três casam ZERO LINHAS POR CONSTRUÇÃO — não "às vezes", não "quando não há
 * conexão". Medido contra o Postgres real: inserir `provider='google'` é barrado
 * pelo CHECK, então a linha que essas consultas procuram não pode existir.
 *
 * O efeito para quem usa: o dono conecta o Google, a conexão É gravada, e o
 * botão "Conectar Google" continua na tela para sempre; o compromisso nunca sai
 * para o Google; e desconectar responde 404. Três sintomas, um literal.
 *
 * ─── Por que o invariante existente fica VERDE ───────────────────────────────
 * `tests/invariants/agenda-vocabulario.test.ts` já tem o par
 * `{ calendar_connections, provider, PROVEDORES_DE_AGENDA }`. Ele compara o
 * CHECK do banco com a constante do TypeScript — e os dois dizem
 * `google_calendar`. Ele está certo e é cego para isto: o valor errado não está
 * na constante nem no schema, está **no literal dentro do `.eq()`**.
 *
 * Duas guardas que medem pontas diferentes da mesma corrente. Sem esta, a
 * corrente tem um elo que ninguém olha.
 *
 * ─── E a constante era ÓRFÃ, que é o que permitiu tudo ───────────────────────
 * `PROVEDORES_DE_AGENDA` existia em `lib/agenda/tipos.ts` com ZERO consumidores
 * de produção (medido). Símbolo canônico que ninguém importa não é fonte da
 * verdade — é documentação que o compilador não confere. Este arquivo o importa
 * de propósito: a partir daqui, apagá-lo quebra o build do teste.
 */
const RAIZ = process.cwd();

/**
 * Tabelas com vocabulário FECHADO por CHECK, e a constante que o espelha.
 *
 * Só entram colunas cujo conjunto de valores é fechado no schema. Coluna de
 * vocabulário ABERTO (como `crm_lead_activities.type`, que não tem CHECK de
 * propósito para o clone com valor legado não quebrar) fica fora: ali um literal
 * novo é legítimo, e cobrá-lo reprovaria código correto.
 */
const COLUNAS_FECHADAS: ReadonlyArray<{
  tabela: string;
  coluna: string;
  valores: ReadonlyArray<string>;
  simbolo: string;
}> = [
  {
    tabela: "calendar_connections",
    coluna: "provider",
    valores: PROVEDORES_DE_AGENDA,
    simbolo: "PROVEDORES_DE_AGENDA",
  },
];

function arquivos(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : arquivos(p);
    return e.isFile() && /\.tsx?$/.test(p) ? [p] : [];
  });
}

/** Apaga o conteúdo de linhas que são só comentário, preservando as quebras. */
function semComentarios(fonte: string): string {
  return fonte
    .split("\n")
    .map((l) => (/^\s*(\/\/|\/\*|\*)/.test(l) ? "" : l))
    .join("\n");
}

interface Achado {
  onde: string;
  tabela: string;
  coluna: string;
  valor: string;
  simbolo: string;
}

/**
 * Procura `.eq("<coluna>", "<literal>")` em arquivos que citam a tabela, e
 * reprova literal fora do vocabulário que o banco aceita.
 *
 * O recorte é POR ARQUIVO QUE CITA A TABELA, e não global: `provider` é nome de
 * coluna em `tenant_integrations` (nuvemshop), em `ai_provider_credentials`
 * (openai) e em `channel_sessions`. Sem o recorte, esta varredura acusaria
 * `.eq("provider", "nuvemshop")` — que está correto — e viraria ruído.
 */
function achados(): Achado[] {
  const out: Achado[] = [];
  for (const dir of ["app", "lib", "components", "workers"]) {
    for (const arquivo of arquivos(path.join(RAIZ, dir))) {
      // `database.types.ts` é gerado e nomeia toda coluna de todo tabela; ele
      // não faz consulta nenhuma.
      if (arquivo.endsWith("database.types.ts")) continue;
      const fonte = semComentarios(fs.readFileSync(arquivo, "utf8"));
      const rel = path.relative(RAIZ, arquivo);
      for (const alvo of COLUNAS_FECHADAS) {
        if (!fonte.includes(alvo.tabela)) continue;
        const padrao = new RegExp(`\\.eq\\(\\s*"${alvo.coluna}"\\s*,\\s*"([a-z0-9_]+)"`, "g");
        for (const m of fonte.matchAll(padrao)) {
          const valor = m[1] as string;
          if (alvo.valores.includes(valor)) continue;
          const linha = fonte.slice(0, m.index ?? 0).split("\n").length;
          out.push({
            onde: `${rel}:${linha}`,
            tabela: alvo.tabela,
            coluna: alvo.coluna,
            valor,
            simbolo: alvo.simbolo,
          });
        }
      }
    }
  }
  return out;
}

describe("consulta filtra por valor que a coluna pode ter", () => {
  it("a varredura conhece o vocabulário e enxerga os arquivos", () => {
    // Controle do instrumento. Sem isto, uma constante esvaziada ou um diretório
    // renomeado deixaria o gate verde por não medir nada.
    expect(PROVEDORES_DE_AGENDA.length).toBeGreaterThan(0);
    expect(PROVEDORES_DE_AGENDA).toContain("google_calendar");
    expect(arquivos(path.join(RAIZ, "app")).length).toBeGreaterThan(100);
  });

  it("a sonda distingue o literal errado do certo, e não invade outra tabela", () => {
    // A regra que evita o falso positivo: `provider` também é coluna de
    // `tenant_integrations` (nuvemshop) e de `ai_provider_credentials` (openai).
    // O recorte por arquivo-que-cita-a-tabela é o que separa os três.
    const padrao = /\.eq\(\s*"provider"\s*,\s*"([a-z0-9_]+)"/;
    expect(padrao.exec('.eq("provider", "google")')?.[1]).toBe("google");
    expect(PROVEDORES_DE_AGENDA.includes("google" as never)).toBe(false);
    expect(PROVEDORES_DE_AGENDA.includes("google_calendar")).toBe(true);
  });

  it("nenhuma consulta filtra por valor que o CHECK proíbe", () => {
    const lista = achados().map(
      (a) => `${a.onde} → .eq("${a.coluna}", "${a.valor}") em ${a.tabela}`,
    );
    expect(
      lista,
      "Este literal NÃO PODE existir na coluna: o CHECK do schema o proíbe, então a " +
        "consulta casa zero linhas POR CONSTRUÇÃO — não 'às vezes'. Foi assim que a " +
        "conexão do Google ficou invisível na v1.9.0: gravada como `google_calendar`, " +
        "lida como `google`, em três lugares. O botão de conectar não sumia, a ida ao " +
        "Google não saía, e desconectar dava 404. Use a constante " +
        "`PROVEDORES_DE_AGENDA` (ou `PROVEDOR_GOOGLE`) em vez do literal — símbolo " +
        "compartilhado é o que faz o compilador conferir por você.",
    ).toEqual([]);
  });
});
