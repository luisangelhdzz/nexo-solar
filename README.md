# Nexo Solar: siguiente paso para cada cotización

Prototipo para el reto **ByeCode: What Should Happen Next?**

Nexo Solar es una empresa ficticia que vende e instala paneles solares para negocios. Sus cotizaciones son las "propuestas comerciales" del reto.

El sistema recibe los eventos de cada cotización: apertura, vistas, mensajes del cliente, acciones de la empresa, restricciones y cierre. Con ellos recomienda **qué hacer después, cuándo y por qué**, incluido **no intervenir** cuando es lo correcto. Hace tres cosas:

- Interpreta los mensajes del cliente con IA (Gemini) y, con el **asistente comercial**, propone el siguiente paso y redacta borradores que el backend valida.
- Aplica las reglas R1–R6 con código determinístico.
- Valida cada recomendación antes de publicarla.
- Sigue cada cotización por **etapas** y, al cerrarse, analiza **por qué se compró o no** para aprender de cada resultado.

**Stack:** React + Vite (frontend), Node + Express (backend) y PostgreSQL (opcional; sin base, guarda en memoria).

Un solo servidor sirve dos pantallas:

| Dirección | Para quién | Qué hace |
|---|---|---|
| `/` | Equipo comercial y jueces | Consola: resumen de inacción, casos, clientes, reglas, exportación JSON |
| `/portal` | Cliente (celular) | Pedir cotización, revisarla, escribir dudas, pedir que no lo contacten, comprar y recibir el comprobante por correo |

---

## 1. Requisitos

- **Node.js 18.17 o superior.** Se recomienda la versión 20 LTS; en macOS se instala desde nodejs.org o con `brew install node@20`.
- **PostgreSQL (opcional).** Sin él todo funciona en memoria.
- **Clave de Gemini (opcional).** Se crea en Google AI Studio; guía paso a paso en [docs/GEMINI.md](docs/GEMINI.md). Sin clave se usan el clasificador de respaldo y plantillas, sin red.
- **n8n (opcional).** Manda al cliente por correo el acuse de su solicitud, su propuesta y el comprobante de compra ([guía](n8n/README.md)).

## 2. Instalación y ejecución local

```bash
npm run setup      # instala backend y frontend, y compila el frontend
npm start          # http://localhost:3001  (consola)  y  http://localhost:3001/portal
```

En la consola, abre **Carga de datos** y elige una opción:

- **Cargar datos de demostración:** 6 empresas ficticias con historial de compras. Activa el reloj en vivo.
- **Kit público del reto:** `manifest.json` → `events.jsonl` → `updates.jsonl`. Usa la hora fija del manifest.

Para probar el portal desde tu celular en el mismo Wi-Fi, abre `http://IP-DE-TU-MAC:3001/portal`. La IP aparece en Preferencias del Sistema → Red.

### Modo desarrollo (recarga automática)

Usa dos terminales:

```bash
npm run dev:backend    # API en :3001
npm run dev:frontend   # interfaz en http://localhost:5173 (y /portal)
```

## 3. Variables de entorno

Copia `backend/.env.example` como `backend/.env`. **Nunca subas el `.env` al repositorio.**

| Variable | Para qué sirve | Por defecto |
|---|---|---|
| `PORT` | Puerto | `3001` |
| `DATABASE_URL` | PostgreSQL. Vacía = memoria | vacía |
| `DATABASE_SSL` | `true` si la base en la nube exige SSL (conexión externa) | `false` |
| `ADMIN_PASSWORD` | Contraseña de la consola. **Obligatoria al desplegar** | vacía |
| `SEED_DEMO` | Carga los datos de demostración al arrancar si la base está vacía | `false` |
| `AI_PROVIDER` | `gemini`, `anthropic`, `openai` o `heuristic` | `heuristic` |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_REASONING_EFFORT`, `GEMINI_STRICT_SCHEMA` | Gemini por su API compatible con OpenAI ([guía](docs/GEMINI.md)) | —, `gemini-3.8-flash`, `low`, `true` |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Claude | `claude-haiku-5-5` |
| `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL` | Cualquier API compatible con OpenAI: OpenAI, Groq u Ollama | — |
| `ASSISTANT_AUTOPILOT` | Asistente: `off` (solo bajo pedido), `draft` (prepara borradores solo) o `auto` (envía solo lo que pasa todas las validaciones) | `draft` |
| `ASSISTANT_REVIEW_MINUTES`, `ASSISTANT_TIMEOUT_MS` | Cada cuánto revisa cotizaciones pendientes y tiempo máximo de la IA | `5`, `60000` |
| `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET` | Correos al cliente por n8n: acuse de la solicitud, propuesta y comprobante ([guía](n8n/README.md)) | vacías |
| `PUBLIC_URL` | Dirección para los enlaces de los correos. En Render se toma sola | `http://localhost:3001` |
| `FOLLOW_UP_HOURS` | Horas sin actividad antes de proponer un seguimiento | `48` |
| `HIGH_AMOUNT_MXN` | Monto a partir del cual se pide revisión humana | `500000` |
| `MAX_UNANSWERED_FOLLOWUPS` | Seguimientos sin respuesta antes de dejar de insistir | `2` |
| `PATIENCE_MARGIN` | Margen sobre el tiempo típico de decisión de un buen cliente | `1.2` |

## 4. Inacción por historial del cliente (extensión del portal)

Las cotizaciones que crea el portal incluyen `customer_id` en `case.opened`. Con eso el sistema arma el **perfil del cliente** a partir de sus cotizaciones anteriores:

- Compras y rechazos.
- Tiempo típico para decidir (mediana de horas entre la apertura y la compra) y su rango.
- Si es "buen cliente": 2 o más compras sin rechazos frecuentes, o marcado como de confianza por el equipo.

El equipo también puede llenar una **ficha** en la pestaña Clientes: "cliente de confianza", "suele decidir en X horas" y notas. Es lo que el equipo ya sabe del cliente.

**Regla de inacción:** si un buen cliente tiene una cotización abierta, **no ha pedido nada** y la empresa no ha intervenido, el sistema recomienda `wait` con `at_date`.

- La fecha es la apertura + tiempo típico × `PATIENCE_MARGIN`. Por ejemplo, 47 h × 1.2 = 57 h.
- La explicación dice "Lo correcto es no intervenir…" y cuándo reevaluar.
- Si pasa esa ventana sin compra, sugiere un seguimiento amable (`contact`, `within_24h`).

**Límites:**

- Si el buen cliente pregunta algo, se le responde. La inacción solo aplica cuando no hay petición.
- Nunca rompe reglas: R1–R4, la prohibición de contacto y las fechas pedidas mandan siempre.
- La evidencia sigue siendo solo eventos del mismo caso. El historial se cita en la explicación.
- Sin `customer_id`, que es el caso del kit y de los jueces, el sistema decide exactamente igual que antes.

¿Es `wait` o `no_action`? Es **`wait`**, porque se debe volver a revisar en una fecha. `no_action` es para cuando no hay nada que hacer, como un caso cerrado o un cliente sin interés.

## 5. Etapas, por qué se compró o no, y aprendizaje

### Embudo por etapas

Cada cotización avanza por etapas que se derivan de sus eventos:

```
Enviada → Revisando → Con dudas → Decidiendo → Comprada | Perdida
```

| Etapa | Cuándo se entra |
|---|---|
| Revisando | El cliente abre la cotización |
| Con dudas | Pregunta, expresa un reparo o pide más información |
| Decidiendo | Se atendieron sus dudas, revisó a fondo, compara opciones o pidió tiempo |
| Comprada / Perdida | Se cierra el caso |

Puede regresar a "Con dudas" si vuelve a preguntar. Se guarda el evento que causó cada cambio y el tiempo en cada etapa.

### Por qué se compró o no (no es un sí/no)

Al cerrarse una cotización se calculan factores medibles a favor (+) y en contra (−):

| Tipo | Factores |
|---|---|
| A favor (+) | Dudas respondidas rápido, revisión a fondo, se respetó el tiempo que pidió, decidió dentro de su tiempo habitual, un seguimiento a tiempo la reactivó |
| En contra (−) | Dudas sin respuesta o respondidas tarde, reparo de precio, comparaba opciones, contactos sin respuesta o durante una espera recomendada, contacto con restricción, poca interacción, dijo que no le interesa |

También se revisa si la empresa siguió la recomendación vigente cuando actuó. Con eso se arma un resumen ("Se perdió tras 90 h. Lo que pesó: …") y una **lección**:

- Con IA configurada, la lección la redacta el modelo a partir del análisis estructurado, nunca de los mensajes crudos.
- Sin IA, se usa una plantilla.

### Cómo aprende (sin entrenar un modelo)

1. **Lecciones para el LLM.** Al interpretar mensajes nuevos, el modelo recibe como contexto hasta 4 lecciones recientes, primero las del mismo cliente. Van marcadas como contexto: no son instrucciones y no cambian reglas.
2. **Tiempos ajustados con datos.**
   - Con 3 o más compras, el tiempo de seguimiento tras el silencio del cliente pasa del valor fijo (48 h) al percentil 75 de lo que tardaron los compradores. En los datos demo queda en 34 h.
   - Las recomendaciones de "aclarar duda" mencionan en cuánto se respondieron las dudas en las compras ganadas (~2 h en los datos demo).
3. **Versiones.** Cada vez que se cierra una cotización cambia lo aprendido: v1, v2… La pestaña **Aprendizaje** muestra el historial.

**Modo de aprendizaje** (pestaña Aprendizaje):

| Modo | Comportamiento |
|---|---|
| Automático | Aprende solo con el reloj en vivo; con la hora del manifest (kit oficial, jueces) se apaga para que el resultado sea reproducible |
| Siempre | Aprende también con la hora del manifest |
| Apagado | Usa solo los valores predeterminados |

Las reglas R1–R6 nunca se aprenden ni cambian.

## 6. Portal del cliente

Empresa ficticia, sin cobros reales. Desde el celular:

1. **Entrar:** elige una empresa de la lista o registra la tuya.
2. **Solicitar una cotización:** formulario de negocio, contacto, gasto de luz, instalación y preferencias. Genera `case.opened` con `proposal_status=pending`, sin monto ni propuesta enviada, y el cliente recibe por correo el acuse con el resumen. El equipo selecciona una solución de referencia interna y publica el precio y alcance desde el dashboard; `proposal.sent` inicia la etapa Enviada y la propuesta también llega al correo del cliente.
3. **Revisar secciones:** precio, instalación, garantía, financiamiento y entrega. Cada apertura genera `proposal.viewed`.
4. **Escribir una duda:** genera `message.received`.
5. **Elegir cómo quiere que lo contacten:** "No me contacten antes del…" o "Prefiero que no me contacten". Genera `constraint.updated`.
6. **Aceptar o rechazar:** genera `case.closed`. Al aceptar, el comprobante llega solo al correo de la solicitud; el cliente también puede pedirlo a otro correo.

El portal **nunca muestra la recomendación interna**. Los correos automáticos respetan R2 y R3: si el cliente pidió no ser contactado o esperar hasta una fecha, no salen. Si n8n no está configurado, todo se ve en el portal y el comprobante se muestra en pantalla. Configuración de n8n: [`n8n/README.md`](n8n/README.md).

## 7. Reloj: hora del manifest o en vivo

| Modo | Para qué | Cómo se activa |
|---|---|---|
| **Hora del manifest** | Fija y reproducible: kit, jueces y exportación oficial | Al cargar `manifest.json` |
| **En vivo** | Hora real, para el portal y la demo | Al cargar los datos de demostración o al usar el portal |

En vivo puedes **adelantar el reloj** (+6 h, +24 h, +48 h) para mostrar cómo vence la espera de un buen cliente sin esperar dos días reales. La consola se actualiza sola cada 8 segundos.

## 8. Desplegar en Render

1. Sube el repositorio a GitHub. El `.gitignore` ya excluye `.env` y `node_modules`.
2. En Render: **New → Blueprint** y elige el repositorio. `render.yaml` crea el servicio web y una base PostgreSQL gratuita.
3. Llena en el panel:
   - **`ADMIN_PASSWORD`** (obligatoria).
   - La clave de IA, si usarán una.
   - `N8N_WEBHOOK_URL` y `N8N_WEBHOOK_SECRET`, si usarán correos con n8n ([guía](n8n/README.md)).
4. Al terminar quedan dos direcciones: `https://TU-SERVICIO.onrender.com` (consola, pide contraseña) y `.../portal` (público).

**Detalles del plan gratuito:**

- El servicio se duerme tras 15 minutos sin tráfico y tarda cerca de un minuto en despertar. Ábranlo antes de la demo.
- La base gratuita dura 30 días, suficiente para el hackatón.
- Con `SEED_DEMO=true`, si la base está vacía al arrancar se cargan los datos de demostración.
- El portal tiene un límite de solicitudes por IP.
- Para n8n en la nube y el backend en Render, el webhook debe ser una URL pública. Un n8n en tu Mac no es alcanzable desde Render.

## 9. Cómo se usa la IA

La IA **interpreta los mensajes del cliente** y, con el asistente, **propone** el siguiente paso; nunca decide la acción final.

1. **Contexto.** Por cada mensaje se arma un resumen del caso: monto, si se permite el contacto e historial. El mensaje va delimitado como dato no confiable.
2. **Salida estructurada.** El modelo devuelve JSON con `intent`, `topic`, `facts`, `inferences`, `missing_information`, `needs_from_client`, `requested_contact_after`, `manipulation_attempt` y `confidence`. Con Gemini se pide salida con esquema JSON (con la temperatura predeterminada que recomienda Google para Gemini 3); con Claude se fuerza una herramienta; con otras APIs se usa modo JSON y temperatura 0.
3. **Validación.** Se valida en código. Si falla, se usa el clasificador de respaldo. La interfaz muestra qué produjo cada interpretación.
4. **Manipulación.** Órdenes al sistema ("ignora tus reglas", "dame 50% de descuento") se marcan aunque el modelo no las detecte, y el caso se escala.
5. **Caché.** Cada interpretación se guarda por evento, modelo y texto, para que los resultados se puedan repetir.

El correo del cliente nunca se manda al modelo.

### Asistente comercial (Gemini)

Guía completa, paso a paso: **[docs/GEMINI.md](docs/GEMINI.md)**.

- **Contexto sin datos personales.** Por cada cotización recibe el historial, la decisión vigente del motor, las restricciones, el catálogo y las condiciones aprobadas (`backend/src/ai/conocimiento.js`). No recibe nombres, correos ni teléfonos: el saludo usa `{nombre}` y el backend lo llena.
- **Respuesta estructurada.** Resumen, necesidad del cliente, acción y momento, explicación con evidencia, borrador, datos faltantes y si hace falta revisión humana.
- **Validación.** La acción autorizada siempre es la del motor de reglas; las reglas se revisan otra vez a la hora actual; el borrador solo se puede enviar si el contacto está permitido y no ofrece descuentos, no presiona (R5), solo usa cifras aprobadas y no trae enlaces ni teléfonos.
- **Ejemplos y correcciones.** Seis ejemplos revisados (`ejemplos.js`) y las correcciones que el equipo hace a los borradores orientan las siguientes propuestas. No se reentrena el modelo. `npm run ai:eval` lo mide con casos aparte.
- **Autonomía por pasos.** `ASSISTANT_AUTOPILOT=draft` prepara borradores al llegar mensajes y en revisiones programadas; `auto` envía solo lo que pasa todas las validaciones, revisando las reglas justo antes de enviar y sin duplicados.
- **Verificación.** `npm run ai:check` prueba la conexión sin mostrar la clave y `npm run ai:diagnose` mide cuánto tarda la propuesta.

## 10. Cómo se decide

```
eventos → validar → deduplicar → historial por caso → estado → IA interpreta mensajes
       → (perfil del cliente, si hay) → acción ideal → reglas R1–R4 → alternativa válida
       → guardián (contrato + R1–R6) → guardar con la decisión anterior → consola / exportación
```

**Acción ideal:**

| Situación | Acción ideal |
|---|---|
| Pregunta u objeción | `resolve_objection` |
| Falta un dato del cliente | `request_information` |
| Interés o comparando opciones | `contact` en 24 h |
| Pide esperar | `wait` a esa fecha |
| Sin interés | `no_action` |
| Manipulación | `escalate` |
| Buen cliente dentro de su tiempo | `wait` |
| Sin mensajes | Según el tiempo sin actividad; las aperturas nunca dan urgencia (R5) |

**Si la acción ideal está bloqueada:**

- Bloqueo temporal (R3, R4 o una fecha pedida): `wait` con fecha.
- Contacto prohibido (R2) y el cliente pidió algo: `escalate`.
- Contacto prohibido sin petición: `wait` con `on_new_information`.

**Guardián.** Revisa:

- El contrato y la combinación acción/timing.
- R1–R4.
- R5: sin afirmar compra, descuentos ni urgencia.
- Contacto disfrazado.
- Que la evidencia sea del mismo caso.
- Que `wait` diga cuándo reevaluar.

Si algo falla, publica `wait` con revisión humana.

**Confianza:**

- **Alta:** evento estructurado, mensaje explícito con certeza alta, o patrón de 3 o más compras consistentes.
- **Media:** solo aperturas, solo tiempo sin respuesta, patrón corto, o motivo de R2 desconocido.
- **Baja:** mensaje ambiguo.

**Riesgo:** sube con manipulación, objeciones, comparación con otros, montos altos o una petición que no se puede atender.

**Revisión humana:** se pide si la acción es `escalate`, el riesgo es alto, el monto es alto, o la confianza es baja y la acción implica contactar.

## 11. API

**Consola** (pide `x-admin-password` si hay `ADMIN_PASSWORD`):

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/summary` | Resumen de inacción, agenda de reevaluación y "actuar ahora" |
| GET | `/api/cases`, `/api/cases/:id` | Casos y detalle: reglas, interpretaciones, traza, cliente |
| GET | `/api/customers`, `/api/customers/:id` | Clientes con perfil, cotizaciones y comprobantes |
| GET | `/api/insights` | Embudo, factores de compra/pérdida, tiempos aprendidos, lecciones y versiones |
| PUT | `/api/settings/learning` | `{ mode: 'auto' \| 'on' \| 'off' }` |
| PATCH | `/api/customers/:id` | Ficha del equipo: `{ trusted, decision_hours_override, notes }` |
| POST | `/api/manifest`, `/api/events`, `/api/evaluate` | Cargar manifest o JSONL; evaluar |
| PUT | `/api/settings/clock` | `{ mode: 'manifest' \| 'live', offset_hours }` |
| POST | `/api/settings/clock/advance` | Adelantar el reloj: `{ hours }` |
| PUT | `/api/settings/evaluation-at` | Hora fija |
| POST | `/api/cases/:id/events` | Simulador |
| GET | `/api/export` | Recomendaciones (contrato) |
| POST | `/api/demo/seed`, `/api/demo/kit/:file`, `/api/reset` | Atajos de demostración |
| GET | `/api/assistant/status` | Asistente: IA, modo, conocimiento, ejemplos, correcciones y propuestas recientes |
| GET, POST | `/api/cases/:id/assistant` | Última propuesta del asistente para el caso / generar una nueva |
| POST | `/api/cases/:id/reply` | Responder en el portal; con `assistant_run_id` guarda la corrección del equipo al borrador |

**Portal** (público, `x-customer-id`):

| Método | Ruta |
|---|---|
| GET | `/api/portal/catalog`, `/api/portal/customers`, `/api/portal/me` |
| POST | `/api/portal/customers` |
| POST | `/api/portal/quotes` |
| POST | `/api/portal/quotes/:id/view`, `/messages`, `/contact`, `/accept`, `/reject`, `/invoice` |

## 12. Pruebas

```bash
npm test
```

Son más de 130 pruebas sin red, más dos con PostgreSQL (`TEST_DATABASE_URL`). Cubren:

- Reglas R1–R4 y validación de eventos.
- Kit P01–P06 y el cambio de P06.
- Variantes como las que podrían usar los jueces.
- El guardián y el respaldo de la IA.
- Inacción por historial: buen cliente, pregunta pendiente, ventana vencida, ficha del equipo, que nunca rompa reglas.
- El portal completo: venta, comprobante y dueño de cada cotización.
- Correos por n8n contra un webhook simulado: acuse, propuesta y comprobante, R2/R3, reintento, secreto incorrecto y escape de HTML. `npm test` nunca usa el n8n ni la IA de tu `.env`.
- La contraseña de la consola.
- Etapas, análisis de compras y pérdidas, lecciones (IA y plantilla), tiempos aprendidos y versiones.
- Que con la hora del manifest el aprendizaje no cambie el resultado oficial del kit.
- Gemini contra un servidor simulado: salida con esquema, reintentos, límite de uso (429) con pausa, clave inválida y respuestas vacías.
- El asistente: manda el motor de reglas, borradores sin descuentos ni cifras inventadas, privacidad del contexto, plantilla de respaldo y correcciones del equipo.
- El ciclo autónomo: borradores en segundo plano, envío automático una sola vez y nada se envía si hace falta revisión humana.

## 13. Resultados con el kit público

Hora: 9 oct 2026, 16:00 UTC. Archivo: `recomendaciones.json` (`npm run evaluate:kit`).

| Caso | Recomendación |
|---|---|
| P01 | `resolve_objection`, `immediate` (pregunta por la instalación) |
| P02 | `wait` hasta 11 oct 15:00 UTC (R5: solo una apertura; el duplicado se ignora) |
| P03 | `wait` hasta 12 oct 15:00 UTC (igual a `ejemplo_salida.json`) |
| P04 | `escalate`, `immediate`, revisión humana (R2) |
| P05 | `no_action` (R1) |
| P06 | `wait` por R4 y, tras `updates.jsonl`, `resolve_objection` |

## 14. Guion de demostración (5 minutos)

1. **Kit (50 s).** Carga el kit del reto. Muestra P01 (evidencia), P04 (contacto bloqueado por R2) y P06 cambiando con `updates.jsonl`.
2. **Resumen (20 s).** Carga los datos de demostración. Muestra "Lo correcto es no intervenir en X de Y" y el porqué de cada espera.
3. **Venta en vivo desde el celular (1 min 40 s).**
   - Un compañero entra al portal como **Abarrotes La Esperanza** (3 compras, decide en ~47 h) o registra su empresa.
   - Pide una cotización y abre el precio y la garantía.
   - En la consola: **Esperar**, "Lo correcto es no intervenir", con la barra de su ventana de paciencia.
   - Adelanta el reloj +48 h: sigue en espera. +24 h más: pasa a un seguimiento amable.
4. **Compra y comprobante (50 s).** Desde el celular: Aceptar y comprar → el comprobante llega solo al correo de la solicitud. En la consola: el caso pasa a `no_action` (R1) y el cliente suma una compra.
5. **Asistente con Gemini (opcional, 40 s).** El cliente escribe "¿El precio incluye la instalación?". En la consola, el caso muestra la propuesta del asistente: necesidad, acción autorizada por el motor, borrador validado y sus chequeos. **Usar este borrador** → enviar.
6. **Aprendizaje (40 s).** Pestaña Aprendizaje: embudo, qué separa compras de pérdidas, tiempos ajustados con datos y la lección del caso que se acaba de cerrar (la versión sube a v2). En Casos, abre NS-1006 para ver "Por qué no se compró".
7. **Cierre (20 s).** Exportar JSON y `npm test`.

## 15. Limitaciones

- El clasificador de respaldo usa patrones en español.
- Las fechas relativas sin hora se fijan a las 15:00 UTC.
- El portal no tiene autenticación real de clientes: es una demo con empresas ficticias.
- El comprobante no es una factura fiscal (CFDI).
- Las condiciones comerciales de `backend/src/ai/conocimiento.js` (garantías, tiempos, financiamiento) son de demostración.
- En el plan gratuito de Gemini, Google puede usar lo que se envía para mejorar sus productos; por eso el asistente no envía datos personales y la demo usa empresas ficticias.
- No hay procesamiento continuo: se reevalúa al llegar eventos, al consultar en modo en vivo o con el botón Evaluar.

## 16. Estructura

```
kit/                       archivos públicos del reto
recomendaciones.json       salida oficial de los casos públicos
NOTA_TECNICA.md            nota técnica de una página
render.yaml                despliegue en Render (web + PostgreSQL)
n8n/                       flujos importables Webhook → Gmail o SMTP y su guía
backend/
  src/domain/              validación, estado, reglas, política, guardián, perfil del cliente,
                           etapas (stages.js), por qué se compró o no (outcome.js), aprendizaje (learning.js)
  src/ai/                  prompt, proveedores (Gemini / Claude / compatible con OpenAI), respaldo, lecciones,
                           asistente: conocimiento.js, ejemplos.js, evaluacion.js, validación de borradores
  src/services/assistant.js  ciclo del asistente: propone → valida → ejecuta lo autorizado → registra
  src/portal/              catálogo, servicio del portal, datos demo, correos (correos.js), comprobante y envío a n8n
  src/storage/             memoria y PostgreSQL (misma interfaz)
  src/services/engine.js   reloj, evaluación, historial, clientes, resumen
  src/routes/api.js        API Express (consola protegida + portal público)
  src/cli/                 evaluación del kit, npm run ai:check, npm run ai:eval y npm run n8n:check
  test/                    pruebas (node:test)
frontend/
  src/components/          consola: resumen, casos, clientes, reloj, carga
  src/portal/              portal del cliente (celular)
```


### Solicitud y propuesta desde el dashboard

- En `/portal#/cotizar` el cliente solicita su proyecto, sin elegir kits. `/portal#/productos` muestra la invitación a cotizar; `/portal#/mis-cotizaciones` muestra solicitudes y propuestas.
- El recibo puede ser mensual o bimestral; se conserva el monto original y se calcula el equivalente mensual. El gasto es opcional: si falta, el motor recomienda solicitarlo.
- En la consola, **Cotizaciones → caso → Preparar propuesta**, el equipo revisa los datos, elige una solución interna, verifica precio y alcance y publica la propuesta en el portal. No se hacen cobros.
- El caso distingue **Solicitud recibida** de **Enviada**. Antes de publicar no hay precio ni aceptación. El tiempo de decisión y el patrón de compra empiezan al enviar la propuesta.
- Las respuestas del equipo quedan en la conversación del portal como `action.executed`. La propuesta y respuestas comprueban restricciones de contacto, fechas de espera, enfriamiento y cierre antes de enviar. Requieren contraseña de consola cuando `ADMIN_PASSWORD` está configurada.
- El portal actualiza sus datos cada 15 segundos y al recuperar el foco. El envío de propuestas y respuestas es al portal; correo y WhatsApp quedan registrados como preferencias, sin prometer entregas por canales aún no integrados.
- `proposal.sent` es una extensión del portal. Los archivos del kit y sus reglas conservan el comportamiento existente. No requiere cambios de esquema: los datos se guardan en los eventos de PostgreSQL.
- Gemini y el asistente autónomo ya están integrados ([docs/GEMINI.md](docs/GEMINI.md)). Por defecto el asistente prepara borradores y el equipo confirma los envíos; con `ASSISTANT_AUTOPILOT=auto` solo envía lo que pasa todas las validaciones.

API de este flujo: `POST /api/portal/requests`, `GET /api/proposal-options`, `POST /api/cases/:id/proposal`, `POST /api/cases/:id/reply`.
