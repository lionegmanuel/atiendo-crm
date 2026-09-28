/**
 * Seed E2E do catálogo da OpenRouter em `ai_models`.
 *
 * A spec `prova-painel-provedores.spec.ts` afirma que o seletor traz mais de 50
 * modelos da OpenRouter e escolhe `meta-llama/llama-3.3-70b-instruct`. Nada
 * disso existe num banco fresco: o `baseline.sql` semeia só
 * anthropic/openai/google, e os da OpenRouter chegam pelo cron diário
 * `sync-model-catalog`, que busca a lista pública na internet.
 *
 * Sem este seed, a spec media a SORTE do ambiente: passava na máquina onde o
 * cron já tinha rodado e reprovava num ambiente fresco — por falta de fixture,
 * não por defeito. Teste que reprova sem defeito ensina a ignorar teste.
 *
 * Buscar a lista de verdade aqui seria pior: o e2e passaria a depender de rede
 * e de um catálogo que muda sozinho, e o dia em que a OpenRouter renomear um
 * modelo o CI ficaria vermelho sem nada ter quebrado no produto. Quem prova a
 * conciliação contra a origem real é `tests/unit/catalogo-openrouter.test.ts`.
 *
 * `source = 'sync'` de propósito: é como o cron marca o que ele mesmo traz, e o
 * cron não toca em linha `manual`. Um seed marcado `manual` sobreviveria à
 * sincronização e viraria fixture permanente no banco de quem rodar o e2e.
 *
 * Idempotente: `on conflict (provider, model_id) do nothing` via upsert.
 *
 * Run: npx tsx scripts/seed-e2e-catalogo-openrouter.ts
 */

import { createClient } from "@supabase/supabase-js";

import { anunciarDestino, credenciaisSupabaseDeTeste } from "./lib/env-de-teste";

const credenciais = credenciaisSupabaseDeTeste();
anunciarDestino("seed-e2e-catalogo-openrouter", credenciais);

const admin = createClient(credenciais.url, credenciais.serviceRole, {
  auth: { persistSession: false },
});

/**
 * Os que a spec NOMEIA. Ficam fora do gerador para o teste não depender da
 * ordem em que uma lista sintética foi montada.
 */
const NOMEADOS = [
  {
    model_id: "meta-llama/llama-3.3-70b-instruct",
    display_name: "Llama 3.3 70B Instruct",
    supports_tools: true,
    input_price_per_million_cents: 10,
    output_price_per_million_cents: 25,
  },
  // Um SEM ferramentas, porque a catraca do painel só é exercitável se existir
  // um modelo que ela possa recusar.
  {
    model_id: "openrouter/auto-sem-ferramentas",
    display_name: "Roteamento automático (sem ferramentas)",
    supports_tools: false,
    input_price_per_million_cents: 5,
    output_price_per_million_cents: 15,
  },
];

/**
 * Volume. A asserção da spec é sobre a LISTA ter chegado ao seletor — 50+ é o
 * que distingue "o catálogo sincronizou" de "veio o punhado curado do
 * baseline". Ids sintéticos, com fabricante no prefixo como a OpenRouter faz.
 */
const FABRICANTES = ["mistralai", "qwen", "deepseek", "cohere", "nousresearch", "microsoft"];
const sinteticos = FABRICANTES.flatMap((fab) =>
  Array.from({ length: 10 }, (_, i) => ({
    model_id: `${fab}/modelo-de-teste-${i + 1}`,
    display_name: `${fab} modelo de teste ${i + 1}`,
    supports_tools: i % 3 !== 0,
    input_price_per_million_cents: 10 + i,
    output_price_per_million_cents: 40 + i,
  })),
);

async function main(): Promise<void> {
  const linhas = [...NOMEADOS, ...sinteticos].map((m) => ({
    provider: "openrouter",
    model_id: m.model_id,
    display_name: m.display_name,
    supports_tools: m.supports_tools,
    input_price_per_million_cents: m.input_price_per_million_cents,
    output_price_per_million_cents: m.output_price_per_million_cents,
    metadata: { source: "sync", seed: "e2e" },
  }));

  const { error } = await admin
    .from("ai_models")
    .upsert(linhas, { onConflict: "provider,model_id", ignoreDuplicates: true });
  if (error) {
    console.error("[seed-catalogo-openrouter] falhou:", error.message);
    process.exit(1);
  }

  const { count } = await admin
    .from("ai_models")
    .select("*", { count: "exact", head: true })
    .eq("provider", "openrouter");

  // O número vai para o stdout porque é a prova de que o seed serviu: a spec
  // exige mais de 50, e um seed que gravasse 3 deixaria a falha aparecer como
  // "a tela não trouxe modelos" — sintoma que aponta para o lugar errado.
  console.log(`[seed-catalogo-openrouter] ai_models(openrouter) = ${count ?? "?"}`);
  if ((count ?? 0) <= 50) {
    console.error("[seed-catalogo-openrouter] menos de 51 modelos — a spec F3 vai reprovar por fixture");
    process.exit(1);
  }
}

void main();
