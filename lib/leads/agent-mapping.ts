import { LEAD_STAGES, type LeadStage } from "@/lib/agent-engine/agent/lead-state";

/**
 * As regras do mapeamento passo-do-agente → etapa-do-tenant, sem tocar no banco.
 *
 * A ponte é `crm_stages.agent_stage_hint` (migration 0084) e ela JÁ MOVE cards em
 * produção — só que nenhuma tela do produto escreve nessa coluna ainda. Este
 * arquivo é a camada pura que sustenta essa tela.
 *
 * ⚠️ POR QUE VALIDAR SE O BANCO JÁ RECUSA. O CHECK é a rede de segurança, não a
 * primeira linha: um `23514` cru chega ao dono da clínica como "violates check
 * constraint crm_stages_hint_coerente_com_won_lost", que não ensina nada e não
 * diz QUAL etapa está errada. As mensagens daqui vão direto para a tela — por
 * isso citam o NOME da etapa e o rótulo em português do passo, nunca o id nem o
 * token interno ('won', 'e2').
 *
 * ⚠️ `null` É RESPOSTA, NÃO PENDÊNCIA. "Em separação" e "Pós-venda" não têm
 * equivalente no funil do agente; a 0084 diz isso explicitamente. Tratar passo
 * sem etapa como erro cobraria do tenant uma escolha que ele já fez.
 */

/** O que a tela sabe de cada etapa. Arquivadas não chegam aqui — quem monta a lista filtra. */
export interface EtapaDoMapa {
  id: string;
  name: string;
  is_won: boolean;
  is_lost: boolean;
  agent_stage_hint: string | null;
}

/**
 * Passo → id da etapa escolhida (`null` = de propósito sem etapa).
 *
 * Chave é `string`, não `LeadStage`, de propósito: isto vem de request body, e o
 * vocabulário fechado do CHECK precisa ser verificado em runtime — tipo não
 * valida JSON que chegou pela rede.
 */
export type EntradaDeMapeamento = Record<string, string | null | undefined>;

export type ResultadoValidacao = { ok: true } | { ok: false; erros: string[] };

/**
 * Como cada passo do agente se chama para quem não conhece o produto por dentro.
 *
 * Exportado porque a TELA precisa exatamente destes rótulos: dois lugares
 * traduzindo 'negotiating' à mão viram duas traduções diferentes no primeiro
 * ajuste — a família de defeito que a própria 0084 nasceu para fechar.
 */
export const ROTULO_DO_PASSO: Readonly<Record<LeadStage, string>> = {
  new: "Novo lead",
  contacted: "Primeiro contato",
  qualifying: "Em qualificação",
  qualified: "Qualificado",
  negotiating: "Em negociação",
  won: "Ganho",
  lost: "Perdido",
};

/**
 * O mesmo passo, explicado para quem nunca configurou um CRM.
 *
 * ⚠️ MORA AO LADO DO RÓTULO DE PROPÓSITO. O wizard precisa de uma frase, e não
 * de um rótulo de duas palavras: "Em qualificação" não diz nada a quem instalou
 * o sistema há dez minutos e está decidindo o que cada coluna do quadro
 * significa. Escrever essa frase lá teria criado uma SEGUNDA redação dos mesmos
 * sete passos — e duas redações divergem no primeiro ajuste de qualquer uma.
 * Aqui, quem mudar o vocabulário do funil do agente vê as duas juntas.
 */
export const EXPLICACAO_DO_PASSO: Readonly<Record<LeadStage, string>> = {
  new: "acabou de chamar e ninguém respondeu ainda",
  contacted: "já foi respondido",
  qualifying: "ele está entendendo o que a pessoa precisa",
  qualified: "já dá para saber o que oferecer",
  negotiating: "está fechando preço, horário ou condições",
  won: "fechou negócio",
  lost: "não fechou",
};

function ehPasso(valor: string): valor is LeadStage {
  return (LEAD_STAGES as readonly string[]).includes(valor);
}

/** A explicação do passo. Hint fora do vocabulário não inventa frase. */
export function explicacaoDoPasso(passo: string): string | null {
  return ehPasso(passo) ? EXPLICACAO_DO_PASSO[passo] : null;
}

/** Rótulo de tela. Hint fora do vocabulário (banco antigo) sai cru, mas nunca em branco. */
export function rotuloDoPasso(passo: string): string {
  return ehPasso(passo) ? ROTULO_DO_PASSO[passo] : passo;
}

/** Passos que a entrada declara ter mexido — chave ausente ≠ chave com `null`. */
function passosMencionados(entrada: EntradaDeMapeamento): Set<string> {
  return new Set(
    Object.entries(entrada)
      .filter(([, stageId]) => stageId !== undefined)
      .map(([passo]) => passo),
  );
}

/** Recusa o que o banco recusaria — antes de tocar o banco, e em português. */
export function validarMapeamento(
  entrada: EntradaDeMapeamento,
  etapas: EtapaDoMapa[],
): ResultadoValidacao {
  const erros: string[] = [];
  const etapaJaUsadaPor = new Map<string, LeadStage>();
  const mencionados = passosMencionados(entrada);

  for (const [passo, stageId] of Object.entries(entrada)) {
    const errosAntes = erros.length;
    // Chave ausente e chave com `undefined` são a mesma coisa: passo não mexido.
    if (stageId === undefined) continue;

    if (!ehPasso(passo)) {
      erros.push(`«${passo}» não é um passo do atendimento do assistente.`);
      continue;
    }
    const rotulo = ROTULO_DO_PASSO[passo];

    // `null` é escolha do tenant, não omissão — nada a validar.
    if (stageId === null) continue;

    const etapa = etapas.find((e) => e.id === stageId);
    if (!etapa) {
      erros.push(
        `A etapa escolhida para «${rotulo}» não faz parte deste funil. Recarregue a página e escolha de novo.`,
      );
      continue;
    }

    // O índice único `uniq_crm_stages_pipeline_hint`: uma etapa, um passo.
    const donoAnterior = etapaJaUsadaPor.get(etapa.id);
    if (donoAnterior) {
      erros.push(
        `A etapa «${etapa.name}» já representa «${ROTULO_DO_PASSO[donoAnterior]}» e não pode representar «${rotulo}` +
          `» também. Cada etapa vale por um passo só.`,
      );
      continue;
    }
    etapaJaUsadaPor.set(etapa.id, passo);

    // Coerência com is_won/is_lost, nos DOIS sentidos (CHECK da 0084). Sem os
    // dois, `is_won` e o hint viram duas fontes capazes de discordar sobre o
    // mesmo lugar do funil.
    if (passo === "won" && !etapa.is_won) {
      erros.push(
        `A etapa «${etapa.name}» não é a etapa de fechamento (ganho) deste funil, então não pode representar «${rotulo}».`,
      );
    } else if (passo === "lost" && !etapa.is_lost) {
      erros.push(
        `A etapa «${etapa.name}» não é a etapa de perda deste funil, então não pode representar «${rotulo}».`,
      );
    } else if (etapa.is_won && passo !== "won") {
      erros.push(
        `A etapa «${etapa.name}» é a etapa de ganho deste funil, então só pode representar «${ROTULO_DO_PASSO.won}».`,
      );
    } else if (etapa.is_lost && passo !== "lost") {
      erros.push(
        `A etapa «${etapa.name}» é a etapa de perda deste funil, então só pode representar «${ROTULO_DO_PASSO.lost}».`,
      );
    }

    // ⚠️ ETAPA OCUPADA POR UM PASSO QUE A ENTRADA NÃO MENCIONA.
    //
    // O banco aceitaria (é uma coluna, um valor) — e é justamente por isso que
    // a recusa precisa morar aqui: aceitar DESMAPEARIA o passo antigo em
    // silêncio, e o tenant só descobriria meses depois, quando o agente
    // parasse de mover o card e ninguém soubesse dizer por quê.
    //
    // Se o passo antigo ESTÁ na entrada, é permuta ou liberação declarada — o
    // tenant sabe o que está fazendo e `diffParaUpdates` sabe ordenar.
    //
    // Só acusa se este passo ainda não errou por outro motivo: a tela mostra os
    // erros, e dois textos sobre a mesma escolha ensinam menos que um.
    const hintAtual = etapa.agent_stage_hint;
    if (erros.length === errosAntes && hintAtual && hintAtual !== passo && !mencionados.has(hintAtual)) {
      erros.push(
        `A etapa «${etapa.name}» já representa «${rotuloDoPasso(hintAtual)}». Libere-a antes de usá-la para «${rotulo}».`,
      );
    }
  }

  return erros.length === 0 ? { ok: true } : { ok: false, erros };
}

export interface UpdateDeEtapa {
  stageId: string;
  hint: LeadStage | null;
}

/**
 * O mapa desejado traduzido nos UPDATEs mínimos.
 *
 * Chame DEPOIS de `validarMapeamento` — aqui não há veredito, só diferença.
 *
 * ⚠️ SÓ OS PASSOS MENCIONADOS NA ENTRADA ENTRAM NA CONTA. Mapa parcial (a tela
 * mandando um passo só) não apaga passo que a entrada não cita — "ausente"
 * significa "não mexi nisso", nunca "limpe"; para limpar, a entrada diz `null`.
 * O contrato só se fecha COM `validarMapeamento`: a etapa que é ALVO da entrada
 * larga o hint que declarava, e é a validação que recusa isso quando o passo
 * largado não foi mencionado. Chamar o diff sozinho perde configuração.
 *
 * ⚠️ TODOS OS UNSETs VÊM PRIMEIRO, e não é estética: o índice único
 * `uniq_crm_stages_pipeline_hint` é imediato (não deferível), então qualquer
 * estado intermediário com dois donos do mesmo passo é recusado pelo banco —
 * tanto o passo que SAI do mapa quanto o que TROCA de dono numa permuta.
 */
export function diffParaUpdates(
  atual: EtapaDoMapa[],
  desejado: EntradaDeMapeamento,
): UpdateDeEtapa[] {
  const passosEmJogo = passosMencionados(desejado);

  const limpar: UpdateDeEtapa[] = [];
  const ocupar: UpdateDeEtapa[] = [];

  for (const etapa of atual) {
    const alvoDaEtapa = Object.entries(desejado).find(
      ([, stageId]) => stageId === etapa.id,
    )?.[0];

    // `!== undefined` e não veracidade: `find` devolve ausência como undefined,
    // e o contrato deste arquivo é "chame depois de validar" — não é papel do
    // diff decidir que uma chave vazia não conta.
    if (alvoDaEtapa !== undefined) {
      if (etapa.agent_stage_hint !== alvoDaEtapa && ehPasso(alvoDaEtapa)) {
        // A etapa alvo LARGA o passo que declarava — e esse unset precisa sair
        // na primeira leva também. Numa PERMUTA (dois passos trocando de etapa)
        // nenhuma das duas cai no ramo `else`, então sem esta linha saem dois
        // SETs e nenhum UNSET: o primeiro colide com o hint que a outra etapa
        // ainda declara, e o índice único devolve 23505 cru na tela.
        if (etapa.agent_stage_hint) limpar.push({ stageId: etapa.id, hint: null });
        ocupar.push({ stageId: etapa.id, hint: alvoDaEtapa });
      }
      continue;
    }

    // A etapa perdeu o passo que declarava — mas só se esse passo estava em jogo.
    if (etapa.agent_stage_hint && passosEmJogo.has(etapa.agent_stage_hint)) {
      limpar.push({ stageId: etapa.id, hint: null });
    }
  }

  return [...limpar, ...ocupar];
}

// ---------------------------------------------------------------------------
// COBERTURA — a lacuna precisa ser VISÍVEL onde ela custa (spec 17 passo 4)
// ---------------------------------------------------------------------------

/**
 * Os passos que MOVEM o card, e por isso precisam de destino.
 *
 * `won` e `lost` ficam de fora: têm coluna própria no funil (`is_won`/`is_lost`)
 * e o produto já sabe encontrá-las sem tradução. Cobrá-las aqui inflaria a
 * lacuna com uma pendência que não existe — e uma barra que nunca chega a 100%
 * é uma barra que se aprende a ignorar.
 */
export const PASSOS_QUE_PRECISAM_DE_ETAPA = [
  "new",
  "contacted",
  "qualifying",
  "qualified",
  "negotiating",
] as const;

export interface CoberturaDoFunil {
  /** Quantos passos têm uma etapa apontada. */
  traduzidos: number;
  /** Quantos passos MOVEM o card e por isso precisam de destino. */
  total: number;
  /** Nenhum passo traduzido: o agente cuida do funil e não sabe para onde ir. */
  mudo: boolean;
  /** Os passos sem destino, em português, para a tela poder nomeá-los. */
  faltando: string[];
}

/**
 * Quanto deste funil o agente sabe percorrer.
 *
 * ═══ O QUE ISTO RESOLVE ═══
 *
 * Medido: 6 de 36 etapas mapeadas na produção, e os funis "Comercial - Andrea",
 * "Comercial - Julia" e "Suporte - IA" com ZERO. Neles o agente não sabe para
 * onde mover — e a única forma de descobrir isso hoje é entrar funil por funil
 * na tela de tradução.
 *
 * ⚠️ A lacuna só custa onde o agente ATUA. Depois do passo 3, um funil sem
 * tradução e FORA do escopo é irrelevante: ninguém prometeu nada sobre ele.
 * Dentro do escopo, é promessa que não se cumpre — o dono marcou o funil
 * achando que o assistente ia organizá-lo, e ele não vai.
 */
export function coberturaDoFunil(etapas: readonly EtapaDoMapa[]): CoberturaDoFunil {
  const apontados = new Set(
    etapas
      .filter((e) => e.agent_stage_hint !== null && e.agent_stage_hint !== "")
      .map((e) => e.agent_stage_hint as string),
  );
  const faltando = PASSOS_QUE_PRECISAM_DE_ETAPA.filter((p) => !apontados.has(p));
  const traduzidos = PASSOS_QUE_PRECISAM_DE_ETAPA.length - faltando.length;
  return {
    traduzidos,
    total: PASSOS_QUE_PRECISAM_DE_ETAPA.length,
    // MUDO é diferente de incompleto: um funil com 3 de 5 passos o agente
    // percorre em parte; com 0 ele não consegue mover nada, nunca. Só o segundo
    // merece alarme, e distinguir os dois é o que evita o alarme constante.
    mudo: traduzidos === 0,
    faltando: faltando.map((p) => rotuloDoPasso(p)),
  };
}
