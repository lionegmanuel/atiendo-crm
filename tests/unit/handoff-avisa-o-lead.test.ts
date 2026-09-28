import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * NENHUMA PASSAGEM PARA HUMANO SAI CALADA.
 *
 * ─── O defeito, medido em produção (2026-08-26) ─────────────────────────────
 *
 * Duas conversas reais, na mesma hora, nos DOIS motores de passagem do repo:
 *
 *   `cdd9cbd8` — o cliente escreveu "preciso de falar com atendente". A detecção
 *     determinística casou, `performHumanHandoff` rodou e o turno deu `return`
 *     com o comentário "bot silencia: sem modelo, sem envio neste turno".
 *   `b934ba2d` — o agente PERGUNTOU o e-mail do cliente; entre a pergunta e a
 *     resposta, o worker de sentimento disparou `triggerHandoff('low_sentiment')`.
 *     O cliente respondeu para o vazio.
 *
 * Do lado de fora as duas são a mesma coisa: a pessoa falou e ninguém respondeu.
 *
 * ─── Por que a guarda é ESTÁTICA, e por que ela varre DOIS mundos ───────────
 *
 * Porque o defeito é de CLASSE. Consertar os dois sítios que apareceram nos
 * screenshots deixaria o terceiro (teto de gasto), o quarto (escalação de caso)
 * e o quinto — o que alguém acrescentar amanhã — nascendo mudos, e o modo de
 * falha é o pior que existe: nada quebra, ninguém vê, o cliente some.
 *
 * A varredura cobre os DOIS emissores de silêncio, que vivem em mundos de banco
 * diferentes e por isso nunca se encontram numa busca só:
 *   - `performHumanHandoff` — motor de conversa, `pg.Pool`;
 *   - `triggerHandoff`      — CRM, `supabase-js`.
 *
 * AST, nunca regex: a prosa deste repositório cita esses dois nomes o tempo
 * todo — este próprio cabeçalho é a prova — e um regex acusaria o arquivo por
 * ele falar de si mesmo.
 *
 * ─── O que a guarda NÃO prova ──────────────────────────────────────────────
 *
 * Que o aviso CHEGA. Isso é comportamento sobre banco e canal, e mora em
 * `tests/invariants/handoff-avisa-o-lead.test.ts`. Aqui se prova só que nenhum
 * sítio de passagem existe sem um emissor de aviso ao lado — o que é
 * exatamente a classe que o conserto por instância deixa escapar.
 */

const RAIZ = join(__dirname, "..", "..");

/**
 * O motor cujo aviso mora no CHAMADOR — e por que ele mora lá.
 *
 * `performHumanHandoff` recebe `pg.Pool` e ids, e mais nada: não conhece canal,
 * job nem sessão, que é justamente o que enviar exige. Pôr o envio dentro dele
 * obrigaria todos os seus chamadores — inclusive os testes de invariante e o
 * seed de e2e, que o chamam com pool e logger — a montar um canal só para
 * silenciar uma conversa. O aviso é do chamador, e é esta guarda que o cobra.
 *
 * O outro motor, `triggerHandoff`, faz o contrário: o aviso mora DENTRO dele
 * (`Step 0`), porque ele monta o próprio client e seus quatro chamadores não
 * têm contexto nenhum a oferecer. Ver a asserção dedicada mais abaixo.
 */
const PASSAGENS = ["performHumanHandoff"] as const;

/** Os emissores de aviso — um por mundo de acesso a banco. */
const AVISOS = ["avisarLeadDaEscalacao", "avisarLeadLendoOContato", "avisarLeadDoCrm"] as const;

/**
 * Arquivos que EXECUTAM uma passagem. Não é a lista de quem a menciona: é a de
 * quem a chama. Um arquivo novo que chame e não esteja aqui é pego pelo caso
 * "o universo não encolheu" no fim.
 */
const FONTES = [
  "lib/agent-engine/agent/inbound-turn.ts",
  "lib/agent-engine/agent/human-handoff.ts",
  "lib/ai/handoff/orchestrator.ts",
  "app/api/v1/ai/cases/[id]/reply/route.ts",
] as const;

/**
 * Sítios de passagem SEM aviso, no fonte dado.
 *
 * A regra: uma chamada a `performHumanHandoff`/`triggerHandoff` está coberta
 * quando um emissor de aviso é chamado ANTES dela **no mesmo corpo de função**.
 * "Antes" é por posição no fonte — a ordem textual dentro de um bloco `async` é
 * a ordem de execução, e é justamente ela que o conserto precisa garantir
 * (avisar depois do handoff é avisar ninguém: `force_human` já armou o gate).
 *
 * `applyRequestHumanHandoff` é o wrapper da tool: ele CHAMA `performHumanHandoff`
 * e recebe o desfecho do aviso pelo parâmetro `avisoAoLead`, que quem o chama
 * preencheu. Um sítio cujo objeto de opções carrega `avisoAoLead` está, por
 * construção, avisado — então ele também conta como coberto.
 */
export function passagensSemAviso(fonte: string, nomeDoArquivo: string): number[] {
  const arquivo = ts.createSourceFile(nomeDoArquivo, fonte, ts.ScriptTarget.Latest, true);
  const linhaDe = (pos: number) => arquivo.getLineAndCharacterOfPosition(pos).line + 1;

  const nomeDaChamada = (no: ts.Node): string | null => {
    if (!ts.isCallExpression(no)) return null;
    if (ts.isIdentifier(no.expression)) return no.expression.text;
    if (ts.isPropertyAccessExpression(no.expression)) return no.expression.name.text;
    return null;
  };

  /** O corpo de função que contém o nó — a fronteira do "mesmo bloco". */
  const corpoQueContem = (no: ts.Node): ts.Node => {
    let atual: ts.Node | undefined = no.parent;
    while (atual !== undefined) {
      if (
        ts.isFunctionDeclaration(atual) ||
        ts.isFunctionExpression(atual) ||
        ts.isArrowFunction(atual) ||
        ts.isMethodDeclaration(atual)
      ) {
        return atual;
      }
      atual = atual.parent;
    }
    return arquivo;
  };

  /**
   * O objeto de opções desta chamada carrega `avisoAoLead`?
   *
   * A busca é na SUBÁRVORE do argumento, não nas propriedades diretas: o
   * wrapper da tool repassa o desfecho por spread condicional
   * (`...(opts.avisoAoLead !== undefined ? { avisoAoLead } : {})`), e uma
   * checagem só de propriedade direta o acusaria de mudo — sendo que ele é
   * exatamente o caminho que carrega o desfecho de quem o chamou.
   */
  const declaraDesfecho = (no: ts.CallExpression): boolean =>
    no.arguments.some((arg) => {
      let achou = false;
      const olhar = (n: ts.Node): void => {
        if (ts.isIdentifier(n) && n.text === "avisoAoLead") achou = true;
        ts.forEachChild(n, olhar);
      };
      olhar(arg);
      return achou;
    });

  const avisos: Array<{ corpo: ts.Node; pos: number }> = [];
  const passagens: Array<{ corpo: ts.Node; pos: number; no: ts.CallExpression }> = [];

  const visitar = (no: ts.Node): void => {
    const nome = nomeDaChamada(no);
    if (nome !== null && ts.isCallExpression(no)) {
      if ((AVISOS as readonly string[]).includes(nome)) {
        avisos.push({ corpo: corpoQueContem(no), pos: no.getStart(arquivo) });
      } else if ((PASSAGENS as readonly string[]).includes(nome)) {
        passagens.push({ corpo: corpoQueContem(no), pos: no.getStart(arquivo), no });
      }
    }
    ts.forEachChild(no, visitar);
  };
  visitar(arquivo);

  return passagens
    .filter((p) => {
      if (declaraDesfecho(p.no)) return false;
      return !avisos.some((a) => a.corpo === p.corpo && a.pos < p.pos);
    })
    .map((p) => linhaDe(p.pos));
}

function ler(rel: string): string {
  return readFileSync(join(RAIZ, rel), "utf8");
}

describe("toda passagem para humano avisa o lead antes", () => {
  for (const rel of FONTES) {
    it(`${rel}: nenhuma passagem sem aviso`, () => {
      expect(passagensSemAviso(ler(rel), rel)).toEqual([]);
    });
  }

  /**
   * Controle POSITIVO. Sem ele, um bug no localizador (nome trocado, AST mal
   * percorrido) devolveria `[]` para tudo e o arquivo inteiro ficaria verde
   * medindo nada — o modo de falha nº 1 de guarda por varredura.
   */
  it("controle positivo: o instrumento ENXERGA os sítios que existem", () => {
    const arquivo = ts.createSourceFile(
      "controle.ts",
      ler("lib/agent-engine/agent/inbound-turn.ts"),
      ts.ScriptTarget.Latest,
      true,
    );
    let vistos = 0;
    const visitar = (no: ts.Node): void => {
      if (
        ts.isCallExpression(no) &&
        ts.isIdentifier(no.expression) &&
        (PASSAGENS as readonly string[]).includes(no.expression.text)
      ) {
        vistos += 1;
      }
      ts.forEachChild(no, visitar);
    };
    visitar(arquivo);
    // Hoje são 3 (dois determinísticos + a escolta do orçamento). O piso é 2 para
    // não virar contagem a manter; zero seria o instrumento cego.
    expect(vistos).toBeGreaterThanOrEqual(2);
  });

  /** Controle NEGATIVO: fonte sabotado tem de acusar. */
  it("controle negativo: passagem sem aviso é acusada", () => {
    const sabotado = `
      async function escalar(pool: unknown, ids: unknown) {
        await performHumanHandoff(pool, ids, { reason: 'x', conversationSummary: '', log: null });
      }
    `;
    expect(passagensSemAviso(sabotado, "sabotado.ts")).toEqual([3]);
  });

  /** Controle NEGATIVO 2: avisar DEPOIS não vale — é avisar ninguém. */
  /**
   * O OUTRO motor: `triggerHandoff` avisa por dentro, então a guarda tem de
   * checar a ORDEM lá dentro. Se alguém mover o `avisarLeadDoCrm` para depois
   * do UPDATE que silencia, este caso vermelha — e é o único que o pega, porque
   * os quatro chamadores de `triggerHandoff` continuariam limpos.
   */
  it("triggerHandoff avisa ANTES de silenciar a conversa", () => {
    const fonte = ler("lib/ai/handoff/orchestrator.ts");
    const posAviso = fonte.indexOf("avisarLeadDoCrm(");
    const posSilencio = fonte.indexOf("bot_silenced_until: SILENCE_INFINITY");
    expect(posAviso, "avisarLeadDoCrm sumiu do orquestrador").toBeGreaterThan(0);
    expect(posSilencio, "o UPDATE de silêncio sumiu do orquestrador").toBeGreaterThan(0);
    expect(posAviso).toBeLessThan(posSilencio);
  });

  /**
   * E que o aviso dele alcança TODOS os seus chamadores: se `triggerHandoff`
   * ganhar um irmão exportado de outro arquivo, o `Step 0` deixa de valer para
   * ele e ninguém percebe.
   */
  it("triggerHandoff é definido num lugar só", () => {
    const definidores = ARQUIVOS_QUE_DEFINEM_TRIGGER_HANDOFF;
    expect(definidores).toEqual(["lib/ai/handoff/orchestrator.ts"]);
  });

  it("controle negativo: aviso DEPOIS da passagem é acusado", () => {
    const invertido = `
      async function escalar(pool: unknown, ids: unknown) {
        await performHumanHandoff(pool, ids, { reason: 'x', conversationSummary: '', log: null });
        await avisarLeadDaEscalacao(pool, ids, { motivo: 'pediu_humano' });
      }
    `;
    expect(passagensSemAviso(invertido, "invertido.ts")).toEqual([3]);
  });

  /** Controle do CONTROLE: prosa citando os nomes não pode acusar nada. */
  it("controle do controle: menção em comentário e string não é chamada", () => {
    const prosa = `
      // Este comentário fala de performHumanHandoff( e de triggerHandoff( à vontade.
      const doc = "performHumanHandoff(pool, ids, opts) e triggerHandoff({...})";
      export const x = doc;
    `;
    expect(passagensSemAviso(prosa, "prosa.ts")).toEqual([]);
  });

  /**
   * O universo não pode encolher em silêncio. Se alguém mover uma passagem para
   * um arquivo fora de FONTES, a lista acima segue verde medindo o lugar errado
   * — este caso é o que obriga a atualizá-la.
   */
  it("FONTES cobre todo arquivo que executa uma passagem", () => {
    const cobertos = new Set<string>(FONTES);
    const naoCobertos = ARQUIVOS_QUE_CHAMAM.filter((f) => !cobertos.has(f));
    expect(naoCobertos).toEqual([]);
  });
});

/**
 * Todo arquivo de produção que CHAMA uma passagem, descoberto por varredura —
 * não por lista escrita à mão. `git ls-files` é a fonte: arquivo untracked não
 * existe para o CI, e por isso não pode existir para o guarda.
 */
const ARQUIVOS_QUE_CHAMAM: string[] = (() => {
  const saida = execFileSync("git", ["ls-files", "lib", "app", "workers"], {
    cwd: RAIZ,
    encoding: "utf8",
  });
  return saida
    .split("\n")
    .filter((f) => (f.endsWith(".ts") || f.endsWith(".tsx")) && !f.includes(".test."))
    .filter((f) => {
      let fonte: string;
      try {
        fonte = readFileSync(join(RAIZ, f), "utf8");
      } catch {
        return false;
      }
      if (!PASSAGENS.some((p) => fonte.includes(p))) return false;
      const arquivo = ts.createSourceFile(f, fonte, ts.ScriptTarget.Latest, true);
      let chama = false;
      const visitar = (no: ts.Node): void => {
        if (
          ts.isCallExpression(no) &&
          ts.isIdentifier(no.expression) &&
          (PASSAGENS as readonly string[]).includes(no.expression.text)
        ) {
          chama = true;
        }
        ts.forEachChild(no, visitar);
      };
      visitar(arquivo);
      return chama;
    })
    .sort();
})();


/** Onde `triggerHandoff` é DECLARADO (não chamado) — ver a asserção de ordem. */
const ARQUIVOS_QUE_DEFINEM_TRIGGER_HANDOFF: string[] = (() => {
  const saida = execFileSync("git", ["ls-files", "lib", "app", "workers"], {
    cwd: RAIZ,
    encoding: "utf8",
  });
  return saida
    .split("\n")
    .filter((f) => f.endsWith(".ts") && !f.includes(".test."))
    .filter((f) => {
      let fonte: string;
      try {
        fonte = readFileSync(join(RAIZ, f), "utf8");
      } catch {
        return false;
      }
      if (!fonte.includes("triggerHandoff")) return false;
      const arquivo = ts.createSourceFile(f, fonte, ts.ScriptTarget.Latest, true);
      let define = false;
      const visitar = (no: ts.Node): void => {
        if (
          ts.isFunctionDeclaration(no) &&
          no.name !== undefined &&
          no.name.text === "triggerHandoff"
        ) {
          define = true;
        }
        ts.forEachChild(no, visitar);
      };
      visitar(arquivo);
      return define;
    })
    .sort();
})();
