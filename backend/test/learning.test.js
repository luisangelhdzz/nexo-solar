// Embudo por etapas, análisis de compras/pérdidas y aprendizaje.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCaseState } from '../src/domain/state.js';
import { buildStages } from '../src/domain/stages.js';
import { analyzeOutcome, templateLesson } from '../src/domain/outcome.js';
import { computeLearning, pickLessons } from '../src/domain/learning.js';
import { interpretHeuristic } from '../src/ai/heuristic.js';
import { generateLesson } from '../src/ai/lessons.js';
import { createMemoryStorage } from '../src/storage/memory.js';
import { createEngine } from '../src/services/engine.js';
import { createPortal } from '../src/portal/service.js';
import { seedDemo } from '../src/portal/seed.js';
import { ev } from './helpers.js';

const H = 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const T0 = Date.parse('2026-09-01T15:00:00Z');
const at = (h) => iso(T0 + h * H);

function interp(state) {
  const out = {};
  for (const m of state.messages) out[m.event_id] = interpretHeuristic(m.message, { occurredAt: m.at });
  return out;
}

function caseWith(id, steps) {
  const events = [ev(id, 'case.opened', at(0), { status: 'open', proposal_amount_mxn: 150000 }, `${id}-e1`)];
  steps.forEach(([h, type, data], i) => events.push(ev(id, type, at(h), data, `${id}-e${i + 2}`)));
  const state = buildCaseState(id, events);
  return { state, interpretations: interp(state) };
}

test('Etapas: Enviada → Revisando → Con dudas → Decidiendo → Comprada, con tiempo en cada una', () => {
  const { state, interpretations } = caseWith('S1', [
    [2, 'proposal.viewed', { section: 'price' }],
    [5, 'message.received', { message: '¿Incluye la instalación?' }],
    [7, 'action.executed', { action: 'contact' }],
    [40, 'case.closed', { status: 'accepted' }],
  ]);
  const st = buildStages(state, interpretations, at(50));
  assert.deepEqual(st.transitions.map((t) => t.stage), ['enviada', 'revisando', 'con_dudas', 'decidiendo', 'comprada']);
  assert.deepEqual(st.transitions.map((t) => t.hours), [2, 3, 2, 33, null]);
  assert.equal(st.current, 'comprada');
});

test('Etapas: una pregunta nueva regresa a "Con dudas"; revisar a fondo pasa a "Decidiendo"', () => {
  const { state, interpretations } = caseWith('S2', [
    [1, 'proposal.viewed', { section: 'price' }],
    [2, 'proposal.viewed', { section: 'price' }],
    [3, 'message.received', { message: '¿Cuál es la garantía?' }],
  ]);
  const st = buildStages(state, interpretations, at(4));
  assert.deepEqual(st.transitions.map((t) => t.stage), ['enviada', 'revisando', 'decidiendo', 'con_dudas']);
  assert.equal(st.current, 'con_dudas');
  assert.equal(st.pending_doubt, true);
});

test('Análisis de compra: dudas respondidas rápido y revisión a fondo', () => {
  const { state, interpretations } = caseWith('W1', [
    [2, 'proposal.viewed', { section: 'price' }],
    [3, 'proposal.viewed', { section: 'financing' }],
    [5, 'message.received', { message: '¿Tienen financiamiento a meses?' }],
    [6, 'action.executed', { action: 'contact' }],
    [30, 'case.closed', { status: 'accepted' }],
  ]);
  const a = analyzeOutcome({ state, interpretations, stages: buildStages(state, interpretations) });
  assert.equal(a.outcome, 'won');
  assert.equal(a.decision_hours, 30);
  const ids = a.factors.map((f) => f.id);
  assert.ok(ids.includes('dudas_respondidas_rapido'));
  assert.ok(ids.includes('revision_a_fondo'));
  assert.match(a.summary, /Compró en 30 h/);
  assert.match(templateLesson(a), /^Funcionó/);
});

test('Análisis de pérdida: reparo de precio, respuesta tarde y presión', () => {
  const { state, interpretations } = caseWith('L1', [
    [1, 'proposal.viewed', { section: 'price' }],
    [2, 'message.received', { message: 'Está muy caro comparado con otra cotización.' }],
    [40, 'action.executed', { action: 'contact' }],
    [60, 'action.executed', { action: 'contact' }],
    [90, 'case.closed', { status: 'rejected' }],
  ]);
  const a = analyzeOutcome({ state, interpretations, stages: buildStages(state, interpretations) });
  assert.equal(a.outcome, 'lost');
  const ids = a.factors.map((f) => f.id);
  assert.ok(ids.includes('reparo_precio'));
  assert.ok(ids.includes('dudas_respuesta_lenta'));
  assert.ok(ids.includes('presion'));
  assert.match(templateLesson(a), /^Para la próxima/);
});

test('Análisis: contactar durante una espera recomendada cuenta como presión', () => {
  const { state, interpretations } = caseWith('L2', [
    [1, 'proposal.viewed', { section: 'price' }],
    [10, 'action.executed', { action: 'contact' }],
    [50, 'case.closed', { status: 'rejected' }],
  ]);
  const decisions = [{ evaluation_at: at(2), recommendation: { action: 'wait' } }];
  const a = analyzeOutcome({ state, interpretations, stages: buildStages(state, interpretations), decisions });
  assert.equal(a.metrics.contacts_during_wait, 1);
  assert.ok(a.factors.some((f) => f.id === 'presion'));
});

test('Análisis: respetar la fecha que pidió el cliente suma a favor', () => {
  const { state, interpretations } = caseWith('W2', [
    [1, 'message.received', { message: 'No me contacten antes del 5 de septiembre.' }],
    [100, 'action.executed', { action: 'contact' }],
    [110, 'case.closed', { status: 'accepted' }],
  ]);
  const a = analyzeOutcome({ state, interpretations, stages: buildStages(state, interpretations) });
  assert.ok(a.factors.some((f) => f.id === 'pidio_tiempo_respetado'));
});

test('Aprendizaje: con 3+ compras ajusta el tiempo de seguimiento; con menos usa el predeterminado', () => {
  const won = (id, silence) => {
    const { state, interpretations } = caseWith(id, [[1, 'proposal.viewed', { section: 'price' }], [1 + silence, 'case.closed', { status: 'accepted' }]]);
    return { state, analysis: analyzeOutcome({ state, interpretations, stages: buildStages(state, interpretations) }) };
  };
  const few = computeLearning([won('A', 20), won('B', 30)], { defaults: { followUpHours: 48 } });
  assert.equal(few.params.follow_up_hours.source, 'predeterminado');
  assert.equal(few.params.follow_up_hours.value, 48);
  const many = computeLearning([won('A', 20), won('B', 30), won('C', 24), won('D', 40)], { defaults: { followUpHours: 48 } });
  assert.equal(many.params.follow_up_hours.source, 'aprendido');
  assert.equal(many.params.follow_up_hours.value, 30); // percentil 75 de [20, 24, 30, 40]
  assert.notEqual(few.version, many.version);
});

test('Lecciones: primero las del mismo cliente', () => {
  const lessons = [
    { case_id: 'a', customer_id: 'X', lesson: 'a' }, { case_id: 'b', customer_id: 'Y', lesson: 'b' },
    { case_id: 'c', customer_id: 'Y', lesson: 'c' }, { case_id: 'd', customer_id: 'Z', lesson: 'd' },
  ];
  assert.deepEqual(pickLessons(lessons, { customerId: 'Y', limit: 3 }).map((l) => l.case_id), ['b', 'c', 'a']);
});

test('Lección con IA: usa la respuesta del modelo; si falla, usa la plantilla', async () => {
  const { state, interpretations } = caseWith('L3', [[1, 'message.received', { message: '¿Pueden instalar en una semana?' }], [60, 'case.closed', { status: 'rejected' }]]);
  const a = analyzeOutcome({ state, interpretations, stages: buildStages(state, interpretations) });
  const ok = await generateLesson(a, { structured: async () => ({ output: { lesson: 'Responder dudas de plazos el mismo día evita perder clientes con prisa.', tags: ['dudas'] }, model: 'fake' }) });
  assert.equal(ok.source, 'ia');
  const bad = await generateLesson(a, { structured: async () => { throw new Error('timeout'); } });
  assert.equal(bad.source, 'reglas');
  assert.match(bad.lesson, /Responder todas las dudas/);
});

test('Demo: el sistema aprende de los cierres y la venta nueva crea una versión nueva de lo aprendido', async () => {
  let nowMs = Date.parse('2026-10-10T15:00:00Z');
  const storage = createMemoryStorage();
  const engine = createEngine({ storage, provider: null, policy: { followUpHours: 48 }, clock: () => nowMs });
  const portal = createPortal({ engine, storage });
  await seedDemo({ engine, storage });

  let ins = await engine.insights();
  assert.equal(ins.active, true);
  assert.deepEqual(ins.totals.won, 8);
  assert.deepEqual(ins.totals.lost, 4);
  assert.equal(ins.learning.params.follow_up_hours.source, 'aprendido');
  assert.equal(ins.learning.params.answer_within_hours.value, 2);
  assert.equal(ins.lessons.length, 12);
  assert.equal(ins.history.length, 1);

  // El tiempo aprendido aparece en la explicación de la confianza.
  const hotel = await engine.getCase('NS-1012');
  assert.match(hotel.current.recommendation.confidence_reason, /ajustado con lo aprendido/);
  // Lo aprendido sobre tiempos de respuesta aparece en la recomendación de una duda.
  const taller = await engine.getCase('NS-1011');
  assert.match(taller.current.recommendation.reason, /Lo aprendido/);
  assert.equal(taller.stages.current, 'con_dudas');

  // Venta nueva: al cerrarse deja su lección y el aprendizaje pasa a la versión 2.
  const q = await portal.requestQuote('CUS-001', 'PKG-COMERCIO-10');
  nowMs += 40 * H;
  await portal.decide('CUS-001', q.case_id, 'accepted');
  const detail = await engine.getCase(q.case_id);
  assert.equal(detail.outcome.outcome, 'won');
  assert.ok(detail.lesson.lesson.length > 10);
  ins = await engine.insights();
  assert.equal(ins.totals.won, 9);
  assert.equal(ins.history.length, 2);
});

test('Con la hora del manifest el aprendizaje está apagado: el kit oficial no cambia', async () => {
  const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../kit');
  const engine = createEngine({ storage: createMemoryStorage(), provider: null, policy: { followUpHours: 48 } });
  await engine.setManifest(JSON.parse(fs.readFileSync(path.join(KIT, 'manifest.json'), 'utf8')));
  await engine.ingest({ content: fs.readFileSync(path.join(KIT, 'events.jsonl'), 'utf8') });
  const ins = await engine.insights();
  assert.equal(ins.active, false);
  const p02 = await engine.getCase('P02');
  assert.equal(p02.current.detail.trace.learning, null);
  assert.equal(p02.current.recommendation.scheduled_for, '2026-10-11T15:00:00Z');
  // P05 (cerrado) también deja su análisis.
  const p05 = await engine.getCase('P05');
  assert.equal(p05.outcome.outcome, 'won');
});
