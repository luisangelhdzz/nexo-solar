import { ACTIONS, CONTACT_ACTIONS, COOLDOWN_HOURS } from './constants.js';
import { addHours, toMs, humanUtc, maxIso } from './time.js';
import { lastAction } from './state.js';

export const RULES = {
  R1: 'Caso cerrado: solo no_action.',
  R2: 'contact_allowed=false bloquea contact, request_information y resolve_objection.',
  R3: 'Antes de contact_not_before se bloquean las mismas tres acciones.',
  R4: 'Tras contact o request_information se esperan 24 h, salvo un message.received posterior.',
  R5: 'Las aperturas solas no confirman compra ni justifican descuentos o urgencia inmediata.',
  R6: 'Reconocer la información faltante; la prohibición de contacto prevalece.',
  CLIENTE: 'El cliente pidió explícitamente no ser contactado antes de una fecha.',
};

// Calcula de forma determinística qué acciones están permitidas en `nowIso`.
// `clientDelays` son solicitudes de espera detectadas en mensajes del cliente
// ([{ until, event_id }]); se respetan igual que una restricción.
export function evaluateRules(state, nowIso, { clientDelays = [] } = {}) {
  const now = toMs(nowIso);
  const restrictions = [];

  // R1: caso cerrado.
  if (state.status === 'closed') {
    restrictions.push({
      rule: 'R1',
      scope: 'all_but_no_action',
      until: null,
      event_ids: [state.closed_event_id],
      message: `R1: el caso se cerró (${state.closed_status}) en ${state.closed_event_id}; solo se permite no_action.`,
    });
  }

  // R2: contacto prohibido.
  if (state.contact_allowed === false) {
    restrictions.push({
      rule: 'R2',
      scope: 'contact',
      until: null,
      event_ids: [state.contact_allowed_event_id].filter(Boolean),
      message: `R2: contacto prohibido (contact_allowed=false en ${state.contact_allowed_event_id}).`,
    });
  }

  // R3: fecha mínima de contacto.
  if (state.contact_not_before && now < toMs(state.contact_not_before)) {
    restrictions.push({
      rule: 'R3',
      scope: 'contact',
      until: state.contact_not_before,
      event_ids: [state.contact_not_before_event_id].filter(Boolean),
      message: `R3: no se puede contactar antes del ${humanUtc(state.contact_not_before)} (${state.contact_not_before_event_id}).`,
    });
  }

  // R4: 24 h después de contact/request_information, salvo mensaje posterior del cliente.
  const last = lastAction(state);
  let r4 = null;
  if (last) {
    const cooldownEnd = addHours(last.at, COOLDOWN_HOURS);
    const replyAfter = state.messages.find((m) => toMs(m.at) > toMs(last.at));
    r4 = { last_action: last, cooldown_end: cooldownEnd, reply_event_id: replyAfter?.event_id ?? null };
    if (now < toMs(cooldownEnd) && !replyAfter) {
      restrictions.push({
        rule: 'R4',
        scope: 'contact',
        until: cooldownEnd,
        event_ids: [last.event_id],
        message: `R4: no se puede volver a contactar antes del ${humanUtc(cooldownEnd)} (24 h después de ${last.event_id}).`,
      });
    }
  }

  // Solicitudes de espera del propio cliente (detectadas por la IA o por el clasificador de respaldo).
  for (const d of clientDelays) {
    if (d.until && now < toMs(d.until)) {
      restrictions.push({
        rule: 'CLIENTE',
        scope: 'contact',
        until: d.until,
        event_ids: [d.event_id],
        message: `El cliente pidió no ser contactado antes del ${humanUtc(d.until)} (${d.event_id}).`,
      });
    }
  }

  const actions = {};
  for (const action of ACTIONS) {
    const blocks = restrictions.filter((r) => {
      if (r.scope === 'all_but_no_action') return action !== 'no_action';
      if (r.scope === 'contact') return CONTACT_ACTIONS.includes(action);
      return false;
    });
    actions[action] = { allowed: blocks.length === 0, blocks };
  }

  const contactRestrictions = restrictions.filter((r) => r.scope === 'contact');
  const indefinite = contactRestrictions.some((r) => r.until === null);
  const temporaryEnd = maxIso(...contactRestrictions.filter((r) => r.until).map((r) => r.until));

  return {
    evaluation_at: nowIso,
    closed: state.status === 'closed',
    restrictions,
    actions,
    contact_blocked: contactRestrictions.length > 0,
    contact_block_indefinite: indefinite,
    // Primer momento en que el contacto vuelve a estar permitido (si solo hay bloqueos temporales).
    contact_available_at: !indefinite && temporaryEnd ? temporaryEnd : null,
    r4,
  };
}

export function isAllowed(rulesResult, action) {
  return Boolean(rulesResult.actions[action]?.allowed);
}
