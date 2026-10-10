import { buildCaseState } from './state.js';
import { decide } from './policy.js';
import { guard } from './guardian.js';
import { interpretCase } from '../ai/interpreter.js';
import { RECOMMENDATION_FIELDS } from './constants.js';

// Evalúa un caso completo: estado -> IA -> política -> reglas -> guardián.
// `events` deben venir deduplicados y en el orden de llegada.
export async function evaluateCase({ caseId, events, evaluationAt, storage = null, provider, policy = {}, customer = null, lessons = [] }) {
  const state = buildCaseState(caseId, events);
  const interpretations = await interpretCase(state, storage, provider, { lessons });
  const { recommendation: proposed, trace, rules } = decide(state, interpretations, evaluationAt, policy, customer);
  const guarded = guard(proposed, { state, rules, evaluationAt });

  return {
    case_id: caseId,
    state: publicState(state),
    rules,
    interpretations,
    customer,
    recommendation: guarded.recommendation,
    trace: {
      ...trace,
      guardian: {
        checks: guarded.checks,
        fixes: guarded.fixes,
        replaced: guarded.replaced,
        replaced_reason: guarded.replaced_reason,
        original: guarded.original,
      },
    },
  };
}

function publicState(state) {
  const { events, ...rest } = state;
  return { ...rest, event_count: events.length };
}

// Solo los campos del contrato, en el orden del contrato (para exportar).
export function toContract(rec) {
  const out = {};
  for (const f of RECOMMENDATION_FIELDS) out[f] = rec[f];
  return out;
}

const DIFF_FIELDS = ['action', 'timing', 'scheduled_for', 'confidence', 'risk_level', 'requires_human_review', 'missing_information', 'evidence_event_ids', 'reason'];

// Campos que definen la decisión (sin la explicación, que cambia con el tiempo transcurrido).
const CORE_FIELDS = DIFF_FIELDS.filter((f) => f !== 'reason');
export function sameDecision(a, b) {
  if (!a || !b) return false;
  return CORE_FIELDS.every((f) => JSON.stringify(a[f] ?? null) === JSON.stringify(b[f] ?? null));
}

// Qué cambió entre la decisión anterior y la nueva.
export function diffRecommendations(prev, next) {
  if (!prev) return [];
  const changes = [];
  for (const f of DIFF_FIELDS) {
    const a = JSON.stringify(prev[f] ?? null);
    const b = JSON.stringify(next[f] ?? null);
    if (a !== b) changes.push({ field: f, before: prev[f] ?? null, after: next[f] ?? null });
  }
  return changes;
}
