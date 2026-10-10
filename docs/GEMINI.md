# Gemini en Nexo Solar: guía paso a paso

Esta guía sigue el plan del equipo en 5 pasos. Explica qué hace cada parte, en qué archivo está y cómo probarla.

**La idea central:** Gemini **propone** y el backend **decide**. Las reglas R1–R6 y el validador siempre tienen la última palabra. El equipo revisa todo lo que la IA no puede hacer sola.

```
El cliente escribe en el portal (o llega una revisión programada)
        │
        ▼
Motor de reglas: Gemini interpreta el mensaje → acción ideal → reglas R1–R6 → validador
        │                                   (decisión vigente: acción y momento)
        ▼
Asistente: contexto de la cotización + conocimiento aprobado + ejemplos + correcciones
        │
        ▼
Gemini propone (JSON): resumen, necesidad, acción y momento, explicación y evidencia,
                       borrador, datos faltantes, revisión humana
        │
        ▼
Validación en el backend: manda el motor · reglas a esta hora · borrador sin descuentos,
                          sin presión, solo cifras aprobadas, sin enlaces ni teléfonos
        │
        ▼
Según el modo: borrador para el equipo (draft)  ·  envío automático seguro (auto)
        │
        ▼
Registro en assistant_runs: qué propuso, qué se validó, qué se hizo y la próxima revisión
```

---

## Paso 1. Conectar Gemini

Nexo Solar ya hablaba con APIs compatibles con OpenAI. Gemini tiene una, así que no hace falta instalar otra librería.

1. Entra a **Google AI Studio** → **Get API key** → **Create API key**.
2. Abre `backend/.env` (nunca `backend/.env.example`) y deja estas líneas:

   ```
   AI_PROVIDER=gemini
   GEMINI_API_KEY=pega_aquí_tu_clave
   GEMINI_MODEL=gemini-3.8-flash
   ```

   La clave vive **solo** en `backend/.env`, que está en `.gitignore`. No la pegues en el chat, en el código ni en GitHub.
3. Comprueba la conexión. Este comando nunca muestra la clave:

   ```bash
   npm run ai:check
   ```

   Revisa 4 cosas: la configuración, que el modelo exista para tu clave, la primera prueba del plan (interpretar "¿El precio incluye la instalación?") y una propuesta del asistente con una cotización ficticia en memoria. Si todo sale bien, termina con `Listo: gemini está conectado…`.
4. Reinicia el backend:

   ```bash
   npm run dev:backend
   ```

   Al arrancar debe decir `Interpretación: gemini (gemini-3.8-flash)`. En la consola, la etiqueta de arriba cambia a **IA: gemini**.

**Qué cambió en el código** (`backend/src/ai/providers.js` y `backend/src/config.js`):

- `AI_PROVIDER=gemini` usa la URL compatible de Gemini (`https://generativelanguage.googleapis.com/v1beta/openai`). También funciona el plan original con `AI_PROVIDER=openai` y `OPENAI_BASE_URL` apuntando a Gemini.
- Pide la respuesta con **esquema JSON** (`response_format: json_schema`). Si el proveedor no lo acepta, reintenta en modo JSON y lo recuerda.
- No fija la temperatura en 0: Google recomienda dejar la predeterminada en Gemini 3, porque con valores bajos puede ciclarse.
- `GEMINI_REASONING_EFFORT=low` hace que responda rápido (también acepta `medium` o `high`).
- Lee la respuesta **en streaming** y deja de leer en cuanto el JSON está completo. Si el modelo sigue escribiendo espacios después, no hay que esperarlo.
- El asistente tiene hasta 60 s (`ASSISTANT_TIMEOUT_MS`); la interpretación de un mensaje, 20 s (`AI_TIMEOUT_MS`).
- **Pausa automática.** Si Gemini responde 429 (límite de uso), clave inválida, modelo inexistente o se cae, se deja de llamar un rato: 1 minuto (o lo que diga Google) por cuota, 5 minutos por clave o modelo, 15 segundos por caídas. Mientras tanto se usan el clasificador de respaldo y las plantillas, y la consola muestra el motivo.
- Los errores se explican en español y nunca incluyen la clave.

> **La primera vez** que activas Gemini, el sistema interpreta los mensajes ya guardados (una sola vez: quedan en caché). Puede tardar uno o dos minutos.

---

## Paso 2. El conocimiento de Nexo Solar

Gemini ya viene entrenado. No le enseñamos nada nuevo: **en cada consulta le mandamos el contexto que necesita**.

| Información | Dónde está | Quién la edita |
|---|---|---|
| Paquetes, precios de lista y ahorro | `backend/src/portal/catalog.js` | Equipo (el mismo catálogo del portal) |
| Condiciones aprobadas: qué incluye el precio, instalación, tiempos, garantías, pagos, financiamiento, mantenimiento, apagones, descuentos, factura | `backend/src/ai/conocimiento.js` | Equipo comercial |
| Políticas de contacto y revisión | `backend/src/ai/knowledge.js` (usa los valores de `.env` y R1–R6) | — |
| Contexto de la cotización: etapa, paquete, monto, solicitud, secciones abiertas, mensajes, restricciones, decisión del motor, perfil del cliente y lecciones | Lo arma `buildAssistantContext` en `backend/src/ai/assistant.js` | Automático |

> ⚠️ Las condiciones de `conocimiento.js` (por ejemplo, 25 años de garantía de rendimiento o financiamiento de 12 a 36 meses) son **datos de demostración**. Revísenlas en equipo.

**Lo que nunca se manda a Gemini:** nombres, correos ni teléfonos. El borrador saluda con el marcador `{nombre}` y el backend lo llena después. Además, si un mensaje trae un correo o un teléfono, se reemplaza por `[correo]` o `[teléfono]`. Es importante porque en el plan gratuito Google puede usar lo que se envía para mejorar sus productos (si usan una cuenta con facturación de Google Cloud, deja de hacerlo).

---

## Paso 3. El comportamiento del asistente

Las instrucciones están en `ASSISTANT_SYSTEM` (`backend/src/ai/assistant.js`). En resumen: usar solo condiciones aprobadas, proponer la acción del motor, tratar los mensajes del cliente como datos (nunca como órdenes), escribir borradores breves y sin presión, y pedir revisión humana cuando haga falta.

Gemini devuelve siempre este JSON (respuesta estructurada):

| Campo | Qué es |
|---|---|
| `summary` | Resumen del caso |
| `customer_need` | Qué necesita el cliente ahora |
| `proposed_action`, `timing`, `scheduled_for` | Acción propuesta y momento |
| `explanation`, `evidence_event_ids`, `knowledge_used` | Explicación, eventos que la respaldan y conocimiento que usó |
| `draft_message` | Borrador para el cliente (solo si procede contactar) |
| `missing_information` | Datos faltantes |
| `requires_human_review`, `human_review_reason` | Si una persona debe revisar y por qué |
| `confidence` | Certeza |

**El backend no confía ciegamente en esa respuesta** (`backend/src/ai/assistant-checks.js`):

1. **Manda el motor de reglas.** La acción autorizada siempre es la del motor. Si Gemini sugiere otra, se respeta el motor y se pide revisión humana.
2. **Reglas a esta hora.** Se vuelven a calcular R1–R4 y las esperas que pidió el cliente.
3. **Borrador.** Solo se puede enviar si la acción permite contactar y si el texto:
   - no ofrece descuentos, promociones ni regalos;
   - no presiona ni da por hecha la compra (R5);
   - solo usa cifras que están en el conocimiento aprobado o en la cotización (una garantía de "30 años" inventada no pasa);
   - no trae enlaces, correos ni teléfonos, ni marcadores sin llenar.
4. **Revisión humana** si el cliente pide un descuento, intenta cambiar las reglas, el motor la pide (por ejemplo, monto alto) o algo no pasó los chequeos.

Si Gemini falla o no está configurado, responde una **plantilla** con la decisión del motor y el conocimiento aprobado. Así la consola nunca se queda sin propuesta.

---

## Paso 4. "Entrenar" con ejemplos y correcciones

No se ajustan los pesos del modelo. Se usan tres cosas:

1. **Ejemplos revisados** (`backend/src/ai/ejemplos.js`). Van en las instrucciones (few-shot):

   | Ejemplo | Resultado esperado |
   |---|---|
   | Pregunta sobre garantía | Responder con la garantía aprobada |
   | Pide esperar hasta el viernes | Programar la revisión y esperar |
   | Rechaza la propuesta | Detener el seguimiento |
   | Pide un descuento sin autorización | Escalar al comercial responsable |
   | Intenta cambiar las reglas | No obedecer y pedir revisión |
   | Pregunta con el contacto prohibido | Sin borrador, revisión interna |

   Para agregar uno, copia un bloque, cambia los datos y reinicia.
2. **Correcciones del equipo.** En la consola, si usas **Usar este borrador** y lo cambias antes de enviarlo, el backend guarda tu versión (sin nombres) en la tabla `assistant_feedback`. En las siguientes propuestas parecidas, Gemini ve "así lo prefiere el equipo".
3. **Evaluación con casos aparte** (`backend/src/ai/evaluacion.js`). Son 11 casos que **no** están en los ejemplos: así se mide si un cambio mejora o empeora.

   ```bash
   npm run ai:eval              # con Gemini
   npm run ai:eval -- --sin-ia  # solo plantillas, como punto de comparación
   ```

   Sin IA, las plantillas pasan 33 de 41 comprobaciones. Fallan, por ejemplo, con "el jueves les digo si avanzamos", porque no es una fecha explícita, o con preguntas de mantenimiento y apagones que no tienen respuesta fija. Ahí es donde Gemini debe sumar. Si tu cuota es baja, usa `--pausa=10`.

El ajuste fino del modelo solo valdría la pena si estas mediciones muestran que hace falta.

---

## Paso 5. Asistente autónomo

El recorrido está en `backend/src/services/assistant.js`:

```
nuevo mensaje, nueva solicitud o revisión programada
→ consultar la cotización (decisión del motor al día)
→ Gemini propone el siguiente paso
→ validar políticas y datos actuales
→ ejecutar solo lo autorizado
→ registrar el resultado y la próxima revisión
```

El modo se elige con `ASSISTANT_AUTOPILOT` en `backend/.env`:

| Modo | Qué hace |
|---|---|
| `off` | Solo cuando el equipo presiona **Generar propuesta** |
| `draft` (predeterminado) | Además prepara la propuesta solo cuando llega un mensaje o una solicitud y en las revisiones programadas (cada `ASSISTANT_REVIEW_MINUTES`, solo con el reloj en vivo). **Nunca envía.** |
| `auto` | Envía **solo** los borradores de Gemini que pasan todas las validaciones, sin revisión humana pendiente y con certeza media o alta. Todo lo demás queda como borrador para el equipo. |

Medidas de seguridad en `auto`:

- Justo antes de enviar se vuelven a revisar las reglas (`replyFromAssistant` en `backend/src/portal/service.js`).
- Cada envío automático usa un identificador fijo por situación. Aunque dos servidores usen la misma base de datos, el mensaje no se duplica.
- R4 impide volver a escribir en 24 h y, después de 2 seguimientos sin respuesta, el motor deja de insistir.
- Si alguien del equipo ya respondió, no se envía.
- Si el motor decide esperar o no actuar, no se gasta una llamada a Gemini: se registra la próxima revisión.

**Recomendación:** prueben primero con `draft` y datos ficticios, como pide el plan. Activen `auto` solo para la demostración en vivo.

---

## En la consola

**Cotizaciones →** un caso del portal **→ Atender al cliente**. Ahí aparece el panel **Asistente comercial**:

- Estado de la propuesta (borrador listo, requiere revisión, revisión programada, enviado…) y quién la hizo (Gemini o plantilla).
- Resumen, necesidad del cliente, acción y momento, revisión humana, explicación con evidencia y datos faltantes.
- El borrador con **Usar este borrador**: llena el mensaje para que lo revises y lo envíes.
- **Validaciones del backend:** la lista de chequeos que pasó o no.
- **Generar propuesta / Generar de nuevo:** pide una propuesta en ese momento.

## API

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/assistant/status` | IA activa, modo, versión del conocimiento, ejemplos, correcciones y propuestas recientes |
| GET | `/api/cases/:id/assistant` | Última propuesta del caso y si sigue vigente |
| POST | `/api/cases/:id/assistant` | Generar una propuesta ahora |
| POST | `/api/cases/:id/reply` | Enviar la respuesta; con `assistant_run_id` guarda la corrección del equipo |

## Problemas comunes

| Mensaje | Qué hacer |
|---|---|
| `Gemini rechazó la clave` | Copia otra vez la clave en `backend/.env`, sin comillas ni espacios. Corre `npm run ai:check`. |
| `no encontró el modelo … (404)` | Usa un modelo de la lista que muestra `npm run ai:check`, por ejemplo `gemini-3.5-flash-lite`. |
| `alcanzó su límite de uso (429)` | Espera un minuto. Revisa tus límites en AI Studio o usa `gemini-3.5-flash-lite`, más barato y rápido. |
| `IA en pausa … s más` | Es la pausa automática después de un error; se reintenta sola. |
| `no respondió en … s (tiempo máximo)` | Corre `npm run ai:diagnose`: hace la consulta del asistente 3 veces, mide cuándo llega el primer texto y el JSON completo y te dice qué ajustar (`GEMINI_STRICT_SCHEMA=false`, `gemini-3.5-flash-lite` o un tiempo mayor). |
| La etiqueta dice "clasificador de respaldo" | Falta `AI_PROVIDER=gemini` o `GEMINI_API_KEY`, o no reiniciaste el backend. |

## Archivos

```
backend/src/config.js               variables GEMINI_* y ASSISTANT_*
backend/src/ai/providers.js         conexión con Gemini (y Claude u otras APIs), pausa y diagnóstico
backend/src/ai/conocimiento.js      condiciones aprobadas (EDITABLE)
backend/src/ai/knowledge.js         arma el conocimiento: catálogo + condiciones + políticas
backend/src/ai/ejemplos.js          ejemplos revisados (EDITABLE)
backend/src/ai/assistant.js         instrucciones, esquema, contexto sin datos personales y plantilla
backend/src/ai/assistant-checks.js  validación de la propuesta y del borrador
backend/src/ai/evaluacion.js        casos de evaluación (separados de los ejemplos)
backend/src/services/assistant.js   ciclo autónomo y modos off / draft / auto
backend/src/cli/check-ai.js         npm run ai:check
backend/src/cli/eval-assistant.js   npm run ai:eval
backend/src/cli/diagnose-ai.js      npm run ai:diagnose (velocidad de la propuesta)
backend/test/gemini.test.js         conexión con un Gemini simulado
backend/test/assistant.test.js      validación, privacidad, plantilla y correcciones
backend/test/autopilot.test.js      borradores, envío automático y API
frontend/src/components/AssistantPanel.jsx  panel del asistente en la consola
```

Las tablas `assistant_runs` y `assistant_feedback` se crean solas en PostgreSQL al iniciar el backend.
