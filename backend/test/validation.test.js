import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonl } from '../src/domain/validation.js';
import { createMemoryStorage } from '../src/storage/memory.js';
import { createEngine } from '../src/services/engine.js';

test('Las líneas inválidas se reportan sin detener las válidas', () => {
  const content = [
    '{"event_id":"X-1","case_id":"X","event_type":"case.opened","occurred_at":"2026-10-09T15:00:00Z","data":{"status":"open","proposal_amount_mxn":1000}}',
    '{esto no es json',
    '{"event_id":"X-2","case_id":"X","event_type":"case.renamed","occurred_at":"2026-10-09T15:00:00Z","data":{}}',
    '{"event_id":"X-3","case_id":"X","event_type":"message.received","occurred_at":"2026-10-09 15:00","data":{"message":"hola"}}',
    '{"event_id":"X-4","case_id":"X","event_type":"constraint.updated","occurred_at":"2026-10-09T15:00:00Z","data":{}}',
    '{"event_id":"X-5","case_id":"X","event_type":"action.executed","occurred_at":"2026-10-09T15:00:00Z","data":{"action":"call"}}',
    '{"case_id":"X","event_type":"message.received","occurred_at":"2026-10-09T15:00:00Z","data":{"message":"sin id"}}',
    '',
    '{"event_id":"X-6","case_id":"X","event_type":"message.received","occurred_at":"2026-10-09T15:05:00Z","data":{"message":"¿Incluye garantía?"}}',
  ].join('\n');
  const { events, errors } = parseJsonl(content);
  assert.deepEqual(events.map((e) => e.event_id), ['X-1', 'X-6']);
  assert.equal(errors.length, 6);
  assert.deepEqual(errors.map((e) => e.line), [2, 3, 4, 5, 6, 7]);
  assert.match(errors[0].errors[0], /JSON mal formado/);
  assert.match(errors[1].errors[0], /event_type inválido/);
  assert.match(errors[2].errors[0], /occurred_at/);
  assert.match(errors[3].errors[0], /requiere contact_allowed o contact_not_before/);
  assert.match(errors[4].errors[0], /data.action/);
  assert.match(errors[5].errors[0], /event_id/);
});

test('Deduplicación por event_id: el repetido se ignora y se reporta', async () => {
  const storage = createMemoryStorage();
  const engine = createEngine({ storage, provider: null });
  await engine.setManifest({ evaluation_at: '2026-10-09T16:00:00Z' });
  const line = '{"event_id":"D-1","case_id":"D","event_type":"case.opened","occurred_at":"2026-10-09T15:00:00Z","data":{"status":"open","proposal_amount_mxn":1}}';
  const first = await engine.ingest({ content: `${line}\n${line}` });
  assert.equal(first.accepted, 1);
  assert.equal(first.duplicates.length, 1);
  assert.equal(first.duplicates[0].same_content, true);
  const again = await engine.ingest({ content: line });
  assert.equal(again.accepted, 0);
  assert.equal((await storage.getCaseEvents('D')).length, 1);
});

test('Un error en un caso no impide evaluar los demás', async () => {
  const storage = createMemoryStorage();
  const engine = createEngine({ storage, provider: null });
  await engine.setManifest({ evaluation_at: '2026-10-09T16:00:00Z' });
  const res = await engine.ingest({
    content: [
      '{"event_id":"Q-1","case_id":"Q","event_type":"case.opened","occurred_at":"2026-10-09T15:00:00Z","data":{"status":"open"}}',
      '{"event_id":"R-1","case_id":"R","event_type":"case.opened","occurred_at":"2026-10-09T15:00:00Z","data":{"status":"open","proposal_amount_mxn":5}}',
    ].join('\n'),
  });
  assert.equal(res.errors.length, 1);
  assert.equal(res.errors[0].case_id, 'Q');
  assert.deepEqual(res.evaluated.map((r) => r.case_id), ['R']);
});
