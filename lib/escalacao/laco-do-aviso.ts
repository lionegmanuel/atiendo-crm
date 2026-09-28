/**
 * O LAÇO DE RETORNO DO AVISO — o aviso encurta a espera do cliente?
 *
 * Invariante 7 do Sistema Vivo: *"o que muda no sistema quando ela erra"*. Uma
 * feature que manda mensagem e nunca mede se a mensagem adiantou alguma coisa é
 * uma feature que não pode ser desligada com argumento — só com opinião.
 *
 * ## O contraste, e por que ele existe de graça
 *
 * Numa instalação self-host existe UMA organização; comparar com outras está
 * descartado. Mas o contraste intra-organização já está no banco: alguns casos
 * tiveram o aviso ENTREGUE (`entregas_de_aviso_de_caso.status = 'enviado'`) e
 * outros não (falhou, foi cancelado, ou é anterior a alguém ligar o recurso —
 * e esse último grupo nem tem linha de entrega, que é por que o "antes × depois
 * de ligar" do plano e o "com × sem aviso" são o MESMO corte, não dois).
 *
 * ## ⚠️ Os dois grupos são medidos a partir do MESMO marco, e isso é correção
 *
 * O plano mandava medir o grupo com aviso a partir de `enviado_em` e o grupo
 * sem aviso a partir de `opened_at`. Isso enviesa **a favor** do aviso: como
 * `enviado_em >= opened_at`, o grupo avisado começa a contar depois, e todo
 * atraso da própria entrega desaparece da conta. Os dois grupos aqui contam de
 * `opened_at`, que é o instante em que o CLIENTE começou a esperar — a única
 * régua que responde à pergunta que a feature faz.
 *
 * O atraso da entrega não some: ele vira `medianaAteOAvisoMinutos`, medido
 * separado. Duas perguntas, dois números.
 *
 * ## Mediana, nunca média
 *
 * Um caso respondido três dias depois (fim de semana) move a média de uma
 * amostra pequena para onde ela quiser. A mediana descreve o caso típico, que é
 * o que quem opera precisa comparar.
 */

/** Uma linha do contraste: um caso, com ou sem aviso entregue. */
export interface CasoParaOLaco {
  caseId: string;
  /** `agent_cases.opened_at` — o instante em que o cliente começou a esperar. */
  abertoEm: string;
  /** `entregas_de_aviso_de_caso.enviado_em`; `null` = o aviso não saiu. */
  avisoSaiuEm: string | null;
  /** O primeiro `agent_case_events` com `actor_kind = 'user'`; `null` = ninguém agiu ainda. */
  primeiraAcaoHumanaEm: string | null;
}

export interface GrupoDoLaco {
  /** Quantos casos caíram neste grupo. */
  casos: number;
  /** Quantos deles já tiveram ação humana — a base da mediana. */
  respondidos: number;
  /** Minutos de `opened_at` até a primeira ação humana. `null` = amostra vazia. */
  medianaMinutos: number | null;
}

export interface LacoDoAviso {
  comAviso: GrupoDoLaco;
  semAviso: GrupoDoLaco;
  /** Minutos de `opened_at` até o aviso SAIR. A latência da entrega, separada. */
  medianaAteOAvisoMinutos: number | null;
}

/** A mediana em minutos, ou `null` quando não há amostra. */
function medianaEmMinutos(intervalosMs: number[]): number | null {
  if (intervalosMs.length === 0) return null;
  const ordenado = [...intervalosMs].sort((a, b) => a - b);
  const meio = Math.floor(ordenado.length / 2);
  const ms =
    ordenado.length % 2 === 1 ? ordenado[meio]! : (ordenado[meio - 1]! + ordenado[meio]!) / 2;
  return Math.round(ms / 60_000);
}

/**
 * Intervalo em ms entre dois instantes, ou `null` quando um deles não dá para
 * ler ou a ordem está invertida.
 *
 * Relógio torto e carimbo ausente existem: uma ação humana ANTES da abertura do
 * caso é dado que não descreve nada, e entrar com valor negativo puxaria a
 * mediana para baixo em silêncio. Fora da amostra é melhor que dentro errado.
 */
function intervalo(de: string | null, ate: string | null): number | null {
  if (!de || !ate) return null;
  const a = Date.parse(de);
  const b = Date.parse(ate);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return b - a;
}

export function medirLacoDoAviso(casos: CasoParaOLaco[]): LacoDoAviso {
  const esperaComAviso: number[] = [];
  const esperaSemAviso: number[] = [];
  const ateOAviso: number[] = [];
  let comAviso = 0;
  let semAviso = 0;

  for (const caso of casos) {
    const avisado = caso.avisoSaiuEm !== null;
    if (avisado) comAviso += 1;
    else semAviso += 1;

    const espera = intervalo(caso.abertoEm, caso.primeiraAcaoHumanaEm);
    if (espera !== null) (avisado ? esperaComAviso : esperaSemAviso).push(espera);

    const latencia = intervalo(caso.abertoEm, caso.avisoSaiuEm);
    if (latencia !== null) ateOAviso.push(latencia);
  }

  return {
    comAviso: {
      casos: comAviso,
      respondidos: esperaComAviso.length,
      medianaMinutos: medianaEmMinutos(esperaComAviso),
    },
    semAviso: {
      casos: semAviso,
      respondidos: esperaSemAviso.length,
      medianaMinutos: medianaEmMinutos(esperaSemAviso),
    },
    medianaAteOAvisoMinutos: medianaEmMinutos(ateOAviso),
  };
}
