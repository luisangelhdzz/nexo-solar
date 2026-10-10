// Validación determinística de la propuesta del asistente (paso 3 y 5 del plan).
//
// La IA propone; este código decide qué se puede hacer:
//   - La acción autorizada SIEMPRE es la del motor de reglas (R1–R6 + validador).
//   - Las reglas se vuelven a revisar con la hora actual.
//   - El borrador solo se puede enviar si la acción permite contactar y su contenido pasa los chequeos:
//     sin descuentos ni promociones, sin presión (R5), solo cifras aprobadas, sin enlaces ni teléfonos.
//   - Si algo no cuadra, se pide revisión humana y se explica por qué.

import { ACTION_LABELS_ES, CONTACT_ACTIONS } from '../domain/constants.js';
import { R5_PATTERNS, findAffirmative } from '../domain/guardian.js';
import { pendingMessages } from '../domain/state.js';
import { extractNumbers } from './knowledge.js';
import { normalizeText } from './heuristic.js';
import { DISCOUNT_REQUEST } from './assistant.js';

const label = (action) => ACTION_LABELS_ES[action] ?? action;

// Ofertas que el asistente nunca puede hacer por su cuenta.
const DISCOUNT_OFFER = [
  /descuento/, /rebaja/, /promoci[oó]n/, /precio especial/, /bonificaci[oó]n/, /meses sin intereses/,
  /\bgratis\b|\bgratuit[oa]s?\b/, /\bte regalamos\b|\bde regalo\b/,
];

// Cifras con unidad o dinero: "25 años", "$150,000", "150,000 MXN", "3 días", "50%", "120 mil".
export function unitNumbers(text) {
  const out = [];
  const re = /(\$\s?)?(\d[\d,.]*)\s*(mil\b)?\s*(%|por ciento|mxn|pesos|a[nñ]os?|meses|mes\b|d[ií]as?|semanas?|horas?|h\b|kw\b|kwh\b|paneles|metros|m2)?/gi;
  for (const m of String(text ?? '').matchAll(re)) {
    const [raw, dollar, num, mil, unit] = m;
    if (!dollar && !mil && !unit) continue; // números sueltos (fechas, horas, cantidades) no se revisan
    const [value] = extractNumbers(num);
    if (value === undefined) continue;
    out.push({ raw: raw.trim(), value: mil ? value * 1000 : value });
  }
  return out;
}

// Llena el saludo con el nombre del contacto (el modelo nunca lo ve).
export function fillPlaceholders(text, { contactName = null } = {}) {
  const first = contactName ? String(contactName).trim().split(/\s+/)[0] : '';
  const out = first
    ? String(text).replace(/\{\s*nombre[^}]*\}/gi, first)
    : String(text).replace(/,?\s*\{\s*nombre[^}]*\}/gi, '');
  return out.replace(/\s+([.,;:!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

export function checkProposal(proposal, { state, rules, recommendation, interpretations = {}, approved = new Set() }) {
  const checks = [];
  const reasons = [];
  const add = (id, ok, message, severity = 'error') => {
    checks.push({ id, ok: Boolean(ok), message, severity });
    return Boolean(ok);
  };
  const authorized = {
    action: recommendation.action,
    timing: recommendation.timing,
    scheduled_for: recommendation.scheduled_for ?? null,
  };

  // 1. El motor de reglas tiene la última palabra.
  const agrees = proposal.proposed_action === authorized.action;
  add('engine_agrees', agrees, agrees
    ? `La IA coincide con el motor de reglas (${label(authorized.action)}).`
    : `La IA sugiere "${label(proposal.proposed_action)}", pero el motor de reglas decide "${label(authorized.action)}". Se respeta el motor.`, 'warning');
  if (!agrees) reasons.push(`La IA sugiere "${label(proposal.proposed_action)}" y el motor de reglas "${label(authorized.action)}": decide una persona.`);

  // 2. Las reglas, revisadas otra vez con la hora actual.
  const ruleInfo = rules.actions[authorized.action];
  const allowedNow = Boolean(ruleInfo?.allowed);
  add('rules_allow', allowedNow, allowedNow
    ? 'Las reglas R1–R4 permiten la acción en este momento.'
    : `Las reglas bloquean la acción en este momento (${ruleInfo?.blocks.map((b) => b.rule).join(', ')}).`);
  if (!allowedNow) reasons.push('Las reglas cambiaron y bloquean la acción en este momento.');
  const contactAction = CONTACT_ACTIONS.includes(authorized.action);
  const contactOk = contactAction && allowedNow;

  // 3. El borrador.
  let draft = null;
  if (proposal.draft_message) {
    const text = proposal.draft_message;
    add('draft_allowed', contactOk, contactOk
      ? 'La acción autorizada permite escribirle al cliente.'
      : contactAction
        ? 'Hay borrador, pero el contacto está bloqueado: no se puede enviar.'
        : `Hay borrador, pero la acción autorizada (${label(authorized.action)}) no es contactar: no se envía.`, 'warning');
    const offer = findAffirmative(text, DISCOUNT_OFFER);
    add('draft_no_discount', !offer, offer ? `Ofrece algo no aprobado ("${offer}").` : 'No ofrece descuentos, promociones ni regalos.');
    const pressure = findAffirmative(text, R5_PATTERNS);
    add('draft_no_pressure', !pressure, pressure ? `Presiona o da por hecha la compra ("${pressure}").` : 'Sin presión, urgencia ni afirmaciones de compra (R5).');
    const unapproved = [...new Set(unitNumbers(text).filter((x) => !approved.has(x.value)).map((x) => x.raw))];
    add('draft_approved_numbers', !unapproved.length, unapproved.length
      ? `Menciona cifras que no están aprobadas: ${unapproved.join(', ')}.`
      : 'Las cifras salen del conocimiento aprobado o de la cotización.');
    const contactData = /(https?:\/\/|www\.)|[\w.+-]+@[\w-]+\.[\w.]+|\+?\d[\d\s()-]{8,}\d/i.exec(text);
    add('draft_no_links', !contactData, contactData ? 'Incluye enlaces, correos o teléfonos.' : 'Sin enlaces, correos ni teléfonos.');
    const leftover = /\{(?!\s*nombre)[^}]{0,40}\}/i.exec(text);
    add('draft_placeholders', !leftover, leftover ? `Tiene un marcador sin llenar (${leftover[0]}).` : 'Sin marcadores pendientes.');
    add('draft_length', text.length <= 900, `Longitud: ${text.length} caracteres${text.length > 900 ? ' (máximo 900)' : ''}.`);
    const contentOk = checks.filter((c) => c.id.startsWith('draft_') && c.severity === 'error').every((c) => c.ok);
    if (!contentOk) reasons.push('El borrador no pasó los chequeos de contenido.');
    draft = { text, sendable: contactOk && contentOk, content_ok: contentOk };
  } else if (contactOk) {
    add('draft_present', false, 'La acción permite escribirle al cliente, pero no hay borrador: lo redacta una persona.', 'warning');
  }

  // 4. Lo que pidió el cliente y solo puede decidir una persona.
  const pending = pendingMessages(state);
  if (pending.some((m) => interpretations[m.event_id]?.manipulation_attempt)) {
    add('client_manipulation', false, 'Un mensaje del cliente intenta cambiar las reglas; se trató como dato.', 'warning');
    reasons.push('El cliente intentó cambiar las reglas o forzar condiciones: revisa antes de responder.');
  }
  const last = pending.at(-1);
  if (last && DISCOUNT_REQUEST.test(normalizeText(last.message))) {
    add('client_discount', false, 'El cliente pide un descuento o una condición especial.', 'warning');
    reasons.push('El cliente pide un descuento o una condición especial: solo el comercial responsable puede autorizarlo.');
  }

  // 5. Revisión humana final.
  if (proposal.requires_human_review) reasons.push(proposal.human_review_reason || 'La IA pidió revisión humana.');
  if (recommendation.requires_human_review) reasons.push('El motor de reglas pide revisión humana para este caso.');
  if (authorized.action === 'escalate') reasons.push('La acción autorizada es escalar a una persona.');

  const humanReasons = [...new Set(reasons)];
  return {
    authorized,
    agrees_with_engine: agrees,
    allowed_now: allowedNow,
    checks,
    draft,
    requires_human_review: humanReasons.length > 0,
    human_review_reasons: humanReasons,
  };
}
