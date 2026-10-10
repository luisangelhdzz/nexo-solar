// Clientes HTTP mínimos para los modelos de lenguaje (sin SDK, usando fetch de Node).
//
// Proveedores (AI_PROVIDER):
//   gemini     -> Google Gemini por su API compatible con OpenAI (GEMINI_API_KEY, GEMINI_MODEL)
//   anthropic  -> Claude (Messages API)
//   openai     -> cualquier API compatible con OpenAI: OpenAI, Groq, Ollama… o Gemini con OPENAI_BASE_URL
//   heuristic  -> sin IA externa: clasificador de respaldo
//
// El modelo nunca decide solo: todo lo que devuelve se valida en código y, si una llamada falla,
// quien la usa cae a su respaldo (clasificador o plantilla) y la consola muestra el motivo.
import { config } from '../config.js';
import { INTERPRETATION_JSON_SCHEMA } from './schema.js';
import { SYSTEM_PROMPT } from './prompt.js';

const GEMINI_HOST = 'generativelanguage.googleapis.com';
export const isGeminiUrl = (url) => String(url || '').includes(GEMINI_HOST);

export class ProviderError extends Error {
  constructor(message, { status = null, body = '', cooldown = false } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status; // código HTTP, 'timeout', 'network' o 'invalid_output'
    this.body = body;
    this.cooldown = cooldown;
  }
}

async function withTimeout(promiseFactory, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await promiseFactory(controller.signal);
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new ProviderError(`El modelo no respondió en ${Math.round(ms / 1000)} s (tiempo máximo).`, { status: 'timeout' });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Una petición completa (encabezados y cuerpo) dentro del tiempo máximo.
async function request(fetchImpl, url, init, ms, label) {
  try {
    return await withTimeout(async (signal) => {
      const res = await fetchImpl(url, { ...init, signal });
      const text = await res.text();
      return { res, text };
    }, ms);
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(`No se pudo conectar con ${label} (${err?.cause?.code || err?.message || 'error de red'}).`, { status: 'network' });
  }
}

// Mensajes claros para los errores más comunes. Nunca incluyen la clave.
export function describeHttpError(label, status, body, model) {
  const text = String(body || '');
  if ([400, 401, 403].includes(status) && /api[ _-]?key/i.test(text)) {
    return `${label} rechazó la clave: revisa que esté bien copiada en backend/.env.`;
  }
  if (status === 401 || status === 403) return `${label} rechazó la solicitud (${status}): la clave no tiene permiso para este modelo o proyecto.`;
  if (status === 404) return `${label} no encontró el modelo "${model}" (404). Comprueba el nombre con npm run ai:check.`;
  if (status === 429) return `${label} alcanzó su límite de uso (429). Espera un momento o revisa tu cuota en Google AI Studio.`;
  if (status >= 500) return `${label} tuvo un error temporal (${status}).`;
  return `${label} respondió ${status}: ${text.replace(/\s+/g, ' ').slice(0, 200)}`;
}

function retryDelayMs(body) {
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(String(body || ''));
  return m ? Math.min(Math.ceil(Number(m[1]) * 1000), 10 * 60000) : null;
}

// Pausa automática: si el proveedor falla por cuota, clave o caída, no se le vuelve a llamar
// durante un rato. Así una evaluación no se queda esperando ni se gasta la cuota en reintentos.
export function createBreaker(now = () => Date.now()) {
  let until = 0;
  let reason = null;
  return {
    check() {
      const left = until - now();
      if (left > 0) throw new ProviderError(`IA en pausa ${Math.ceil(left / 1000)} s más (${reason})`, { cooldown: true });
    },
    trip(err) {
      const s = err?.status;
      let ms = 0;
      if (s === 429) ms = retryDelayMs(err.body) ?? 60000;
      else if ([401, 403, 404].includes(s) || (s === 400 && /api[ _-]?key/i.test(String(err.body || '')))) ms = 5 * 60000;
      else if (s === 'timeout' || s === 'network' || (typeof s === 'number' && s >= 500)) ms = 15000;
      if (ms > 0) {
        until = now() + ms;
        reason = err.message;
      }
    },
    reset() {
      until = 0;
      reason = null;
    },
    state() {
      const active = until > now();
      return { paused_until: active ? new Date(until).toISOString() : null, reason: active ? reason : null };
    },
  };
}

// Diagnóstico sin datos sensibles: cuántas llamadas, cuántas fallaron y el último error.
function createHealth() {
  const h = { calls: 0, failures: 0, last_ok_at: null, last_error: null, last_error_at: null };
  return {
    ok() {
      h.calls += 1;
      h.last_ok_at = new Date().toISOString();
    },
    fail(err) {
      if (err?.cooldown) return;
      h.calls += 1;
      h.failures += 1;
      h.last_error = String(err?.message ?? err).slice(0, 300);
      h.last_error_at = new Date().toISOString();
    },
    snapshot() {
      return { ...h };
    },
  };
}

function guarded(fn, { breaker, health }) {
  return async (args) => {
    breaker.check();
    try {
      const out = await fn(args);
      health.ok();
      return out;
    } catch (err) {
      breaker.trip(err);
      health.fail(err);
      throw err;
    }
  };
}

const normalizeModelId = (id) => (typeof id === 'string' ? id.replace(/^models\//, '') : null);

function messageText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('');
  return '';
}

// Acepta JSON puro, JSON entre ``` o con texto alrededor.
export function parseJsonContent(text) {
  const clean = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  try {
    return JSON.parse(clean);
  } catch { /* se intenta extraer el objeto */ }
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(clean.slice(start, end + 1));
    } catch { /* sin JSON válido */ }
  }
  throw new ProviderError('El modelo no devolvió un JSON válido.', { status: 'invalid_output' });
}

// Claude (Anthropic Messages API). Se fuerza el uso de una herramienta para obtener JSON estructurado.
export function createAnthropic({ apiKey, model, timeoutMs = 20000, fetchImpl = fetch, now }) {
  const label = 'Claude';
  const breaker = createBreaker(now);
  const health = createHealth();
  const structured = guarded(async ({ system, user, schema, toolName, toolDescription, maxTokens = 800, timeoutMs: ms = timeoutMs }) => {
    const body = {
      model,
      max_tokens: maxTokens,
      temperature: 0,
      system,
      tools: [{ name: toolName, description: toolDescription, input_schema: schema }],
      tool_choice: { type: 'tool', name: toolName },
      messages: [{ role: 'user', content: user }],
    };
    const { res, text } = await request(fetchImpl, 'https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    }, ms, label);
    if (!res.ok) throw new ProviderError(describeHttpError(label, res.status, text, model), { status: res.status, body: text });
    const data = JSON.parse(text);
    const block = (data.content || []).find((b) => b.type === 'tool_use' && b.name === toolName);
    if (!block) throw new ProviderError('El modelo no devolvió la herramienta esperada.', { status: 'invalid_output' });
    return { output: block.input, model };
  }, { breaker, health });
  return { name: 'anthropic', model, structured, listModels: null, health: health.snapshot, breaker };
}

// Detecta cuándo un texto que llega por partes ya contiene un objeto JSON completo.
// Ignora llaves dentro de comillas; si el primer objeto no es válido, sigue buscando.
export function createJsonScanner() {
  let text = '';
  let pos = 0;
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  return {
    push(piece) {
      text += piece;
      while (pos < text.length) {
        const ch = text[pos];
        pos += 1;
        if (start < 0) {
          if (ch === '{') {
            start = pos - 1;
            depth = 1;
            inString = false;
            escaped = false;
          }
          continue;
        }
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === '\\') escaped = true;
          else if (ch === '"') inString = false;
          continue;
        }
        if (ch === '"') inString = true;
        else if (ch === '{') depth += 1;
        else if (ch === '}') {
          depth -= 1;
          if (depth === 0) {
            const candidate = text.slice(start, pos);
            start = -1;
            try {
              return JSON.parse(candidate);
            } catch { /* no era un objeto válido: se sigue buscando */ }
          }
        }
      }
      return undefined;
    },
  };
}

// Pide la respuesta en streaming (SSE) y deja de leer en cuanto llega un JSON completo:
// si el modelo sigue escribiendo espacios o texto después, no hay que esperarlo.
// `stopAtJson=false` y `extraAfterJsonMs` sirven al diagnóstico para ver si el modelo seguía escribiendo.
export async function streamCompletion({
  fetchImpl = fetch, url, headers, body, timeoutMs, label = 'El modelo',
  stopAtJson = true, extraAfterJsonMs = 0, maxChars = 60000,
}) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const started = Date.now();
  const timings = { first_ms: null, json_ms: null, end_ms: null };
  const scanner = createJsonScanner();
  let content = '';
  let finish = null;
  let model = body.model;
  let json;
  let afterJson = 0;
  let stopReason = null;
  let jsonDeadline = Infinity;
  const fail = (err) => {
    if (err instanceof ProviderError) return err;
    if (timedOut || err?.name === 'AbortError') {
      return new ProviderError(`El modelo no respondió en ${Math.round(timeoutMs / 1000)} s (tiempo máximo).`, { status: 'timeout' });
    }
    return new ProviderError(`No se pudo conectar con ${label} (${err?.cause?.code || err?.message || 'error de red'}).`, { status: 'network' });
  };
  try {
    let res;
    try {
      res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify({ ...body, stream: true }), signal: controller.signal });
    } catch (err) {
      throw fail(err);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ProviderError(describeHttpError(label, res.status, text, body.model), { status: res.status, body: text });
    }
    const type = String(res.headers.get('content-type') || '');
    if (!type.includes('text/event-stream')) {
      // El servidor ignoró stream y mandó la respuesta completa de una vez.
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new ProviderError(`${label} devolvió una respuesta que no es JSON.`, { status: 'invalid_output' });
      }
      const choice = data.choices?.[0];
      content = messageText(choice?.message?.content);
      finish = choice?.finish_reason ?? null;
      model = data.model || model;
      timings.first_ms = Date.now() - started;
      json = content ? scanner.push(content) : undefined;
      if (json !== undefined) timings.json_ms = timings.first_ms;
      stopReason = 'respuesta_completa';
    } else {
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        reading: for await (const chunk of res.body) {
          buffer += decoder.decode(chunk, { stream: true });
          let nl = buffer.indexOf('\n');
          while (nl >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            nl = buffer.indexOf('\n');
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') break reading;
            let evt;
            try {
              evt = JSON.parse(payload);
            } catch {
              continue;
            }
            const streamError = Array.isArray(evt) ? evt[0]?.error : evt?.error;
            if (streamError) {
              const code = Number(streamError.code) || 500;
              throw new ProviderError(describeHttpError(label, code, JSON.stringify(streamError), body.model), { status: code, body: payload });
            }
            model = evt.model || model;
            const choice = evt.choices?.[0];
            if (choice?.finish_reason) finish = choice.finish_reason;
            const piece = messageText(choice?.delta?.content);
            if (!piece) continue;
            if (timings.first_ms === null) timings.first_ms = Date.now() - started;
            content += piece;
            if (json === undefined) {
              const found = scanner.push(piece);
              if (found !== undefined) {
                json = found;
                timings.json_ms = Date.now() - started;
                if (stopAtJson) {
                  stopReason = 'json_completo';
                  break reading;
                }
                jsonDeadline = Date.now() + extraAfterJsonMs;
              }
            } else {
              afterJson += piece.length;
              if (Date.now() > jsonDeadline) {
                stopReason = 'siguio_escribiendo';
                break reading;
              }
            }
            if (content.length > maxChars) {
              stopReason = 'demasiado_largo';
              break reading;
            }
          }
        }
      } catch (err) {
        throw fail(err);
      }
    }
  } finally {
    clearTimeout(timer);
    controller.abort(); // corta la conexión si el modelo seguía escribiendo
  }
  timings.end_ms = Date.now() - started;
  return { content, json, finish, model: normalizeModelId(model), timings, chars_after_json: afterJson, stop_reason: stopReason ?? 'fin' };
}

// Cualquier API compatible con OpenAI Chat Completions (Gemini, OpenAI, Groq, Ollama...).
export function createOpenAICompatible({
  name = 'openai', label, baseUrl, apiKey, model, gemini = isGeminiUrl(baseUrl), reasoningEffort = null,
  strictSchema = true, timeoutMs = 20000, fetchImpl = fetch, now,
}) {
  const display = label || (gemini ? 'Gemini' : 'El proveedor de IA');
  const breaker = createBreaker(now);
  const health = createHealth();
  // Lo que acepta el proveedor se descubre en la primera llamada y se recuerda.
  const compat = {
    // Salida con esquema (json_schema). Con GEMINI_STRICT_SCHEMA=false se usa el modo JSON simple.
    jsonSchema: strictSchema !== false && (gemini || /api\.openai\.com/.test(String(baseUrl))),
    reasoning: Boolean(gemini && reasoningEffort), // reasoning_effort (nivel de razonamiento de Gemini)
    stream: gemini, // en Gemini se lee en streaming para no esperar texto de más después del JSON
  };
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${apiKey || 'no-key'}` };

  async function chat(body, ms) {
    const { res, text } = await request(fetchImpl, `${baseUrl}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) }, ms, display);
    if (!res.ok) throw new ProviderError(describeHttpError(display, res.status, text, model), { status: res.status, body: text });
    try {
      return JSON.parse(text);
    } catch {
      throw new ProviderError(`${display} devolvió una respuesta que no es JSON.`, { status: 'invalid_output' });
    }
  }

  function buildMessages(system, user, schema) {
    return [
      { role: 'system', content: `${system}\n\nResponde SOLO con un objeto JSON que cumpla este esquema:\n${JSON.stringify(schema)}` },
      { role: 'user', content: user },
    ];
  }

  // Cuerpo de la petición según lo que acepta el proveedor (también lo usa el diagnóstico).
  function buildBody({ system, user, schema, toolName = 'respuesta' }) {
    const body = { model, messages: buildMessages(system, user, schema) };
    // Gemini 3 recomienda dejar la temperatura predeterminada (1.0): con valores bajos puede ciclarse.
    // En los demás proveedores se usa 0 para que los resultados se repitan.
    if (!gemini) body.temperature = 0;
    if (compat.reasoning) body.reasoning_effort = reasoningEffort;
    body.response_format = compat.jsonSchema
      ? { type: 'json_schema', json_schema: { name: toolName, schema, strict: true } }
      : { type: 'json_object' };
    return body;
  }

  const emptyError = (finish) => new ProviderError(
    `${display} ${finish === 'length' ? 'se quedó sin espacio para responder' : `devolvió una respuesta vacía${finish ? ` (${finish})` : ''}`}.`,
    { status: 'invalid_output' },
  );

  const structured = guarded(async ({ system, user, schema, toolName = 'respuesta', timeoutMs: ms = timeoutMs }) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const body = buildBody({ system, user, schema, toolName });
        if (compat.stream) {
          const r = await streamCompletion({ fetchImpl, url: `${baseUrl}/chat/completions`, headers, body, timeoutMs: ms, label: display });
          if (r.json !== undefined) return { output: r.json, model: r.model || model };
          if (!r.content.trim()) throw emptyError(r.finish);
          if (r.stop_reason === 'demasiado_largo') throw new ProviderError(`${display} escribió de más sin terminar el JSON.`, { status: 'invalid_output' });
          return { output: parseJsonContent(r.content), model: r.model || model };
        }
        const data = await chat(body, ms);
        const choice = data.choices?.[0];
        const content = messageText(choice?.message?.content);
        if (!content.trim()) throw emptyError(choice?.finish_reason);
        return { output: parseJsonContent(content), model: normalizeModelId(data.model) || model };
      } catch (err) {
        // Si el proveedor no acepta un parámetro, se quita y se reintenta.
        const detail = String(err.body || '');
        if (attempt < 3 && err.status === 400 && compat.stream && /stream/i.test(detail)) {
          compat.stream = false;
          continue;
        }
        if (attempt < 3 && err.status === 400 && compat.jsonSchema && /response_format|json_schema|schema/i.test(detail)) {
          compat.jsonSchema = false;
          continue;
        }
        if (attempt < 3 && err.status === 400 && compat.reasoning && /reasoning|thinking/i.test(detail)) {
          compat.reasoning = false;
          continue;
        }
        throw err;
      }
    }
  }, { breaker, health });

  // Modelos disponibles para la clave (GET /models). Lo usa npm run ai:check.
  async function listModels({ timeoutMs: ms = timeoutMs } = {}) {
    const { res, text } = await request(fetchImpl, `${baseUrl}/models`, { method: 'GET', headers }, ms, display);
    if (!res.ok) throw new ProviderError(describeHttpError(display, res.status, text, model), { status: res.status, body: text });
    const data = JSON.parse(text);
    return [...new Set((data.data || []).map((m) => normalizeModelId(m.id)).filter(Boolean))].sort();
  }

  return {
    name, model, structured, listModels, health: health.snapshot, breaker, compat,
    // Para el diagnóstico: arma la misma petición que usa la app.
    url: `${baseUrl}/chat/completions`, headers, buildBody, fetchImpl,
  };
}

function build(client) {
  return {
    client,
    name: client.name,
    model: client.model,
    structured: client.structured,
    listModels: client.listModels,
    health: client.health,
    pause: () => client.breaker.state(),
    // Interpretación de un mensaje del cliente.
    call: (userPrompt) => client.structured({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      schema: INTERPRETATION_JSON_SCHEMA,
      toolName: 'registrar_interpretacion',
      toolDescription: 'Registra la interpretación estructurada del mensaje del cliente.',
    }),
  };
}

// Crea el proveedor según la configuración, o null si se usa el respaldo.
export function createConfiguredProvider(ai = config.ai, { fetchImpl = fetch } = {}) {
  const p = ai.provider;
  if (p === 'gemini' && ai.gemini.apiKey) {
    return build(createOpenAICompatible({
      name: 'gemini', baseUrl: ai.gemini.baseUrl, apiKey: ai.gemini.apiKey, model: ai.gemini.model,
      gemini: true, reasoningEffort: ai.gemini.reasoningEffort, strictSchema: ai.gemini.strictSchema, timeoutMs: ai.timeoutMs, fetchImpl,
    }));
  }
  if (p === 'anthropic' && ai.anthropic.apiKey) {
    return build(createAnthropic({ apiKey: ai.anthropic.apiKey, model: ai.anthropic.model, timeoutMs: ai.timeoutMs, fetchImpl }));
  }
  if (p === 'openai' && ai.openai.model) {
    // Si OPENAI_BASE_URL apunta a Gemini, se aplican los ajustes de Gemini.
    const gemini = isGeminiUrl(ai.openai.baseUrl);
    return build(createOpenAICompatible({
      name: gemini ? 'gemini' : 'openai', baseUrl: ai.openai.baseUrl, apiKey: ai.openai.apiKey, model: ai.openai.model,
      gemini, reasoningEffort: gemini ? ai.gemini.reasoningEffort : null, strictSchema: gemini ? ai.gemini.strictSchema : true, timeoutMs: ai.timeoutMs, fetchImpl,
    }));
  }
  return null;
}

// Una sola instancia por proceso: así se comparten la pausa por errores y el diagnóstico.
let cached;
export function activeProvider() {
  if (cached === undefined) cached = createConfiguredProvider(config.ai);
  return cached;
}

export function providerStatus(provider = activeProvider()) {
  if (provider) {
    const health = provider.health?.() ?? null;
    const pause = provider.pause?.() ?? null;
    let note = null;
    if (pause?.paused_until) note = `En pausa hasta ${pause.paused_until}: ${pause.reason}`;
    else if (health?.last_error && (!health.last_ok_at || health.last_error_at > health.last_ok_at)) note = `Último error: ${health.last_error}`;
    return { provider: provider.name, model: provider.model, mode: 'ai', note, health, pause };
  }
  const requested = config.ai.provider;
  let note = 'Usando el clasificador de respaldo (sin IA externa).';
  if (requested === 'gemini') note = 'AI_PROVIDER=gemini pero falta GEMINI_API_KEY en backend/.env; se usa el clasificador de respaldo.';
  else if (requested === 'anthropic') note = 'AI_PROVIDER=anthropic pero falta ANTHROPIC_API_KEY; se usa el clasificador de respaldo.';
  else if (requested === 'openai') note = 'AI_PROVIDER=openai pero falta OPENAI_MODEL; se usa el clasificador de respaldo.';
  else if (requested !== 'heuristic') note = `AI_PROVIDER=${requested} no es válido (usa gemini, anthropic, openai o heuristic); se usa el clasificador de respaldo.`;
  return { provider: 'heuristic', model: 'patrones-es-v1', mode: 'fallback', note };
}
