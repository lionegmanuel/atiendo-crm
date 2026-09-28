import { beforeAll, describe, expect, it } from "vitest";

import { GOV_ORG, GOV_VIEWER, seedGov, sql } from "./gov-helpers";

/**
 * Migration 0149 — SECURITY DEFINER valida a ORGANIZAÇÃO de quem chamou.
 *
 * Veio de um relatório de segurança da comunidade (auditoria da v1.0.0). A
 * varredura da 0116 (hardening-definer-varredura.test.ts) pergunta "QUEM pode
 * executar esta função?"; nunca "a função confere DE QUAL organização é quem
 * executou?". São perguntas diferentes, e o furo vivia exatamente no vão entre
 * as duas: `emit_event` e `retrieve_top_k_chunks` são — corretamente —
 * executáveis por `authenticated`, e usavam o `p_organization_id` do ARGUMENTO
 * como único filtro de tenant. Rodando como `postgres`, contornavam a RLS.
 *
 * Este arquivo mede a pergunta que faltava, e mede as DUAS direções: o ataque
 * tem de falhar E o uso legítimo tem de continuar passando. Sem os controles
 * positivos, uma função que lançasse exceção SEMPRE (ou que não existisse)
 * deixaria esta suíte verde pelo motivo errado.
 */

/** Org vizinha (a vítima) — namespace próprio para não colidir com gov/rls-isolation. */
const VIZINHA_ORG = "dddddddd-0000-4000-8000-000000000001";
const VIZINHA_AGENT = "dddddddd-2222-4000-8000-000000000001";
const VIZINHA_SOURCE = "dddddddd-3333-4000-8000-000000000001";
const VIZINHA_KBV = "dddddddd-4444-4000-8000-000000000001";
const VIZINHA_CHUNK = "dddddddd-5555-4000-8000-000000000001";
const SEGREDO_VIZINHO = "SEGREDO DA ORG VIZINHA: tabela de precos interna";

/** Espelho da KB na org do GOV_VIEWER — serve de controle positivo de leitura. */
const CASA_AGENT = "dddddddd-2222-4000-8000-000000000002";
const CASA_SOURCE = "dddddddd-3333-4000-8000-000000000002";
const CASA_KBV = "dddddddd-4444-4000-8000-000000000002";
const CASA_CHUNK = "dddddddd-5555-4000-8000-000000000002";

const EMBEDDING = "array_fill(0.1::real, array[1536])::vector";

function seedKb(): void {
  sql(`
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${VIZINHA_ORG}', 'viz-inv', 'Vizinha Invariant Org', 'Vizinha Inv')
      on conflict do nothing;

    insert into public.ai_agents (id, organization_id, name, system_prompt) values
      ('${VIZINHA_AGENT}', '${VIZINHA_ORG}', 'Agente Vizinho', 'prompt vizinho'),
      ('${CASA_AGENT}',    '${GOV_ORG}',     'Agente Casa',    'prompt casa')
      on conflict do nothing;

    insert into public.ai_knowledge_sources (id, organization_id, agent_id, source_type, name, status) values
      ('${VIZINHA_SOURCE}', '${VIZINHA_ORG}', '${VIZINHA_AGENT}', 'faq', 'Fonte Vizinha', 'ready'),
      ('${CASA_SOURCE}',    '${GOV_ORG}',     '${CASA_AGENT}',    'faq', 'Fonte Casa',    'ready')
      on conflict do nothing;

    insert into public.ai_knowledge_versions (id, organization_id, agent_id, version_number, is_active) values
      ('${VIZINHA_KBV}', '${VIZINHA_ORG}', '${VIZINHA_AGENT}', 1, true),
      ('${CASA_KBV}',    '${GOV_ORG}',     '${CASA_AGENT}',    1, true)
      on conflict do nothing;

    insert into public.ai_chunks
      (id, organization_id, knowledge_source_id, kb_version_id, position, content,
       content_hash, token_count, embedding, metadata)
    values
      ('${VIZINHA_CHUNK}', '${VIZINHA_ORG}', '${VIZINHA_SOURCE}', '${VIZINHA_KBV}',
       0, '${SEGREDO_VIZINHO}', 'hash-viz', 9, ${EMBEDDING}, '{}'::jsonb),
      ('${CASA_CHUNK}', '${GOV_ORG}', '${CASA_SOURCE}', '${CASA_KBV}',
       0, 'conteudo da propria organizacao', 'hash-casa', 9, ${EMBEDDING}, '{}'::jsonb)
      on conflict do nothing;
  `);
}

/**
 * Roda `select` como o usuário dado e devolve `{ ok, stderr }`.
 * Diferente de `writeCountAs`, aqui interessa a exceção que a FUNÇÃO lança
 * (`caller_not_authorized_for_org`), não a negativa da RLS.
 */
function callAs(userId: string, select: string): { ok: boolean; stderr: string } {
  try {
    const out = sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
      ${select}
    `);
    return { ok: true, stderr: out };
  } catch (err) {
    return { ok: false, stderr: (err as { stderr?: string }).stderr ?? String(err) };
  }
}

beforeAll(() => {
  seedGov();
  seedKb();
});

describe("0149 — definer confere a organização de quem chamou", () => {
  it("CONTROLE: a RLS já barra o caminho DIRETO (senão o furo seria da tabela, não da função)", () => {
    const direto = callAs(
      GOV_VIEWER,
      `select count(*) from public.ai_chunks where organization_id = '${VIZINHA_ORG}';`,
    );
    expect(direto.ok).toBe(true);
    expect(direto.stderr.trim().endsWith("0")).toBe(true);
  });

  it("viewer NÃO emite evento na organização VIZINHA (emit_event)", () => {
    const r = callAs(
      GOV_VIEWER,
      `select public.emit_event('lead.moved', 'lead', null, '{}'::jsonb, '{}'::jsonb, '${VIZINHA_ORG}');`,
    );
    expect(r.ok).toBe(false);
    expect(r.stderr).toContain("caller_not_authorized_for_org");
  });

  it("viewer NÃO lê a base de conhecimento VIZINHA (retrieve_top_k_chunks)", () => {
    const r = callAs(
      GOV_VIEWER,
      `select content from public.retrieve_top_k_chunks('${VIZINHA_ORG}', '${VIZINHA_KBV}', ${EMBEDDING}, 5, -1);`,
    );
    expect(r.ok).toBe(false);
    expect(r.stderr).toContain("caller_not_authorized_for_org");
    // O segredo não pode ter saído nem junto da mensagem de erro.
    expect(r.stderr).not.toContain(SEGREDO_VIZINHO);
  });

  it("CONTROLE POSITIVO: viewer EMITE evento na PRÓPRIA organização", () => {
    const r = callAs(
      GOV_VIEWER,
      `select public.emit_event('lead.moved', 'lead', null, '{}'::jsonb, '{}'::jsonb, '${GOV_ORG}');`,
    );
    expect(r.ok).toBe(true);
  });

  it("CONTROLE POSITIVO: viewer LÊ a base de conhecimento da PRÓPRIA organização", () => {
    const r = callAs(
      GOV_VIEWER,
      `select content from public.retrieve_top_k_chunks('${GOV_ORG}', '${CASA_KBV}', ${EMBEDDING}, 5, -1);`,
    );
    expect(r.ok).toBe(true);
    expect(r.stderr).toContain("conteudo da propria organizacao");
  });

  it("CONTROLE POSITIVO: o worker (service_role, sem JWT) emite em qualquer organização", () => {
    // auth.uid() é null aqui — é o caminho de worker/cron/trigger, que NÃO pode
    // ter sido fechado pelo guard. Se este caso ficar vermelho, o produto parou.
    const out = sql(`
      set role service_role;
      select public.emit_event('worker.tick', 'system', null, '{}'::jsonb, '{}'::jsonb, '${VIZINHA_ORG}') is not null;
    `);
    expect(out.trim().endsWith("t")).toBe(true);
  });
});
