/**
 * Cost computation for ai_agent_runs (S-13.08).
 *
 * Looks up the curated `ai_models` catalog (Spec 10 §2.2) and converts token
 * usage into cents, rounded up. Cached in-memory for 5 min — stale catalog data
 * never crashes; missing entries simply mean cost=0 for that run.
 *
 * IMPORTANT: distinct from `lib/ai/cost.ts` which still serves the legacy
 * `ai_pricing` table used by the EPIC-06 RAG worker.
 */
import { createAdminClient } from "@/lib/supabase/admin";

interface ModelPricingRow {
  provider: string;
  model_id: string;
  input_price_per_million_cents: number | null;
  output_price_per_million_cents: number | null;
}

const TTL_MS = 5 * 60 * 1000;
let cache: Map<string, ModelPricingRow> | null = null;
let cacheAt = 0;

function key(provider: string, modelId: string): string {
  return `${provider}:${modelId}`;
}

async function loadPricing(): Promise<Map<string, ModelPricingRow>> {
  const now = Date.now();
  if (cache && now - cacheAt < TTL_MS) return cache;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ai_models")
    .select("provider, model_id, input_price_per_million_cents, output_price_per_million_cents");
  if (error) {
    return cache ?? new Map();
  }
  const map = new Map<string, ModelPricingRow>();
  for (const row of (data ?? []) as ModelPricingRow[]) {
    map.set(key(row.provider, row.model_id), row);
  }
  cache = map;
  cacheAt = now;
  return map;
}

export interface ComputeCostInput {
  provider: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}

/** Returns cost in cents (rounded up). 0 if model not in catalog. */
export async function computeCostCents(input: ComputeCostInput): Promise<number> {
  const pricing = await loadPricing();
  const row = pricing.get(key(input.provider, input.model));
  if (!row) return 0;
  const inputRate = Number(row.input_price_per_million_cents ?? 0);
  const outputRate = Number(row.output_price_per_million_cents ?? 0);
  const cents =
    ((input.inputTokens ?? 0) * inputRate) / 1_000_000 +
    ((input.outputTokens ?? 0) * outputRate) / 1_000_000;
  return Math.ceil(cents);
}

/** Test-only: drop the in-memory pricing cache. */
export function _resetRuntimeCostCacheForTests(): void {
  cache = null;
  cacheAt = 0;
}
