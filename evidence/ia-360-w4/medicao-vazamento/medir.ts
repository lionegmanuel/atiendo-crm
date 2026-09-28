/**
 * A MEDIÇÃO: passa o `final_text` de cada turno gravado pelo detector
 * determinístico `detectarVazamentoInterno` e imprime a taxa por prompt.
 *
 * Por que ler o dump em vez de chamar o detector dentro do spec: o detector é a
 * MESMA função que o `internalVocabularyGate` chama (o gate é um invólucro puro
 * dela — ver `lib/agent-engine/guardrails/before-send.ts`). Medir aqui, sobre o
 * texto cru gravado, mantém a medição repetível sem gastar token de novo, e
 * deixa o instrumento de coleta separado do instrumento de contagem.
 *
 * ⚠️ O QUE ESTE NÚMERO É: vazamento CRU. O endpoint que produziu os turnos
 * (`/versions/[vid]/test` → `lib/ai/runtime/agent.ts`) NÃO passa por
 * `runBeforeSend` — nenhum gate rodou. Ver `RELATORIO.md` ao lado.
 *
 * Uso: npx tsx evidence/ia-360-w4/medicao-vazamento/medir.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import { detectarVazamentoInterno } from '@/lib/agent-engine/guardrails/vazamento-interno';

const TURNOS = path.join(process.cwd(), 'evidence', 'ia-360-w4', 'medicao-vazamento', 'turnos');

interface Turno {
  prompt_kind: string;
  cenario: string;
  mensagem: string;
  rodou: boolean;
  status?: string;
  final_text?: string | null;
  ferramentas?: string[];
  tool_calls?: Array<Record<string, unknown>>;
  http_status?: number;
  corpo?: string;
  medido_em: string;
}

/**
 * Nomes de ferramenta derivados do `tool_calls` CRU, não do campo `ferramentas`.
 *
 * O primeiro turno desta medição foi coletado antes da correção da extração no
 * spec (que lia o nome no nível do PASSO, onde ele não está) e gravou `?`. O dado
 * verdadeiro sempre esteve no dump — derivar aqui recupera o turno sem re-rodar o
 * modelo. Re-rodar seria jogar o dado de novo e ficar com o segundo resultado.
 */
function ferramentasDe(t: Turno): string[] {
  const passos = Array.isArray(t.tool_calls) ? t.tool_calls : [];
  return passos.flatMap((p) => {
    const doPasso = Array.isArray(p.tool_calls) ? (p.tool_calls as Array<Record<string, unknown>>) : [];
    return doPasso.map((c) => String(c.tool_name ?? c.tool ?? c.name ?? '?'));
  });
}

const arquivos = fs.readdirSync(TURNOS).filter((f) => f.endsWith('.json')).sort();
const turnos = arquivos.map((f) => JSON.parse(fs.readFileSync(path.join(TURNOS, f), 'utf8')) as Turno);

interface Linha {
  t: Turno;
  achou: boolean;
  termos: string[];
  categorias: string[];
}

const linhas: Linha[] = [];
for (const t of turnos) {
  if (!t.rodou) {
    linhas.push({ t, achou: false, termos: [], categorias: [] });
    continue;
  }
  const r = detectarVazamentoInterno(t.final_text ?? '');
  linhas.push({ t, achou: r.achou, termos: r.termos, categorias: r.categorias });
}

function bloco(rotulo: string, sel: Linha[]): void {
  // Denominador = turnos que DE FATO produziram texto. Turno que não rodou entra
  // no relatório como não-medido, nunca como "não vazou" (zero de instrumento
  // morto é indistinguível de zero medido).
  const rodados = sel.filter((l) => l.t.rodou);
  const naoRodou = sel.filter((l) => !l.t.rodou);
  const vazaram = rodados.filter((l) => l.achou);
  const taxa = rodados.length === 0 ? 'n/d' : `${((vazaram.length / rodados.length) * 100).toFixed(1)}%`;
  console.log(`\n=== ${rotulo} ===`);
  console.log(`turnos rodados: ${rodados.length}   com vazamento: ${vazaram.length}   TAXA: ${taxa}`);
  if (naoRodou.length > 0) {
    console.log(`NÃO rodaram (fora do denominador): ${naoRodou.map((l) => l.t.cenario).join(', ')}`);
  }
  for (const l of rodados) {
    const marca = l.achou ? 'VAZOU' : '  ok ';
    const detalhe = l.achou ? `  termos=[${l.termos.join(', ')}]  categorias=[${l.categorias.join(',')}]` : '';
    console.log(`  ${marca} ${l.t.cenario}${detalhe}`);
    const fs2 = ferramentasDe(l.t);
    console.log(`        ferramentas: ${fs2.length ? fs2.join(' → ') : 'NENHUMA'}`);
  }
}

bloco('PROMPT DE OPERADOR', linhas.filter((l) => l.t.prompt_kind === 'operador'));
bloco('PROMPT DE ATENDIMENTO (voz de paciente)', linhas.filter((l) => l.t.prompt_kind === 'atendimento'));
bloco('TOTAL', linhas);

// As frases exatas que vazaram, com o termo destacado — é o material cru do relatório.
console.log('\n\n=== FRASES QUE VAZARAM (trecho ao redor de cada termo) ===');
for (const l of linhas.filter((x) => x.achou)) {
  console.log(`\n--- ${l.t.prompt_kind} :: ${l.t.cenario} ---`);
  const texto = l.t.final_text ?? '';
  for (const termo of l.termos) {
    const i = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').indexOf(termo.toLowerCase());
    const trecho = i < 0 ? '(termo é rótulo de regra; ver texto completo)' : texto.slice(Math.max(0, i - 90), i + 90).replace(/\n/g, ' ');
    console.log(`  [${termo}] …${trecho}…`);
  }
}
