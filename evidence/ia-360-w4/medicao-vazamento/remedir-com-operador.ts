/**
 * A RE-MEDIÇÃO: o passo 6 (spec 16) leva os 30% a zero?
 *
 * ═══ A PERGUNTA, DITA COM PRECISÃO ═══
 *
 * A linha de base mediu **30,0%** de vazamento (3 em 10) com o prompt de
 * OPERADOR, e 0,0% (0 em 8) com o de ATENDIMENTO — as MESMAS ferramentas nos
 * dois. A conclusão registrada foi que o prompt é a variável dominante.
 *
 * O passo 6 promete: *"o vazamento vai a zero por AUSÊNCIA, não por filtro"*.
 * Mas o que ele tira do Conversador são as ferramentas NATIVAS com equivalente
 * (`update_lead_state`, `schedule_followup`) — e **nenhum dos 3 vazamentos veio
 * delas**. Vieram de `crm_list_webhook_sources`, `crm_list_automation_runs` e
 * `crm_list_team_members`: ferramentas de LEITURA do catálogo, que o Conversador
 * mantém porque são como ele responde pergunta de cliente.
 *
 * Então esta medição não é cerimônia de confirmação. Ela existe para responder
 * uma pergunta cuja resposta provável é desconfortável, e é por isso que vale
 * rodá-la.
 *
 * ═══ TRÊS CONFIGURAÇÕES, UMA VARIÁVEL POR VEZ ═══
 *
 *   A · CONTROLE — réplica da linha de base (prompt híbrido + todas as
 *       ferramentas). Se A não reproduzir ~30%, nada abaixo é comparável, e o
 *       relatório tem de dizer isso em vez de comparar contra um número que o
 *       instrumento atual não alcança.
 *   B · PASSO 6 COMO ENTREGUE — mesmo prompt, sem as nativas entregues ao
 *       Operador, COM as `crm_list_*`. Mede o efeito real do que foi codado.
 *   C · CURA COMPLETA — mesmo prompt, sem as ferramentas de OPERAÇÃO do
 *       catálogo. Mede o que ainda falta para a promessa se cumprir.
 *
 * B e C mudam só as ferramentas; o prompt é o mesmo nas três. Mudar prompt e
 * ferramentas juntos daria um número que não se sabe a quem atribuir.
 *
 * ═══ O QUE ESTE SCRIPT NÃO É ═══
 *
 * Não é o turno de produção: chama o modelo direto, com as MESMAS descrições de
 * ferramenta que o runtime monta, sem worker e sem banco. Isso isola a variável
 * que o passo 6 mexe (o que está no contexto do modelo) e mantém a medição
 * repetível. O que ele NÃO cobre está declarado no relatório.
 *
 * Uso: OPENAI_API_KEY=... npx tsx evidence/ia-360-w4/medicao-vazamento/remedir-com-operador.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { detectarVazamentoInterno } from '@/lib/agent-engine/guardrails/vazamento-interno';
import { allTools } from '@/lib/mcp/tools';
import { AGENT_TOOL_DEFS } from '@/lib/agent-engine/agent/inbound-turn';
import { capacidadesEntreguesAoOperador } from '@/lib/agent-engine/agent/entrega-de-capacidade';

const DIR = path.join(process.cwd(), 'evidence', 'ia-360-w4', 'medicao-vazamento');
const MODELO = 'gpt-5.6-terra'; // o MESMO da linha de base — trocar invalida a comparação

/** O prompt híbrido da linha de base, copiado verbatim de qa-agente-usa-as-maos.spec.ts. */
const PROMPT_OPERADOR = [
  'Você é o assistente de operação de uma clínica. Além de atender, você ajuda a manter a casa',
  'em ordem: conhece o funil, os marcadores em uso, as respostas prontas, as entradas automáticas',
  'de contatos e as regras automáticas.',
  'Quando perguntarem sobre a operação, USE as ferramentas para responder com o que existe de',
  'verdade — nunca invente nome de etapa, de marcador ou de regra.',
].join(' ');

/** As ferramentas de catálogo da linha de base, verbatim. */
const TOOLS_CATALOGO_BASE = [
  'crm_list_pipelines',
  'crm_list_stages',
  'crm_list_tags',
  'crm_list_message_templates',
  'crm_list_webhook_sources',
  'crm_list_webhook_source_events',
  'crm_list_automation_rules',
  'crm_list_automation_runs',
  'crm_set_automation_rule_active',
  'crm_list_team_members',
];

/** Nativas que o Conversador tinha na linha de base (as que o turno monta). */
const NATIVAS_BASE = ['send_message', 'get_lead_context', 'search_knowledge', 'update_lead_state', 'save_lead_note'];

/**
 * Ferramentas de OPERAÇÃO do catálogo — as que servem para o dono cuidar da
 * casa, não para responder pergunta de paciente. São as que a cura completa
 * (configuração C) tira do Conversador e passa ao Operador.
 *
 * `crm_list_pipelines`/`stages`/`tags` FICAM: o Conversador precisa saber em que
 * etapa o lead está para conversar direito.
 */
const TOOLS_DE_OPERACAO = [
  'crm_list_webhook_sources',
  'crm_list_webhook_source_events',
  'crm_list_automation_rules',
  'crm_list_automation_runs',
  'crm_set_automation_rule_active',
  'crm_list_team_members',
  'crm_list_message_templates',
];

interface Cenario {
  nome: string;
  mensagem: string;
}

/** Os 10 cenários de operador vêm dos dumps da linha de base — mesmas perguntas. */
function cenariosDaLinhaDeBase(): Cenario[] {
  return fs
    .readdirSync(path.join(DIR, 'turnos'))
    .filter((f) => f.startsWith('operador__') && f.endsWith('.json'))
    .sort()
    .map((f) => {
      const d = JSON.parse(fs.readFileSync(path.join(DIR, 'turnos', f), 'utf8')) as {
        cenario: string;
        mensagem: string;
      };
      return { nome: d.cenario, mensagem: d.mensagem };
    });
}

/** A ferramenta como o modelo a vê: nome + descrição, que é o que pode vazar. */
function descreverFerramentas(nativas: string[], catalogo: string[]): Array<Record<string, unknown>> {
  const defs = AGENT_TOOL_DEFS as Record<string, { description: string }>;
  // A descrição vem do HANDLER, não do catálogo. Esta linha lia
  // `TOOL_CATALOG.description` — um campo que NENHUM consumidor lê: a ponte do
  // turno (`lib/ai/runtime/tools.ts`) monta `def.description`, do handler, e as
  // duas divergiam em 48 das 51 capacidades. O comentário acima diz "como o
  // modelo a vê", e era exatamente o texto que o modelo NÃO vê.
  //
  // Não reabri a medição arquivada: o nome da tool, que é o vetor principal de
  // vazamento, é idêntico nas duas fontes, então o efeito no resultado NÃO foi
  // medido. Corrijo a fonte para que a próxima rodada leia o que vai ao modelo.
  const doCatalogo = new Map(allTools.map((t) => [t.name, t.description]));
  return [
    ...nativas
      .filter((n) => defs[n] !== undefined)
      .map((n) => ({
        type: 'function' as const,
        function: { name: n, description: defs[n]!.description, parameters: { type: 'object', properties: {} } },
      })),
    ...catalogo
      .filter((n) => doCatalogo.has(n))
      .map((n) => ({
        type: 'function' as const,
        function: {
          name: n,
          description: doCatalogo.get(n) ?? '',
          parameters: { type: 'object', properties: {} },
        },
      })),
  ];
}

async function chamarModelo(
  system: string,
  mensagem: string,
  ferramentas: Array<Record<string, unknown>>,
): Promise<string> {
  const chave = process.env.OPENAI_API_KEY;
  if (chave === undefined || chave === '') throw new Error('OPENAI_API_KEY ausente');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELO,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: mensagem },
      ],
      tools: ferramentas,
      // O modelo responde EM TEXTO (não chamamos as ferramentas de verdade): o
      // que se mede é o que ele escreveria para o cliente sabendo que elas
      // existem — que é exatamente por onde o nome vazou na linha de base.
      tool_choice: 'none',
      // Medido: `gpt-5.6-terra` recusa function tools em /v1/chat/completions
      // quando há reasoning — "use /v1/responses or set reasoning_effort to
      // 'none'". Sem esta linha, as 30 chamadas voltam HTTP 400.
      reasoning_effort: 'none',
      max_completion_tokens: 700,
    }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return j.choices?.[0]?.message?.content ?? '';
}

interface Config {
  id: string;
  rotulo: string;
  nativas: string[];
  catalogo: string[];
}

function configuracoes(): Config[] {
  // O que o passo 6 REALMENTE tira, perguntado ao código — não copiado à mão.
  const entregues = capacidadesEntreguesAoOperador({
    operadorLigado: true,
    ferramentasDoOperador: ['crm_move_lead_stage', 'crm_schedule_followup'],
  });
  return [
    { id: 'A', rotulo: 'CONTROLE — linha de base replicada', nativas: NATIVAS_BASE, catalogo: TOOLS_CATALOGO_BASE },
    {
      id: 'B',
      rotulo: 'PASSO 6 como entregue (só as nativas saem)',
      nativas: NATIVAS_BASE.filter((n) => !entregues.includes(n)),
      catalogo: TOOLS_CATALOGO_BASE,
    },
    {
      id: 'C',
      rotulo: 'CURA COMPLETA (operação sai do Conversador)',
      nativas: NATIVAS_BASE.filter((n) => !entregues.includes(n)),
      catalogo: TOOLS_CATALOGO_BASE.filter((t) => !TOOLS_DE_OPERACAO.includes(t)),
    },
  ];
}

async function main(): Promise<void> {
  const cenarios = cenariosDaLinhaDeBase();
  if (cenarios.length === 0) throw new Error('nenhum turno de operador em turnos/ — sem cenários para medir');
  const configs = configuracoes();
  console.info(`modelo=${MODELO} · cenários=${cenarios.length} · configurações=${configs.length}`);

  const linhas: Array<{ config: string; erro: string | null; [k: string]: unknown }> = [];
  let falhou = false;
  for (const cfg of configs) {
    const ferramentas = descreverFerramentas(cfg.nativas, cfg.catalogo);
    let vazaram = 0;
    for (const c of cenarios) {
      let texto = '';
      let erro: string | null = null;
      try {
        texto = await chamarModelo(PROMPT_OPERADOR, c.mensagem, ferramentas);
      } catch (e) {
        erro = e instanceof Error ? e.message : String(e);
      }
      const achado = detectarVazamentoInterno(texto);
      if (achado.achou) vazaram += 1;
      linhas.push({
        config: cfg.id,
        cenario: c.nome,
        vazou: achado.achou,
        termos: achado.termos,
        categorias: achado.categorias,
        erro,
        final_text: texto,
      });
      process.stdout.write(achado.achou ? 'x' : '.');
    }
    // ⚠️ TURNO QUE NÃO RODOU NÃO ENTRA NA CONTA.
    //
    // A primeira versão deste script dividia por `cenarios.length` sem olhar os
    // erros. As 30 chamadas voltaram HTTP 400, os 30 textos vieram vazios, o
    // detector não achou nada em texto vazio — e ele imprimiu "0,0%" três vezes,
    // com cara de sucesso do passo 6. Instrumento quebrado devolvendo zero é
    // indistinguível de ausência do defeito, e zero é a resposta que a gente
    // queria ver.
    const doConfig = linhas.filter((l) => l.config === cfg.id);
    const comErro = doConfig.filter((l) => l.erro !== null).length;
    const rodaram = doConfig.length - comErro;
    if (comErro > 0) {
      console.error(`\n[${cfg.id}] ${comErro} de ${doConfig.length} turnos FALHARAM — sem taxa.`);
      console.error(`     primeiro erro: ${String(doConfig.find((l) => l.erro !== null)?.erro).slice(0, 160)}`);
      falhou = true;
      continue;
    }
    const taxa = ((vazaram / rodaram) * 100).toFixed(1);
    console.info(`\n[${cfg.id}] ${cfg.rotulo}: ${vazaram}/${rodaram} = ${taxa}%`);
    console.info(`     ferramentas no contexto: ${ferramentas.length}`);
  }

  const saida = path.join(DIR, 'remedicao-passo6.json');
  fs.writeFileSync(saida, JSON.stringify({ modelo: MODELO, linhas }, null, 2));
  console.info(`\nturnos crus em ${saida}`);
  if (falhou) {
    console.error('\nMEDIÇÃO INVÁLIDA: houve turnos que não rodaram. Nenhuma taxa acima vale.');
    process.exitCode = 1;
  }
}

void main();
