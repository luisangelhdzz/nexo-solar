// Conexión con Gemini por su API compatible con OpenAI, probada contra un servidor falso (sin red).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAICompatible, createConfiguredProvider, providerStatus, parseJsonContent, createJsonScanner } from '../src/ai/providers.js';
import { interpretMessage } from '../src/ai/interpreter.js';
import { buildCaseState } from '../src/domain/state.js';
import { GEMINI_DEFAULT_MODEL, GEMINI_OPENAI_BASE_URL } from '../src/config.js';
import { opened, msg } from './helpers.js';
import { startFakeGemini, completion, schemaName, sse } from './fake-gemini.js';

const interpretation = {
  intent: 'question', topic: 'instalación', summary: 'Pregunta si el precio incluye la instalación.',
  facts: ['Pregunta si el precio incluye la instalación.'], inferences: ['Quiere saber el alcance del precio.'],
  missing_information: [], needs_from_client: [], requested_contact_after: null,
  manipulation_attempt: false, manipulation_note: null, confidence: 'high',
};
const gemini = (baseUrl, extra = {}) => createOpenAICompatible({
  name: 'gemini', baseUrl, apiKey: 'clave-de-prueba', model: 'gemini-3.8-flash', gemini: true, reasoningEffort: 'low', timeoutMs: 3000, ...extra,
});
const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };

test('Gemini: pide salida con esquema, razonamiento bajo y deja la temperatura predeterminada', async () => {
  const fake = await startFakeGemini(() => completion({ ok: true }));
  try {
    const out = await gemini(fake.baseUrl).structured({ system: 'S', user: 'U', schema, toolName: 'prueba' });
    assert.deepEqual(out.output, { ok: true });
    const req = fake.requests[0];
    assert.equal(req.url, '/v1beta/openai/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer clave-de-prueba');
    assert.equal(req.body.model, 'gemini-3.8-flash');
    assert.equal(req.body.stream, true);
    assert.equal(req.body.reasoning_effort, 'low');
    assert.equal('temperature' in req.body, false);
    assert.equal(req.body.response_format.type, 'json_schema');
    assert.equal(req.body.response_format.json_schema.name, 'prueba');
    assert.equal(req.body.response_format.json_schema.strict, true);
  } finally { await fake.close(); }
});

test('Gemini: si rechaza el esquema, reintenta con modo JSON y lo recuerda', async () => {
  const fake = await startFakeGemini((req) => (req.body.response_format.type === 'json_schema'
    ? { status: 400, body: [{ error: { code: 400, message: 'Invalid JSON payload: unknown field in response_format.json_schema', status: 'INVALID_ARGUMENT' } }] }
    : completion({ ok: true }, { fenced: true })));
  try {
    const client = gemini(fake.baseUrl);
    assert.deepEqual((await client.structured({ system: 'S', user: 'U', schema })).output, { ok: true });
    assert.deepEqual((await client.structured({ system: 'S', user: 'U', schema })).output, { ok: true });
    assert.deepEqual(fake.requests.map((r) => r.body.response_format.type), ['json_schema', 'json_object', 'json_object']);
  } finally { await fake.close(); }
});

test('Gemini: si no acepta reasoning_effort, se quita y se reintenta', async () => {
  const fake = await startFakeGemini((req) => ('reasoning_effort' in req.body
    ? { status: 400, body: { error: { message: 'reasoning_effort is not supported for this model' } } }
    : completion({ ok: true })));
  try {
    assert.deepEqual((await gemini(fake.baseUrl).structured({ system: 'S', user: 'U', schema })).output, { ok: true });
    assert.equal(fake.requests.length, 2);
  } finally { await fake.close(); }
});

test('Límite de uso (429): mensaje claro y pausa sin volver a llamar', async () => {
  const fake = await startFakeGemini(() => ({ status: 429, body: [{ error: { code: 429, status: 'RESOURCE_EXHAUSTED', details: [{ retryDelay: '30s' }] } }] }));
  try {
    const client = gemini(fake.baseUrl);
    await assert.rejects(client.structured({ system: 'S', user: 'U', schema }), /límite de uso \(429\)/);
    await assert.rejects(client.structured({ system: 'S', user: 'U', schema }), /IA en pausa 30 s/);
    assert.equal(fake.requests.length, 1);
    assert.equal(client.health().failures, 1);
    assert.match(client.breaker.state().paused_until, /^\d{4}-/);
  } finally { await fake.close(); }
});

test('Clave inválida: el mensaje lo dice y nunca muestra la clave', async () => {
  const fake = await startFakeGemini(() => ({ status: 400, body: [{ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }] }));
  try {
    const err = await gemini(fake.baseUrl).structured({ system: 'S', user: 'U', schema }).catch((e) => e);
    assert.match(err.message, /rechazó la clave/);
    assert.doesNotMatch(err.message, /clave-de-prueba/);
  } finally { await fake.close(); }
});

test('Respuesta vacía o sin JSON: error claro para caer al respaldo', async () => {
  const fake = await startFakeGemini((req, all) => (all.length === 1 ? completion(null, { finish: 'length' }) : { status: 200, body: { choices: [{ message: { content: 'no sé' } }] } }));
  try {
    const client = gemini(fake.baseUrl);
    await assert.rejects(client.structured({ system: 'S', user: 'U', schema }), /sin espacio para responder/);
    await assert.rejects(client.structured({ system: 'S', user: 'U', schema }), /JSON válido/);
  } finally { await fake.close(); }
});

test('Lista de modelos sin el prefijo models/', async () => {
  const fake = await startFakeGemini(() => ({ status: 200, body: { object: 'list', data: [{ id: 'models/gemini-3.8-flash' }, { id: 'models/gemini-3.5-flash-lite' }] } }));
  try {
    assert.deepEqual(await gemini(fake.baseUrl).listModels(), ['gemini-3.5-flash-lite', 'gemini-3.8-flash']);
  } finally { await fake.close(); }
});

test('JSON entre ``` o con texto alrededor también se acepta', () => {
  assert.deepEqual(parseJsonContent('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonContent('Aquí está: {"a":2} listo'), { a: 2 });
  assert.throws(() => parseJsonContent('sin json'), /JSON válido/);
});

test('Configuración: AI_PROVIDER=gemini usa la URL y el modelo de Gemini; sin clave usa el respaldo', () => {
  const ai = {
    provider: 'gemini', timeoutMs: 1000,
    anthropic: { apiKey: '', model: 'x' },
    openai: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: '' },
    gemini: { baseUrl: GEMINI_OPENAI_BASE_URL, apiKey: 'k', model: GEMINI_DEFAULT_MODEL, reasoningEffort: 'low' },
  };
  const p = createConfiguredProvider(ai);
  assert.equal(p.name, 'gemini');
  assert.equal(p.model, 'gemini-3.8-flash');
  assert.equal(createConfiguredProvider({ ...ai, gemini: { ...ai.gemini, apiKey: '' } }), null);
  // El plan original (AI_PROVIDER=openai con la URL de Gemini) también funciona y se identifica como Gemini.
  const viaOpenai = createConfiguredProvider({ ...ai, provider: 'openai', openai: { baseUrl: GEMINI_OPENAI_BASE_URL, apiKey: 'k', model: 'gemini-3.8-flash' } });
  assert.equal(viaOpenai.name, 'gemini');
  assert.equal(providerStatus(p).mode, 'ai');
});

test('"¿El precio incluye la instalación?" se interpreta con Gemini, no con el respaldo', async () => {
  const fake = await startFakeGemini((req) => {
    assert.equal(schemaName(req.body), 'registrar_interpretacion');
    return completion(interpretation);
  });
  try {
    const state = buildCaseState('G1', [opened('G1'), msg('G1', '2026-10-10T15:00:00Z', '¿El precio incluye la instalación?')]);
    const provider = createConfiguredProvider({
      provider: 'gemini', timeoutMs: 3000, anthropic: {}, openai: {},
      gemini: { baseUrl: fake.baseUrl, apiKey: 'k', model: 'gemini-3.8-flash', reasoningEffort: 'low' },
    });
    const it = await interpretMessage({ state, message: '¿El precio incluye la instalación?', eventId: state.messages[0].event_id, occurredAt: '2026-10-10T15:00:00Z', provider });
    assert.equal(it.source, 'gemini');
    assert.equal(it.fallback_reason, null);
    assert.equal(it.intent, 'question');
  } finally { await fake.close(); }
});

test('Streaming: arma el JSON que llega en partes y deja de leer en cuanto está completo', async () => {
  let closed = false;
  const json = JSON.stringify({ ok: true, texto: 'llaves {dentro} de "comillas"' });
  const fake = await startFakeGemini(() => sse([json.slice(0, 7), json.slice(7, 20), json.slice(20)], {
    after: Array.from({ length: 200 }, () => '\n  '), done: false, closed: () => { closed = true; },
  }));
  try {
    const started = Date.now();
    const out = await gemini(fake.baseUrl).structured({ system: 'S', user: 'U', schema });
    assert.deepEqual(out.output, { ok: true, texto: 'llaves {dentro} de "comillas"' });
    assert.ok(Date.now() - started < 1500, 'no espera el texto de más después del JSON');
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(closed, true, 'corta la conexión');
  } finally { await fake.close(); }
});

test('Streaming: si el servidor no acepta stream, reintenta sin stream', async () => {
  const fake = await startFakeGemini((req) => (req.body.stream
    ? { status: 400, body: { error: { message: 'stream is not supported for this request' } } }
    : completion({ ok: true })));
  try {
    assert.deepEqual((await gemini(fake.baseUrl).structured({ system: 'S', user: 'U', schema })).output, { ok: true });
    assert.deepEqual(fake.requests.map((r) => Boolean(r.body.stream)), [true, false]);
  } finally { await fake.close(); }
});

test('Streaming: tiempo máximo si el modelo no manda nada y error claro dentro del stream', async () => {
  const silent = await startFakeGemini(() => sse([], { done: false }));
  try {
    await assert.rejects(gemini(silent.baseUrl, { timeoutMs: 300 }).structured({ system: 'S', user: 'U', schema }), /no respondió en 0 s|tiempo máximo/);
  } finally { await silent.close(); }
  const quota = await startFakeGemini(() => ({
    raw: async (res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ error: { code: 429, message: 'Resource exhausted', status: 'RESOURCE_EXHAUSTED' } })}\n\n`);
    },
  }));
  try {
    await assert.rejects(gemini(quota.baseUrl).structured({ system: 'S', user: 'U', schema }), /límite de uso \(429\)/);
  } finally { await quota.close(); }
});

test('Con GEMINI_STRICT_SCHEMA=false se pide JSON simple', async () => {
  const fake = await startFakeGemini(() => completion({ ok: true }));
  try {
    await gemini(fake.baseUrl, { strictSchema: false }).structured({ system: 'S', user: 'U', schema });
    assert.equal(fake.requests[0].body.response_format.type, 'json_object');
  } finally { await fake.close(); }
});

test('El detector de JSON completo ignora llaves dentro de textos', () => {
  const scan = createJsonScanner();
  assert.equal(scan.push('basura {"a": "x}'), undefined);
  assert.equal(scan.push('{\\"y", "b": [1, {"c": 2}]'), undefined);
  assert.deepEqual(scan.push('} y más texto'), { a: 'x}{"y', b: [1, { c: 2 }] });
});
