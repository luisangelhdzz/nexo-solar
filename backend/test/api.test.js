// Prueba de punta a punta del API. Usa memoria; con TEST_DATABASE_URL también prueba PostgreSQL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { createEngine } from '../src/services/engine.js';
import { createMemoryStorage } from '../src/storage/memory.js';
import { createPostgresStorage } from '../src/storage/postgres.js';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../kit');
const read = (f) => fs.readFileSync(path.join(KIT, f), 'utf8');

async function withServer(storage, fn) {
  await storage.init();
  await storage.reset();
  const app = createApp(createEngine({ storage, provider: null }));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, url, body, type = 'application/json') => {
    const res = await fetch(base + url, {
      method,
      headers: body === undefined ? {} : { 'content-type': type },
      body: body === undefined ? undefined : type === 'application/json' ? JSON.stringify(body) : body,
    });
    return { status: res.status, body: await res.json() };
  };
  try {
    await fn(call);
  } finally {
    server.close();
    await storage.close();
  }
}

async function scenario(call) {
  // Evaluar sin manifest da un error claro.
  const early = await call('POST', '/evaluate', {});
  assert.equal(early.status, 409);

  assert.equal((await call('POST', '/manifest', JSON.parse(read('manifest.json')))).status, 200);

  // Carga como texto plano (el archivo tal cual).
  const load = await call('POST', '/events?source=events.jsonl', read('events.jsonl'), 'text/plain');
  assert.equal(load.status, 200);
  assert.equal(load.body.accepted, 15);
  assert.equal(load.body.duplicates.length, 1);
  assert.equal(load.body.evaluated.length, 6);

  const cases = await call('GET', '/cases');
  assert.equal(cases.body.cases.length, 6);
  assert.equal(cases.body.cases.find((c) => c.case_id === 'P06').recommendation.action, 'wait');

  // Carga de actualizaciones como JSON.
  const upd = await call('POST', '/events', { content: read('updates.jsonl'), source: 'updates.jsonl' });
  assert.deepEqual(upd.body.affected_cases, ['P06']);

  const p06 = await call('GET', '/cases/P06');
  assert.equal(p06.body.current.recommendation.action, 'resolve_objection');
  assert.equal(p06.body.previous.recommendation.action, 'wait');
  assert.ok(p06.body.current.changes.some((c) => c.field === 'action'));
  assert.ok(p06.body.current.detail.trace.guardian.checks.every((c) => c.ok));

  // El caso P02 muestra el duplicado ignorado.
  const p02 = await call('GET', '/cases/P02');
  assert.ok(p02.body.ingest_issues.some((i) => i.kind === 'duplicate' && i.event_id === 'P02-e2'));

  // Simulador: se prohíbe el contacto en P01 y la recomendación deja de contactar.
  const sim = await call('POST', '/cases/P01/events', { event_type: 'constraint.updated', data: { contact_allowed: false } });
  assert.equal(sim.status, 200);
  const p01 = await call('GET', '/cases/P01');
  assert.equal(p01.body.current.recommendation.action, 'escalate');
  assert.equal(p01.body.previous.recommendation.action, 'resolve_objection');

  // Evento inválido desde el simulador.
  const bad = await call('POST', '/cases/P01/events', { event_type: 'action.executed', data: { action: 'call' } });
  assert.equal(bad.status, 400);

  // Exportación.
  const exp = await call('GET', '/export');
  assert.equal(exp.body.length, 6);
  assert.deepEqual(Object.keys(exp.body[0]).length, 11);

  // Cambiar la hora de evaluación.
  const t = await call('PUT', '/settings/evaluation-at', { evaluation_at: '2026-10-12T15:00:00Z' });
  assert.equal(t.body.evaluation_at, '2026-10-12T15:00:00Z');
  const ev = await call('POST', '/evaluate', {});
  assert.ok(ev.body.results.find((r) => r.case_id === 'P03').action !== 'wait');

  assert.equal((await call('GET', '/cases/NOEXISTE')).status, 404);
  assert.equal((await call('POST', '/reset', {})).body.ok, true);
  assert.equal((await call('GET', '/cases')).body.cases.length, 0);
}

test('API completo con almacenamiento en memoria', async () => {
  await withServer(createMemoryStorage(), scenario);
});

test('API completo con PostgreSQL', { skip: !process.env.TEST_DATABASE_URL && 'define TEST_DATABASE_URL para probar PostgreSQL' }, async () => {
  await withServer(createPostgresStorage(process.env.TEST_DATABASE_URL), scenario);
});
