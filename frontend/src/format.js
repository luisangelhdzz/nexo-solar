// Textos y formatos compartidos por la interfaz.

export const ACTIONS = ['contact', 'request_information', 'resolve_objection', 'escalate', 'wait', 'no_action'];

export const ACTION_LABEL = {
  contact: 'Dar seguimiento',
  request_information: 'Pedir información',
  resolve_objection: 'Aclarar duda',
  escalate: 'Escalar a una persona',
  wait: 'Esperar',
  no_action: 'No actuar',
};

export const ACTION_HINT = {
  contact: 'Seguimiento breve sin afirmar intención de compra.',
  request_information: 'Pedir un dato necesario para avanzar.',
  resolve_objection: 'Aclarar una duda que el cliente expresó.',
  escalate: 'Revisión de una persona responsable.',
  wait: 'Posponer y reevaluar en una fecha o condición.',
  no_action: 'No hay intervención justificada.',
};

export const CONTACT_ACTIONS = ['contact', 'request_information', 'resolve_objection'];

export const LEVEL_LABEL = { low: 'Baja', medium: 'Media', high: 'Alta' };
export const RISK_LABEL = { low: 'Bajo', medium: 'Medio', high: 'Alto' };

export const EVENT_LABEL = {
  'case.opened': 'Propuesta enviada',
  'proposal.viewed': 'Abrió la propuesta',
  'message.received': 'Mensaje del cliente',
  'action.executed': 'Acción de la empresa',
  'constraint.updated': 'Restricción de contacto',
  'case.closed': 'Caso cerrado',
};

export const INTENT_LABEL = {
  question: 'Pregunta',
  objection: 'Objeción',
  request_delay: 'Pide esperar',
  interest: 'Interés',
  comparing: 'Comparando opciones',
  not_interested: 'Sin interés',
  provides_information: 'Entrega información',
  other: 'No es claro',
};

export const CLOSED_LABEL = { accepted: 'aceptada', rejected: 'rechazada', cancelled: 'cancelada' };

export const FIELD_LABEL = {
  action: 'Acción',
  timing: 'Momento',
  scheduled_for: 'Fecha',
  confidence: 'Confianza',
  risk_level: 'Riesgo',
  requires_human_review: 'Revisión humana',
  missing_information: 'Información faltante',
  evidence_event_ids: 'Evidencia',
  reason: 'Explicación',
};

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function fmtUtc(iso, { withYear = true } = {}) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${withYear ? ` ${d.getUTCFullYear()}` : ''}, ${hh}:${mm} UTC`;
}

export function timingText(rec) {
  if (!rec) return '';
  switch (rec.timing) {
    case 'immediate': return 'Ahora';
    case 'within_24h': return 'En las próximas 24 horas';
    case 'at_date': return `El ${fmtUtc(rec.scheduled_for)}`;
    case 'on_new_information': return 'Cuando llegue información nueva';
    default: return 'No aplica';
  }
}

export function fmtMoney(n) {
  if (n === null || n === undefined) return 'Monto desconocido';
  return `$${Number(n).toLocaleString('es-MX')} MXN`;
}

export function valueText(field, v) {
  if (v === null || v === undefined) return '—';
  if (field === 'action') return ACTION_LABEL[v] ?? v;
  if (field === 'confidence') return LEVEL_LABEL[v] ?? v;
  if (field === 'risk_level') return RISK_LABEL[v] ?? v;
  if (field === 'requires_human_review') return v ? 'Sí' : 'No';
  if (field === 'scheduled_for') return fmtUtc(v);
  if (field === 'timing') return { immediate: 'Ahora', within_24h: '24 h', at_date: 'En fecha', on_new_information: 'Con info nueva', not_applicable: 'No aplica' }[v] ?? v;
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'ninguna';
  return String(v);
}

export function eventSummary(ev) {
  const d = ev.data || {};
  switch (ev.event_type) {
    case 'case.opened': return `Estado ${d.status}, ${fmtMoney(d.proposal_amount_mxn)}`;
    case 'proposal.viewed': return d.section ? `Sección: ${d.section}` : 'Sin sección';
    case 'message.received': return d.message;
    case 'action.executed': return `Se ejecutó ${d.action}`;
    case 'constraint.updated': {
      const parts = [];
      if ('contact_allowed' in d) parts.push(d.contact_allowed ? 'Contacto permitido' : 'Contacto prohibido');
      if ('contact_not_before' in d) parts.push(d.contact_not_before ? `No antes del ${fmtUtc(d.contact_not_before)}` : 'Sin fecha mínima');
      return parts.join('. ');
    }
    case 'case.closed': return `Cerrado como ${CLOSED_LABEL[d.status] ?? d.status}`;
    default: return '';
  }
}

export const INACTION_KIND = {
  pattern: { label: 'Historial del cliente', hint: 'Es un buen cliente y sigue dentro de su tiempo habitual de decisión.' },
  client: { label: 'Lo pidió el cliente', hint: 'El cliente pidió esperar o dijo que no le interesa.' },
  rules: { label: 'Una regla lo impide', hint: 'R2, R3 o R4 bloquean el contacto por ahora.' },
  no_signal: { label: 'Sin señal suficiente', hint: 'Solo hay aperturas o tiempo sin respuesta; aún no se justifica intervenir.' },
  closed: { label: 'Caso cerrado', hint: 'R1: el cierre es definitivo.' },
};

export const TIER_LABEL = {
  frecuente: 'Cliente frecuente',
  recurrente: 'Cliente recurrente',
  nuevo: 'Cliente nuevo',
  sin_compras: 'Sin compras previas',
};

export const PACKAGE_LABEL = {
  'PKG-COMERCIO-10': 'Comercio 10 kW',
  'PKG-NEGOCIO-20': 'Negocio 20 kW',
  'PKG-INDUSTRIA-50': 'Industria 50 kW',
};

// "en 31 h", "hace 2 días"
export function fmtRelative(targetIso, nowIso) {
  if (!targetIso || !nowIso) return '';
  const diffH = (new Date(targetIso) - new Date(nowIso)) / 3600000;
  const abs = Math.abs(diffH);
  const txt = abs < 1 ? `${Math.max(1, Math.round(abs * 60))} min` : abs < 48 ? `${Math.round(abs)} h` : `${Math.round(abs / 24)} días`;
  return diffH >= 0 ? `en ${txt}` : `hace ${txt}`;
}

export function fmtHours(h) {
  if (h === null || h === undefined) return '—';
  return h < 48 ? `${Math.round(h)} h` : `${Math.round(h)} h (${Math.round((h / 24) * 10) / 10} días)`;
}

export const STAGE_LABEL = {
  enviada: 'Enviada',
  revisando: 'Revisando',
  con_dudas: 'Con dudas',
  decidiendo: 'Decidiendo',
  comprada: 'Comprada',
  perdida: 'Perdida',
};

export const pct = (x) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`);
