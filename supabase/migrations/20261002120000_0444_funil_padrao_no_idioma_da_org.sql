-- 0444 — o funil que nasce com a organização sai no idioma dela.
--
-- `fn_seed_default_pipeline_for_org` (gatilho AFTER INSERT em `organizations`)
-- semeava "Carrinho abandonado", "Aguardando pagamento", "Em separação"... em
-- português para TODA organização, inclusive a que nasce com `locale = 'es'`
-- (o cadastro grava o `APP_LOCALE` da instalação). Quem pulava o passo do
-- quadro no onboarding ficava com o funil inteiro em outra língua.
--
-- Muda só o NOME das etapas. O `slug` continua o mesmo em qualquer idioma: é
-- chave que integração e automação podem referenciar, e traduzi-lo quebraria
-- quem já depende dele.
--
-- Backfill conservador: renomeia só etapas de organizações em espanhol cujo
-- nome ainda é EXATAMENTE o semeado (ninguém mexeu) e cujo slug é o do seed.
-- Etapa renomeada pelo tenant não é tocada. Idempotente: na segunda passada o
-- nome já não bate com o português e nada acontece.

create or replace function public.fn_seed_default_pipeline_for_org() returns trigger
    language plpgsql
    set search_path to 'public', 'pg_temp'
    as $$
declare
  v_pipeline_id uuid;
  v_position numeric := 1000;
  v_es boolean := coalesce(new.locale, '') = 'es' or coalesce(new.locale, '') like 'es-%';
  r record;
begin
  insert into public.crm_pipelines (organization_id, name, slug, is_default, position)
  values (new.id, 'Pedidos', 'pedidos', true, 1000)
  returning id into v_pipeline_id;

  for r in
    select * from (values
      ('Carrinho abandonado',  'Carrito abandonado', 'carrinho_abandonado',  false, false),
      ('Aguardando pagamento', 'Esperando el pago',  'aguardando_pagamento', false, false),
      ('Pago',                 'Pagado',             'pago',                 true,  false),
      ('Em separação',         'En preparación',     'em_separacao',         false, false),
      ('Enviado',              'Enviado',            'enviado',              false, false),
      ('Entregue',             'Entregado',          'entregue',             false, false),
      ('Pós-venda',            'Posventa',           'pos_venda',            false, false),
      ('Cancelado',            'Cancelado',          'cancelado',            false, true)
    ) as t(stage_name, stage_name_es, stage_slug, won, lost)
  loop
    insert into public.crm_stages (organization_id, pipeline_id, name, slug, position, is_won, is_lost)
    values (new.id, v_pipeline_id, case when v_es then r.stage_name_es else r.stage_name end,
            r.stage_slug, v_position, r.won, r.lost);
    v_position := v_position + 1000;
  end loop;

  return new;
end$$;

update public.crm_stages s
   set name = t.nome_es
  from (values
      ('carrinho_abandonado',  'Carrinho abandonado',  'Carrito abandonado'),
      ('aguardando_pagamento', 'Aguardando pagamento', 'Esperando el pago'),
      ('pago',                 'Pago',                 'Pagado'),
      ('em_separacao',         'Em separação',         'En preparación'),
      ('entregue',             'Entregue',             'Entregado'),
      ('pos_venda',            'Pós-venda',            'Posventa')
  ) as t(slug, nome_pt, nome_es),
       public.crm_pipelines p,
       public.organizations o
 where s.slug = t.slug
   and s.name = t.nome_pt
   and p.id = s.pipeline_id
   and p.organization_id = s.organization_id
   and p.slug = 'pedidos'
   and o.id = s.organization_id
   and (o.locale = 'es' or o.locale like 'es-%');
