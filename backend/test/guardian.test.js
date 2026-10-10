// El guardián debe atrapar recomendaciones inválidas aunque vengan de la política o de la IA.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCaseState } from '../src/domain/state.js';
import { evaluateRules } from '../src/domain/rules.js';
import { guard } from '../src/domain/guardian.js';
import { opened, msg, view, action, constraint, closed } from './helpers.js';

const NOW = '2026-10-09T16:00:00Z';

function run(events, rec) {
  const state = buildCaseState(events[0].case_id, events);
  const rules = evaluateRules(state, NOW);
  return guard({
    case_id: state.case_id,
    timing: 'immediate',
    scheduled_for: null,
    reason: 'Prueba.',
    evidence_event_ids: [events[events.length - 1].event_id],
    confidence: 'medium',
    confidence_reason: 'Prueba.',
    risk_level: 'low',
    requires_human_review: false,
    missing_information: [],
    ...rec,
  }, { state, rules, evaluationAt: NOW });
}

test('Bloquea contacto con contact_allowed=false (R2)', () => {
  const g = run([opened('A'), constraint('A', '2026-10-09T15:00:00Z', { contact_allowed: false })], { action: 'contact' });
  assert.equal(g.replaced, true);
  assert.equal(g.recommendation.action, 'wait');
  assert.equal(g.recommendation.requires_human_review, true);
});

test('Bloquea contacto durante las 24 h de R4', () => {
  const g = run([opened('B'), action('B', '2026-10-09T15:00:00Z')], { action: 'request_information' });
  assert.equal(g.replaced, true);
  assert.equal(g.recommendation.action, 'wait');
  assert.equal(g.recommendation.scheduled_for, '2026-10-10T15:00:00Z');
});

test('Caso cerrado: cualquier acción distinta de no_action se reemplaza (R1)', () => {
  const g = run([opened('C'), closed('C', '2026-10-09T15:00:00Z')], { action: 'escalate' });
  assert.equal(g.replaced, true);
  assert.equal(g.recommendation.action, 'no_action');
  assert.equal(g.recommendation.timing, 'not_applicable');
});

test('Detecta contacto disfrazado dentro de wait cuando el contacto está prohibido', () => {
  const g = run([opened('D'), constraint('D', '2026-10-09T15:00:00Z', { contact_allowed: false })], {
    action: 'wait', timing: 'on_new_information',
    reason: 'Esperar, pero mientras tanto enviarle un WhatsApp al cliente con la cotización. Reevaluar mañana.',
  });
  assert.equal(g.replaced, true);
});

test('Permite mencionar el contacto en forma negativa', () => {
  const g = run([opened('E'), constraint('E', '2026-10-09T15:00:00Z', { contact_allowed: false })], {
    action: 'wait', timing: 'on_new_information',
    reason: 'No contactar al cliente mientras siga la restricción. Reevaluar cuando cambie.',
  });
  assert.equal(g.replaced, false);
});

test('R5: rechaza explicaciones que afirman compra o proponen descuentos', () => {
  const g = run([opened('F'), view('F', '2026-10-09T15:10:00Z')], {
    action: 'contact', timing: 'within_24h', reason: 'Vio el precio: tiene intención de compra confirmada, ofrecer un descuento.',
  });
  assert.equal(g.replaced, true);
});

test('R5: sin mensajes del cliente, el contacto inmediato pasa a within_24h', () => {
  const g = run([opened('G'), view('G', '2026-10-09T15:10:00Z')], { action: 'contact', timing: 'immediate', reason: 'Seguimiento breve.' });
  assert.equal(g.replaced, false);
  assert.equal(g.recommendation.timing, 'within_24h');
});

test('Quita evidencia inventada o de otro caso', () => {
  const g = run([opened('H'), msg('H', '2026-10-09T15:10:00Z', '¿Incluye instalación?')], {
    action: 'resolve_objection', evidence_event_ids: ['H-inventado', 'P01-e2'],
  });
  assert.equal(g.replaced, false);
  assert.equal(g.recommendation.evidence_event_ids.length, 1);
  assert.ok(g.fixes.some((f) => /evidencia/.test(f)));
});

test('Timing incompatible con la acción se reemplaza', () => {
  const g = run([opened('I')], { action: 'no_action', timing: 'immediate' });
  assert.equal(g.replaced, true);
});

test('wait sin condición de reevaluación: se agrega', () => {
  const g = run([opened('J')], { action: 'wait', timing: 'on_new_information', reason: 'Sin novedades.' });
  assert.equal(g.replaced, false);
  assert.match(g.recommendation.reason, /Reevaluar/);
});

test('Quita campos que no son del contrato (p. ej. un borrador de mensaje)', () => {
  const g = run([opened('K'), msg('K', '2026-10-09T15:10:00Z', '¿Incluye instalación?')], {
    action: 'resolve_objection', draft_message: 'Hola, le escribo para...',
  });
  assert.equal('draft_message' in g.recommendation, false);
});
