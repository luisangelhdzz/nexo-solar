import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorage } from '../src/storage/memory.js';
import { createEngine } from '../src/services/engine.js';

test('Resumen, clientes y embudo leen eventos en bloque y reflejan eventos nuevos', async () => {
  const storage = createMemoryStorage();
  const engine = createEngine({ storage, provider: null });
  await engine.setEvaluationAt('2026-10-10T00:00:00Z');
  await storage.upsertCustomer({ customer_id: 'C1', name: 'Cliente demo' });
  const events = Array.from({ length: 20 }, (_, i) => ({
    event_id: `E${i}`, case_id: `Q${i}`, event_type: 'case.opened',
    occurred_at: '2026-10-09T12:00:00Z', data: { status: 'open', customer_id: 'C1', proposal_amount_mxn: 100000 },
  }));
  await storage.addEvents(events, null);
  let reads = 0;
  const batchRead = storage.getEventsByCase.bind(storage);
  storage.getEventsByCase = async () => { reads++; return batchRead(); };
  storage.getCaseEvents = async () => { throw new Error('No consultar cada cotización por separado'); };
  assert.equal((await engine.summary()).totals.open, 20);
  assert.equal((await engine.listCustomers())[0].cases.length, 20);
  assert.equal((await engine.insights()).totals.open, 20);
  assert.equal(reads, 3);
  await storage.addEvents([{ event_id: 'CLOSE', case_id: 'Q0', event_type: 'case.closed', occurred_at: '2026-10-09T20:00:00Z', data: { status: 'accepted' } }], null);
  const summary = await engine.summary();
  assert.equal(summary.totals.open, 19);
  assert.equal(summary.totals.accepted, 1);
});
