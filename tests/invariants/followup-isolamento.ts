import type pg from "pg";

/**
 * Isolamento de fixture dos invariantes de follow-up.
 *
 * POR QUE existe: `fn_claim_due_followup_enrollments` é GLOBAL por desenho — não
 * recebe organização, porque em produção o worker atende todas de uma vez. E
 * `tests/invariants/**` compartilha UM Postgres que não é resetado entre
 * arquivos (`vitest.db.config.ts`, `fileParallelism: false`). Um enrollment
 * DEVIDO deixado por um arquivo anterior entra no `runFollowupTick({limit:N})`
 * do arquivo seguinte, consome vaga do lote e conta nos agregados
 * (`claimed`/`scheduled`/`advanced`/`jobs.length`) que os testes comparam com
 * números exatos.
 *
 * MEDIDO nesta base: rodando os cinco arquivos de follow-up que precedem
 * `followup-turn-bridge` na ordem alfabética, sobram **10 enrollments devidos**
 * — mais que o `limit: 5` que aquele arquivo usa. Ou seja: o tick do teste
 * seguinte pode encher o lote inteiro com trabalho alheio e não reclamar NENHUM
 * dos seus. É a assinatura do vermelho intermitente que a Wave 4 viu em
 * `followup-turn-bridge` e `followup-reactivity` no mesmo SHA: os dois arquivos
 * são exatamente os que rodavam tick SEM isolar a fixture (o
 * `followup-engine.test.ts` já limpava desde a Task 5.2 — o conserto foi
 * aplicado numa ocorrência e as irmãs ficaram de fora).
 *
 * Também limpa `agent_inbox_items`: `markDead` grava um aviso por enrollment
 * morto, e testes que contam esses avisos falham na SEGUNDA execução contra o
 * mesmo banco. No CI isso não aparecia porque o container nasce e morre a cada
 * run — mas é a mesma classe de defeito, e esconde-se do gate exatamente por
 * isso.
 *
 * `followup_enrollment_events.enrollment_id` tem `on delete cascade` (migration
 * 0054): apagar os enrollments já leva os eventos junto.
 */
export async function isolarFixtureDeFollowup(pool: pg.Pool): Promise<void> {
  await pool.query(`delete from followup_enrollments`);
  await pool.query(`delete from agent_inbox_items where kind = 'followup_dead'`);
}
