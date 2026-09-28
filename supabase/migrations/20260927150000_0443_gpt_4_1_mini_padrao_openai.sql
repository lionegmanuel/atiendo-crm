-- GPT-4.1 mini no catálogo da OpenAI, e como PADRÃO do provedor.
-- Com uma chave OpenAI, o agente publicado sem escolha explícita passa a usar
-- gpt-4.1-mini (`lib/ai/agents/escolher-modelo.ts`: o curado vence). Preço da
-- tabela Standard da OpenAI: $0,40 entrada / $1,60 saída por milhão.
-- Idempotente; o índice `ai_models_one_default_per_provider` é UNIQUE parcial e
-- imediato, então o padrão anterior é limpo ANTES de marcar o novo.
insert into public.ai_models
  (provider, model_id, display_name, description,
   input_price_per_million_cents, output_price_per_million_cents, supports_tools)
values
  ('openai', 'gpt-4.1-mini', 'GPT-4.1 Mini',
   'Rápido e econômico, com ferramentas — padrão para atendimento por WhatsApp.', 40, 160, true)
on conflict (provider, model_id) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  input_price_per_million_cents = excluded.input_price_per_million_cents,
  output_price_per_million_cents = excluded.output_price_per_million_cents,
  supports_tools = excluded.supports_tools,
  deprecated_at = null;

update public.ai_models set is_default_for_provider = false
 where provider = 'openai' and is_default_for_provider and model_id <> 'gpt-4.1-mini';

update public.ai_models set is_default_for_provider = true
 where provider = 'openai' and model_id = 'gpt-4.1-mini' and not is_default_for_provider;

insert into public.ai_pricing
  (model, prompt_cents_per_million_tokens, completion_cents_per_million_tokens, notes)
values
  ('gpt-4.1-mini', 40, 160, 'migration 0443 — padrão OpenAI; tabela Standard da OpenAI')
on conflict (model) do update set
  prompt_cents_per_million_tokens = excluded.prompt_cents_per_million_tokens,
  completion_cents_per_million_tokens = excluded.completion_cents_per_million_tokens,
  notes = excluded.notes,
  superseded_at = null;
