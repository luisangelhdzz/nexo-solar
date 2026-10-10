import { EVENT_TYPES, EXECUTED_ACTIONS, CLOSED_STATUSES } from './constants.js';
import { isIsoUtc } from './time.js';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';

// Valida los campos de `data` según contratos.json.
function validateData(type, data) {
  const errors = [];
  switch (type) {
    case 'case.opened':
      if (data.status !== 'open') errors.push('data.status debe ser "open"');
      if (typeof data.proposal_amount_mxn !== 'number' || !Number.isFinite(data.proposal_amount_mxn) || data.proposal_amount_mxn < 0) {
        errors.push('data.proposal_amount_mxn debe ser un número mayor o igual a 0');
      }
      break;
    case 'proposal.viewed':
      if (data.section !== undefined && typeof data.section !== 'string') {
        errors.push('data.section debe ser texto');
      }
      break;
    case 'message.received':
      if (!isNonEmptyString(data.message)) errors.push('data.message debe ser texto no vacío');
      break;
    case 'action.executed':
      if (!EXECUTED_ACTIONS.includes(data.action)) {
        errors.push(`data.action debe ser uno de: ${EXECUTED_ACTIONS.join(', ')}`);
      }
      break;
    case 'constraint.updated': {
      const hasAllowed = Object.prototype.hasOwnProperty.call(data, 'contact_allowed');
      const hasNotBefore = Object.prototype.hasOwnProperty.call(data, 'contact_not_before');
      if (!hasAllowed && !hasNotBefore) {
        errors.push('constraint.updated requiere contact_allowed o contact_not_before');
      }
      if (hasAllowed && typeof data.contact_allowed !== 'boolean') {
        errors.push('data.contact_allowed debe ser booleano');
      }
      if (hasNotBefore && data.contact_not_before !== null && !isIsoUtc(data.contact_not_before)) {
        errors.push('data.contact_not_before debe ser fecha ISO 8601 en UTC o null');
      }
      break;
    }
    case 'case.closed':
      if (!CLOSED_STATUSES.includes(data.status)) {
        errors.push(`data.status debe ser uno de: ${CLOSED_STATUSES.join(', ')}`);
      }
      break;
    default:
      break;
  }
  return errors;
}

// Valida un objeto evento. Devuelve la lista de errores (vacía si es válido).
export function validateEvent(ev) {
  if (!isObject(ev)) return ['La línea no es un objeto JSON'];
  const errors = [];
  if (!isNonEmptyString(ev.event_id)) errors.push('event_id es obligatorio y debe ser texto');
  if (!isNonEmptyString(ev.case_id)) errors.push('case_id es obligatorio y debe ser texto');
  if (!EVENT_TYPES.includes(ev.event_type)) {
    errors.push(`event_type inválido (${JSON.stringify(ev.event_type)}); válidos: ${EVENT_TYPES.join(', ')}`);
  }
  if (!isIsoUtc(ev.occurred_at)) errors.push('occurred_at debe ser fecha ISO 8601 en UTC (terminar en Z)');
  if (!isObject(ev.data)) {
    errors.push('data es obligatorio y debe ser un objeto');
  } else if (EVENT_TYPES.includes(ev.event_type)) {
    errors.push(...validateData(ev.event_type, ev.data));
  }
  return errors;
}

// Solo conserva los campos del contrato (evita guardar basura extra).
function normalize(ev) {
  return {
    event_id: ev.event_id.trim(),
    case_id: ev.case_id.trim(),
    event_type: ev.event_type,
    occurred_at: ev.occurred_at,
    data: ev.data,
  };
}

// Recibe el texto de un archivo JSONL y separa eventos válidos de errores.
// Un error en una línea nunca detiene el resto del archivo.
export function parseJsonl(content) {
  const events = [];
  const errors = [];
  const lines = String(content ?? '').split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const line = idx + 1;
    const text = raw.trim();
    if (!text) return;
    let obj;
    try {
      obj = JSON.parse(text);
    } catch (e) {
      errors.push({ line, raw: text.slice(0, 300), errors: [`JSON mal formado: ${e.message}`] });
      return;
    }
    const problems = validateEvent(obj);
    if (problems.length) {
      errors.push({
        line,
        raw: text.slice(0, 300),
        event_id: typeof obj?.event_id === 'string' ? obj.event_id : null,
        case_id: typeof obj?.case_id === 'string' ? obj.case_id : null,
        errors: problems,
      });
      return;
    }
    events.push({ ...normalize(obj), line });
  });
  return { events, errors };
}
