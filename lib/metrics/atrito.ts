/**
 * Índice de Atrito — montagem dos pares eficiência/dano (spec 17; doutrina
 * `docs/doctrine/sistema-vivo/03-medida-do-proposito.md` §3.3).
 *
 * A regra que este módulo EXISTE para materializar: toda medida que empurra o
 * sistema a fazer mais de alguma coisa é publicada junto da medida que denuncia
 * o custo dessa coisa — mesmo painel, mesmo destaque. Separadas, a de eficiência
 * vence sempre, porque é a que sobe. Por isso o formato de saída é o PAR, e não
 * uma lista de números: a tela não consegue renderizar uma eficiência sozinha
 * sem violar o tipo.
 *
 * Guardado por `tests/unit/atrito-par-eficiencia-dano.test.ts`, que reprova par
 * sem dano — o gate mecânico da doutrina, não um comentário pedindo cuidado.
 *
 * ⚠️ AUSÊNCIA DE DADO É `null`, NUNCA `0`. Denominador zero devolve null e a
 * tela mostra "—". Um zero aqui viraria "0% de contorno" numa org sem nenhum
 * envio — a frase tranquilizadora que a falta de medição não autoriza.
 */

/** Shape cru devolvido por `fn_atrito_metrics` (migrations 0133 + 0134). */
export interface AtritoRaw {
  escopo: {
    demandas: number; de: string; ate: string;
    abandono_horas: number; repeticao_min: number; espera_horas: number;
    demandas_com_caso: number; demandas_abertas: number; denominador: string;
  };
  cliente: {
    turnos_p50: number | null;
    turnos_p90: number | null;
    insistencia_media: number | null;
    insistencia_max: number | null;
    pedidos_de_humano: number;
    descadastros: number;
    abandonos: number;
    conversas_com_fala_nossa: number;
    reperguntas: number;
    perguntas_com_resposta: number;
    esperas_caladas: number;
    esperas_medidas: number;
    espera_resposta_p90_s: number | null;
    /**
     * O LAÇO DE RETORNO DA PASSAGEM (migration 0294). Numerador e denominador
     * SEPARADOS, e não uma razão pronta: só assim a borda consegue distinguir
     * "ninguém repetiu" (0 de 10) de "ninguém voltou a falar" (0 de 0, que é
     * ausência de dado e sai como `—`).
     */
    repeticao_pos_passagem: number;
    passagens_medidas: number;
  };
  empresa: {
    intervencoes_por_demanda: number | null;
    espera_humana_p50_s: number | null;
    espera_humana_p90_s: number | null;
    retrabalho: number;
    vetos: number;
    execucoes_medidas: number;
    envios_por_ia: number;
    /**
     * Envios de REGRA (automação, follow-up fixo, lembrete de agenda): saíram
     * sozinhos, mas ninguém os escreveu. É o número que a #652 acrescentou ao
     * painel para a queda do "por IA" não ser lida como o agente encolhendo.
     */
    envios_por_automacao: number;
    envios_por_integracao: number;
    envios_humano_no_sistema: number;
    envios_humano_fora: number;
    demandas_sem_proximo_passo: number;
  };
  eficiencia: { ganhos: number; perdidos: number };
}

export type Unidade = "contagem" | "segundos" | "razao" | "media";

export interface Medida {
  chave: string;
  rotulo: string;
  valor: number | null;
  unidade: Unidade;
  /** Ressalva que viaja COM o número — proxy, escopo parcial, régua. */
  nota?: string;
}

export interface Par {
  chave: string;
  titulo: string;
  /** O que o sistema é empurrado a maximizar. */
  eficiencia: Medida;
  /** O custo disso. Nunca vazio — o teste reprova. */
  danos: Medida[];
}

/** Régua do abandono. Default conservador: 72h de silêncio no WhatsApp já é fim. */
export const ABANDONO_HORAS_DEFAULT = 72;
const ABANDONO_HORAS_MIN = 1;
const ABANDONO_HORAS_MAX = 24 * 90;

/**
 * Leitura DEFENSIVA de settings->'atrito' (jsonb livre): valor fora da faixa,
 * de tipo errado ou ausente cai no default. Régua inválida não pode derrubar o
 * painel — e não pode virar `NaN` no rótulo que a tela exibe.
 *
 * ⚠️ O `typeof` vem ANTES do `Number()` de propósito. `Number(true)` é `1`, que
 * é inteiro e cai dentro da faixa — um `true` no jsonb passaria como "abandono
 * após 1h" e o painel acusaria abandono em massa, com aparência de dado. Pego
 * por `tests/unit/atrito-par-eficiencia-dano.test.ts`, não por revisão.
 * `Number([])` é `0` e `Number([5])` é `5` pelo mesmo caminho.
 */
export function lerAbandonoHoras(settings: unknown): number {
  const s = settings as { atrito?: { abandono_horas?: unknown } } | null | undefined;
  const cru = s?.atrito?.abandono_horas;
  if (typeof cru !== "number" && typeof cru !== "string") return ABANDONO_HORAS_DEFAULT;
  const bruto = Number(cru);
  if (!Number.isFinite(bruto) || !Number.isInteger(bruto)) return ABANDONO_HORAS_DEFAULT;
  if (bruto < ABANDONO_HORAS_MIN || bruto > ABANDONO_HORAS_MAX) return ABANDONO_HORAS_DEFAULT;
  return bruto;
}

/** Divisão que devolve null em vez de mentir com 0. */
export function razao(numerador: number, denominador: number): number | null {
  if (!Number.isFinite(numerador) || !Number.isFinite(denominador)) return null;
  if (denominador <= 0) return null;
  return numerador / denominador;
}

/**
 * Quanto das respostas saiu do agente, sobre as saídas que TÊM dono entre o
 * agente e uma pessoa (IA + humano no sistema + humano fora). Incluir o
 * `external_device` no denominador é o que impede a automação de parecer alta
 * numa org onde o time responde pelo celular: ali a IA não absorveu, ela apenas
 * não foi usada.
 *
 * As linhas de AUTOMAÇÃO (#652) ficam de fora das duas pontas: nem o agente nem
 * uma pessoa as escreveu, e misturá-las aqui faria o número do agente subir por
 * mensagem que ele não escreveu. Elas aparecem no número próprio, no painel.
 */
export function taxaDeAutomacao(e: AtritoRaw["empresa"]): number | null {
  return razao(e.envios_por_ia, e.envios_por_ia + e.envios_humano_no_sistema + e.envios_humano_fora);
}

/**
 * Das respostas dadas por gente, quantas saíram POR FORA do sistema.
 * Mede quantas vezes o operador contornou a própria ferramenta — o sinal de
 * atrito da empresa mais honesto que existe, porque ninguém o reporta.
 */
export function taxaDeContorno(e: AtritoRaw["empresa"]): number | null {
  return razao(e.envios_humano_fora, e.envios_humano_no_sistema + e.envios_humano_fora);
}

/**
 * Das conversas em que O SISTEMA FALOU, quantas terminaram no silêncio.
 * Denominador é "conversas em que falamos", não o total: 12 abandonos não diz
 * nada sem saber se é 12 de 15 ou 12 de 1200.
 */
export function taxaDeAbandono(c: AtritoRaw["cliente"]): number | null {
  return razao(c.abandonos, c.conversas_com_fala_nossa);
}

/**
 * Das perguntas que TIVERAM resposta nossa, quantas a pessoa teve de refazer.
 * É um PISO: a camada lexical só pega repergunta quase literal (limiar 0.7,
 * calibrado para zero falso positivo). Reformulação com outro vocabulário
 * escapa — ver o cabeçalho da migration 0135.
 */
export function taxaDeRepergunta(c: AtritoRaw["cliente"]): number | null {
  return razao(c.reperguntas, c.perguntas_com_resposta);
}

/** Das falas do cliente que tiveram resposta, quantas esperaram calado demais. */
export function taxaDeEsperaCalada(c: AtritoRaw["cliente"]): number | null {
  return razao(c.esperas_caladas, c.esperas_medidas);
}

/** Vetos por execução medida — quanto o sistema precisou ser contido de si. */
export function vetosPorExecucao(e: AtritoRaw["empresa"]): number | null {
  return razao(e.vetos, e.execucoes_medidas);
}

const ESCOPO_PARCIAL = "Sobre as demandas encerradas no período.";

/**
 * `t` é opcional (identidade por padrão) porque `montarPares` roda no servidor
 * — dentro de uma API route (`app/api/v1/metrics/atrito/route.ts`), não de um
 * componente React — e é chamado também pelos testes unitários sem tradução
 * nenhuma. O idioma vem de `user.locale`, resolvido pela própria rota, e é a
 * PRIMEIRA vez que este sistema de tradução atravessa a fronteira da API: até
 * aqui só telas liam `traduzir()`. O rótulo interpola números (regra `${...}`),
 * então cada `t()` cobre só a parte fixa da frase — o número nunca passa por
 * tradução.
 */
export function montarPares(
  raw: AtritoRaw,
  t: (texto: string) => string = (texto) => texto,
): Par[] {
  const { cliente, empresa, eficiencia, escopo } = raw;

  return [
    {
      chave: "conversao",
      titulo: t("Conversão"),
      eficiencia: {
        chave: "ganhos",
        rotulo: t("Negócios ganhos"),
        valor: eficiencia.ganhos,
        unidade: "contagem",
      },
      danos: [
        {
          chave: "turnos_p50",
          rotulo: t("Turnos até o desfecho (mediana)"),
          valor: cliente.turnos_p50,
          unidade: "media",
          nota: t(ESCOPO_PARCIAL),
        },
        {
          chave: "insistencia_media",
          rotulo: t("Insistência do agente (média de retornos)"),
          valor: cliente.insistencia_media,
          unidade: "media",
          nota: `${t("Quantas vezes o agente voltou ao cliente por conta própria. Medido sobre as")} ${escopo.demandas_com_caso} ${t("demandas que passaram por atendimento humano.")}`,
        },
        // O MÁXIMO ao lado da média, e não no lugar dela. A spec 17 nasceu do
        // agente que insiste seis vezes: numa base de 40 demandas, seis retornos
        // num único cliente somem na média e é justamente esse caso que precisa
        // aparecer. Publicar só a média reintroduziria o defeito pelo lado da
        // exibição — o sistema mediria o dano e a tela o esconderia.
        {
          chave: "insistencia_max",
          rotulo: t("Insistência no pior caso"),
          valor: cliente.insistencia_max,
          unidade: "contagem",
          nota: t("O cliente que mais recebeu retornos. A média esconde o exagero pontual."),
        },
        {
          chave: "descadastros",
          rotulo: t("Descadastros no período"),
          valor: cliente.descadastros,
          unidade: "contagem",
          nota: t("Atrito máximo: a pessoa pediu para sair."),
        },
        // ABANDONO é irmão do descadastro e muito mais comum: em vez de pedir
        // para sair, a pessoa simplesmente para de responder. Não gera ticket,
        // não gera nota baixa, não aparece em lugar nenhum — e é a perda que
        // mais acontece. A régua vem do payload para o rótulo não mentir.
        {
          chave: "taxa_de_abandono",
          rotulo: `${t("Conversas que morreram no silêncio (após")} ${escopo.abandono_horas}h)`,
          valor: taxaDeAbandono(cliente),
          unidade: "razao",
          nota: `${cliente.abandonos} ${t("de")} ${cliente.conversas_com_fala_nossa} ${t("conversas em que falamos: a pessoa não respondeu e ninguém encerrou.")}`,
        },
      ],
    },
    {
      chave: "automacao",
      titulo: t("Automação"),
      eficiencia: {
        chave: "taxa_automacao",
        rotulo: t("Respostas dadas pelo agente"),
        valor: taxaDeAutomacao(empresa),
        unidade: "razao",
      },
      danos: [
        {
          chave: "pedidos_de_humano",
          rotulo: t("Passagens para humano"),
          valor: cliente.pedidos_de_humano,
          unidade: "contagem",
          nota: t("Confiança perdida na automação."),
        },
        {
          chave: "taxa_de_contorno",
          rotulo: t("Respostas humanas fora do sistema"),
          valor: taxaDeContorno(empresa),
          unidade: "razao",
          nota: t("O time respondeu pelo celular, contornando a ferramenta."),
        },
        // ─── O LAÇO DE RETORNO DA PASSAGEM (invariante 7) ─────────────────
        // Encostada em `pedidos_de_humano` de propósito: aquela medida conta
        // QUANTAS vezes a IA desistiu; esta diz se a desistência custou caro à
        // pessoa do outro lado. A pergunta que ela responde é a única que mede
        // se o cartão da passagem serviu para alguma coisa — se o briefing
        // chegou a quem assumiu, a repetição cai; se não chegou, ela não muda.
        {
          chave: "repeticao_pos_passagem",
          rotulo: t("Clientes que repetiram depois da passagem"),
          valor: razao(cliente.repeticao_pos_passagem, cliente.passagens_medidas),
          unidade: "razao",
          // A régua viaja com o número (doutrina §3.4 regra 4), e junto vai a
          // ressalva de escopo: `fn_atrito_metrics` é SECURITY INVOKER, então
          // dois papéis veem números diferentes de boa-fé.
          nota: `${cliente.repeticao_pos_passagem} ${t("de")} ${cliente.passagens_medidas} ${t("passagens em que o cliente voltou a falar: ele teve de repetir o que já tinha dito.")} ${t("Limiar de 0,7 e janela de 24h. Quem atende em `visibility_mode='own'` vê só as conversas dele.")}`,
        },
        // O agente respondeu — e a pessoa teve de perguntar de novo. É o dano
        // direto da automação: responder não é resolver.
        {
          chave: "taxa_de_repergunta",
          rotulo: t("Perguntas que a pessoa teve de repetir"),
          valor: taxaDeRepergunta(cliente),
          unidade: "razao",
          nota: `${t("Piso:")} ${cliente.reperguntas} ${t("de")} ${cliente.perguntas_com_resposta}. ${t("Conta só a repergunta quase literal — reformulada com outras palavras escapa desta medida.")}`,
        },
      ],
    },
    {
      chave: "custo_humano",
      titulo: t("Custo humano"),
      eficiencia: {
        chave: "demandas",
        rotulo: t("Demandas encerradas"),
        valor: escopo.demandas,
        unidade: "contagem",
        nota: t(ESCOPO_PARCIAL),
      },
      danos: [
        {
          chave: "intervencoes_por_demanda",
          rotulo: t("Intervenções humanas por demanda"),
          valor: empresa.intervencoes_por_demanda,
          unidade: "media",
        },
        {
          chave: "espera_humana_p50_s",
          rotulo: t("Espera na fila humana (mediana)"),
          valor: empresa.espera_humana_p50_s,
          unidade: "segundos",
        },
        {
          chave: "espera_humana_p90_s",
          rotulo: t("Espera na fila humana (p90)"),
          valor: empresa.espera_humana_p90_s,
          unidade: "segundos",
          // Mediana e p90 iguais denunciam base pequena, não uma fila homogênea.
          // Sem dizer isso, dois números idênticos lado a lado leem-se como bug.
          nota:
            empresa.espera_humana_p50_s !== null &&
            empresa.espera_humana_p50_s === empresa.espera_humana_p90_s
              ? t("Igual à mediana: há poucas esperas medidas no período para os dois se separarem.")
              : t("O p90 é a experiência de quem espera mais — a mediana a esconde."),
        },
        // O INVARIANTE 4 como número: demanda aberta sem próximo passo é o
        // vazamento que a doutrina inteira combate — e vazamento que ninguém vê
        // é o pior tipo. Antes da entidade de demanda isto não era enumerável.
        {
          chave: "demandas_sem_proximo_passo",
          rotulo: t("Demandas abertas sem próximo passo"),
          valor: empresa.demandas_sem_proximo_passo,
          unidade: "contagem",
          nota: `${t("De")} ${escopo.demandas_abertas} ${t("abertas agora. Cada uma é alguém esperando sem que nada esteja marcado para acontecer.")}`,
        },
        {
          chave: "retrabalho",
          rotulo: t("Demandas que precisaram subir de nível"),
          valor: empresa.retrabalho,
          unidade: "contagem",
        },
        // Espera COMUNICADA custa uma fração da espera calada. Esta mede a
        // calada: a pessoa falou e ficou sem nenhuma palavra nossa.
        {
          chave: "taxa_de_espera_calada",
          rotulo: `${t("Esperas sem nenhuma resposta por mais de")} ${escopo.espera_horas}h`,
          valor: taxaDeEsperaCalada(cliente),
          unidade: "razao",
          nota: `${cliente.esperas_caladas} ${t("de")} ${cliente.esperas_medidas} ${t("falas do cliente. Quem sabe que vai esperar, espera; quem não sabe, desiste.")}`,
        },
      ],
    },
    {
      chave: "contencao",
      titulo: t("Contenção"),
      eficiencia: {
        chave: "envios_por_ia",
        rotulo: t("Mensagens enviadas pelo agente"),
        valor: empresa.envios_por_ia,
        unidade: "contagem",
      },
      danos: [
        {
          chave: "vetos_por_execucao",
          rotulo: t("Vetos por execução"),
          valor: vetosPorExecucao(empresa),
          unidade: "media",
          nota: t("Quanto o sistema precisou ser contido de si mesmo antes de falar."),
        },
        // O número da #652. Ele existe porque o contrário dele mente: quando o
        // carimbo da automação saiu de `'ai'`, o "por IA" CAIU para quem usa
        // regra — sem este número, a queda apareceria como o agente encolhendo.
        // O irmão do número acima, pela decisão da #866: o envio por TOKEN DE
        // SERVIDOR também não é a IA — mas chamá-lo de "automação" seria mentir
        // no rótulo, porque quem manda é um sistema de fora, não uma regra desta
        // instalação. Número próprio, e os dois somados aos que já existiam.
        {
          chave: "envios_por_integracao",
          rotulo: t("Mensagens enviadas por integração"),
          valor: empresa.envios_por_integracao,
          unidade: "contagem",
          nota: t(
            "Envios feitos por um sistema de fora com token de servidor. Como a automação, não entram no número do agente — e é por isso que ele cai onde há integração.",
          ),
        },
        {
          chave: "envios_por_automacao",
          rotulo: t("Mensagens enviadas por automação"),
          valor: empresa.envios_por_automacao,
          unidade: "contagem",
          nota: t(
            "Regra de automação, texto fixo do follow-up e lembrete de agenda: saiu sozinho e ninguém escreveu. Não entra no número do agente — é por isso que ele cai onde há automação.",
          ),
        },
      ],
    },
  ];
}

/** Formatação para tela. `null` é "—" — nunca "0". */
export function formatarMedida(m: Medida): string {
  if (m.valor === null || !Number.isFinite(m.valor)) return "—";
  switch (m.unidade) {
    case "razao":
      return `${(m.valor * 100).toFixed(1)}%`;
    case "segundos":
      return formatarDuracao(m.valor);
    case "media":
      return m.valor.toFixed(1);
    case "contagem":
      return String(Math.round(m.valor));
  }
}

export function formatarDuracao(segundos: number): string {
  const s = Math.round(segundos);
  if (s < 60) return `${s}s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const restoMin = min % 60;
  return restoMin === 0 ? `${h}h` : `${h}h ${restoMin}min`;
}
