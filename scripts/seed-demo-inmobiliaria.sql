-- ==============================================================================
-- SEED DE DEMO EN ESPAÑOL LATINO (INMOBILIARIA DE EJEMPLO)
-- ==============================================================================
-- Deja el embudo por defecto en español (6 etapas) y carga 4 prospectos de demo.
--
-- CUÁNDO CORRERLO (el orden importa):
--   1. DESPUÉS del onboarding en http://localhost:3000 (crea la organización).
--   2. ANTES de conectar Zernio: siembra la clave de cifrado que esa conexión usa.
--   3. ANTES de que entre el primer WhatsApp real: el cambio de etapas se niega
--      si el embudo ya tiene negocios, para no dejarlos sin columna.
--
-- CÓMO: pegar entero en el SQL Editor de Supabase y "Run". Se puede correr
-- varias veces: la segunda vez no duplica nada.
--
-- Las etapas se cambian con `fn_aplicar_quadro_do_onboarding`, la misma función
-- que usa el paso "Embudo" del onboarding: valida que no haya negocios ni
-- integraciones colgando de las etapas viejas, y graba el vínculo de cada etapa
-- con el funil del agente de IA (`agent_stage_hint`), que es lo que permite que
-- el agente mueva la tarjeta sola al calificar al prospecto.
-- Si algo falla, el bloque entero se revierte: nunca queda a medias.
-- ==============================================================================

-- 0. Clave con la que la base cifra los secretos (el del webhook de Zernio, entre
--    otros). El instalador oficial (hostgator-setup-kit) la siembra solo; quien
--    aplica el baseline a mano en el SQL Editor no la tiene, y al conectar Zernio
--    ve "cifrado no disponible". `do nothing`: una clave que ya existe NO se
--    cambia, porque cambiarla dejaría ilegibles los secretos ya guardados.
INSERT INTO private.app_secrets (name, value)
VALUES ('nuvemshop_oauth_key', encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;

DO $$
DECLARE
  v_org_id uuid;
  v_pipeline_id uuid;
  v_slug text;
  v_resultado jsonb;
  v_stage_lead uuid;
  v_stage_calificado uuid;
  v_stage_reunion uuid;
  v_stage_propuesta uuid;
  v_contacto uuid;
  r record;
BEGIN
  -- 1. La organización creada por el onboarding (la primera).
  SELECT id INTO v_org_id FROM public.organizations ORDER BY created_at ASC LIMIT 1;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No hay ninguna organización. Completá primero el onboarding en http://localhost:3000 y volvé a correr este script.';
  END IF;

  -- 2. Idioma de la organización.
  UPDATE public.organizations SET locale = 'es' WHERE id = v_org_id;

  -- 3. El embudo por defecto (lo crea un trigger al nacer la organización).
  SELECT id INTO v_pipeline_id
    FROM public.crm_pipelines
   WHERE organization_id = v_org_id AND is_default AND NOT is_archived
   LIMIT 1;
  IF v_pipeline_id IS NULL THEN
    RAISE EXCEPTION 'La organización % no tiene embudo por defecto. Creá uno en Configuración › Embudos y volvé a correr.', v_org_id;
  END IF;

  -- 4. Etapas en español — solo si todavía no están (idempotente).
  IF NOT EXISTS (
    SELECT 1 FROM public.crm_stages
     WHERE pipeline_id = v_pipeline_id AND slug = 'nuevo-lead' AND NOT is_archived
  ) THEN
    -- El slug no puede chocar con el de otro embudo de la misma organización.
    SELECT CASE WHEN EXISTS (
             SELECT 1 FROM public.crm_pipelines
              WHERE organization_id = v_org_id AND slug = 'embudo-ventas' AND id <> v_pipeline_id)
           THEN (SELECT slug FROM public.crm_pipelines WHERE id = v_pipeline_id)
           ELSE 'embudo-ventas' END
      INTO v_slug;

    v_resultado := public.fn_aplicar_quadro_do_onboarding(
      v_org_id, v_pipeline_id, 'Embudo de Ventas', v_slug,
      jsonb_build_array(
        -- agent_stage_hint: a qué paso del funil del agente corresponde la etapa.
        jsonb_build_object('nome', 'Nuevo Lead',           'slug', 'nuevo-lead',           'position', 1000, 'is_won', false, 'is_lost', false, 'agent_stage_hint', 'new'),
        jsonb_build_object('nome', 'Prospecto Calificado', 'slug', 'prospecto-calificado', 'position', 2000, 'is_won', false, 'is_lost', false, 'agent_stage_hint', 'qualified'),
        jsonb_build_object('nome', 'Reunión Agendada',     'slug', 'reunion-agendada',     'position', 3000, 'is_won', false, 'is_lost', false, 'agent_stage_hint', ''),
        jsonb_build_object('nome', 'Propuesta Enviada',    'slug', 'propuesta-enviada',    'position', 4000, 'is_won', false, 'is_lost', false, 'agent_stage_hint', 'negotiating'),
        jsonb_build_object('nome', 'Cerrado Ganado',       'slug', 'cerrado-ganado',       'position', 5000, 'is_won', true,  'is_lost', false, 'agent_stage_hint', 'won'),
        -- Sin etapa de perdido, "Marcar como perdido" no tiene adónde mover la tarjeta.
        jsonb_build_object('nome', 'Cerrado Perdido',      'slug', 'cerrado-perdido',      'position', 6000, 'is_won', false, 'is_lost', true,  'agent_stage_hint', 'lost')
      )
    );

    IF NOT coalesce((v_resultado->>'ok')::boolean, false) THEN
      IF v_resultado->>'motivo' = 'funil_com_negocios' THEN
        RAISE EXCEPTION 'El embudo ya tiene % negocio(s) (¿entró un WhatsApp antes del seed?). Borralos o movelos desde el Kanban y volvé a correr.', v_resultado->>'quantos';
      END IF;
      RAISE EXCEPTION 'No se pudieron cambiar las etapas: %', v_resultado;
    END IF;

    -- Colores de las columnas (la función del onboarding no los recibe).
    UPDATE public.crm_stages s
       SET color = c.color
      FROM (VALUES ('nuevo-lead', '#3b82f6'), ('prospecto-calificado', '#10b981'),
                   ('reunion-agendada', '#f59e0b'), ('propuesta-enviada', '#8b5cf6'),
                   ('cerrado-ganado', '#059669'), ('cerrado-perdido', '#ef4444')) AS c(slug, color)
     WHERE s.pipeline_id = v_pipeline_id AND s.slug = c.slug;
  END IF;

  -- 5. Vocabulario del embudo en español (el default es de e-commerce: Cliente/Pedido).
  UPDATE public.crm_pipelines
     SET vocabulary = jsonb_build_object(
           'lead', 'Contacto', 'lead_plural', 'Contactos',
           'deal', 'Negocio',  'deal_plural', 'Negocios',
           'won', 'Ganado', 'lost', 'Perdido',
           'stage', 'Etapa', 'stage_plural', 'Etapas'),
         description = 'Embudo principal de atención y ventas por WhatsApp con IA',
         updated_at = now()
   WHERE id = v_pipeline_id;

  SELECT id INTO v_stage_lead       FROM public.crm_stages WHERE pipeline_id = v_pipeline_id AND slug = 'nuevo-lead';
  SELECT id INTO v_stage_calificado FROM public.crm_stages WHERE pipeline_id = v_pipeline_id AND slug = 'prospecto-calificado';
  SELECT id INTO v_stage_reunion    FROM public.crm_stages WHERE pipeline_id = v_pipeline_id AND slug = 'reunion-agendada';
  SELECT id INTO v_stage_propuesta  FROM public.crm_stages WHERE pipeline_id = v_pipeline_id AND slug = 'propuesta-enviada';

  -- 6. Contactos y tarjetas de demo. La clave de idempotencia es el teléfono
  --    del contacto (un negocio abierto por contacto en este embudo).
  FOR r IN
    SELECT * FROM (VALUES
      ('Martín López',    '+5493510001122', 'martin.lopez@gmail.com',      v_stage_lead,
       'Consulta Depto Nueva Córdoba - Martín',
       'Presupuesto: $500 USD/mes. Busca 1 dormitorio con balcón para mudarse el mes próximo.', 50000::bigint),
      ('Sofía Rodríguez', '+5493510003344', 'sofia.rodriguez@gmail.com', v_stage_calificado,
       'Alquiler Estrada 300 - Sofía R.',
       'Calificada por IA. Interesada en opción de $450 USD. Solicitó fotos y video del recorrido.', 45000::bigint),
      ('Carlos Martínez', '+5493510005566', 'cmartinez@empresa.com',     v_stage_reunion,
       'Visita Presencial - Carlos M.',
       'Coordinada para este jueves 16:30 hs. Interesado en compra o alquiler a largo plazo.', 120000::bigint),
      ('Valentina Gómez', '+5493510007788', 'vgomez@innovar.io',         v_stage_propuesta,
       'Reserva Depto Amoblado - Valentina G.',
       'Contrato enviado por WhatsApp. Pendiente comprobante de garantía para cierre.', 60000::bigint)
    ) AS t(nombre, telefono, email, etapa, titulo, detalle, valor)
  LOOP
    SELECT id INTO v_contacto
      FROM public.contacts
     WHERE organization_id = v_org_id AND phone_number = r.telefono AND is_merged_into IS NULL
     LIMIT 1;
    IF v_contacto IS NULL THEN
      INSERT INTO public.contacts (organization_id, name, phone_number, email)
      VALUES (v_org_id, r.nombre, r.telefono, r.email)
      RETURNING id INTO v_contacto;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.crm_leads
       WHERE organization_id = v_org_id AND pipeline_id = v_pipeline_id AND contact_id = v_contacto
    ) THEN
      INSERT INTO public.crm_leads
        (organization_id, pipeline_id, stage_id, contact_id, title, description, status, value_cents, currency, source)
      VALUES
        (v_org_id, v_pipeline_id, r.etapa, v_contacto, r.titulo, r.detalle, 'open', r.valor, 'USD', 'whatsapp');
    END IF;
  END LOOP;

  RAISE NOTICE 'Seed listo: "Embudo de Ventas" con 6 etapas y 4 prospectos de demo (organización %).', v_org_id;
END $$;

-- Verificación: debería listar las 6 etapas en orden y 4 negocios abiertos.
SELECT s.position, s.name AS etapa, s.agent_stage_hint, count(l.id) AS negocios
  FROM public.crm_stages s
  JOIN public.crm_pipelines p ON p.id = s.pipeline_id AND p.is_default
  LEFT JOIN public.crm_leads l ON l.stage_id = s.id AND l.status = 'open'
 WHERE p.organization_id = (SELECT id FROM public.organizations ORDER BY created_at LIMIT 1)
 GROUP BY s.position, s.name, s.agent_stage_hint
 ORDER BY s.position;
