import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCaseState } from '../src/domain/state.js';
import { evaluateRules } from '../src/domain/rules.js';
import { opened, msg, action, constraint, closed, CONTACT } from './helpers.js';

const rulesFor = (events, now) => evaluateRules(buildCaseState(events[0].case_id, events), now);
const allowed = (r) => Object.entries(r.actions).filter(([, v]) => v.allowed).map(([k]) => k).sort();

test('R1: caso cerrado solo permite no_action', () => {
  const r = rulesFor([opened('A'), closed('A', '2026-10-09T15:10:00Z')], '2026-10-09T16:00:00Z');
  assert.deepEqual(allowed(r), ['no_action']);
});

test('R1: un cierre es definitivo aunque lleguen eventos después', () => {
  const evs = [opened('A'), closed('A', '2026-10-09T15:10:00Z'), msg('A', '2026-10-09T15:20:00Z', '¿Siguen ahí?'), constraint('A', '2026-10-09T15:30:00Z', { contact_allowed: true })];
  const state = buildCaseState('A', evs);
  assert.equal(state.status, 'closed');
  assert.equal(state.messages.length, 0);
  assert.deepEqual(allowed(evaluateRules(state, '2026-10-09T16:00:00Z')), ['no_action']);
});

test('R2: contact_allowed=false bloquea las tres acciones de contacto', () => {
  const r = rulesFor([opened('B'), constraint('B', '2026-10-09T15:00:00Z', { contact_allowed: false })], '2026-10-09T16:00:00Z');
  for (const a of CONTACT) assert.equal(r.actions[a].allowed, false, a);
  assert.deepEqual(allowed(r), ['escalate', 'no_action', 'wait']);
  assert.equal(r.contact_block_indefinite, true);
});

test('R3: antes de contact_not_before se bloquea el contacto y después se permite', () => {
  const evs = [opened('C'), constraint('C', '2026-10-09T15:00:00Z', { contact_not_before: '2026-10-12T15:00:00Z' })];
  const before = rulesFor(evs, '2026-10-12T14:59:00Z');
  for (const a of CONTACT) assert.equal(before.actions[a].allowed, false);
  assert.equal(before.contact_available_at, '2026-10-12T15:00:00Z');
  const after = rulesFor(evs, '2026-10-12T15:00:00Z');
  for (const a of CONTACT) assert.equal(after.actions[a].allowed, true);
});

test('R4: 24 h de espera después de contact o request_information', () => {
  for (const kind of ['contact', 'request_information']) {
    const evs = [opened('D'), action('D', '2026-10-09T14:00:00Z', kind)];
    const during = rulesFor(evs, '2026-10-10T13:59:00Z');
    for (const a of CONTACT) assert.equal(during.actions[a].allowed, false, `${kind}/${a}`);
    const after = rulesFor(evs, '2026-10-10T14:00:00Z');
    for (const a of CONTACT) assert.equal(after.actions[a].allowed, true);
  }
});

test('R4: un mensaje del cliente posterior a la acción levanta la espera', () => {
  const evs = [opened('E'), action('E', '2026-10-09T14:00:00Z'), msg('E', '2026-10-09T15:30:00Z', '¿Pueden aclararme la fecha de entrega?')];
  const r = rulesFor(evs, '2026-10-09T16:00:00Z');
  for (const a of CONTACT) assert.equal(r.actions[a].allowed, true);
});

test('R4: un mensaje anterior o simultáneo a la acción NO levanta la espera', () => {
  const evs = [opened('F'), msg('F', '2026-10-09T14:00:00Z', 'Hola'), action('F', '2026-10-09T14:00:00Z')];
  const r = rulesFor(evs, '2026-10-09T16:00:00Z');
  assert.equal(r.actions.contact.allowed, false);
});

test('R4 no anula R2 ni R3 aunque el cliente haya escrito', () => {
  const evs = [opened('G'), action('G', '2026-10-09T14:00:00Z'), constraint('G', '2026-10-09T14:30:00Z', { contact_allowed: false }), msg('G', '2026-10-09T15:00:00Z', '¿Me llaman?')];
  const r = rulesFor(evs, '2026-10-09T16:00:00Z');
  assert.equal(r.actions.contact.allowed, false);
  assert.deepEqual(r.actions.contact.blocks.map((b) => b.rule), ['R2']);
});

test('constraint.updated solo sobrescribe los campos incluidos', () => {
  const evs = [
    opened('H'),
    constraint('H', '2026-10-09T15:00:00Z', { contact_allowed: false }),
    constraint('H', '2026-10-09T15:10:00Z', { contact_not_before: '2026-10-20T00:00:00Z' }),
  ];
  const state = buildCaseState('H', evs);
  assert.equal(state.contact_allowed, false);
  assert.equal(state.contact_not_before, '2026-10-20T00:00:00Z');
});

test('Predeterminados: contacto permitido y sin fecha de bloqueo', () => {
  const state = buildCaseState('I', [opened('I')]);
  assert.equal(state.contact_allowed, true);
  assert.equal(state.contact_not_before, null);
});
