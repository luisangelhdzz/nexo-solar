// Guardián: última validación determinística antes de publicar una recomendación.
// No confía en nada de lo anterior (ni en la IA ni en la política): revisa el contrato
// y las reglas R1–R6 otra vez. Si encuentra una infracción, reemplaza la recomendación
// por una alternativa segura y deja constancia en la traza.

import {
  ACTIONS, CONTACT_ACTIONS, LEVELS, RECOMMENDATION_FIELDS, TIMINGS, TIMINGS_BY_ACTION,
} from './constants.js';
import { isIsoUtc, toMs, humanUtc } from './time.js';

const NEGATION = /\b(no|nadie|sin|ni|nunca|evitar|evite|prohibid[oa]|impide|impiden)\b[^.;:]{0,30}$/;

// Frases que afirman intención de compra o presionan la venta (R5).
// También las usa el asistente para revisar sus borradores (ai/assistant-checks.js).
export const R5_PATTERNS = [
  /(ofrecer|aplicar|dar|otorgar|proponer)(le)? (un |el )?descuento/,
  /\burgente\b|\burgencia\b/,
  /[uú]ltima oportunidad/,
  /cerrar (la )?venta|cierre de (la )?venta/,
  /intenci[oó]n de compra (confirmada|clara|segura)/,
  /(est[aá]|ya) (list[oa]|decidid[oa]) (para|a) comprar/,
  /va a comprar|quiere comprar|comprar[aá] seguro/,
];

// Frases que indican comunicarse con el cliente (contacto "disfrazado").
const CONTACT_PATTERNS = [
  /(contactar|llamar|escribir|marcar|mandar|enviar|responder)(le)? al cliente/,
  /(env[ií]a|manda|escribe|ll[aá]ma|responde)(le)? al cliente/,
  /(enviar|mandar)(le)? (un |una )?(mensaje|correo|whatsapp|sms|email|e-mail)/,
  /\bwhatsapp\b|\bsms\b/,
  /borrador (de|del) (mensaje|correo)/,
];

export function findAffirmative(text, patterns) {
  const lower = text.toLowerCase();
  for (const re of patterns) {
    const global = new RegExp(re.source, 'g');
    let m;
    while ((m = global.exec(lower)) !== null) {
      const before = lower.slice(Math.max(0, m.index - 40), m.index);
      if (!NEGATION.test(before)) return m[0];
    }
  }
  return null;
}

function check(list, id, ok, message, severity = 'error') {
  list.push({ id, ok: Boolean(ok), message, severity });
  return Boolean(ok);
}

// Alternativa segura cuando algo no pasa la validación.
export function safeFallback(rec, state, rules, why) {
  if (rules.closed) {
    return {
      case_id: state.case_id, action: 'no_action', timing: 'not_applicable', scheduled_for: null,
      reason: `El caso está cerrado (${state.closed_event_id}). Por R1 solo procede no_action.`,
      evidence_event_ids: [state.closed_event_id], confidence: 'high',
      confidence_reason: 'El cierre es definitivo.', risk_level: 'low', requires_human_review: false,
      missing_information: [],
    };
  }
  const evidence = rec?.evidence_event_ids?.length ? rec.evidence_event_ids : [state.events[state.events.length - 1]?.event_id].filter(Boolean);
  const temporary = rules.contact_blocked && !rules.contact_block_indefinite && rules.contact_available_at;
  return {
    case_id: state.case_id,
    action: 'wait',
    timing: temporary ? 'at_date' : 'on_new_information',
    scheduled_for: temporary ? rules.contact_available_at : null,
    reason: `La recomendación original no pasó la validación (${why}). Por seguridad se espera sin contactar al cliente. Reevaluar ${temporary ? `el ${humanUtc(rules.contact_available_at)}` : 'cuando llegue nueva información'}; una persona debe revisar el caso.`,
    evidence_event_ids: evidence,
    confidence: 'low',
    confidence_reason: 'Se aplicó la alternativa segura del validador.',
    risk_level: 'medium',
    requires_human_review: true,
    missing_information: rec?.missing_information?.filter((x) => typeof x === 'string') ?? [],
  };
}

// Valida y, si es posible, corrige detalles menores. Devuelve la recomendación final y la lista de chequeos.
export function guard(input, { state, rules, evaluationAt }) {
  const checks = [];
  const fixes = [];
  const rec = { ...input };
  const caseEventIds = new Set(state.events.map((e) => e.event_id));
  const hasClientMessage = state.messages.length > 0;
  let fatal = null;

  // Contrato: campos requeridos, solo los del contrato.
  const missingFields = RECOMMENDATION_FIELDS.filter((f) => !(f in rec));
  if (!check(checks, 'contract_fields', missingFields.length === 0, missingFields.length ? `Faltan campos: ${missingFields.join(', ')}` : 'Tiene los 11 campos del contrato.')) {
    fatal = fatal || 'faltan campos del contrato';
  }
  for (const k of Object.keys(rec)) if (!RECOMMENDATION_FIELDS.includes(k)) delete rec[k];

  check(checks, 'case_id', rec.case_id === state.case_id, 'El case_id coincide con el caso evaluado.') || (fatal = fatal || 'case_id incorrecto');

  // Catálogos.
  const validAction = check(checks, 'action_catalog', ACTIONS.includes(rec.action), `Acción del catálogo (${rec.action}).`);
  if (!validAction) fatal = fatal || 'acción fuera del catálogo';
  const validTiming = check(
    checks, 'timing_for_action',
    TIMINGS.includes(rec.timing) && validAction && TIMINGS_BY_ACTION[rec.action].includes(rec.timing),
    `Timing compatible con la acción (${rec.action} + ${rec.timing}).`,
  );
  if (!validTiming) fatal = fatal || 'timing incompatible con la acción';

  // scheduled_for solo con at_date.
  if (rec.timing === 'at_date') {
    const okDate = isIsoUtc(rec.scheduled_for) && toMs(rec.scheduled_for) >= toMs(evaluationAt);
    check(checks, 'scheduled_for', okDate, 'scheduled_for es una fecha UTC futura (timing=at_date).') || (fatal = fatal || 'scheduled_for inválido');
  } else {
    if (rec.scheduled_for !== null) fixes.push('scheduled_for se dejó en null porque timing no es at_date.');
    rec.scheduled_for = null;
    check(checks, 'scheduled_for', true, 'scheduled_for es null (timing distinto de at_date).');
  }

  // Reglas R1–R4 (y solicitud explícita del cliente).
  const allowed = rules.actions[rec.action];
  if (!check(checks, 'rules_r1_r4', allowed?.allowed, allowed?.allowed ? 'La acción está permitida por R1–R4 y por las solicitudes del cliente.' : `Bloqueada: ${allowed?.blocks.map((b) => b.rule).join(', ')}`)) {
    fatal = fatal || `la acción ${rec.action} está bloqueada por ${allowed?.blocks.map((b) => b.rule).join(', ')}`;
  }

  // R5: sin mensajes del cliente, no hay urgencia inmediata ni afirmaciones de compra.
  if (CONTACT_ACTIONS.includes(rec.action) && !hasClientMessage && rec.timing === 'immediate') {
    rec.timing = 'within_24h';
    fixes.push('R5: sin mensajes del cliente no se recomienda contacto inmediato; se cambió a within_24h.');
  }
  const r5Hit = typeof rec.reason === 'string' ? findAffirmative(rec.reason, R5_PATTERNS) : null;
  check(checks, 'r5_no_pressure', !r5Hit, r5Hit ? `La explicación afirma o presiona la compra ("${r5Hit}").` : 'No afirma intención de compra ni propone descuentos o urgencia.') || (fatal = fatal || 'explicación contraria a R5');

  // Contacto disfrazado: si el contacto está bloqueado, ninguna acción puede incluirlo.
  if (rules.contact_blocked || rules.closed) {
    const hit = typeof rec.reason === 'string' ? findAffirmative(rec.reason, CONTACT_PATTERNS) : null;
    check(checks, 'no_hidden_contact', !hit, hit ? `La explicación incluye contacto con el cliente ("${hit}") con el contacto bloqueado.` : 'No incluye contacto con el cliente bajo otra etiqueta.') || (fatal = fatal || 'contacto disfrazado');
  } else {
    check(checks, 'no_hidden_contact', true, 'No hay restricciones de contacto vigentes.');
  }

  // Evidencia: solo IDs existentes del mismo caso.
  const evidence = Array.isArray(rec.evidence_event_ids) ? [...new Set(rec.evidence_event_ids)] : [];
  const validEvidence = evidence.filter((id) => caseEventIds.has(id));
  if (validEvidence.length !== evidence.length) fixes.push(`Se quitaron IDs de evidencia que no existen en el caso: ${evidence.filter((id) => !caseEventIds.has(id)).join(', ')}.`);
  if (!validEvidence.length && state.events.length) {
    validEvidence.push(state.events[state.events.length - 1].event_id);
    fixes.push('No había evidencia válida; se usó el último evento del caso.');
  }
  rec.evidence_event_ids = validEvidence;
  check(checks, 'evidence', validEvidence.length > 0, 'La evidencia son eventos existentes del mismo caso.') || (fatal = fatal || 'sin evidencia');

  // Niveles y tipos.
  check(checks, 'levels', LEVELS.includes(rec.confidence) && LEVELS.includes(rec.risk_level), 'confidence y risk_level son low, medium o high.') || (fatal = fatal || 'niveles inválidos');
  if (typeof rec.requires_human_review !== 'boolean') fatal = fatal || 'requires_human_review no es booleano';
  check(checks, 'human_review_bool', typeof rec.requires_human_review === 'boolean', 'requires_human_review es booleano.');
  if (!Array.isArray(rec.missing_information)) rec.missing_information = [];
  rec.missing_information = rec.missing_information.filter((x) => typeof x === 'string' && x.trim());
  check(checks, 'missing_information', true, `missing_information es una lista (${rec.missing_information.length}).`);

  // R6: la explicación existe y wait dice cuándo o bajo qué condición reevaluar.
  const hasReason = typeof rec.reason === 'string' && rec.reason.trim().length > 0;
  check(checks, 'reason', hasReason && typeof rec.confidence_reason === 'string' && rec.confidence_reason.trim(), 'Tiene explicación y motivo de la confianza.') || (fatal = fatal || 'sin explicación');
  if (rec.action === 'wait' && hasReason && !/reevaluar/i.test(rec.reason)) {
    rec.reason += rec.timing === 'at_date' ? ` Reevaluar el ${humanUtc(rec.scheduled_for)}.` : ' Reevaluar cuando llegue nueva información.';
    fixes.push('Se agregó la condición de reevaluación a la explicación de wait.');
  }
  if (rec.action === 'wait') check(checks, 'wait_condition', true, 'wait indica cuándo o bajo qué condición reevaluar.');

  if (rec.action === 'escalate' && rec.requires_human_review !== true) {
    rec.requires_human_review = true;
    fixes.push('escalate siempre requiere revisión humana.');
  }

  if (fatal) {
    const replacement = safeFallback(rec, state, rules, fatal);
    // La alternativa también se valida (sin recursión infinita: es segura por construcción).
    return { recommendation: replacement, checks, fixes, replaced: true, replaced_reason: fatal, original: input };
  }
  return { recommendation: rec, checks, fixes, replaced: false, replaced_reason: null, original: null };
}
