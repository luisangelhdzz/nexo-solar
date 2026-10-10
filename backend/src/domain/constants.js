// Catálogos del contrato (contratos.json del kit).

export const EVENT_TYPES = [
  'case.opened',
  'proposal.viewed',
  'proposal.sent', // extensión del portal: una solicitud pasa a propuesta enviada
  'message.received',
  'action.executed',
  'constraint.updated',
  'case.closed',
];

export const ACTIONS = [
  'contact',
  'request_information',
  'resolve_objection',
  'escalate',
  'wait',
  'no_action',
];

// Acciones que implican comunicarse con el cliente. R2, R3 y R4 las bloquean.
export const CONTACT_ACTIONS = ['contact', 'request_information', 'resolve_objection'];

export const TIMINGS = ['immediate', 'within_24h', 'at_date', 'on_new_information', 'not_applicable'];

// Qué timings acepta cada acción (sección 6 del documento).
export const TIMINGS_BY_ACTION = {
  contact: ['immediate', 'within_24h', 'at_date'],
  request_information: ['immediate', 'within_24h', 'at_date'],
  resolve_objection: ['immediate', 'within_24h', 'at_date'],
  escalate: ['immediate', 'within_24h', 'at_date'],
  wait: ['at_date', 'on_new_information'],
  no_action: ['not_applicable'],
};

export const LEVELS = ['low', 'medium', 'high'];

export const EXECUTED_ACTIONS = ['contact', 'request_information'];

export const CLOSED_STATUSES = ['accepted', 'rejected', 'cancelled'];

export const RECOMMENDATION_FIELDS = [
  'case_id',
  'action',
  'timing',
  'scheduled_for',
  'reason',
  'evidence_event_ids',
  'confidence',
  'confidence_reason',
  'risk_level',
  'requires_human_review',
  'missing_information',
];

export const COOLDOWN_HOURS = 24; // R4

export const ACTION_LABELS_ES = {
  contact: 'Dar seguimiento',
  request_information: 'Pedir información',
  resolve_objection: 'Aclarar duda',
  escalate: 'Escalar a una persona',
  wait: 'Esperar',
  no_action: 'No actuar',
};
