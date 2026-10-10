import { toMs } from './time.js';

// Construye el estado de un caso aplicando sus eventos en el orden recibido
// (contratos.json: "Apply ordered events"). Los eventos ya vienen deduplicados.
//
// Reglas de estado del kit:
// - Predeterminados: contact_allowed=true, contact_not_before=null.
// - constraint.updated solo sobrescribe los campos incluidos.
// - case.closed es terminal: los eventos posteriores se guardan en el historial
//   pero no cambian el estado.
export function buildCaseState(caseId, orderedEvents) {
  const state = {
    case_id: caseId,
    status: 'unknown', // unknown | open | closed
    opened_event_id: null,
    opened_at: null,
    amount_mxn: null,
    customer_id: null, // extensión: solo en casos creados por el portal
    package_id: null,
    closed_status: null,
    closed_event_id: null,
    closed_at: null,
    contact_allowed: true,
    contact_allowed_event_id: null,
    contact_not_before: null,
    contact_not_before_event_id: null,
    messages: [],
    views: [],
    actions: [],
    events: orderedEvents,
    warnings: [],
  };

  let prevAt = null;
  for (const ev of orderedEvents) {
    const at = ev.occurred_at;

    if (prevAt && toMs(at) < toMs(prevAt)) {
      state.warnings.push({
        event_id: ev.event_id,
        message: `La fecha de ${ev.event_id} es anterior a la del evento previo; se respeta el orden recibido.`,
      });
    }
    prevAt = at;

    if (state.status === 'closed') {
      state.warnings.push({
        event_id: ev.event_id,
        message: `${ev.event_id} llegó después del cierre; el cierre es definitivo y el evento no cambia el estado.`,
      });
      continue;
    }

    switch (ev.event_type) {
      case 'case.opened':
        if (state.opened_event_id) {
          state.warnings.push({ event_id: ev.event_id, message: `Apertura repetida (${ev.event_id}); se conserva la primera.` });
          break;
        }
        state.status = 'open';
        state.opened_event_id = ev.event_id;
        state.opened_at = at;
        state.amount_mxn = ev.data.proposal_amount_mxn;
        state.customer_id = typeof ev.data.customer_id === 'string' ? ev.data.customer_id : null;
        state.package_id = typeof ev.data.package_id === 'string' ? ev.data.package_id : null;
        break;
      case 'proposal.viewed':
        state.views.push({ event_id: ev.event_id, section: ev.data.section ?? null, at });
        break;
      case 'message.received':
        state.messages.push({ event_id: ev.event_id, message: ev.data.message, at });
        break;
      case 'action.executed':
        state.actions.push({ event_id: ev.event_id, action: ev.data.action, at });
        break;
      case 'constraint.updated':
        if (Object.prototype.hasOwnProperty.call(ev.data, 'contact_allowed')) {
          state.contact_allowed = ev.data.contact_allowed;
          state.contact_allowed_event_id = ev.event_id;
        }
        if (Object.prototype.hasOwnProperty.call(ev.data, 'contact_not_before')) {
          state.contact_not_before = ev.data.contact_not_before;
          state.contact_not_before_event_id = ev.event_id;
        }
        break;
      case 'case.closed':
        state.status = 'closed';
        state.closed_status = ev.data.status;
        state.closed_event_id = ev.event_id;
        state.closed_at = at;
        break;
      default:
        break;
    }
  }

  if (!state.opened_event_id && state.status !== 'closed') {
    state.warnings.push({ event_id: null, message: 'El caso no tiene evento case.opened: falta el monto y el estado inicial.' });
  }

  return state;
}

// Última acción ejecutada por la empresa (la más reciente por fecha).
export function lastAction(state) {
  if (!state.actions.length) return null;
  return state.actions.reduce((a, b) => (toMs(b.at) >= toMs(a.at) ? b : a));
}

// Mensajes del cliente que llegaron después de la última acción de la empresa
// (es decir, que todavía no han sido atendidos).
export function pendingMessages(state) {
  const last = lastAction(state);
  if (!last) return [...state.messages];
  return state.messages.filter((m) => toMs(m.at) > toMs(last.at));
}

// Último momento en que hubo actividad (del cliente o de la empresa).
export function lastTouchAt(state) {
  const times = [
    state.opened_at,
    ...state.views.map((v) => v.at),
    ...state.messages.map((m) => m.at),
    ...state.actions.map((a) => a.at),
  ].filter(Boolean);
  if (!times.length) return null;
  return times.reduce((a, b) => (toMs(b) > toMs(a) ? b : a));
}

// Contactos de la empresa que no han recibido respuesta del cliente.
export function unansweredFollowups(state) {
  const lastMsgAt = state.messages.length
    ? state.messages.reduce((a, b) => (toMs(b.at) > toMs(a.at) ? b : a)).at
    : null;
  return state.actions.filter((a) => !lastMsgAt || toMs(a.at) > toMs(lastMsgAt)).length;
}
