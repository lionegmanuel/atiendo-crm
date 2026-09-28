/**
 * Sync do espelho local dos templates hospedados na Meta (migration 0088).
 *
 * O template VIVE NA META — este módulo não cria, não edita e não é dono de nada:
 * ele **espelha**. Toda coluna sai do que a Graph API devolveu, e `contract_hash` é
 * DERIVADO de `components` por `hashContract`, nunca redigitado (Global Constraint
 * nº 1 do plano da Fase 3a: se aparecer em algum lugar um campo "quantidade de
 * parâmetros", o desenho vazou).
 *
 * ─── A separação puro / casca, e por que ela não é estética ───
 * `templatesToRows` e `planSync` são PUROS: recebem o payload da API e o que já
 * existe no banco, devolvem linhas e um plano. `syncTemplates` é a casca — faz
 * `fetch`, lê o que existe, escreve. Toda a decisão perigosa (o que desabilitar) mora
 * no lado puro, que é testável contra a fixture real; a casca não decide nada.
 */
import { createAdminClient } from "@/lib/supabase/admin";

import { hashContract } from "./contract-hash";
import { graphBaseUrl } from "./graph-base";
import { normalizeRejectedReason as rejectedReason } from "./webhook";

/**
 * O vocabulário que a Meta usa hoje. **A coluna `status` do banco NÃO tem CHECK e
 * este tipo NÃO é uma trava** — é conhecimento compartilhado (rótulo de tela, e a
 * constante que o emissor usa em vez de string literal). Quem define o vocabulário é
 * a Meta, que acrescenta estado sem avisar; por isso a linha carrega `status: string`
 * e o valor desconhecido ATRAVESSA em vez de virar `23514` no meio do sync. Ver o
 * cabeçalho da migration 0088 e o de `tests/invariants/vocabulario-banco-x-typescript.test.ts`
 * (esta coluna fica deliberadamente FORA dele).
 */
export const META_TEMPLATE_STATUS = [
  "APPROVED",
  "PENDING",
  "REJECTED",
  "PAUSED",
  "DISABLED",
  "IN_APPEAL",
  "PENDING_DELETION",
] as const;

export type MetaTemplateStatus = (typeof META_TEMPLATE_STATUS)[number];

/** O estado de quem sumiu da Meta. Constante compartilhada — nunca o literal solto. */
export const TEMPLATE_STATUS_DISABLED: MetaTemplateStatus = "DISABLED";

/** Uma linha de `public.meta_templates`, sem as colunas que o banco preenche. */
export interface MetaTemplateRow {
  organization_id: string;
  waba_id: string;
  name: string;
  language: string;
  status: string;
  category: string | null;
  rejected_reason: string | null;
  quality_score: string | null;
  components: unknown;
  contract_hash: string;
  parameter_format: string;
}

/** O que já existe no banco, na projeção mínima que o plano precisa. */
export interface LocalTemplate {
  name: string;
  language: string;
  status: string;
  contract_hash: string;
}

export interface TemplateKey {
  name: string;
  language: string;
}

export interface SyncCounts {
  inserted: number;
  updated: number;
  unchanged: number;
  disabled: number;
}

export interface SyncPlan {
  disable: TemplateKey[];
  counts: SyncCounts;
}

interface GraphTemplate {
  name?: unknown;
  language?: unknown;
  status?: unknown;
  category?: unknown;
  rejected_reason?: unknown;
  quality_score?: unknown;
  parameter_format?: unknown;
  components?: unknown;
}

const key = (t: TemplateKey): string => `${t.name} ${t.language}`;

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/**
 * `quality_score` chega como OBJETO na Graph API (`{score, date}`), não como string —
 * medido contra a WABA real. Guardar o objeto inteiro obrigaria a tela a conhecer o
 * formato interno da Meta para mostrar uma palavra.
 */
function qualityScore(v: unknown): string | null {
  if (typeof v === "string") return str(v);
  if (v && typeof v === "object" && "score" in v) return str((v as { score: unknown }).score);
  return null;
}

// `rejectedReason` mora em ./webhook.ts — dois escritores, uma regra.

/**
 * Payload da Graph API → linhas do espelho.
 *
 * @throws se o payload não tem `data` (resposta de erro, token vencido, WABA errada).
 *   Devolver `[]` em silêncio seria pior que estourar: `planSync` leria "nenhum
 *   template existe na Meta" e o sync seguinte marcaria o espelho inteiro como
 *   obsoleto — uma falha de rede apagando a configuração de todo mundo.
 */
export function templatesToRows(
  payload: unknown,
  organizationId: string,
  wabaId: string,
): MetaTemplateRow[] {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    throw new Error(
      `templatesToRows: resposta da Graph API sem \`data\` — ${JSON.stringify(payload)?.slice(0, 200)}`,
    );
  }

  return data.map((raw: GraphTemplate) => {
    const name = str(raw.name);
    const language = str(raw.language);
    if (!name || !language) {
      throw new Error(
        `templatesToRows: template sem name/language — a chave do espelho é o par (name, language)`,
      );
    }
    // POSITIONAL quando ausente: é o que a Meta assume, e o campo só vem quando
    // pedido explicitamente nos `fields` (medido). NAMED lido como POSITIONAL
    // montaria o payload de envio sem `parameter_name` — o 132012 pela porta dos fundos.
    const parameterFormat = raw.parameter_format === "NAMED" ? "NAMED" : "POSITIONAL";
    const components = raw.components ?? [];

    return {
      organization_id: organizationId,
      waba_id: wabaId,
      name,
      language,
      status: str(raw.status) ?? "",
      category: str(raw.category),
      rejected_reason: rejectedReason(raw.rejected_reason),
      quality_score: qualityScore(raw.quality_score),
      components,
      // Derivado, sempre. E com o `parameter_format` JUNTO: os mesmos `components`
      // sob formatos diferentes exigem payloads diferentes, logo hashes diferentes.
      contract_hash: hashContract(components, parameterFormat),
      parameter_format: parameterFormat,
    };
  });
}

/**
 * O que mudou entre a Meta e o espelho.
 *
 * ⚠️ **Template que sumiu da Meta é MARCADO `DISABLED`, nunca apagado.** Apagar
 * quebraria em silêncio toda config de disparo que aponta para ele — a linha some, e
 * o erro aparece meses depois no envio. Marcado, ele vira item VISÍVEL na tela e no
 * `bindingState` (`missing`), que é o invariante 6 do sistema vivo.
 *
 * ⚠️ **Payload vazio não desabilita nada.** Uma WABA recém-trocada, um token de outra
 * conta ou uma resposta de página única devolvem zero templates sem devolver erro — e
 * "zero templates" é indistinguível de "apagaram todos". Entre reportar obsolescência
 * falsa e não reportar uma verdadeira, o custo é assimétrico: o primeiro desliga o
 * alarme de todo mundo.
 */
export function planSync(rows: MetaTemplateRow[], existing: LocalTemplate[]): SyncPlan {
  const remoto = new Map(rows.map((r) => [key(r), r]));
  const local = new Map(existing.map((e) => [key(e), e]));

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  for (const r of rows) {
    const antes = local.get(key(r));
    if (!antes) inserted += 1;
    else if (antes.contract_hash !== r.contract_hash || antes.status !== r.status) updated += 1;
    else unchanged += 1;
  }

  const disable =
    rows.length === 0
      ? []
      : existing
          .filter((e) => !remoto.has(key(e)) && e.status !== TEMPLATE_STATUS_DISABLED)
          .map((e) => ({ name: e.name, language: e.language }));

  return { disable, counts: { inserted, updated, unchanged, disabled: disable.length } };
}

export interface SyncInput {
  organizationId: string;
  wabaId: string;
  /** Token da Graph API. Resolvido de fonte confiável pelo chamador, nunca do body. */
  token: string;
  /**
   * Ex.: `v22.0`. Explícito de propósito — ver o comentário de `fetchAllTemplates`.
   * É a VERSÃO que vai na base; o HOST vem do knob da instalação.
   */
  graphVersion: string;
}

const FIELDS =
  "name,language,status,category,parameter_format,rejected_reason,quality_score,components";

/**
 * Busca TODAS as páginas. Não é zelo: a WABA de teste, com 5 templates e `limit=3`,
 * já devolve `paging.next` — e uma busca de página única combinada com o
 * `disable` de `planSync` marcaria como sumido todo template a partir do 26º.
 *
 * O cursor é reaproveitado na MINHA url em vez de seguir `paging.next` direto porque
 * a Meta reescreve a versão no link: pedindo `v22.0` ela devolveu um `next` apontando
 * para `v25.0` (medido). Seguir o link cru trocaria de versão no meio da paginação,
 * misturando páginas de contratos de API diferentes.
 */
async function fetchAllTemplates(input: SyncInput): Promise<unknown[]> {
  const base = `${graphBaseUrl(input.graphVersion)}/${input.wabaId}/message_templates?limit=100&fields=${FIELDS}`;
  const out: unknown[] = [];
  let after: string | null = null;

  for (let page = 0; page < 50; page += 1) {
    const url: string = after ? `${base}&after=${encodeURIComponent(after)}` : base;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${input.token}` } });
    const body: unknown = await res.json();
    if (!res.ok) {
      throw new Error(
        `syncTemplates: Graph API respondeu ${res.status} — ${JSON.stringify(body)?.slice(0, 300)}`,
      );
    }
    const paging = (body as { paging?: { next?: string; cursors?: { after?: string } } }).paging;
    out.push(...templatesToRows(body, input.organizationId, input.wabaId));
    if (!paging?.next || !paging.cursors?.after) return out;
    after = paging.cursors.after;
  }
  return out;
}

/**
 * Espelha os templates da WABA na tabela local e devolve o que mudou.
 *
 * Usa o admin client (bypassa RLS) e por isso filtra `organization_id` À MÃO em toda
 * query — o valor vem do chamador (sessão/token de webhook), nunca de body.
 */
export async function syncTemplates(input: SyncInput): Promise<SyncCounts> {
  const rows = (await fetchAllTemplates(input)) as MetaTemplateRow[];
  const db = createAdminClient();

  const { data: existing, error: readError } = await db
    .from("meta_templates")
    .select("name, language, status, contract_hash")
    .eq("organization_id", input.organizationId)
    .eq("waba_id", input.wabaId);
  if (readError) throw new Error(`syncTemplates: leitura do espelho falhou — ${readError.message}`);

  const plano = planSync(rows, (existing ?? []) as LocalTemplate[]);
  const now = new Date().toISOString();

  if (rows.length > 0) {
    const { error } = await db
      .from("meta_templates")
      .upsert(
        rows.map((r) => ({ ...r, synced_at: now, updated_at: now })),
        { onConflict: "organization_id,waba_id,name,language" },
      );
    if (error) throw new Error(`syncTemplates: upsert falhou — ${error.message}`);
  }

  for (const alvo of plano.disable) {
    const { error } = await db
      .from("meta_templates")
      .update({ status: TEMPLATE_STATUS_DISABLED, synced_at: now, updated_at: now })
      .eq("organization_id", input.organizationId)
      .eq("waba_id", input.wabaId)
      .eq("name", alvo.name)
      .eq("language", alvo.language);
    if (error) throw new Error(`syncTemplates: marcação DISABLED falhou — ${error.message}`);
  }

  return plano.counts;
}
