/**
 * Quando uma capacidade SAI do Conversador (spec 16, passo 6).
 *
 * ═══ A CURA, E POR QUE ELA VEM POR ÚLTIMO ═══
 *
 * O gate de vazamento (passo 1) é rede: ele barra o vocabulário interno na saída
 * e devolve ao modelo um erro de ensino. A CURA é o Conversador nunca ter visto
 * esse vocabulário — e isso só acontece tirando as ferramentas de escrita dele,
 * porque foi pelo NOME delas que o vazamento voltou depois de a descrição ser
 * limpa (`crm_list_webhook_sources`, medido). Nome de ferramenta é contrato de
 * wire e não se renomeia; só se fecha não mostrando.
 *
 * O sinal de sucesso do passo 6 é o vazamento medido em 30% ir a zero **por
 * ausência, não por filtro**.
 *
 * ═══ A REGRA QUE IMPEDE O BURACO ═══
 *
 * Uma capacidade só muda de dono **quando o novo dono existe**. Concretamente:
 * a ferramenta nativa sai do Conversador apenas se o Operador estiver ligado
 * E tiver, marcado na tela, um equivalente que faça a mesma coisa.
 *
 * Sem essa condição, ligar o Operador e esquecer de marcar `crm_move_lead_stage`
 * faria o funil parar de andar — em silêncio, que é o modo de falha que este
 * épico inteiro existe para combater. Tirar a capacidade de um lado sem
 * garantir o outro não é separar papéis: é perder a capacidade.
 *
 * ═══ O QUE NÃO SAI, E POR QUÊ (medido) ═══
 *
 * `save_lead_note`, `open_human_case` e `provide_case_update` **não têm
 * equivalente no catálogo MCP** — verificado contra `TOOL_CATALOG`. Tirá-las
 * deixaria a capacidade órfã, então elas ficam com o Conversador até que alguém
 * as exponha no catálogo. A dívida está declarada, não escondida.
 *
 * `request_human_handoff` fica de propósito, e não por falta de equivalente: ela
 * existe no catálogo, mas está em `BLOCKED_TOOL_IDS` porque a variante do
 * catálogo NÃO silencia o harness. Além disso, passar a conversa para uma pessoa
 * é decisão sobre a CONVERSA, com efeito imediato — adiá-la para o turno
 * seguinte deixaria o assistente respondendo depois de o lead pedir um humano,
 * num caminho que a Meta fiscaliza.
 */

/**
 * Ferramenta nativa do Conversador → as do catálogo que fazem a mesma coisa.
 *
 * Só entra aqui o que TEM equivalente. A ausência de uma entrada é a afirmação
 * de que aquela capacidade não pode mudar de dono ainda — e é por isso que a
 * tabela é o lugar certo para essa decisão morar: acrescentar uma linha é a
 * mesma ação de decidir que o Operador passou a cobri-la.
 */
export const EQUIVALENTE_NO_OPERADOR: Readonly<Record<string, readonly string[]>> = {
  update_lead_state: ['crm_move_lead_stage', 'crm_update_lead'],
  schedule_followup: ['crm_schedule_followup'],
};

/**
 * Ferramentas do CATÁLOGO que servem para cuidar da operação, não para conversar
 * com um cliente.
 *
 * ═══ POR QUE ESTA LISTA EXISTE, com número ═══
 *
 * Medido em 2026-08-06 (RELATORIO-passo6.md), ferramentas EXECUTADAS contra
 * dados reais, controle calibrado em 30,0%:
 *
 *   com todas as capacidades ......... 3/10 = 30,0%
 *   sem estas sete ................... 1/10 = 10,0%
 *
 * Os dois vazamentos que sumiram vinham do DADO que elas devolvem —
 * `unsafe_url:https_required` e `admin`/`manager` + UUIDs. Não do nome nem da
 * descrição: do resultado. É a porta 3, a que "não mostrar a ferramenta" só
 * fecha tirando a ferramenta.
 *
 * ═══ O QUE NÃO ENTRA, E POR QUÊ ═══
 *
 * `crm_list_pipelines`, `crm_list_stages` e `crm_list_tags` FICAM com o
 * Conversador: saber em que etapa o lead está é contexto de CONVERSA. Tirá-las
 * deixaria o agente respondendo sem saber onde a pessoa está no funil — trocaria
 * um vazamento por um atendimento pior, que é um mau negócio.
 */
export const CAPACIDADES_DE_OPERACAO: readonly string[] = [
  'crm_list_webhook_sources',
  'crm_list_webhook_source_events',
  'crm_list_automation_rules',
  'crm_list_automation_runs',
  'crm_set_automation_rule_active',
  'crm_list_team_members',
  'crm_list_message_templates',
];

/**
 * As ferramentas de CATÁLOGO que saem do Conversador neste turno.
 *
 * Aqui não há mapa de equivalência: é a MESMA ferramenta mudando de dono. A
 * condição continua sendo a mesma do resto do módulo — só sai se o Operador
 * estiver ligado e a tiver marcada, para que a capacidade nunca fique órfã.
 */
export function catalogoEntregueAoOperador(input: {
  operadorLigado: boolean;
  ferramentasDoOperador: readonly string[];
  ferramentasDoConversador: readonly string[];
}): string[] {
  if (!input.operadorLigado) return [];
  const doOperador = new Set(input.ferramentasDoOperador);
  return input.ferramentasDoConversador.filter(
    (t) => CAPACIDADES_DE_OPERACAO.includes(t) && doOperador.has(t),
  );
}

/**
 * As ferramentas nativas que o Conversador PERDE neste turno.
 *
 * Devolve vazio quando o papel está desligado — o comportamento de hoje, e o que
 * mantém intacto todo self-hoster que não ligou nada (`operator_enabled` nasce
 * `false`).
 */
export function capacidadesEntreguesAoOperador(input: {
  operadorLigado: boolean;
  ferramentasDoOperador: readonly string[];
}): string[] {
  if (!input.operadorLigado) return [];
  const doOperador = new Set(input.ferramentasDoOperador);
  return Object.entries(EQUIVALENTE_NO_OPERADOR)
    .filter(([, equivalentes]) => equivalentes.some((e) => doOperador.has(e)))
    .map(([nativa]) => nativa);
}
