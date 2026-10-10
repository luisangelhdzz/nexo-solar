// Por qué se compró o no: análisis de una cotización cerrada (no es un sí/no).
//
// Se calculan hechos medibles del historial (dudas, tiempos de respuesta, revisión, presión,
// restricciones, si se respetó el tiempo que pidió el cliente) y se convierten en factores
// a favor (+) o en contra (−) de la compra. Todo es determinístico y se puede auditar.

import { hoursBetween, toMs } from './time.js';
import { STAGE_LABEL } from './stages.js';

const DOUBT_INTENTS = ['question', 'objection', 'interest', 'other'];
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r1 = (n) => (n === null ? null : Math.round(n * 10) / 10);
const fmtH = (h) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : `${Math.round(h)} h`);

// Catálogo de factores. `direction`: positive = ayuda a comprar; negative = la frena.
export const FACTORS = {
  dudas_respondidas_rapido: { label: 'Dudas respondidas rápido', direction: 'positive', advice: 'Responder las dudas en pocas horas.' },
  dudas_respuesta_lenta: { label: 'Dudas respondidas tarde', direction: 'negative', advice: 'Responder las dudas en menos de 24 h.' },
  dudas_sin_respuesta: { label: 'Dudas sin respuesta', direction: 'negative', advice: 'Responder todas las dudas antes de cualquier otro seguimiento.' },
  revision_a_fondo: { label: 'Revisó la propuesta a fondo', direction: 'positive', advice: 'Dar tiempo a quien revisa a fondo; está evaluando en serio.' },
  sin_interaccion: { label: 'Casi no interactuó', direction: 'negative', advice: 'Confirmar que el cliente recibió y entendió la cotización.' },
  reparo_precio: { label: 'Reparo de precio', direction: 'negative', advice: 'Atender el reparo de precio con opciones de pago o financiamiento, sin descuentos no aprobados.' },
  comparando: { label: 'Comparaba con otras opciones', direction: 'negative', advice: 'Aclarar pronto las diferencias frente a otras opciones.' },
  pidio_tiempo_respetado: { label: 'Se respetó el tiempo que pidió', direction: 'positive', advice: 'Respetar la fecha que pide el cliente.' },
  pidio_tiempo_no_respetado: { label: 'No se respetó el tiempo que pidió', direction: 'negative', advice: 'No contactar antes de la fecha que pidió el cliente.' },
  presion: { label: 'Contactos sin respuesta o durante una espera', direction: 'negative', advice: 'No insistir: si el cliente no responde, esperar a que escriba.' },
  contacto_prohibido_violado: { label: 'Se contactó con el contacto prohibido', direction: 'negative', advice: 'Nunca contactar mientras la restricción esté vigente.' },
  dentro_de_su_tiempo: { label: 'Decidió dentro de su tiempo habitual', direction: 'positive', advice: 'Con clientes de patrón conocido, esperar sin presionar.' },
  seguimiento_reactivo: { label: 'Un seguimiento a tiempo reactivó la compra', direction: 'positive', advice: 'Tras un silencio largo, un seguimiento breve y amable funciona.' },
  sin_interes: { label: 'Dijo que no le interesaba', direction: 'negative', advice: 'Cuando el cliente dice que no, no insistir.' },
};

// `decisions`: historial de decisiones del caso (cualquier orden), para saber qué se recomendaba
// cuando la empresa actuó. `customer`: perfil del cliente sin contar este caso (opcional).
export function analyzeOutcome({ state, interpretations = {}, stages, decisions = [], customer = null }) {
  if (state.status !== 'closed') return null;
  const won = state.closed_status === 'accepted';
  const closedAt = state.closed_at;
  const intentOf = (m) => interpretations[m.event_id]?.intent ?? 'question';
  const topicOf = (m) => interpretations[m.event_id]?.topic ?? '';

  // Dudas y tiempos de respuesta de la empresa.
  const doubts = state.messages.filter((m) => DOUBT_INTENTS.includes(intentOf(m)));
  const responses = doubts.map((m) => {
    const answer = state.actions.find((a) => toMs(a.at) > toMs(m.at) && toMs(a.at) <= toMs(closedAt));
    return { message_id: m.event_id, answered: Boolean(answer), hours: answer ? hoursBetween(m.at, answer.at) : null };
  });
  const answeredHours = responses.filter((r) => r.answered).map((r) => r.hours);
  const unanswered = responses.filter((r) => !r.answered).length;
  const medianResponse = r1(median(answeredHours));

  // Revisión de la propuesta.
  const sections = new Set(state.views.map((v) => v.section));
  const priceViews = state.views.filter((v) => v.section === 'price').length;
  const deepReview = sections.size >= 3 || priceViews >= 2 || sections.has('financing');

  // Contactos de la empresa: sin respuesta, durante una espera recomendada o con restricción.
  const sortedDecisions = [...decisions].sort((a, b) => toMs(a.evaluation_at) - toMs(b.evaluation_at));
  let contactsWithoutReply = 0;
  let contactsDuringWait = 0;
  let contactsWhileBlocked = 0;
  let contactsBeforeRequested = 0;
  let allowed = true;
  let notBefore = null;
  let requestedUntil = null;
  for (const ev of state.events) {
    if (toMs(ev.occurred_at) > toMs(closedAt)) break;
    if (ev.event_type === 'constraint.updated') {
      if ('contact_allowed' in ev.data) allowed = ev.data.contact_allowed;
      if ('contact_not_before' in ev.data) {
        notBefore = ev.data.contact_not_before;
        if (notBefore) requestedUntil = notBefore;
      }
    }
    if (ev.event_type === 'message.received') {
      const it = interpretations[ev.event_id];
      if (it?.intent === 'request_delay' && it.requested_contact_after) requestedUntil = it.requested_contact_after;
    }
    if (ev.event_type === 'action.executed') {
      const at = toMs(ev.occurred_at);
      if (!allowed || (notBefore && at < toMs(notBefore))) contactsWhileBlocked += 1;
      if (requestedUntil && at < toMs(requestedUntil)) contactsBeforeRequested += 1;
      const replied = state.messages.some((m) => toMs(m.at) > at && toMs(m.at) <= toMs(closedAt));
      if (!replied) contactsWithoutReply += 1;
      const inForce = sortedDecisions.filter((d) => toMs(d.evaluation_at) <= at).at(-1);
      if (inForce && ['wait', 'no_action'].includes(inForce.recommendation?.action)) contactsDuringWait += 1;
    }
  }

  const intents = state.messages.map(intentOf);
  const priceObjection = state.messages.some((m) => intentOf(m) === 'objection' && /precio|caro|costo/i.test(`${topicOf(m)} ${m.message}`));
  const decisionHours = state.opened_at ? r1(hoursBetween(state.opened_at, closedAt)) : null;

  // Compra reactivada: hubo un silencio de 24 h o más, luego un contacto, y la compra llegó en menos de 48 h.
  let reactivated = false;
  if (won) {
    const lastAction = [...state.actions].filter((a) => toMs(a.at) <= toMs(closedAt)).at(-1);
    if (lastAction && hoursBetween(lastAction.at, closedAt) <= 48) {
      const before = [state.opened_at, ...state.views.map((v) => v.at), ...state.messages.map((m) => m.at)]
        .filter((t) => t && toMs(t) < toMs(lastAction.at))
        .sort()
        .at(-1);
      if (before && hoursBetween(before, lastAction.at) >= 24) reactivated = true;
    }
  }

  const present = [];
  const add = (id, detail) => present.push({ id, ...FACTORS[id], detail });
  if (doubts.length && unanswered === 0 && medianResponse !== null && medianResponse <= 24) {
    add('dudas_respondidas_rapido', `${doubts.length === 1 ? 'Su duda se respondió' : `Sus ${doubts.length} dudas se respondieron`} en ~${fmtH(medianResponse)}.`);
  }
  if (medianResponse !== null && medianResponse > 24) add('dudas_respuesta_lenta', `Las respuestas tardaron ~${fmtH(medianResponse)}.`);
  if (unanswered) add('dudas_sin_respuesta', `${unanswered === 1 ? 'Quedó 1 duda' : `Quedaron ${unanswered} dudas`} sin respuesta al cerrar.`);
  if (deepReview) add('revision_a_fondo', `Abrió ${sections.size} ${sections.size === 1 ? 'sección' : 'secciones'}${priceViews >= 2 ? ` y vio el precio ${priceViews} veces` : ''}.`);
  if (!state.views.length && !state.messages.length) add('sin_interaccion', 'No abrió la cotización ni escribió.');
  if (priceObjection) add('reparo_precio', 'Expresó un reparo sobre el precio.');
  if (intents.includes('comparing')) add('comparando', 'Dijo que comparaba con otras opciones.');
  if (requestedUntil && contactsBeforeRequested === 0) add('pidio_tiempo_respetado', 'Pidió tiempo y nadie lo contactó antes de la fecha.');
  if (contactsBeforeRequested) add('pidio_tiempo_no_respetado', `Se le contactó ${contactsBeforeRequested} ${contactsBeforeRequested === 1 ? 'vez' : 'veces'} antes de la fecha que pidió.`);
  if (contactsWithoutReply >= 2 || contactsDuringWait >= 1) {
    const parts = [];
    if (contactsWithoutReply >= 2) parts.push(`${contactsWithoutReply} contactos sin respuesta`);
    if (contactsDuringWait) parts.push(`${contactsDuringWait} durante una espera recomendada`);
    add('presion', `Hubo ${parts.join(' y ')}.`);
  }
  if (contactsWhileBlocked) add('contacto_prohibido_violado', `${contactsWhileBlocked} contacto(s) con la restricción vigente.`);
  if (won && customer?.patience_window_hours && decisionHours !== null && decisionHours <= customer.patience_window_hours) {
    add('dentro_de_su_tiempo', `Decidió en ${fmtH(decisionHours)}; su ventana habitual es de ${fmtH(customer.patience_window_hours)}.`);
  }
  if (reactivated) add('seguimiento_reactivo', 'Tras un silencio de un día o más, un seguimiento precedió la compra.');
  if (intents.includes('not_interested')) add('sin_interes', 'Dijo que no le interesaba.');

  const pos = present.filter((f) => f.direction === 'positive');
  const neg = present.filter((f) => f.direction === 'negative');
  const path = (stages?.transitions ?? []).map((t) => t.label).join(' → ');

  let summary;
  if (won) {
    summary = `Compró en ${decisionHours !== null ? fmtH(decisionHours) : 'un tiempo desconocido'}.`;
    if (pos.length) summary += ` A favor: ${pos.map((f) => f.label.toLowerCase()).join(', ')}.`;
    if (neg.length) summary += ` A pesar de: ${neg.map((f) => f.label.toLowerCase()).join(', ')}.`;
    if (!pos.length && !neg.length) summary += ' No hubo señales destacadas: decidió por su cuenta.';
  } else {
    summary = `Se perdió tras ${decisionHours !== null ? fmtH(decisionHours) : 'un tiempo desconocido'} (${state.closed_status === 'rejected' ? 'rechazada' : 'cancelada'}).`;
    if (neg.length) summary += ` Lo que pesó: ${neg.map((f) => f.label.toLowerCase()).join(', ')}.`;
    if (pos.length) summary += ` Aun así hubo: ${pos.map((f) => f.label.toLowerCase()).join(', ')}.`;
    if (!neg.length) summary += ' No hay una causa clara en el historial; conviene preguntar al cliente.';
  }

  return {
    case_id: state.case_id,
    customer_id: state.customer_id ?? null,
    outcome: won ? 'won' : 'lost',
    closed_status: state.closed_status,
    closed_at: closedAt,
    decision_hours: decisionHours,
    path,
    stage_hours: Object.fromEntries((stages?.transitions ?? []).filter((t) => t.hours !== null).map((t) => [t.stage, t.hours])),
    metrics: {
      doubts: doubts.length,
      unanswered,
      median_response_hours: medianResponse,
      sections_viewed: sections.size,
      price_views: priceViews,
      company_contacts: state.actions.length,
      contacts_without_reply: contactsWithoutReply,
      contacts_during_wait: contactsDuringWait,
      contacts_while_blocked: contactsWhileBlocked,
      requested_time: Boolean(requestedUntil),
    },
    factors: present,
    summary,
  };
}

// Lección por plantilla (cuando no hay IA o la IA falla).
export function templateLesson(analysis) {
  const won = analysis.outcome === 'won';
  const relevant = analysis.factors.filter((f) => (won ? f.direction === 'positive' : f.direction === 'negative'));
  if (!relevant.length) {
    return won
      ? 'El cliente decidió por su cuenta sin necesitar intervención: no intervenir también funciona.'
      : 'No hay una causa clara en el historial; registrar el motivo de rechazo cuando el cliente lo diga.';
  }
  const advice = [...new Set(relevant.map((f) => f.advice))].slice(0, 2).join(' ');
  return won ? `Funcionó: ${advice}` : `Para la próxima: ${advice}`;
}

export { STAGE_LABEL };
