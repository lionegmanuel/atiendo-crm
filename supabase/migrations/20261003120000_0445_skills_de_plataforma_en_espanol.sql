-- 0445: las skills de plataforma (`objecao-preco` y `agendamento`, sembradas por
-- la 0069) pasan a tener versión en español, y el puntero de catálogo apunta a
-- ella.
--
-- Por qué no alcanzaba con traducir en pantalla: solo `name` + `description`
-- viven en el prompt como índice, y el `body` se carga cuando el `matcher`
-- dispara. Las palabras clave eran solo portuguesas ("tá caro", "marcar
-- horário"): con clientes que escriben en español la skill casi no se activaba,
-- y cuando lo hacía le inyectaba al agente una guía en portugués.
--
-- Cómo: `skill_versions` es inmutable (trigger), así que no se edita la versión
-- vieja: se inserta una nueva y se MUEVE el puntero de plataforma, que es el
-- mecanismo de cambio/rollback que el diseño prevé (`lib/agent-engine/agent/skills.ts`).
-- El matcher nuevo junta las palabras en portugués y en español, para que
-- ninguna instalación pierda activación. Las organizaciones que ya instalaron
-- la skill tienen su propia copia (fork-on-install) y no se tocan.
--
-- Idempotente: la versión en español se reconoce por su descripción; si ya
-- existe, no se inserta otra y solo se asegura el puntero. Sin tabla, columna,
-- función ni policy nueva.

do $seed$
declare
  v_id uuid;
  v_desc constant text := 'Guía para responder la objeción de precio por WhatsApp: identifica el motivo real detrás del "es caro" antes de reaccionar, sin ofrecer descuentos no autorizados.';
begin
  select id into v_id
    from public.skill_versions
   where organization_id is null and name = 'objecao-preco' and description = v_desc
   order by created_at desc
   limit 1;

  if v_id is null then
    insert into public.skill_versions (organization_id, name, description, body, matcher)
    values (
      null,
      'objecao-preco',
      v_desc,
      $body$# Guía: responder la objeción de precio

## Cuándo usarla
El cliente reaccionó al precio con resistencia, directa ("es caro") o indirecta
(pidió descuento, comparó con la competencia, dejó de responder después de saber
el valor). Objetivo: entender la objeción real detrás del "es caro" antes de
responder, y nunca ofrecer un descuento que la empresa no autorizó.

## Primero el diagnóstico: "caro" casi nunca es por el número
Antes de responder, identifica CUÁL objeción hay detrás:

1. **Presupuesto realmente insuficiente**: "ahora no tengo ese monto", "se me va del presupuesto"
2. **Todavía no ve el valor**: "¿por qué cuesta eso?", silencio después del precio, comparación vaga
3. **Comparación con la competencia u opción más barata**: "lo vi más barato en [X]"
4. **Táctica de negociación**: pide descuento de entrada, sin haber preguntado nada del producto
5. **Momento**: "lo voy a pensar", "lo hablo con mi socio/pareja" disfrazado de objeción de precio

Si no se puede diagnosticar por el mensaje, PREGUNTA antes de argumentar: "Para
ayudarte mejor: ¿es el monto en sí, o esperabas algo distinto de lo que te ofrecí?"

## Qué hacer según el diagnóstico

**SI el presupuesto es realmente insuficiente:**
- No insistas con el precio completo. Ofrece cuotas, un plan de entrada o una
  versión reducida, SOLO si está documentado como opción en la información del negocio.
- NUNCA inventes cuotas ni descuentos que no estén documentados: si no conoces la
  política, deriva a una persona.
- No desvalorices al cliente por no tener presupuesto. Tómalo como dato, no como rechazo.

**SI todavía no ve el valor:**
- No repitas el precio. Refuerza el resultado concreto que obtiene el cliente (no
  la lista de características).
- Usa un dato o un caso real si la información del negocio lo tiene.
- Pregunta para retomar: "¿Te queda claro lo que esto resuelve, o tienes alguna duda
  sobre lo que incluye?"

**SI compara con la competencia:**
- No ataques a la competencia. Pregunta qué vio de distinto ("¿qué incluía esa otra
  opción?"): suele revelar si es precio u otro criterio (plazo, soporte, garantía).
- Destaca el diferencial real del negocio (lo que diga su información), no algo genérico.

**SI es táctica de negociación (pidió descuento sin contexto):**
- No cedas automáticamente. Pregunta qué le haría sentido para cerrar hoy: muchas
  veces revela el número que el cliente tiene en mente.
- Descuento SOLO si la empresa tiene una política documentada para ese caso. Sin eso,
  deriva a una persona: decidir precio fuera del guion es tarea humana.

**SI es el momento disfrazado ("lo voy a pensar"):**
- No presiones. Pregunta en concreto qué le falta para decidir ("¿qué te ayudaría a
  decidir con más tranquilidad?").
- Acuerda un seguimiento explícito (día y hora); no lo dejes abierto: el cliente que
  "lo va a pensar" sin seguimiento acordado se enfría.

## Reglas firmes
- Nunca prometas descuentos, regalos o condiciones especiales que no estén en la
  información del negocio o configuradas en el agente.
- Nunca mientas con "promociones que terminan hoy" ni crees urgencia falsa.
- Si el cliente se pone hostil, amenaza con cancelar o pide hablar con una persona:
  deriva de inmediato, sin insistir una vez más.
- Si después de 2 intercambios la objeción no se resuelve, ofrece derivar en forma
  explícita: "¿Quieres que llame a alguien del equipo para cerrar los detalles contigo?"

## Ejemplos de respuesta (tono, no copiar literal)
- "Entiendo. Antes de mostrarte otra opción, cuéntame: ¿es el monto en sí o esperabas
  algo distinto de lo que te mostré?"
- "Tiene sentido. Sobre el valor, hoy tenemos [opción documentada]. ¿Eso te ayudaría?"
- "Perfecto, déjame confirmarlo contigo: ¿qué te haría sentido para cerrar hoy?"

## Qué NO hacer
- No vuelvas a mandar la lista de precios sin contexto.
- No ignores la objeción ni cambies de tema.
- No uses frases de presión como "solo por hoy" si esa condición no existe de verdad.
$body$,
      '{"any_keywords": ["caro", "tá caro", "está caro", "muito caro", "desconto", "abaixar o preço", "mais barato", "achei mais barato", "fora do meu orçamento", "não cabe no orçamento", "valor alto", "preço alto", "es caro", "muy caro", "descuento", "rebaja", "bajar el precio", "más barato", "lo vi más barato", "fuera de mi presupuesto", "no me alcanza", "precio alto", "se me va del presupuesto"], "probe_keywords": ["quanto custa", "qual o valor", "quanto é", "parcelamento", "condições de pagamento", "forma de pagamento", "cuánto cuesta", "cuánto sale", "cuál es el precio", "qué precio", "cuotas", "formas de pago", "medios de pago"]}'::jsonb
    )
    returning id into v_id;
  end if;

  update public.skill_pointers
     set version_id = v_id, updated_at = now()
   where organization_id is null and name = 'objecao-preco' and version_id <> v_id;
  if not exists (select 1 from public.skill_pointers where organization_id is null and name = 'objecao-preco') then
    insert into public.skill_pointers (organization_id, name, version_id) values (null, 'objecao-preco', v_id);
  end if;
end
$seed$;

do $seed$
declare
  v_id uuid;
  v_desc constant text := 'Guía para agendar o reprogramar citas (consulta, visita, sesión): ofrece opciones concretas de la agenda real, nunca inventa disponibilidad y confirma por escrito antes de cerrar.';
begin
  select id into v_id
    from public.skill_versions
   where organization_id is null and name = 'agendamento' and description = v_desc
   order by created_at desc
   limit 1;

  if v_id is null then
    insert into public.skill_versions (organization_id, name, description, body, matcher)
    values (
      null,
      'agendamento',
      v_desc,
      $body$# Guía: agendar citas

## Cuándo usarla
El cliente pide reservar un horario, consulta, visita, demostración, reunión o
sesión: cualquier compromiso con fecha y hora. Es común en salud, inmobiliarias
(visitas), servicios y consultoría.

## Regla de oro: nunca inventes disponibilidad
Si no tienes acceso confirmado a la agenda real del negocio, NO ofrezcas un horario
específico. Di que vas a confirmar y deriva, o pregunta la preferencia del cliente y
avisa que la confirmación llega enseguida. Prometer un horario que después no existe
rompe la confianza y obliga a reprogramar.

## Flujo

**1. Identifica el servicio o motivo antes de ofrecer horario**
- SI el cliente solo dijo "quiero agendar" sin contexto, pregunta primero el motivo
  o servicio. Agendar sin saber qué genera errores (una consulta de 20 minutos en un
  espacio de una hora, o al revés).

**2. Ofrece opciones cerradas, no una pregunta abierta**
- SI tienes acceso a la agenda real, ofrece 2 o 3 horarios concretos ("tengo el
  martes a las 14 o el miércoles a las 10, ¿cuál te queda mejor?"). Preguntar "¿qué
  horario prefieres?" genera idas y vueltas.
- SI no tienes acceso a la agenda, no inventes. Di algo como "voy a confirmar la
  disponibilidad y te escribo enseguida" y deriva a quien tenga acceso.

**3. Pide los datos necesarios antes de confirmar**
- Nombre completo del cliente (o confirma el que ya está en el CRM).
- Servicio o motivo concreto.
- Sede o lugar, si el negocio tiene más de uno.
- Si es una reprogramación, el horario anterior que se reemplaza.

**4. Confirma por escrito antes de cerrar**
- SI el cliente acepta un horario, repítelo por escrito: "Confirmado: [servicio] el
  [fecha] a las [hora], en [lugar]. ¿Me lo confirmas?"
- La cita queda cerrada solo con un "sí" o confirmación explícita: el silencio o un
  "ok" vago no alcanzan cuando faltar tiene costo (consulta médica, visita a una propiedad).

**5. Reprogramar y cancelar**
- SI pide reprogramar, trátalo como una cita nueva: busca el nuevo horario y cancela
  o reemplaza el anterior en forma explícita (que no queden las dos).
- SI pide cancelar, confirma la cancelación y pregunta si quiere otra fecha, sin presionar.

**6. Riesgo de que no se presente**
- Si el negocio tiene documentada una política de recordatorio el día anterior,
  síguela. Si no la tiene, no inventes una: solo confirma la cita.

## Reglas firmes
- Nunca confirmes un horario sin haber revisado la disponibilidad real (o sin avisar
  que todavía falta confirmarlo).
- Nunca agendes dos compromisos que se superpongan para el mismo cliente sin avisar.
- Si pide un horario fuera del horario de atención y eso no está en las reglas del
  negocio, no lo confirmes: explica cuándo se atiende.
- Pide datos sensibles (dirección completa, documento) solo si el negocio de verdad
  los necesita para la cita.

## Ejemplos de respuesta (tono, no copiar literal)
- "Para reservarte bien: ¿para qué servicio o motivo es?"
- "Tengo el jueves a las 15 o el viernes a las 9, ¿cuál te queda mejor?"
- "Confirmado: consulta el 28/07 a las 15, en la sede Centro. ¿Me lo confirmas?"

## Qué NO hacer
- No preguntes "¿qué horario prefieres?" sin ofrecer opciones cuando tienes la agenda.
- No confirmes la cita sin una respuesta explícita del cliente.
- No inventes disponibilidad que no revisaste.
$body$,
      '{"any_keywords": ["agendar", "marcar horário", "marcar consulta", "marcar uma visita", "agenda", "que horas vocês", "horário disponível", "remarcar", "reagendar", "cancelar o horário", "desmarcar", "sacar turno", "pedir turno", "turno", "reservar", "pedir una cita", "una cita", "coordinar una visita", "agendar una visita", "horario disponible", "reprogramar", "cambiar el turno", "cancelar el turno", "cancelar la cita"], "probe_keywords": ["que horas", "qual dia", "tem vaga", "disponibilidade", "a qué hora", "qué día", "hay lugar", "disponibilidad", "tienen horario"]}'::jsonb
    )
    returning id into v_id;
  end if;

  update public.skill_pointers
     set version_id = v_id, updated_at = now()
   where organization_id is null and name = 'agendamento' and version_id <> v_id;
  if not exists (select 1 from public.skill_pointers where organization_id is null and name = 'agendamento') then
    insert into public.skill_pointers (organization_id, name, version_id) values (null, 'agendamento', v_id);
  end if;
end
$seed$;
