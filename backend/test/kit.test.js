// Casos públicos del kit: P01–P06 y la actualización de P06.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryStorage } from '../src/storage/memory.js';
import { createEngine } from '../src/services/engine.js';
import { RECOMMENDATION_FIELDS, TIMINGS_BY_ACTION } from '../src/domain/constants.js';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../kit');
const read = (f) => fs.readFileSync(path.join(KIT, f), 'utf8');

async function loadKit({ withUpdates }) {
  const engine = createEngine({ storage: createMemoryStorage(), provider: null });
  await engine.setManifest(JSON.parse(read('manifest.json')));
  const first = await engine.ingest({ content: read('events.jsonl'), source: 'events.jsonl' });
  let second = null;
  if (withUpdates) second = await engine.ingest({ content: read('updates.jsonl'), source: 'updates.jsonl' });
  const recs = Object.fromEntries((await engine.exportRecommendations()).map((r) => [r.case_id, r]));
  return { engine, first, second, recs };
}

test('Carga del kit: 15 eventos aceptados y el duplicado de P02 ignorado', async () => {
  const { first } = await loadKit({ withUpdates: false });
  assert.equal(first.accepted, 15);
  assert.deepEqual(first.duplicates.map((d) => d.event_id), ['P02-e2']);
  assert.equal(first.errors.length, 0);
});

test('Decisiones iniciales de P01–P06', async () => {
  const { recs } = await loadKit({ withUpdates: false });

  assert.equal(recs.P01.action, 'resolve_objection'); // pregunta explícita sobre instalación
  assert.ok(recs.P01.evidence_event_ids.includes('P01-e2'));

  assert.equal(recs.P02.action, 'wait'); // solo una apertura (R5)
  assert.ok(['at_date', 'on_new_information'].includes(recs.P02.timing));
  assert.notEqual(recs.P02.confidence, 'high');

  assert.equal(recs.P03.action, 'wait'); // espera pedida + R3
  assert.equal(recs.P03.timing, 'at_date');
  assert.equal(recs.P03.scheduled_for, '2026-10-12T15:00:00Z');

  assert.ok(['escalate', 'wait', 'no_action'].includes(recs.P04.action)); // R2
  assert.equal(recs.P04.action, 'escalate');
  assert.equal(recs.P04.requires_human_review, true);

  assert.equal(recs.P05.action, 'no_action'); // R1
  assert.equal(recs.P05.timing, 'not_applicable');

  assert.equal(recs.P06.action, 'wait'); // R4: contacto hace 2 h, sin respuesta
  assert.ok(recs.P06.evidence_event_ids.includes('P06-e2'));
});

test('P03 coincide con ejemplo_salida.json', async () => {
  const { recs } = await loadKit({ withUpdates: false });
  const [example] = JSON.parse(read('ejemplo_salida.json'));
  for (const f of ['action', 'timing', 'scheduled_for', 'confidence', 'risk_level', 'requires_human_review', 'missing_information']) {
    assert.deepEqual(recs.P03[f], example[f], f);
  }
  assert.deepEqual([...recs.P03.evidence_event_ids].sort(), [...example.evidence_event_ids].sort());
});

test('P06 cambia tras la pregunta nueva de updates.jsonl', async () => {
  const { second, recs, engine } = await loadKit({ withUpdates: true });
  assert.deepEqual(second.affected_cases, ['P06']);
  const p06 = second.evaluated.find((r) => r.case_id === 'P06');
  assert.ok(p06.changes.some((c) => c.field === 'action' && c.before === 'wait' && c.after === 'resolve_objection'));
  assert.equal(recs.P06.action, 'resolve_objection');
  assert.ok(recs.P06.evidence_event_ids.includes('P06-e3'));
  const detail = await engine.getCase('P06');
  assert.equal(detail.previous.recommendation.action, 'wait');
  assert.deepEqual(detail.current.new_event_ids, ['P06-e3']);
});

test('La exportación cumple el contrato en todos los casos', async () => {
  const { engine } = await loadKit({ withUpdates: true });
  const recs = await engine.exportRecommendations();
  assert.equal(recs.length, 6);
  for (const r of recs) {
    assert.deepEqual(Object.keys(r), RECOMMENDATION_FIELDS);
    assert.ok(TIMINGS_BY_ACTION[r.action].includes(r.timing), `${r.case_id} timing`);
    assert.equal(r.scheduled_for === null, r.timing !== 'at_date', `${r.case_id} scheduled_for`);
    assert.ok(r.evidence_event_ids.length > 0);
    assert.ok(r.evidence_event_ids.every((id) => id.startsWith(`${r.case_id}-`)), `${r.case_id} evidencia del mismo caso`);
    assert.equal(typeof r.requires_human_review, 'boolean');
    assert.ok(Array.isArray(r.missing_information));
    if (r.action === 'wait') assert.match(r.reason, /Reevaluar/);
  }
});

test('Reevaluar sin cambios no duplica decisiones', async () => {
  const { engine } = await loadKit({ withUpdates: true });
  const again = await engine.evaluate();
  assert.ok(again.every((r) => r.created === false));
});

test('Cambiar la hora de evaluación reevalúa: P03 ya se puede contactar el 12 de octubre', async () => {
  const { engine } = await loadKit({ withUpdates: true });
  await engine.setEvaluationAt('2026-10-12T15:00:00Z');
  const recs = Object.fromEntries((await engine.exportRecommendations()).map((r) => [r.case_id, r]));
  assert.notEqual(recs.P03.action, 'wait');
  assert.equal(recs.P05.action, 'no_action');
});
