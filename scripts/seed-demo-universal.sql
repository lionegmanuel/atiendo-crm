-- ==============================================================================
-- SEED DE DEMO EN ESPAÑOL LATINO (EMBUDO COMERCIAL UNIVERSAL)
-- ==============================================================================
-- Configura el embudo de ventas por defecto en español (6 etapas comerciales)
-- y carga 4 prospectos de demostración válidos para cualquier empresa o agencia.
--
-- CUÁNDO EJECUTARLO:
--   1. DESPUÉS de completar el onboarding en http://localhost:3000 (crea la organización).
--   2. ANTES de conectar Zernio: siembra la clave de cifrado requerida por el webhook.
--   3. ANTES de recibir el primer WhatsApp real: la actualización de etapas se bloquea
--      si el embudo ya contiene oportunidades activas para evitar inconsistencias.
--
-- CÓMO EJECUTARLO:
--   Copiar todo el contenido, pegarlo en el SQL Editor de Supabase y presionar "Run".
--   Es completamente idempotente: puede ejecutarse varias veces sin duplicar datos.
-- ==============================================================================

-- 0. Sembrar clave de cifrado requerida por el webhook de Zernio en app_secrets
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
  v_stage_contacto uuid;
  v_stage_calificado uuid;
  v_stage_propuesta uuid;
  v_contacto uuid;
  r record;
BEGIN
  -- 1. Obtener la organización creada en el onboarding
  SELECT id INTO v_org_id FROM public.organizations ORDER BY created_at ASC LIMIT 1;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No se encontró ninguna organización. Completá primero el registro en http://localhost:3000 y volvé a ejecutar este script.';
  END IF;

  -- 2. Asegurar idioma español en la organización
  UPDATE public.organizations SET locale = 'es' WHERE id = v_org_id;

  -- 3. Obtener el embudo por defecto
  SELECT id INTO v_pipeline_id
    FROM public.crm_pipelines
   WHERE organization_id = v_org_id AND is_default AND NOT is_archived
   LIMIT 1;
  IF v_pipeline_id IS NULL THEN
    RAISE EXCEPTION 'La organización % no cuenta con embudo por defecto. Creá uno en Configuración › Embudos y volvé a ejecutar.', v_org_id;
  END IF;

  -- 4. Configurar etapas comerciales universales en español (idempotente)
  IF NOT EXISTS (
    SELECT 1 FROM public.crm_stages
     WHERE pipeline_id = v_pipeline_id AND slug = 'nuevo-lead' AND NOT is_archived
  ) THEN
    SELECT CASE WHEN EXISTS (
             SELECT 1 FROM public.crm_pipelines
              WHERE organization_id = v_org_id AND slug = 'embudo-ventas' AND id <> v_pipeline_id)
           THEN (SELECT slug FROM public.crm_pipelines WHERE id = v_pipeline_id)
           ELSE 'embudo-ventas' END
      INTO v_slug;

    v_resultado := public.fn_aplicar_quadro_do_onboarding(
      v_org_id, v_pipeline_id, 'Embudo de Ventas', v_slug,
      jsonb_build_array(
        jsonb_build_object('nome', 'Nuevo Lead',           'slug', 'nuevo-lead',           'position', 1000, 'is_won', false, 'is_lost', false, 'agent_stage_hint', 'new'),
        jsonb_build_object('nome', 'Contacto Inicial',     'slug', 'contacto-inicial',     'position', 2000, 'is_won', false, 'is_lost', false, 'agent_stage_hint', 'contacted'),
        jsonb_build_object('nome', 'Prospecto Calificado', 'slug', 'prospecto-calificado', 'position', 3000, 'is_won', false, 'is_lost', false, 'agent_stage_hint', 'qualified'),
        jsonb_build_object('nome', 'Propuesta Enviada',    'slug', 'propuesta-enviada',    'position', 4000, 'is_won', false, 'is_lost', false, 'agent_stage_hint', 'negotiating'),
        jsonb_build_object('nome', 'Cerrado Ganado',       'slug', 'cerrado-ganado',       'position', 5000, 'is_won', true,  'is_lost', false, 'agent_stage_hint', 'won'),
        jsonb_build_object('nome', 'Cerrado Perdido',      'slug', 'cerrado-perdido',      'position', 6000, 'is_won', false, 'is_lost', true,  'agent_stage_hint', 'lost')
      )
    );

    IF NOT coalesce((v_resultado->>'ok')::boolean, false) THEN
      IF v_resultado->>'motivo' = 'funil_com_negocios' THEN
        RAISE EXCEPTION 'El embudo ya tiene % oportunidad(es) activa(s). Movelos o eliminalos desde el Kanban y volvé a ejecutar.', v_resultado->>'quantos';
      END IF;
      RAISE EXCEPTION 'No se pudieron actualizar las etapas comerciales: %', v_resultado;
    END IF;

    -- Asignación de colores estándar por etapa
    UPDATE public.crm_stages s
       SET color = c.color
      FROM (VALUES ('nuevo-lead', '#3b82f6'), ('contacto-inicial', '#6366f1'),
                   ('prospecto-calificado', '#10b981'), ('propuesta-enviada', '#f59e0b'),
                   ('cerrado-ganado', '#059669'), ('cerrado-perdido', '#ef4444')) AS c(slug, color)
     WHERE s.pipeline_id = v_pipeline_id AND s.slug = c.slug;
  END IF;

  -- 5. Vocabulario profesional del CRM en español
  UPDATE public.crm_pipelines
     SET vocabulary = jsonb_build_object(
           'lead', 'Contacto', 'lead_plural', 'Contactos',
           'deal', 'Negocio',  'deal_plural', 'Negocios',
           'won', 'Ganado', 'lost', 'Perdido',
           'stage', 'Etapa', 'stage_plural', 'Etapas'),
         description = 'Embudo principal de atención comercial y ventas por WhatsApp con IA',
         updated_at = now()
   WHERE id = v_pipeline_id;

  SELECT id INTO v_stage_lead       FROM public.crm_stages WHERE pipeline_id = v_pipeline_id AND slug = 'nuevo-lead';
  SELECT id INTO v_stage_contacto   FROM public.crm_stages WHERE pipeline_id = v_pipeline_id AND slug = 'contacto-inicial';
  SELECT id INTO v_stage_calificado FROM public.crm_stages WHERE pipeline_id = v_pipeline_id AND slug = 'prospecto-calificado';
  SELECT id INTO v_stage_propuesta  FROM public.crm_stages WHERE pipeline_id = v_pipeline_id AND slug = 'propuesta-enviada';

  -- 6. Prospectos de demostración universales (B2B / B2C)
  FOR r IN
    SELECT * FROM (VALUES
      ('Martín Gómez',    '+5491100001111', 'martin.gomez@empresa.com',      v_stage_lead,
       'Consulta inicial de servicios - Martín G.',
       'Ingresó por WhatsApp consultando planes y presupuesto estimado para su empresa.', 50000::bigint),
      ('Sofía Rodríguez', '+5491100002222', 'sofia.rodriguez@gmail.com',     v_stage_contacto,
       'Información técnica solicitada - Sofía R.',
       'Mensaje de bienvenida respondido. Se compartió catálogo y preguntas frecuentes.', 85000::bigint),
      ('Carlos Martínez', '+5491100003333', 'cmartinez@corporativo.com',     v_stage_calificado,
       'Reunión de demostración - Carlos M.',
       'Calificado con presupuesto y necesidad confirmada. Agendó videollamada para el jueves.', 150000::bigint),
      ('Valentina López', '+5491100004444', 'vlopez@innovacion.io',          v_stage_propuesta,
       'Propuesta comercial en evaluación - Valentina L.',
       'Presupuesto formal enviado por WhatsApp. En revisión final para cierre comercial.', 220000::bigint)
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

  RAISE NOTICE 'Seed universal completado: Embudo de Ventas con 6 etapas y 4 prospectos de ejemplo creados en organización %.', v_org_id;
END $$;

-- Verificación final de etapas y negocios creados
SELECT s.position, s.name AS etapa, s.agent_stage_hint, count(l.id) AS negocios
  FROM public.crm_stages s
  JOIN public.crm_pipelines p ON p.id = s.pipeline_id AND p.is_default
  LEFT JOIN public.crm_leads l ON l.stage_id = s.id AND l.status = 'open'
 WHERE p.organization_id = (SELECT id FROM public.organizations ORDER BY created_at LIMIT 1)
 GROUP BY s.position, s.name, s.agent_stage_hint
 ORDER BY s.position;
