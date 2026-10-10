// Perfil del cliente a partir de su historial de cotizaciones (extensión opcional).
//
// El contrato del reto no trae clientes: esto solo aplica a casos cuyo case.opened incluye
// data.customer_id (los que crea el portal). Sin cliente, el sistema decide igual que siempre.
// El perfil nunca cambia las reglas R1–R6: solo ajusta cuánto conviene esperar antes de
// intervenir cuando el cliente no ha pedido nada.

import { hoursBetween, toMs } from './time.js';

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const round1 = (n) => Math.round(n * 10) / 10;

// `customer`: ficha del cliente (puede incluir la opinión del equipo: trusted, decision_hours_override).
// `caseStates`: estados de TODAS las cotizaciones del cliente.
// Solo cuentan como historial las cotizaciones cerradas antes de la hora de evaluación
// y distintas del caso que se está evaluando.
export function buildCustomerProfile(customer, caseStates, { excludeCaseId = null, nowIso } = {}) {
  if (!customer) return null;
  const now = nowIso ? toMs(nowIso) : Infinity;
  const past = caseStates.filter(
    (s) => s.case_id !== excludeCaseId && s.status === 'closed' && s.closed_at && toMs(s.closed_at) <= now,
  );
  const accepted = past.filter((s) => s.closed_status === 'accepted' && s.opened_at);
  const rejected = past.filter((s) => s.closed_status === 'rejected');
  const cancelled = past.filter((s) => s.closed_status === 'cancelled');
  const decisionHours = accepted.map((s) => round1(hoursBetween(s.opened_at, s.closed_at)));
  const typical = median(decisionHours);
  const min = decisionHours.length ? Math.min(...decisionHours) : null;
  const max = decisionHours.length ? Math.max(...decisionHours) : null;
  const consistent = decisionHours.length >= 2 && typical > 0 && (max - min) <= typical * 0.5;
  const open = caseStates.filter((s) => s.case_id !== excludeCaseId && s.status !== 'closed');

  const trusted = customer.trusted === true;
  const override = Number(customer.decision_hours_override) > 0 ? Number(customer.decision_hours_override) : null;

  // Buen cliente: el equipo lo marcó como de confianza, o tiene 2+ compras y no rechaza seguido.
  const reliable = trusted || (accepted.length >= 2 && accepted.length >= rejected.length * 2);
  const patienceHours = override ?? (typical !== null ? Math.round(typical) : null);

  let tier = 'nuevo';
  if (accepted.length >= 2) tier = 'frecuente';
  else if (accepted.length === 1) tier = 'recurrente';
  else if (past.length) tier = 'sin_compras';

  return {
    customer_id: customer.customer_id,
    name: customer.name,
    tier,
    trusted,
    reliable,
    purchases: accepted.length,
    rejected: rejected.length,
    cancelled: cancelled.length,
    open_cases: open.map((s) => s.case_id),
    total_purchased_mxn: accepted.reduce((sum, s) => sum + (s.amount_mxn || 0), 0),
    decision_hours: decisionHours,
    typical_decision_hours: typical,
    min_decision_hours: min,
    max_decision_hours: max,
    consistent,
    decision_hours_override: override,
    patience_hours: patienceHours,
    past_purchase_case_ids: accepted.map((s) => s.case_id),
    last_purchase_at: accepted.length ? accepted.map((s) => s.closed_at).sort().at(-1) : null,
    notes: customer.notes || null,
  };
}

// Huella corta del perfil: si cambia el historial, la decisión del caso debe recalcularse.
export function profileFingerprint(profile) {
  if (!profile) return 'sin-cliente';
  return [
    profile.customer_id, profile.purchases, profile.rejected, profile.typical_decision_hours,
    profile.trusted, profile.decision_hours_override,
  ].join(':');
}

export const TIER_LABEL = {
  frecuente: 'Cliente frecuente',
  recurrente: 'Cliente recurrente',
  nuevo: 'Cliente nuevo',
  sin_compras: 'Sin compras previas',
};
