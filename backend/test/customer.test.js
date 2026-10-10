// Inacción por historial del cliente (extensión del portal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCaseState } from '../src/domain/state.js';
import { buildCustomerProfile } from '../src/domain/customer.js';
import { decide } from '../src/domain/policy.js';
import { guard } from '../src/domain/guardian.js';
import { interpretHeuristic } from '../src/ai/heuristic.js';
import { ev } from './helpers.js';

const H = 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const NOW = Date.parse('2026-10-10T12:00:00Z');

// Cotización pasada aceptada después de `hours` horas.
function pastPurchase(caseId, customerId, daysAgo, hours) {
  const opened = NOW - daysAgo * 24 * H;
  return buildCaseState(caseId, [
    ev(caseId, 'case.opened', iso(opened), { status: 'open', proposal_amount_mxn: 150000, customer_id: customerId }, `${caseId}-e1`),
    ev(caseId, 'case.closed', iso(opened + hours * H), { status: 'accepted' }, `${caseId}-e2`),
  ]);
}

const goodCustomer = { customer_id: 'CUS-001', name: 'Abarrotes La Esperanza' };
const history = [pastPurchase('H1', 'CUS-001', 300, 46), pastPurchase('H2', 'CUS-001', 180, 50), pastPurchase('H3', 'CUS-001', 60, 47)];

function currentCase(extra = [], openedHoursAgo = 6) {
  const opened = NOW - openedHoursAgo * H;
  return [
    ev('C1', 'case.opened', iso(opened), { status: 'open', proposal_amount_mxn: 150000, customer_id: 'CUS-001' }, 'C1-e1'),
    ev('C1', 'proposal.viewed', iso(opened + 1 * H), { section: 'price' }, 'C1-e2'),
    ...extra,
  ];
}

function run(events, profile, nowMs = NOW) {
  const state = buildCaseState('C1', events);
  const interps = {};
  for (const m of state.messages) interps[m.event_id] = { ...interpretHeuristic(m.message, { occurredAt: m.at }), source: 'heuristic', model: 't' };
  const now = iso(nowMs);
  const { recommendation, trace, rules } = decide(state, interps, now, {}, profile);
  const g = guard(recommendation, { state, rules, evaluationAt: now });
  return { rec: g.recommendation, trace, replaced: g.replaced };
}

test('Perfil: 3 compras en ~48 h hacen un cliente frecuente y confiable', () => {
  const p = buildCustomerProfile(goodCustomer, history, { nowIso: iso(NOW) });
  assert.equal(p.tier, 'frecuente');
  assert.equal(p.purchases, 3);
  assert.equal(p.typical_decision_hours, 47);
  assert.equal(p.reliable, true);
  assert.equal(p.consistent, true);
  assert.equal(p.patience_hours, 47);
});

test('Buen cliente dentro de su tiempo habitual y sin pedir nada: inacción (wait) con confianza alta', () => {
  const p = buildCustomerProfile(goodCustomer, history, { excludeCaseId: 'C1', nowIso: iso(NOW) });
  const { rec, trace, replaced } = run(currentCase(), p);
  assert.equal(replaced, false);
  assert.equal(rec.action, 'wait');
  assert.equal(rec.timing, 'at_date');
  // 47 h × 1.2 = 56.4 -> 57 h después de la apertura
  assert.equal(rec.scheduled_for, iso(NOW - 6 * H + 57 * H));
  assert.equal(rec.confidence, 'high');
  assert.equal(rec.risk_level, 'low');
  assert.equal(rec.requires_human_review, false);
  assert.match(rec.reason, /no intervenir/);
  assert.equal(trace.ideal.basis, 'customer_pattern');
  assert.equal(trace.inaction, true);
  assert.ok(rec.evidence_event_ids.every((id) => id.startsWith('C1-')), 'la evidencia es del mismo caso');
});

test('Si el buen cliente pregunta algo, se le responde (no hay inacción)', () => {
  const p = buildCustomerProfile(goodCustomer, history, { excludeCaseId: 'C1', nowIso: iso(NOW) });
  const { rec } = run(currentCase([ev('C1', 'message.received', iso(NOW - 2 * H), { message: '¿Incluye la instalación?' }, 'C1-e3')]), p);
  assert.equal(rec.action, 'resolve_objection');
});

test('Cuando pasa su tiempo habitual sin respuesta, se sugiere un seguimiento amable', () => {
  const p = buildCustomerProfile(goodCustomer, history, { excludeCaseId: 'C1', nowIso: iso(NOW) });
  const { rec, trace } = run(currentCase([], 60), p);
  assert.equal(rec.action, 'contact');
  assert.equal(rec.timing, 'within_24h');
  assert.equal(trace.ideal.basis, 'customer_pattern_expired');
});

test('Cliente nuevo: no se usa el patrón (decide como siempre)', () => {
  const p = buildCustomerProfile({ customer_id: 'CUS-009', name: 'Nuevo' }, [], { nowIso: iso(NOW) });
  const { trace } = run(currentCase(), p);
  assert.equal(p.reliable, false);
  assert.notEqual(trace.ideal.basis, 'customer_pattern');
});

test('Ficha del equipo: cliente de confianza que decide en ~48 h aunque no tenga historial', () => {
  const p = buildCustomerProfile({ customer_id: 'CUS-010', name: 'Equipo', trusted: true, decision_hours_override: 48 }, [], { nowIso: iso(NOW) });
  const { rec, trace } = run(currentCase(), p);
  assert.equal(rec.action, 'wait');
  assert.equal(trace.ideal.basis, 'customer_pattern');
  assert.equal(rec.confidence, 'medium'); // sin compras previas no hay patrón observado
});

test('El patrón nunca rompe reglas: con contacto prohibido sigue sin contactar', () => {
  const p = buildCustomerProfile(goodCustomer, history, { excludeCaseId: 'C1', nowIso: iso(NOW) });
  const { rec } = run(currentCase([ev('C1', 'constraint.updated', iso(NOW - 1 * H), { contact_allowed: false }, 'C1-e3')], 60), p);
  assert.ok(!['contact', 'request_information', 'resolve_objection'].includes(rec.action));
});

test('Las compras futuras o del mismo caso no cuentan como historial', () => {
  const future = pastPurchase('F1', 'CUS-001', -5, 10); // cerrada en el futuro
  const p = buildCustomerProfile(goodCustomer, [...history, future], { excludeCaseId: 'H1', nowIso: iso(NOW) });
  assert.equal(p.purchases, 2);
});
