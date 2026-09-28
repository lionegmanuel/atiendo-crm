/**
 * A ESCADA DE TOQUES — a forma que todo modelo de reengajamento tem.
 *
 * Um follow-up de clínica é sempre o mesmo desenho: manda, espera a resposta,
 * não veio, espera mais um tanto, manda de novo — e para. O que muda de um
 * modelo para o outro são os TEXTOS e os PRAZOS; o desenho, não.
 *
 * Escrever esse desenho à mão quatro vezes seria quatro chances de publicar um
 * grafo que o validador recusa (saída de ramo solta, `no_reply` sem aresta,
 * prazo de graça abaixo do piso de 15 min) — e um grafo inválido entra no banco
 * sem erro nenhum, porque a coluna é `jsonb`: a falha só aparece quando alguém
 * abre o construtor. Aqui o desenho é montado UMA vez, e cada modelo declara só
 * o que é dele.
 *
 * O que a escada garante por construção, e `modelos.test.ts` mede:
 *   • exatamente um `trigger`, tudo alcançável a partir dele, tudo chega a um fim;
 *   • todo nó de resposta liga as TRÊS saídas (o ramo declarado, "sem resposta"
 *     e o escape) — é o que o publish exige;
 *   • prazo de graça ≥ 15 min e espera ≥ 5 min, os pisos do schema;
 *   • acíclico: a escada só anda para a frente.
 */
import type { FlowGraph, FlowNode, FlowEdge } from "@/lib/followup/graph-schema";

/** Um toque: a mensagem que sai e quanto tempo se espera ANTES dela. */
export interface Toque {
  /** Espera antes de mandar. Ausente = manda assim que o gatilho dispara. */
  esperaAntesMs?: number;
  /** O texto, exatamente como o paciente lê. Sem variável: o modo `text` não interpola nada. */
  texto: string;
  /** Rótulo do nó no construtor — é o que a pessoa vê no canvas. */
  rotulo: string;
}

export interface EscadaSpec {
  toques: Toque[];
  /** Quanto cada nó de resposta segura a inscrição antes de seguir por "sem resposta". */
  prazoDeRespostaMs: number;
  /** O ramo que fecha o fluxo como ganho — o que o paciente escreve quando topa. */
  sim: { rotulo: string; padrao: string };
  /** Nota do fim "o paciente respondeu": quem assume dali em diante. */
  notaDeResposta: string;
}

const COLUNA = 260;

/**
 * Monta a escada. Os ids são estáveis e legíveis (`msg-1`, `resposta-1`) porque
 * eles aparecem no dossiê da inscrição e nas mensagens de erro do publish —
 * `uuid` ali seria o mesmo defeito de UX que tiraram da tela do construtor.
 */
export function montarEscada(spec: EscadaSpec): FlowGraph {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  let coluna = 0;
  const x = () => COLUNA * coluna++;

  const INICIO = "inicio";
  const FIM_MARCOU = "fim-marcou";
  const FIM_RESPONDEU = "fim-respondeu";
  const FIM_ESGOTOU = "fim-esgotou";

  nodes.push({ id: INICIO, type: "trigger", label: "Início", position: { x: x(), y: 0 }, config: {} });

  spec.toques.forEach((toque, i) => {
    const n = i + 1;
    // ⚠️ SÓ O PRIMEIRO DEGRAU PENDURA NO GATILHO. Do segundo em diante quem liga
    // é a saída "sem resposta" do degrau anterior, lá embaixo — e é uma aresta
    // só. A primeira versão disto encadeava `anterior → próximo` aqui também, e
    // o nó de resposta ficava com DUAS saídas `always`: a que devolve a conversa
    // ao atendimento e uma segunda, invisível, que empurrava para a próxima
    // cobrança. `selectEdge` escolhe por prioridade e as duas tinham 0, então o
    // paciente que respondesse podia receber a mensagem seguinte assim mesmo.
    // Quem achou foi o teste "liga as três saídas de todo nó de resposta".
    let anterior = i === 0 ? INICIO : null;

    if (toque.esperaAntesMs !== undefined) {
      const espera = `espera-${n}`;
      nodes.push({
        id: espera,
        type: "wait",
        label: rotuloDaEspera(toque.esperaAntesMs),
        position: { x: x(), y: 0 },
        config: { mode: "fixed", duration_ms: toque.esperaAntesMs },
      });
      if (anterior) edges.push(aresta(anterior, espera));
      anterior = espera;
    }

    const msg = `msg-${n}`;
    nodes.push({
      id: msg,
      type: "action",
      label: toque.rotulo,
      position: { x: x(), y: 0 },
      config: { mode: "text", body: toque.texto },
    });
    if (anterior) edges.push(aresta(anterior, msg));

    const resposta = `resposta-${n}`;
    nodes.push({
      id: resposta,
      type: "match_reply",
      label: "Espera a resposta",
      position: { x: x(), y: 0 },
      config: {
        branches: [{ id: "topou", label: spec.sim.rotulo, op: "contains", pattern: spec.sim.padrao }],
        grace_timeout_ms: spec.prazoDeRespostaMs,
      },
    });
    edges.push(aresta(msg, resposta));

    // O ramo declarado fecha como ganho; qualquer outra resposta encerra o fluxo
    // e devolve a conversa a quem atende. Os dois só chegam a rodar quando a
    // organização desliga `cancel_on_reply` — com ela ligada (o padrão de todo
    // modelo de clínica), a reatividade cancela a inscrição na primeira resposta,
    // antes de o nó rotear. Continuam ligados porque o publish exige cobertura
    // de TODA saída, e porque desligar a opção não pode deixar buraco no grafo.
    edges.push(aresta(resposta, FIM_MARCOU, { type: "branch", branch_id: "topou" }));
    edges.push(aresta(resposta, FIM_RESPONDEU, { type: "always" }));

    if (i === spec.toques.length - 1) {
      edges.push(aresta(resposta, FIM_ESGOTOU, { type: "branch", branch_id: "no_reply" }));
    }
  });

  const xFim = COLUNA * coluna;
  nodes.push(
    {
      id: FIM_MARCOU,
      type: "end",
      label: "Fim: quis marcar",
      position: { x: xFim, y: -200 },
      config: { outcome: "converted" },
    },
    {
      id: FIM_RESPONDEU,
      type: "end",
      label: "Fim: respondeu",
      position: { x: xFim, y: 0 },
      config: { outcome: "custom", note: spec.notaDeResposta },
    },
    {
      id: FIM_ESGOTOU,
      type: "end",
      label: "Fim: sem resposta",
      position: { x: xFim, y: 200 },
      config: { outcome: "exhausted" },
    },
  );

  // "Sem resposta" de um toque que não é o último cai no próximo degrau — é a
  // espinha da escada, e por isso é ligada depois que todos os nós existem.
  spec.toques.forEach((_, i) => {
    if (i === spec.toques.length - 1) return;
    const proximo = spec.toques[i + 1]!;
    const alvo = proximo.esperaAntesMs !== undefined ? `espera-${i + 2}` : `msg-${i + 2}`;
    edges.push(aresta(`resposta-${i + 1}`, alvo, { type: "branch", branch_id: "no_reply" }));
  });

  return { nodes, edges };
}

function aresta(
  source: string,
  target: string,
  condition: FlowEdge["condition"] = { type: "always" },
): FlowEdge {
  const sufixo = condition.type === "branch" ? condition.branch_id : "segue";
  return { id: `${source}__${target}__${sufixo}`, source, target, priority: 0, condition };
}

const DIA_MS = 86_400_000;
const HORA_MS = 3_600_000;

/** O rótulo do nó de espera, em dias ou horas — é o que a pessoa lê no canvas. */
export function rotuloDaEspera(ms: number): string {
  if (ms >= DIA_MS) {
    const dias = Math.round(ms / DIA_MS);
    return dias === 1 ? "Espera 1 dia" : `Espera ${dias} dias`;
  }
  const horas = Math.max(1, Math.round(ms / HORA_MS));
  return horas === 1 ? "Espera 1 hora" : `Espera ${horas} horas`;
}
