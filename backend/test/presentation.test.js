import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPresentation } from '../src/portal/presentation.js';
import { createMemoryStorage } from '../src/storage/memory.js';
import { createEngine } from '../src/services/engine.js';

test('Presentación: seis escenarios válidos respetan cierres y límites de contacto', async () => {
  const now = '2026-10-10T12:00:00.000Z';
  const data = buildPresentation(now);
  const storage = createMemoryStorage();
  const engine = createEngine({ storage, provider: null, clock: () => Date.parse(now) });
  await engine.setClock({ mode: 'live' });
  for (const customer of data.customers) await storage.upsertCustomer(customer);
  const ingest = await engine.ingest({ content: data.events.map(e => JSON.stringify(e)).join('\n') });
  assert.equal(ingest.errors.length, 0);
  const cases = Object.fromEntries((await engine.listCases()).map(c => [c.case_id, c]));
  assert.equal(Object.keys(cases).length, 6);
  assert.equal(cases['DEMO-01'].recommendation.action, 'request_information');
  assert.equal(cases['DEMO-02'].recommendation.action, 'resolve_objection');
  assert.equal(cases['DEMO-03'].recommendation.action, 'wait');
  assert.equal(cases['DEMO-04'].recommendation.action, 'escalate');
  assert.equal(cases['DEMO-05'].recommendation.action, 'no_action');
  assert.equal(cases['DEMO-06'].recommendation.action, 'no_action');
  assert.equal((await engine.getCase('DEMO-05')).state.closed_reason, 'Ahorro esperado');
  assert.equal((await engine.getCase('DEMO-06')).state.closed_reason, 'Precio');
});
