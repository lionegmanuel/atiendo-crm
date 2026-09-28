import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { sql } from "./gov-helpers";

/**
 * O relógio do silêncio (`crm_leads.last_activity_at`) só anda com INTERAÇÃO.
 *
 * Este arquivo mede COMPORTAMENTO, não a lista: insere uma atividade de cada
 * tipo e olha se o relógio andou. Conferir a lista contra si mesma seria medir
 * o mecanismo contra a própria definição — passaria mesmo com o `if` invertido.
 *
 * O DEFEITO QUE ELE GUARDA: `fn_update_last_activity_at` carimbava para
 * QUALQUER tipo, e `last_activity_at` é o relógio que decide o esfriamento. O
 * produtor do estado apagava o próprio estado ao registrá-lo — e 24h depois
 * repetia, virando uma máquina de ruído perpétua.
 *
 * ⚠️ TIPO NOVO DE ATIVIDADE → uma linha aqui, declarando o lado. Se você não
 * souber de que lado ele fica, a pergunta é: *uma linha desse tipo é instância
 * do que a métrica conta?* Constatar o silêncio não é quebrar o silêncio.
 *
 * ⚠️ CADA CASO VIVE INTEIRO DENTRO DE UMA TRANSAÇÃO REVERTIDA, e isso não é
 * capricho de higiene. A primeira versão criava os dados e os apagava num
 * `afterAll`; mesmo assim tornou o `gov-8-metrics` INTERMITENTE — ele roda
 * EXPLAIN e exige um índice no plano, os arquivos rodam em paralelo, e enquanto
 * meus doze leads existiam o planner via tabela grande o bastante para trocar
 * de caminho. Medido: sem este arquivo, 338 verdes em duas rodadas seguidas;
 * com ele, alternava. Teste que deixa lixo em tabela compartilhada não quebra o
 * vizinho — torna o vizinho INTERMITENTE, que é pior, porque some quando
 * alguém vai investigar. Com `rollback`, nada nunca existiu.
 */

/** `true` = quebra o silêncio; `false` = é observação e o relógio segue correndo. */
const TIPOS: Array<[tipo: string, quebraOSilencio: boolean, porque: string]> = [
  ["ai_turn", true, "a IA falou com o cliente"],
  ["note", true, "alguém registrou trabalho no negócio"],
  ["lead_edited", true, "humano mexeu nos dados"],
  ["stage_changed", true, "humano moveu o negócio"],
  ["next_action_approved", true, "humano decidiu agir"],
  ["send_vetoed", false, "o envio não chegou ao cliente"],
  ["handoff_triggered", false, "passar para humano é promessa, não atendimento"],
  ["next_action_dismissed", false, "decidiu NÃO agir: fica sem próximo passo"],
  ["lead_cooled", false, "É A OBSERVAÇÃO DO SILÊNCIO — o caso que motivou tudo"],
  ["lead_reactivated", false, "observação de sistema, ninguém falou com ninguém"],
];

/**
 * Roda o experimento inteiro numa transação que NUNCA commita e devolve o
 * relógio antes e depois. Os ids vêm do Node para o script dispensar
 * `returning` — nada a extrair da saída do psql, uma fonte de erro a menos.
 */
function medirRelogio(tipo: string): { antes: string; depois: string } {
  const org = randomUUID();
  const pipe = randomUUID();
  const stage = randomUUID();
  const lead = randomUUID();
  // O ator é `system` com evidence preenchida porque `ai_turn` de ator 'ai' cai
  // na constraint de evidência (wave 3). O experimento é sobre o RELÓGIO — o
  // INSERT não pode morrer por um motivo que não é o que está sendo medido.
  const saida = sql(`
    begin;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${org}', 'relogio-${tipo}', 'Relogio ${tipo}', 'Relogio ${tipo}');
    insert into public.crm_pipelines (id, organization_id, name, slug)
      values ('${pipe}', '${org}', 'Relogio', 'relogio');
    insert into public.crm_stages (id, organization_id, pipeline_id, name, slug, position)
      values ('${stage}', '${org}', '${pipe}', 'Novo', 'novo', 1000);
    insert into public.crm_leads
      (id, organization_id, pipeline_id, stage_id, title, last_activity_at, position_in_stage)
      values ('${lead}', '${org}', '${pipe}', '${stage}', 'frio',
              now() - interval '30 days', 1000);

    select last_activity_at from public.crm_leads where id = '${lead}';

    insert into public.crm_lead_activities
      (organization_id, lead_id, type, source_module, source_id, performed_at, actor_kind, evidence)
      values ('${org}', '${lead}', '${tipo}', 'crm', '${lead}', now(), 'system', '{}'::jsonb);

    select last_activity_at from public.crm_leads where id = '${lead}';
    rollback;
  `);
  const linhas = saida.split("\n").filter((l) => l.includes("+00"));
  return { antes: linhas[0] ?? "", depois: linhas[1] ?? "" };
}

describe("0079 · o relógio do silêncio", () => {
  // ESTATÍSTICA FRESCA APÓS CADA CASO, e isto não é higiene: `rollback` desfaz
  // as linhas mas deixa TUPLA MORTA, o que mexe em `reltuples` e dispara
  // autoanalyze em hora imprevisível. O `gov-8-metrics` mede ESCOLHA DE PLANO
  // numa tabela minúscula (`enable_seqscan = off` é penalidade de custo, não
  // proibição), então basta a estatística oscilar para ele trocar de índice e
  // reprovar — num arquivo que ninguém tocou. Medido: sem este arquivo, 338
  // verdes em duas rodadas seguidas; com ele e sem este `analyze`, alternava.
  //
  // O conserto de causa raiz é o EXPLAIN rodar com estatística recém-calculada,
  // mas `tests/invariants/**` é congelado por hook e invariante mal-escrito vai
  // para a inbox, não para o Edit — está registrado em loop/INBOX.md. Aqui fica
  // a contenção do lado de quem causou a perturbação.
  afterEach(() => {
    sql(`analyze public.crm_leads;`);
  });

  for (const [tipo, quebraOSilencio, porque] of TIPOS) {
    it(`${tipo}: ${quebraOSilencio ? "ANDA" : "não anda"} — ${porque}`, () => {
      const { antes, depois } = medirRelogio(tipo);
      // As duas leituras têm de EXISTIR: comparar "" com "" passaria em
      // qualquer cenário, inclusive com o INSERT falhando calado.
      expect(antes).not.toBe("");
      expect(depois).not.toBe("");
      if (quebraOSilencio) expect(depois).not.toBe(antes);
      else expect(depois).toBe(antes);
    });
  }

  it("o ciclo NÃO se autodestrói: constatar o silêncio não o quebra", () => {
    // A composição, que nenhum caso isolado prova: 30 dias de silêncio continuam
    // 30 dias DEPOIS de o sistema registrar que o negócio esfriou. Era aqui que
    // o produtor se aniquilava — e 24h depois faria tudo de novo, para sempre.
    const { antes, depois } = medirRelogio("lead_cooled");
    const idade = (iso: string): number => (Date.now() - new Date(iso).getTime()) / 3_600_000;
    expect(idade(antes)).toBeGreaterThan(700); // ~30 dias
    expect(depois).toBe(antes);
  });
});
