import { buildCaseState } from '../src/domain/state.js';
import { decide } from '../src/domain/policy.js';
import { guard } from '../src/domain/guardian.js';
import { interpretHeuristic } from '../src/ai/heuristic.js';

// Constructor de eventos para pruebas.
let n = 0;
export function ev(caseId, type, at, data = {}, id) {
  n += 1;
  return { event_id: id ?? `${caseId}-t${n}`, case_id: caseId, event_type: type, occurred_at: at, data };
}
export const opened = (c, at = '2026-10-09T15:00:00Z', amount = 150000) => ev(c, 'case.opened', at, { status: 'open', proposal_amount_mxn: amount });
export const msg = (c, at, message) => ev(c, 'message.received', at, { message });
export const view = (c, at, section = 'price') => ev(c, 'proposal.viewed', at, { section });
export const action = (c, at, a = 'contact') => ev(c, 'action.executed', at, { action: a });
export const constraint = (c, at, data) => ev(c, 'constraint.updated', at, data);
export const closed = (c, at, status = 'accepted') => ev(c, 'case.closed', at, { status });

// Decide con el clasificador de respaldo (sin red) y pasa por el guardián, como en producción.
export function decideHeuristic(events, now = '2026-10-09T16:00:00Z', policy = {}) {
  const caseId = events[0].case_id;
  const state = buildCaseState(caseId, events);
  const interpretations = {};
  for (const m of state.messages) interpretations[m.event_id] = { ...interpretHeuristic(m.message, { occurredAt: m.at }), source: 'heuristic', model: 'test' };
  const { recommendation, trace, rules } = decide(state, interpretations, now, policy);
  const guarded = guard(recommendation, { state, rules, evaluationAt: now });
  return { rec: guarded.recommendation, trace, rules, state, guarded };
}

export const CONTACT = ['contact', 'request_information', 'resolve_objection'];
