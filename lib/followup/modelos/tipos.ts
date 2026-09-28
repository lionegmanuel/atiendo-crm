/**
 * MODELO DE FOLLOW-UP — um fluxo pronto, com os textos já escritos, que uma
 * organização instala em vez de desenhar.
 *
 * ⚠️ POR QUE ISTO EXISTE. O motor de follow-up está inteiro (gatilhos, espera,
 * resposta, fila, dossiê), e mesmo assim uma clínica recém-instalada não tem
 * follow-up nenhum: para ter o primeiro é preciso abrir o construtor, entender
 * nó, ramo, prazo de graça e política de handoff, e escrever as mensagens. Quem
 * instala o produto numa VPS para atender pacientes não vai fazer isso na
 * primeira semana — e o resultado medido é a tela de Follow-ups vazia com o
 * texto "sem depender de alguém lembrar de mandar mensagem" em cima dela.
 *
 * O modelo é DADO, não código: um grafo que o `flowGraphSchema` valida e o
 * `validateFlowForPublish` aprova, mais o gatilho que ele arma. Ele nasce como
 * RASCUNHO na organização — quem publica é uma pessoa, depois de ler os textos.
 * Instalar não manda mensagem para ninguém.
 *
 * O que o modelo NÃO decide, de propósito:
 *   • **Publicar.** Texto de clínica é voz de clínica; o dono revisa antes.
 *   • **Armar no agente.** Gatilho automático só enrolla se um agente PUBLICADO
 *     tem o ponteiro em `followup.flow_pointer_ids` (`agent-followup-gate.ts`).
 *     O modelo não mexe no agente de ninguém — a tela diz que falta esse passo.
 */
import type { TriggerConfig } from "@/lib/followup/api-schemas";
import type { FlowGraph } from "@/lib/followup/graph-schema";

/** Para qual tipo de negócio o modelo foi escrito. Hoje só clínica; o catálogo já é plural. */
export const NICHOS_DE_MODELO = ["clinica"] as const;
export type NichoDeModelo = (typeof NICHOS_DE_MODELO)[number];

/** O que a pessoa precisa escolher na tela para o modelo virar um fluxo instalável. */
export interface EntradaDoModelo {
  /** Etapa do funil que dispara — só para modelos com `pedeEtapa`. */
  stageId?: string;
}

export interface ModeloDeFollowup {
  /** Id estável. Vai para o audit log e para a tela; renomear quebra o histórico. */
  id: string;
  nicho: NichoDeModelo;
  /** Vira o `name` do ponteiro — e `followup_flow_pointers` tem `unique (organization_id, name)`. */
  nome: string;
  /** A jornada do paciente, como a recepção chama: Consulta, Exame, Cirurgia, Falta. */
  jornada: string;
  /** Uma frase, na voz de quem opera a clínica. */
  resumo: string;
  /** O gatilho em português, para a tela não mostrar `stage_change`. */
  oQueDispara: string;
  /** `true` quando o gatilho é `stage_change`: a tela pede a etapa antes de instalar. */
  pedeEtapa: boolean;
  handoffPolicy: "pause" | "cancel" | "allow";
  /** Monta o `trigger_config`. Quem valida a entrada é a rota; aqui é montagem pura. */
  gatilho(entrada: EntradaDoModelo): TriggerConfig;
  grafo: FlowGraph;
}

/**
 * Quantas mensagens o paciente recebe, no pior caso (ninguém respondeu nunca).
 *
 * CALCULADO do grafo, nunca declarado ao lado dele — doutrina DIRC, letra C. Um
 * campo `toques: 3` escrito à mão vira mentira no dia em que alguém tira um nó
 * de ação do grafo, e a tela mente para quem está decidindo se instala.
 */
export function toquesDoModelo(grafo: FlowGraph): number {
  return grafo.nodes.filter((n) => n.type === "action").length;
}

/**
 * Por quanto tempo o fluxo acompanha o paciente, em ms — o caminho mais longo
 * do gatilho até um fim, somando espera fixa e prazo de resposta.
 *
 * DFS simples porque o grafo de um modelo é ACÍCLICO por construção (a escada
 * só anda para a frente) — e `modelos.test.ts` reprova o modelo que deixar de
 * ser. Num grafo com ciclo isto não terminaria; é por isso que a garantia é
 * testada, não comentada.
 */
export function horizonteDoModeloMs(grafo: FlowGraph): number {
  const saidas = new Map<string, string[]>();
  for (const e of grafo.edges) saidas.set(e.source, [...(saidas.get(e.source) ?? []), e.target]);
  const porId = new Map(grafo.nodes.map((n) => [n.id, n]));

  const memo = new Map<string, number>();
  const emCurso = new Set<string>();
  const caminho = (id: string): number => {
    const jaVisto = memo.get(id);
    if (jaVisto !== undefined) return jaVisto;
    // Cinto de segurança: um ciclo faria esta recursão não terminar, e quem paga
    // seria a aba do navegador de quem só queria ver o catálogo. O ciclo é
    // impossível por construção E reprovado no teste; aqui ele só devolve um
    // número errado em vez de travar a tela.
    if (emCurso.has(id)) return 0;
    emCurso.add(id);
    const no = porId.get(id);
    const proprio =
      no?.type === "wait"
        ? no.config.mode === "fixed"
          ? no.config.duration_ms
          : no.config.max_ms
        : no?.type === "match_reply"
          ? no.config.grace_timeout_ms
          : no?.type === "ai_classify"
            ? no.config.grace_timeout_ms
            : 0;
    const depois = (saidas.get(id) ?? []).reduce((maior, alvo) => Math.max(maior, caminho(alvo)), 0);
    const total = proprio + depois;
    emCurso.delete(id);
    memo.set(id, total);
    return total;
  };

  const inicio = grafo.nodes.find((n) => n.type === "trigger");
  return inicio ? caminho(inicio.id) : 0;
}
