/**
 * WAVE 5 — CORE 3: score com evidência, e a faixa que não pode piscar.
 *
 * Duas exigências, e cada uma tem um jeito próprio de ficar verde à toa:
 *
 * A) A LEI MORA NO BANCO. "Score sem razão não é gravado" só vale se o Postgres
 *    REPROVAR. Ler o arquivo da migration prova que alguém escreveu a constraint;
 *    prova nenhuma de que ela foi aplicada, nem de que pega o caso do array
 *    vazio, que a própria migration nomeia como armadilha. Então aqui a
 *    verificação é uma TABELA-VERDADE contra o banco de verdade — e com a perna
 *    positiva: se tudo fosse recusado, "recusou" não distinguiria nada.
 *
 *    Escreve dentro de transação e faz ROLLBACK: constraint se testa tentando
 *    violar, e tentar violar num banco compartilhado sem desfazer é sujeira.
 *
 * B) A HISTERESE se testa com o valor DANÇANDO, não com o caso limpo. Mas
 *    "não pisca" não é a única propriedade: uma faixa que nunca muda também não
 *    pisca. Então são duas, e a segunda é a que o caso limpo não vê:
 *
 *      P1 — ANTI-PISCA: numa série oscilando em volta do limiar, a faixa muda no
 *           máximo uma vez.
 *      P2 — NÃO-MENTIRA: a faixa exibida nunca fica a DUAS faixas de distância da
 *           régua crua. Segurar uma faixa por um degrau é histerese; parar dois
 *           degraus atrás é rótulo velho — o card diria "Frio" ao lado de 72%.
 *
 * NUMERAÇÃO — e ela quase custou caro. Meus rótulos internos eram 15.a..15.j, e
 * o BRIEFING numera os cenários da wave 5 como 15 (card mostra medidor, hover
 * revela as evidências), 16 (banco rejeita score sem razão) e 17 (lead sem sinal
 * não mostra score inventado). O que estes testes provam é o 16 — ler
 * "15 verdes, cenários 15.a-15.j" levava direto a concluir que o cenário 15
 * estava pronto. **Não está: não começou.**
 *
 *   C16.*  cenário 16 do briefing — a constraint
 *   H.*    a histerese — condição acrescentada ao contrato, não cenário do briefing
 *   S15/S17 os cenários que FALTAM, medidos para aparecerem no placar
 *
 * Placar que PARECE cobrir o que não cobre é pior que placar ausente: ninguém vai
 * atrás do que já parece feito. Por isso o que falta não é omitido — é medido e
 * reportado como BLOQUEADO.
 *
 * Run: E2E_PORT=3020 npx tsx tests/capture-wave-5-cenarios.ts
 */

import pg from "pg";

import { CREDS, carimbar } from "./qa-helpers";
import { resolveBand, type ScoreBand } from "@/lib/kanban/score-band";
import { carregarEnvLocal } from "../scripts/lib/env-de-teste";

const envVars = carregarEnvLocal();
const pool = new pg.Pool({ connectionString: envVars.SUPABASE_DB_URL });
const ORG = CREDS.org_id as string;

type Estado = "PASS" | "FALHA" | "BLOQUEADO";
const resultados: { n: string; nome: string; estado: Estado; detalhe: string }[] = [];
function record(n: string, nome: string, ok: boolean, detalhe: string, estado?: Estado): void {
  const e: Estado = estado ?? (ok ? "PASS" : "FALHA");
  resultados.push({ n, nome, estado: e, detalhe });
  console.info(`${e.padEnd(9)} [${n}] ${nome} — ${detalhe}`);
}

// ---------------------------------------------------------------------------
// A) a tabela-verdade da constraint, contra Postgres real
// ---------------------------------------------------------------------------

interface Caso {
  n: string;
  nome: string;
  /** `true` = o banco TEM de recusar; `false` = tem de aceitar. */
  recusar: boolean;
  campos: Record<string, unknown>;
}

/**
 * O lastro canônico carrega AS DUAS chaves de propósito.
 *
 * O CHECK conta âncoras (`activity_ids`/`message_ids`/`checkpoint_ids`); o board
 * lê `factors`. Enquanto forem dois vocabulários, o único payload que satisfaz a
 * constraint E aparece na tela é o que traz os dois — e a perna positiva desta
 * tabela tem de ser um caso REALISTA, não o mínimo que o banco tolera. Um
 * "aceito" que o usuário nunca veria não é a linha positiva de nada.
 */
const ANCORA = "11111111-1111-1111-1111-111111111111";
/**
 * O lastro canônico, na forma que o banco passou a exigir.
 *
 * A trípice foi implementada MELHOR do que eu tinha armado: em vez de exigir
 * duas chaves irmãs (`activity_ids` E `factors`), a constraint exige `factors`
 * não vazio COM `ancora` DENTRO — `evidence @? '$."factors"[*]."ancora"'`.
 * Os dois vocabulários viraram UM, e a âncora deixa de poder existir sem a
 * frase que a explica. É o conserto certo do defeito que eu tinha reportado.
 */
const LASTRO = {
  factors: [{ pontos: 20, frase: "Cliente confirmou o orçamento", ancora: { kind: "activity", id: ANCORA } }],
};

const CASOS: Caso[] = [
  {
    n: "C16.a",
    nome: "score COM razão e lastro é aceito",
    recusar: false,
    campos: { ai_probability: 72, ai_probability_reason: "dois compromissos e nenhuma objeção aberta", ai_probability_evidence: LASTRO },
  },
  {
    n: "C16.b",
    nome: "score SEM razão é recusado",
    recusar: true,
    campos: { ai_probability: 72, ai_probability_reason: null, ai_probability_evidence: LASTRO },
  },
  {
    n: "C16.c",
    nome: "razão só com espaços é recusada — string vazia não é razão",
    recusar: true,
    campos: { ai_probability: 72, ai_probability_reason: "   ", ai_probability_evidence: LASTRO },
  },
  {
    n: "C16.d",
    nome: "razão sem lastro nenhum é recusada — razão sem referência é adjetivo",
    recusar: true,
    campos: { ai_probability: 72, ai_probability_reason: "parece quente", ai_probability_evidence: {} },
  },
  {
    n: "C16.e",
    nome: "ARRAY VAZIO é recusado — lastro nenhum com cara de lastro",
    recusar: true,
    campos: { ai_probability: 72, ai_probability_reason: "parece quente", ai_probability_evidence: { activity_ids: [] } },
  },
  {
    n: "C16.f",
    nome: "AUSÊNCIA de score é livre — sinal insuficiente é estado legítimo",
    recusar: false,
    campos: { ai_probability: null, ai_probability_reason: null, ai_probability_evidence: {} },
  },
  {
    // A OUTRA METADE DA DIVERGÊNCIA. O board lê `ai_probability_evidence.factors`;
    // o CHECK conta activity_ids/message_ids/checkpoint_ids. Se o CHECK também
    // aceitasse `factors`, dava para escrever só a chave que a tela usa. Não
    // aceita — então quem grava precisa preencher AS DUAS, e nada o obriga.
    // Este caso já foi o INVERSO: quando a tela lia `factors` e a constraint
    // contava `activity_ids`, um lastro na chave que o board consome era
    // RECUSADO — e era o defeito. Agora é o payload canônico, e o critério
    // afirma a aceitação. O nome do teste mudou junto com a regra: critério que
    // sobrevive à mudança do contrato com o nome antigo mente na próxima leitura.
    n: "C16.k",
    nome: "evidência na chave que a tela LÊ, com âncora dentro, é ACEITA",
    recusar: false,
    campos: {
      ai_probability: 72,
      ai_probability_reason: "lastro na chave que o board consome",
      ai_probability_evidence: {
        factors: [{ pontos: 20, frase: "Cliente confirmou o orçamento", ancora: { kind: "activity", id: "11111111-1111-1111-1111-111111111111" } }],
      },
    },
  },
  {
    n: "C16.g",
    nome: "score fora de 0-100 é recusado",
    recusar: true,
    campos: { ai_probability: 101, ai_probability_reason: "acima do teto", ai_probability_evidence: LASTRO },
  },
  {
    n: "C16.h",
    nome: "faixa fora do vocabulário é recusada",
    recusar: true,
    campos: { ai_probability: 72, ai_probability_reason: "ok", ai_probability_evidence: LASTRO, ai_probability_band: "morninho" },
  },
];


/**
 * A tabela do score é `crm_lead_scores`, não `crm_leads` (migration 0075).
 *
 * E a escrita é upsert porque a linha pode não existir: o score é 1:1 com o
 * lead, mas nasce quando o worker calcula, não quando o lead nasce.
 */
async function escreverScore(
  client: pg.PoolClient,
  leadId: string,
  campos: Record<string, unknown>,
): Promise<void> {
  const base: Record<string, unknown> = { lead_id: leadId, organization_id: ORG, ...campos };
  const chaves = Object.keys(base);
  const valores = chaves.map((k) => {
    const v = base[k];
    return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
  });
  const params = chaves.map((_, i) => `$${i + 1}`).join(", ");
  const sets = chaves
    .filter((k) => k !== "lead_id")
    .map((k) => `${k} = excluded.${k}`)
    .join(", ");
  await client.query(
    `insert into crm_lead_scores (${chaves.join(", ")}) values (${params})
       on conflict (lead_id) do update set ${sets}`,
    valores,
  );
}

/**
 * A RECUSA TEM DE VIR DA CONSTRAINT, e esta função existe por causa de um verde
 * falso meu.
 *
 * Quando a 0075 tirou as colunas de `crm_leads`, seis das oito linhas da
 * tabela-verdade continuaram VERDES: eu perguntava "o banco recusou?", e o banco
 * recusava — com `42703`, coluna inexistente. Um teste que afirma "score sem
 * razão é recusado" ficou verde num banco onde a coluna do score tinha sumido.
 *
 * `23514` é violação de CHECK. Qualquer outro código significa que a montagem do
 * caso está errada, e isso é falha do instrumento, não do produto.
 */
const VIOLACAO_DE_CHECK = "23514";

/**
 * A TRÍPLICE (decisão do regente, ainda não aplicada quando isto foi escrito).
 *
 * O conserto do vocabulário duplo é exigir AS DUAS COISAS: pelo menos uma âncora
 * E `factors` não vazio. Uma sem a outra produz evidência **ilegível**
 * (rastreável e muda) ou **irrastreável** (legível e sem destino) — e o cenário
 * 15 promete as duas: o hover revela, o clique leva.
 *
 * Armado antes de a migration existir. Enquanto ela não entra, os dois casos são
 * BLOQUEADO — recurso que ninguém escreveu acusa quem planejou.
 */
async function travaDaTriplice(): Promise<boolean> {
  const { rowCount } = await pool.query(
    `select 1 from pg_constraint
      where conrelid = 'public.crm_lead_scores'::regclass and contype = 'c'
        and pg_get_constraintdef(oid) like '%factors%'`,
  );
  return (rowCount ?? 0) > 0;
}

async function tabelaVerdade(): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `select id from crm_leads where organization_id = $1 and status = 'open' order by id limit 1`,
    [ORG],
  );
  const leadId = rows[0]?.id;
  if (!leadId) throw new Error("nenhum lead aberto na org — a tabela-verdade não se monta");

  const temTriplice = await travaDaTriplice();
  const CASOS_TRIPLICE: Caso[] = [
    {
      n: "C16.l",
      nome: "âncora fora de factors é recusada — a tela não leria esse lastro",
      recusar: true,
      campos: {
        ai_probability: 72,
        ai_probability_reason: "lastro que o banco via e a tela não",
        ai_probability_evidence: { activity_ids: [ANCORA] },
      },
    },
    {
      // O nome PRECISA casar com o payload: a versão anterior deste caso se
      // chamava "sem âncora" e mandava um factor COM âncora. Passou a reprovar
      // o produto por um acerto dele — a §7.63 aplicada a mim, de novo.
      n: "C16.m",
      nome: "factor SEM âncora é recusado — frase legível e IRRASTREÁVEL",
      recusar: true,
      campos: {
        ai_probability: 72,
        ai_probability_reason: "frase bonita sem destino",
        ai_probability_evidence: { factors: [{ pontos: 10, frase: "parece animado" }] },
      },
    },
  ];

  const client = await pool.connect();
  try {
    // Tudo dentro de UMA transação desfeita no fim: a constraint é exercitada de
    // verdade e o banco compartilhado não guarda nada.
    await client.query("begin");
    if (!temTriplice) {
      for (const c of CASOS_TRIPLICE) {
        record(c.n, c.nome, false, "a trava da tríplice ainda não entrou no banco", "BLOQUEADO");
      }
    }
    for (const caso of temTriplice ? [...CASOS, ...CASOS_TRIPLICE] : CASOS) {
      await client.query("savepoint c");
      let erro: { code?: string; message?: string } | null = null;
      try {
        await escreverScore(client, leadId, caso.campos);
      } catch (e) {
        erro = e as { code?: string; message?: string };
        await client.query("rollback to savepoint c");
      }
      const recusou = erro !== null;
      const porCheck = erro?.code === VIOLACAO_DE_CHECK;
      const constraint = (erro?.message ?? "").match(/"([a-z_]+)"/)?.[1] ?? "-";

      // VOLTA DE LEITURA nas linhas que devem ser ACEITAS.
      //
      // As pernas positivas já haviam salvado este aparato uma vez: quando a
      // coluna sumiu de `crm_leads`, as seis linhas de recusa ficaram verdes
      // erradas e só as duas positivas reprovaram — elas não têm como passar num
      // banco onde a escrita não funciona. Mas o canário tinha um limite: ele
      // detecta "a escrita quebrou", NÃO "a escrita foi para o lugar errado".
      // Escrever na linha de outro lead deixaria tudo verde. Ler de volta fecha
      // essa metade — a asserção deixa de ser "não deu erro" e passa a ser "o
      // valor está lá".
      let voltou: string | null = null;
      let leuDeVolta = false;
      if (!caso.recusar && !recusou && caso.campos.ai_probability !== null) {
        leuDeVolta = true;
        const { rows: lidas } = await client.query<{ p: string | null; r: string | null }>(
          `select ai_probability::text as p, ai_probability_reason as r
             from crm_lead_scores where lead_id = $1`,
          [leadId],
        );
        const esperado = Number(caso.campos.ai_probability);
        const obtido = lidas[0] ? Number(lidas[0].p) : null;
        if (obtido !== esperado) {
          voltou = `escreveu ${esperado} e leu de volta ${obtido ?? "(nenhuma linha)"} — a escrita não pousou onde devia`;
        }
      }

      record(
        caso.n,
        caso.nome,
        caso.recusar ? porCheck : !recusou && voltou === null,
        caso.recusar
          ? porCheck
            ? `recusado por ${constraint} (${erro?.code})`
            : recusou
              ? `recusado por ${erro?.code} (${constraint}) — NÃO é violação de CHECK: o caso está mal montado`
              : "ACEITO — a lei não está no banco, está só no comentário da migration"
          : recusou
            ? `RECUSADO indevidamente: ${erro?.code} ${constraint}`
            : (voltou ?? (leuDeVolta ? "aceito, e o valor voltou na leitura" : "aceito (sem score para reler)")),
      );
    }
  } finally {
    await client.query("rollback").catch(() => null);
    client.release();
  }
}


/**
 * COERÊNCIA faixa × score (§7.36) — descobre o intervalo, não o adivinha.
 *
 * A trava é a imagem algébrica da caminhada: `frio` só sobrevive com score
 * baixo, `quente` só com score alto. Ela ainda não existe no banco quando isto
 * é escrito, e por isso o estado inicial destas linhas é BLOQUEADO — recurso que
 * ninguém escreveu ainda acusa quem planejou, não quem construiu.
 *
 * DUAS DECISÕES DE MÉTODO, e a segunda é a que evita um vermelho injusto:
 *
 * 1. Em vez de afirmar bordas, eu VARRO 0..100 por faixa e leio de volta o
 *    intervalo que o banco aceita. O intervalo vira saída — documenta a borda em
 *    vez de disputá-la.
 * 2. Não asserto o valor exato da borda. O próprio §7.36 escreve "score ≤ 45" num
 *    parágrafo e "score < 45" no outro; reprovar por essa diferença seria reprovar
 *    por ambiguidade de especificação. O que eu asserto é o que os dois textos
 *    concordam: o intervalo é contíguo, contém o claramente coerente e exclui o
 *    claramente incoerente — que é justamente a zona dos 9 casos da caminhada.
 */
async function coerenciaFaixaScore(): Promise<void> {
  const existe = await pool.query<{ nome: string; def: string }>(
    `select conname as nome, pg_get_constraintdef(oid) as def
       from pg_constraint
      where conrelid = 'public.crm_lead_scores'::regclass and contype = 'c'
        and pg_get_constraintdef(oid) like '%ai_probability_band%'
        and pg_get_constraintdef(oid) like '%ai_probability %'`,
  );
  if (existe.rowCount === 0) {
    record(
      "C16.i",
      "COERÊNCIA faixa × score: o banco recusa faixa que o score não sustenta",
      false,
      "nenhuma constraint em crm_lead_scores confronta ai_probability_band com ai_probability — a trava do §7.36 ainda não entrou",
      "BLOQUEADO",
    );
    return;
  }
  console.info(`[coerência] trava encontrada: ${existe.rows[0]!.nome}`);

  const { rows } = await pool.query<{ id: string }>(
    `select id from crm_leads where organization_id = $1 and status = 'open' order by id limit 1`,
    [ORG],
  );
  const leadId = rows[0]!.id;
  const client = await pool.connect();
  const aceitos: Record<string, number[]> = { frio: [], morno: [], quente: [] };
  try {
    await client.query("begin");
    for (const banda of ORDEM) {
      for (let score = 0; score <= 100; score++) {
        await client.query("savepoint c");
        try {
          await escreverScore(client, leadId, {
            ai_probability: score,
            ai_probability_reason: "varredura de coerência",
            ai_probability_evidence: LASTRO,
            ai_probability_band: banda,
          });
          aceitos[banda]!.push(score);
        } catch {
          await client.query("rollback to savepoint c");
        }
      }
    }
  } finally {
    await client.query("rollback").catch(() => null);
    client.release();
  }

  const contiguo = (xs: number[]) => xs.length > 0 && xs[xs.length - 1]! - xs[0]! === xs.length - 1;
  const intervalo = (xs: number[]) => (xs.length === 0 ? "(nenhum)" : `${xs[0]}..${xs[xs.length - 1]}`);
  const contem = (xs: number[], v: number) => xs.includes(v);

  const problemas: string[] = [];
  for (const b of ORDEM) {
    if (!contiguo(aceitos[b]!)) problemas.push(`"${b}" aceita um conjunto NÃO contíguo: ${aceitos[b]!.join(",")}`);
  }
  // Claramente coerente: o miolo de cada faixa TEM de passar.
  for (const [b, v] of [["frio", 20], ["morno", 50], ["quente", 85]] as [ScoreBand, number][]) {
    if (!contem(aceitos[b]!, v)) problemas.push(`"${b}" recusa ${v}, que é o miolo da própria faixa`);
  }
  // Claramente incoerente: exatamente a zona dos 9 casos da caminhada.
  for (const [b, v] of [["frio", 72], ["frio", 74], ["quente", 36], ["quente", 39]] as [ScoreBand, number][]) {
    if (contem(aceitos[b]!, v)) problemas.push(`"${b}" com score ${v} passa — é um dos 9 casos da caminhada`);
  }

  record(
    "C16.i",
    "COERÊNCIA faixa × score: intervalo contíguo, miolo aceito, zona dos 9 recusada",
    problemas.length === 0,
    `intervalos aceitos — frio ${intervalo(aceitos.frio!)} · morno ${intervalo(aceitos.morno!)} · ` +
      `quente ${intervalo(aceitos.quente!)}` +
      (problemas.length ? ` | PROBLEMAS: ${problemas.join(" · ")}` : ""),
  );
}


/**
 * §7.36 OBSERVADA, não deduzida — a caminhada escrevendo no banco de verdade.
 *
 * A tabela do §7.36 diz que os três instrumentos batem em 9/303, e o terceiro é
 * "CHECK de coerência (erro na escrita)". Mas esse terceiro foi obtido por
 * RACIOCÍNIO sobre a definição da constraint. Aqui ele é obtido TENTANDO
 * ESCREVER: para cada um dos 303 estados, pergunto à função de produção que faixa
 * ela devolve e mando esse par (faixa, score) para o Postgres.
 *
 * A diferença importa porque muda o que a frase significa. Deduzido, "o worker
 * pararia de gravar" é previsão. Observado, é fato — o par que a função produz
 * volta 23514 do banco, e é o mesmo caminho que o worker percorreria.
 */
async function caminhadaContraATrava(): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `select id from crm_leads where organization_id = $1 and status = 'open' order by id limit 1`,
    [ORG],
  );
  const leadId = rows[0]!.id;
  const client = await pool.connect();
  const rejeitados: Violacao[] = [];
  try {
    await client.query("begin");
    for (const anterior of ORDEM) {
      for (let score = 0; score <= 100; score++) {
        const faixa = resolveBand(score, anterior);
        await client.query("savepoint c");
        try {
          await escreverScore(client, leadId, {
            ai_probability: score,
            ai_probability_reason: "saída da função de produção",
            ai_probability_evidence: LASTRO,
            ai_probability_band: faixa,
          });
        } catch (e) {
          await client.query("rollback to savepoint c");
          if ((e as { code?: string }).code === VIOLACAO_DE_CHECK) {
            rejeitados.push({ anterior, score, obtido: faixa, esperado: faixaCrua(score) });
          } else {
            throw e;
          }
        }
      }
    }
  } finally {
    await client.query("rollback").catch(() => null);
    client.release();
  }

  record(
    "C16.j",
    "a faixa que a função PRODUZ é aceita pelo banco — worker não trava",
    rejeitados.length === 0,
    rejeitados.length === 0
      ? "303 estados percorridos, todos gravaram — caminhada e trava concordam"
      : `${rejeitados.length}/303 rejeitados com 23514: ${comprimir(rejeitados)} — ` +
        `o worker do score PARA DE GRAVAR nesses estados`,
  );
}

// ---------------------------------------------------------------------------
// B) a histerese com o valor dançando
// ---------------------------------------------------------------------------

const ORDEM: ScoreBand[] = ["frio", "morno", "quente"];

interface Violacao {
  anterior: ScoreBand;
  score: number;
  obtido: ScoreBand;
  esperado: ScoreBand;
}

/**
 * Comprime scores CONSECUTIVOS com o mesmo veredito numa faixa.
 *
 * Não é cosmética: "70-74 vindo de frio exibem frio" mostra a FORMA do defeito
 * (a zona morta do limiar distante) — cinco linhas soltas mostram cinco casos e
 * deixam a forma para quem ler adivinhar.
 */
function comprimir(vs: Violacao[]): string {
  const grupos: string[] = [];
  let atual: { v: Violacao; de: number; ate: number } | null = null;
  const fechar = () => {
    if (!atual) return;
    const { v, de, ate } = atual;
    const faixa = de === ate ? `${de}` : `${de}-${ate}`;
    grupos.push(`vindo de "${v.anterior}", score ${faixa} exibe "${v.obtido}" (esperado "${v.esperado}")`);
    atual = null;
  };
  for (const v of vs) {
    if (
      atual &&
      atual.v.anterior === v.anterior &&
      atual.v.obtido === v.obtido &&
      atual.v.esperado === v.esperado &&
      v.score === atual.ate + 1
    ) {
      atual.ate = v.score;
      continue;
    }
    fechar();
    atual = { v, de: v.score, ate: v.score };
  }
  fechar();
  return grupos.join(" · ");
}

/**
 * ÂNCORAS — a cerca de regressão, escrita À MÃO a partir da regra declarada.
 *
 * Conserto que zera as violações quebrando os acertos é TROCA de defeito, não
 * correção — e a varredura sozinha não pega isso: devolver sempre a régua crua
 * zeraria a não-mentira e mataria a histerese inteira.
 *
 * Escritas a mão de propósito. Derivá-las de `porDegrau` ou de `faixaCrua` faria
 * a cerca concordar com o instrumento que ela deveria vigiar; cada linha aqui é
 * a régua do módulo lida por um humano e fixada como número.
 *
 * São as BORDAS — onde um conserto de um-a-mais/um-a-menos quebra: o primeiro
 * valor que confirma a mudança e o último que não confirma.
 */
const ANCORAS_DA_REGRA: {
  score: number;
  anterior: ScoreBand | null;
  esperado: ScoreBand;
  porque: string;
}[] = [
    { score: 72, anterior: null, esperado: "quente", porque: "sem memória, vale a régua crua" },
    { score: 50, anterior: null, esperado: "morno", porque: "sem memória, vale a régua crua" },
    { score: 10, anterior: null, esperado: "frio", porque: "sem memória, vale a régua crua" },
    { score: 45, anterior: "frio", esperado: "morno", porque: "primeiro valor que CONFIRMA a subida (40+5)" },
    { score: 44, anterior: "frio", esperado: "frio", porque: "último que NÃO confirma — a zona morta segura" },
    { score: 75, anterior: "morno", esperado: "quente", porque: "primeiro valor que CONFIRMA a subida (70+5)" },
    { score: 74, anterior: "morno", esperado: "morno", porque: "último que NÃO confirma" },
    { score: 65, anterior: "quente", esperado: "morno", porque: "primeiro valor que CONFIRMA a descida (70-5)" },
    { score: 66, anterior: "quente", esperado: "quente", porque: "último que NÃO confirma" },
    { score: 35, anterior: "morno", esperado: "frio", porque: "primeiro valor que CONFIRMA a descida (40-5)" },
    { score: 36, anterior: "morno", esperado: "morno", porque: "último que NÃO confirma" },
    { score: 50, anterior: "morno", esperado: "morno", porque: "no meio da faixa nada se mexe" },
    { score: 80, anterior: "frio", esperado: "quente", porque: "salto real atravessa duas faixas de uma vez" },
    { score: 20, anterior: "quente", esperado: "frio", porque: "tombo real atravessa duas faixas de uma vez" },
];

/**
 * A régua escrita no próprio módulo, aplicada degrau a degrau: "para SUBIR de
 * faixa o score precisa passar do limiar mais a banda; para DESCER, cair abaixo
 * do limiar menos a banda". Não é um modelo meu — é o comentário virado código,
 * que é o único jeito de confrontar os dois.
 */
function porDegrau(score: number, anterior: ScoreBand): ScoreBand {
  let b = anterior;
  for (let i = 0; i < ORDEM.length; i++) {
    let n = b;
    if (b === "frio" && score >= 45) n = "morno";
    else if (b === "morno" && score >= 75) n = "quente";
    else if (b === "quente" && score <= 65) n = "morno";
    else if (b === "morno" && score <= 35) n = "frio";
    if (n === b) break;
    b = n;
  }
  return b;
}
/** A faixa que o número indicaria sem memória nenhuma — a régua crua. */
function faixaCrua(score: number): ScoreBand {
  if (score >= 70) return "quente";
  if (score >= 40) return "morno";
  return "frio";
}

function histerese(): void {
  // P1 — o valor dançando em volta de CADA limiar, não de um só.
  for (const [nome, serie] of [
    ["limiar morno (40)", [38, 42, 39, 41, 38, 43, 40, 37]],
    ["limiar quente (70)", [68, 72, 69, 71, 68, 73, 70, 67]],
  ] as [string, number[]][]) {
    let banda: ScoreBand | null = null;
    const trocas: string[] = [];
    for (const s of serie) {
      const nova = resolveBand(s, banda);
      if (banda !== null && nova !== banda) trocas.push(`${s}:${banda}→${nova}`);
      banda = nova;
    }
    record(
      `H.${nome.includes("morno") ? "a" : "b"}`,
      `ANTI-PISCA no ${nome}: série oscilante muda a faixa no máximo uma vez`,
      trocas.length <= 1,
      trocas.length === 0
        ? `nenhuma troca em ${serie.length} recálculos — o card fica quieto`
        : `${trocas.length} troca(s): ${trocas.join(", ")}`,
    );
  }

  // P2 e P3 por VARREDURA, não por exemplos. Exemplo escolhido a mão acha o que
  // quem escreveu já suspeitava; a varredura acha o que ninguém suspeitou. Aqui o
  // domínio inteiro cabe num laço: 101 scores × 3 faixas anteriores = 303 casos,
  // e ainda sobra barato. Onde der para varrer o domínio, amostrar é escolha
  // pior — e a saída ainda comprime as violações em FAIXAS, porque 300 linhas de
  // falha escondem a forma do defeito tão bem quanto nenhuma linha.
  const violaP2: Violacao[] = [];
  const violaP3: Violacao[] = [];
  for (const anterior of ORDEM) {
    for (let score = 0; score <= 100; score++) {
      const exibida = resolveBand(score, anterior);
      const crua = faixaCrua(score);
      if (Math.abs(ORDEM.indexOf(exibida) - ORDEM.indexOf(crua)) >= 2) {
        violaP2.push({ anterior, score, obtido: exibida, esperado: crua });
      }
      const degrau = porDegrau(score, anterior);
      if (exibida !== degrau) {
        violaP3.push({ anterior, score, obtido: exibida, esperado: degrau });
      }
    }
  }

  record(
    "H.c",
    "NÃO-MENTIRA em TODO o domínio: 303 casos, faixa nunca a duas da régua crua",
    violaP2.length === 0,
    violaP2.length === 0
      ? "0..100 × 3 faixas anteriores — nenhum caso passou de um degrau de atraso"
      : `${violaP2.length}/303 casos: ${comprimir(violaP2)}`,
  );
  record(
    "H.d",
    "a função concorda com a régua escrita no módulo — em TODO o domínio",
    violaP3.length === 0,
    violaP3.length === 0
      ? "0..100 × 3 faixas anteriores — função e régua escrita coincidem"
      : `${violaP3.length}/303 casos: ${comprimir(violaP3)}`,
  );

  const quebradas = ANCORAS_DA_REGRA.filter((a) => resolveBand(a.score, a.anterior) !== a.esperado).map(
    (a) =>
      `${a.score} de "${a.anterior ?? "(sem memória)"}" deu "${resolveBand(a.score, a.anterior)}", esperado "${a.esperado}" (${a.porque})`,
  );
  record(
    "H.e",
    "ÂNCORAS: o que já funciona continua funcionando depois do conserto",
    quebradas.length === 0,
    quebradas.length === 0
      ? `${ANCORAS_DA_REGRA.length} bordas fixadas à mão, todas de pé`
      : `${quebradas.length}/${ANCORAS_DA_REGRA.length} quebrada(s): ${quebradas.join(" · ")}`,
  );
}


/**
 * AUTO-TESTE DA CERCA — `SELFCHECK=1`.
 *
 * A 16.e passa hoje, antes de qualquer conserto. Isso é o que se pede dela, e é
 * também o que a torna suspeita: cerca que nunca reprovou pode ser decoração.
 * Então aqui ela é submetida ao conserto ERRADO que o regente nomeou — o que
 * zera as violações matando a histerese: devolver sempre a régua crua.
 *
 * Não mexo em `lib/kanban/score-band.ts` para fazer isto. O arquivo está sendo
 * escrito pelo @DevVivo agora, e mutilar arquivo de colega vivo é a receita de
 * dois trabalhos se destruírem. A regra alternativa é local a esta função.
 */
function autoTesteDaCerca(): void {
  const ingenua = (score: number, _anterior: ScoreBand | null): ScoreBand => faixaCrua(score);

  const violaP2 = ORDEM.flatMap((anterior) =>
    Array.from({ length: 101 }, (_, score) => score).filter(
      (score) =>
        Math.abs(ORDEM.indexOf(ingenua(score, anterior)) - ORDEM.indexOf(faixaCrua(score))) >= 2,
    ),
  ).length;

  let banda: ScoreBand | null = null;
  let trocas = 0;
  for (const s of [68, 72, 69, 71, 68, 73, 70, 67]) {
    const nova = ingenua(s, banda);
    if (banda !== null && nova !== banda) trocas++;
    banda = nova;
  }

  const ancorasQuebradas = ANCORAS_DA_REGRA.filter(
    (a) => ingenua(a.score, a.anterior) !== a.esperado,
  ).length;

  console.info("\n=== AUTO-TESTE: a cerca reprova o conserto que mata a histerese? ===");
  console.info(`  a régua crua zera a NÃO-MENTIRA (H.c): ${violaP2} violações`);
  console.info(`  ...e o ANTI-PISCA a reprova: ${trocas} trocas na série oscilante (limite 1)`);
  console.info(`  ...e as ÂNCORAS a reprovam: ${ancorasQuebradas}/${ANCORAS_DA_REGRA.length} quebradas`);
  const cercaFunciona = violaP2 === 0 && (trocas > 1 || ancorasQuebradas > 0);
  console.info(
    cercaFunciona
      ? "  ==> CERCA DE PÉ: o atalho passaria na varredura e é barrado pelas outras duas."
      : "  ==> CERCA FURADA: o atalho passaria — a 16.e não distingue conserto de troca de defeito.",
  );
  if (!cercaFunciona) process.exitCode = 1;
}


// Os cenários 15 e 17 do briefing viviam aqui como marcadores BLOQUEADOS,
// enquanto ninguém os media. Agora existe aparato de verdade para eles em
// `tests/capture-wave-5-tela.ts`, e manter os marcadores criaria dois
// instrumentos afirmando o mesmo cenário com vereditos diferentes — que é
// exatamente o que eu reprovaria em qualquer outro lugar.

async function main(): Promise<void> {
  carimbar([
    // O APARATO ENTRA NA PRÓPRIA LISTA — ideia do @DevVivo, e ele está certo:
    // instrumento não commitado produz veredito irreprodutível do mesmo jeito que
    // produto não commitado. Declarar só as dependências do produto deixa o carimbo
    // dizer "todas limpas" enquanto a RÉGUA muda debaixo do resultado.
    "tests/capture-wave-5-cenarios.ts",
    "supabase/migrations/20260725040000_0074_lead_score_com_evidencia.sql",
    "supabase/migrations/20260725050000_0075_score_sai_do_lead_para_tabela_propria.sql",
    "lib/kanban/score-band.ts",
    "lib/kanban/card-state.ts",
    "components/kanban/KanbanCard.tsx",
  ]);

  if (process.env.SELFCHECK === "1") {
    autoTesteDaCerca();
    return;
  }

  try {
    await tabelaVerdade();
    await coerenciaFaixaScore();
    await caminhadaContraATrava();
    histerese();
  } finally {
    await pool.end().catch(() => null);
  }

  const pass = resultados.filter((r) => r.estado === "PASS").length;
  const falha = resultados.filter((r) => r.estado === "FALHA").length;
  const bloq = resultados.filter((r) => r.estado === "BLOQUEADO").length;
  console.info(`\n=== WAVE 5: ${pass} verdes · ${falha} vermelhos · ${bloq} bloqueados ===`);
  for (const r of resultados.filter((x) => x.estado !== "PASS")) {
    console.info(`  ${r.estado} [${r.n}] ${r.nome}: ${r.detalhe}`);
  }
  if (falha > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error("❌ Wave 5 falhou:", err);
  await pool.end().catch(() => null);
  process.exit(1);
});
