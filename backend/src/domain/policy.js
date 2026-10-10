// Política de decisión: a partir del estado, las reglas y la interpretación de los mensajes,
// propone la acción "ideal" y después la ajusta a lo que las reglas permiten.
//
// Flujo:
//   1. ¿Caso cerrado? -> no_action (R1).
//   2. Acción ideal según lo que pide el cliente o la actividad del caso (ignorando bloqueos).
//   3. Si las reglas bloquean la acción ideal, se elige una alternativa válida
//      (wait con fecha si el bloqueo es temporal; escalate o wait si el contacto está prohibido).
//   4. Se calculan confianza, riesgo, revisión humana, evidencia y datos faltantes.
// Después de esto, guardian.js vuelve a validar todo antes de publicar.

import { CONTACT_ACTIONS } from './constants.js';
import { evaluateRules } from './rules.js';
import { lastAction, pendingMessages, unansweredFollowups } from './state.js';
import { addHours, hoursBetween, humanDuration, humanUtc, maxIso, toMs } from './time.js';

const LEVEL_ORDER = { low: 0, medium: 1, high: 2 };
const LEVEL_ES = { low: 'baja', medium: 'media', high: 'alta' };
const minLevel = (...ls) => ls.reduce((a, b) => (LEVEL_ORDER[b] < LEVEL_ORDER[a] ? b : a));
const maxLevel = (...ls) => ls.reduce((a, b) => (LEVEL_ORDER[b] > LEVEL_ORDER[a] ? b : a));
const uniq = (arr) => [...new Set(arr.filter(Boolean))];

const DEFAULT_POLICY = { followUpHours: 48, highAmountMxn: 500000, maxUnansweredFollowups: 2, patienceMargin: 1.2 };

const TIER_ES = { frecuente: 'cliente frecuente', recurrente: 'cliente recurrente', nuevo: 'cliente nuevo', sin_compras: 'cliente sin compras previas' };
const fmtH = (h) => `${Math.round(h)} h`;

// Describe el patrón de compra del cliente en una o dos oraciones.
function describePattern(c) {
  const parts = [];
  if (c.purchases) {
    const ids = c.past_purchase_case_ids;
    const list = `${ids.slice(-3).join(', ')}${ids.length > 3 ? '…' : ''}`;
    const range = c.purchases > 1 ? ` (entre ${fmtH(c.min_decision_hours)} y ${fmtH(c.max_decision_hours)})` : '';
    parts.push(`${c.name} es ${TIER_ES[c.tier]}: ${c.purchases === 1 ? '1 compra previa' : `${c.purchases} compras previas`} (${list}) en las que tardó ~${fmtH(c.typical_decision_hours)} en decidir${range}.`);
  } else {
    parts.push(`${c.name} no tiene compras previas registradas.`);
  }
  if (c.trusted) parts.push('El equipo lo marcó como cliente de confianza.');
  if (c.decision_hours_override) parts.push(`Según el equipo, suele decidir en ~${fmtH(c.decision_hours_override)}.`);
  return parts.join(' ');
}

export function patternRange(c) {
  if (!c?.purchases) return null;
  return c.purchases > 1 ? `${fmtH(c.min_decision_hours)}–${fmtH(c.max_decision_hours)}` : fmtH(c.typical_decision_hours);
}

// Solicitudes de espera del cliente que siguen vigentes: solo cuentan si el cliente
// no ha escrito otro mensaje después (un mensaje nuevo reemplaza la solicitud anterior).
export function activeClientDelays(state, interpretations) {
  const msgs = state.messages;
  const delays = [];
  msgs.forEach((m, i) => {
    const it = interpretations[m.event_id];
    const isLatest = i === msgs.length - 1;
    if (isLatest && it?.intent === 'request_delay' && it.requested_contact_after) {
      delays.push({ until: it.requested_contact_after, event_id: m.event_id });
    }
  });
  return delays;
}

function needPhrase(it) {
  const topic = it.topic ? ` sobre ${it.topic}` : '';
  switch (it.intent) {
    case 'question': return `preguntó${topic}`;
    case 'objection': return `expresó un reparo${topic}`;
    case 'interest': return 'pidió más información';
    case 'comparing': return 'dijo que compara opciones';
    case 'provides_information': return 'compartió información';
    default: return 'escribió un mensaje';
  }
}

// Paso 2: acción ideal ignorando restricciones de contacto.
function idealAction(state, interpretations, nowIso, policy, customer) {
  const now = toMs(nowIso);
  const pending = pendingMessages(state);
  const latest = pending[pending.length - 1];
  const it = latest ? interpretations[latest.event_id] : null;
  const manipulated = pending.find((m) => interpretations[m.event_id]?.manipulation_attempt);

  if (manipulated) {
    return {
      basis: 'message',
      message: manipulated,
      interpretation: interpretations[manipulated.event_id],
      action: 'escalate',
      timing: 'immediate',
      scheduled_for: null,
      evidence: [manipulated.event_id],
      text: `El mensaje ${manipulated.event_id} incluye instrucciones dirigidas al sistema (por ejemplo, ignorar reglas o exigir condiciones). Se trata como dato y no cambia las políticas; una persona debe revisarlo antes de cualquier respuesta.`,
      manipulation: true,
    };
  }

  if (it) {
    const id = latest.event_id;
    const topic = it.topic ? ` sobre ${it.topic}` : '';
    const base = { basis: 'message', message: latest, interpretation: it, evidence: [id], scheduled_for: null };
    switch (it.intent) {
      case 'not_interested':
        return { ...base, action: 'no_action', timing: 'not_applicable', text: `El cliente indicó que no le interesa continuar (${id}). No insistir; solo reconsiderar si vuelve a escribir.` };
      case 'request_delay':
        if (it.requested_contact_after && now < toMs(it.requested_contact_after)) {
          return { ...base, action: 'wait', timing: 'at_date', scheduled_for: it.requested_contact_after, text: `El cliente pidió no ser contactado antes del ${humanUtc(it.requested_contact_after)} (${id}). Reevaluar en esa fecha.` };
        }
        if (it.requested_contact_after) {
          // La fecha pedida ya pasó: se puede retomar con un seguimiento breve.
          return { ...base, action: 'contact', timing: 'within_24h', text: `El cliente pidió esperar hasta el ${humanUtc(it.requested_contact_after)} (${id}) y esa fecha ya pasó. Retomar con un seguimiento breve.` };
        }
        return { ...base, action: 'wait', timing: 'on_new_information', text: `El cliente pidió esperar sin dar una fecha concreta (${id}). Reevaluar cuando llegue nueva información del cliente.` };
      case 'question':
      case 'objection':
        if (it.needs_from_client.length) {
          return { ...base, action: 'request_information', timing: 'immediate', text: `Para responder al cliente (${id}) falta un dato que solo él puede dar: ${it.needs_from_client.join('; ')}. Pedir ese dato de forma breve.` };
        }
        {
          const learnedAnswer = policy.learned?.answerWithin?.value;
          const learnedNote = learnedAnswer ? ` Lo aprendido: en las compras ganadas, las dudas se respondieron en ~${learnedAnswer} h.` : '';
          return {
            ...base,
            action: 'resolve_objection',
            timing: 'immediate',
            text: (it.intent === 'question'
              ? `El cliente preguntó${topic} (${id}). Aclarar la duda de forma breve, sin presionar la compra.`
              : `El cliente expresó un reparo${topic} (${id}). Atenderlo con información concreta, sin ofrecer condiciones no aprobadas.`) + learnedNote,
          };
        }
      case 'interest':
        return { ...base, action: 'contact', timing: 'within_24h', text: `El cliente pidió más información (${id}). Dar un seguimiento breve con lo que solicita, sin asumir que va a comprar.` };
      case 'comparing':
        return { ...base, action: 'contact', timing: 'within_24h', text: `El cliente dijo que compara opciones (${id}). Ofrecer aclarar diferencias en un seguimiento breve, sin presión ni descuentos.` };
      case 'provides_information':
        return { ...base, action: 'contact', timing: 'within_24h', text: `El cliente compartió información (${id}). Confirmar que se recibió y continuar con la propuesta.` };
      default:
        return { ...base, action: 'request_information', timing: 'within_24h', text: `El mensaje ${id} no deja clara la intención del cliente. Pedirle una aclaración breve.` };
    }
  }

  // Extensión (portal): buen cliente con un patrón de decisión conocido, sin peticiones
  // pendientes y sin intervenciones de la empresa en este caso. Lo correcto es NO intervenir
  // mientras esté dentro de su tiempo habitual de decisión (con margen).
  if (customer?.reliable && customer.patience_hours && state.opened_at && !lastAction(state)) {
    const windowEnd = addHours(state.opened_at, Math.ceil(customer.patience_hours * policy.patienceMargin));
    const elapsed = hoursBetween(state.opened_at, nowIso);
    const viewIds = uniq(state.views.slice(-3).map((v) => v.event_id));
    const evidence = uniq([state.opened_event_id, ...viewIds]);
    const views = state.views.length ? ` y la ha abierto ${state.views.length === 1 ? 'una vez' : `${state.views.length} veces`}` : '';
    const pattern = describePattern(customer);
    if (now < toMs(windowEnd)) {
      return {
        basis: 'customer_pattern', action: 'wait', timing: 'at_date', scheduled_for: windowEnd, evidence,
        text: `${pattern} Lleva ${humanDuration(elapsed)} con esta cotización${views} y no ha pedido nada. Lo correcto es no intervenir: contactarlo antes de su tiempo habitual podría presionarlo sin necesidad. Reevaluar el ${humanUtc(windowEnd)} o antes si escribe.`,
      };
    }
    return {
      basis: 'customer_pattern_expired', action: 'contact', timing: 'within_24h', scheduled_for: null, evidence,
      text: `${pattern} Ya pasaron ${humanDuration(elapsed)} desde que recibió esta cotización, más que su tiempo habitual, y no ha respondido. Dar un seguimiento breve y amable, sin presión ni descuentos.`,
    };
  }

  // Sin mensajes pendientes: decidir por la actividad del caso.
  const last = lastAction(state);
  if (last) {
    const unanswered = unansweredFollowups(state);
    const hours = hoursBetween(last.at, nowIso);
    if (unanswered >= policy.maxUnansweredFollowups) {
      return {
        basis: 'activity', action: 'wait', timing: 'on_new_information', scheduled_for: null, evidence: state.actions.slice(-unanswered).map((a) => a.event_id),
        text: `Ya hubo ${unanswered} contactos sin respuesta. No insistir; reevaluar cuando el cliente escriba.`,
      };
    }
    const followUpAt = addHours(last.at, policy.followUpHours);
    if (now < toMs(followUpAt)) {
      return {
        basis: 'activity', action: 'wait', timing: 'at_date', scheduled_for: followUpAt, evidence: [last.event_id],
        text: `Se ejecutó ${last.action} hace ${humanDuration(hours)} (${last.event_id}) y el cliente no ha respondido. Reevaluar el ${humanUtc(followUpAt)} o antes si llega un mensaje.`,
      };
    }
    return {
      basis: 'activity', action: 'contact', timing: 'within_24h', scheduled_for: null, evidence: [last.event_id],
      text: `Pasaron ${humanDuration(hours)} desde el último contacto (${last.event_id}) sin respuesta. Dar un seguimiento breve, sin presión.`,
    };
  }

  if (state.views.length) {
    const lastView = state.views[state.views.length - 1];
    const ids = uniq(state.views.slice(-3).map((v) => v.event_id));
    const sections = uniq(state.views.map((v) => v.section)).join(', ');
    const followUpAt = addHours(lastView.at, policy.followUpHours);
    const opened = `El cliente abrió la propuesta ${state.views.length === 1 ? 'una vez' : `${state.views.length} veces`}${sections ? ` (sección: ${sections})` : ''} pero no ha escrito.`;
    if (now < toMs(followUpAt)) {
      return {
        basis: 'views', action: 'wait', timing: 'at_date', scheduled_for: followUpAt, evidence: ids,
        text: `${opened} Por R5, abrir la propuesta no confirma interés de compra ni justifica urgencia. Reevaluar el ${humanUtc(followUpAt)} o antes si llega un mensaje.`,
      };
    }
    return {
      basis: 'views', action: 'contact', timing: 'within_24h', scheduled_for: null, evidence: ids,
      text: `${opened} Pasaron ${humanDuration(hoursBetween(lastView.at, nowIso))} sin mensajes. Dar un seguimiento breve y neutral; por R5 no se ofrecen descuentos ni urgencia.`,
    };
  }

  if (state.opened_at) {
    const followUpAt = addHours(state.opened_at, policy.followUpHours);
    if (now < toMs(followUpAt)) {
      return {
        basis: 'opened', action: 'wait', timing: 'at_date', scheduled_for: followUpAt, evidence: [state.opened_event_id],
        text: `La propuesta se envió (${state.opened_event_id}) y aún no hay aperturas ni mensajes. Reevaluar el ${humanUtc(followUpAt)} o antes si hay actividad.`,
      };
    }
    return {
      basis: 'opened', action: 'contact', timing: 'within_24h', scheduled_for: null, evidence: [state.opened_event_id],
      text: `No hay actividad del cliente desde el envío de la propuesta (${state.opened_event_id}). Dar un seguimiento breve para confirmar que la recibió.`,
    };
  }

  const anyId = state.events[state.events.length - 1]?.event_id;
  return {
    basis: 'none', action: 'wait', timing: 'on_new_information', scheduled_for: null, evidence: [anyId],
    text: 'El caso no tiene apertura, mensajes ni actividad suficiente para decidir. Reevaluar cuando llegue nueva información.',
  };
}

// Paso 3: ajustar la acción ideal a las reglas.
const stripReevaluate = (text) => text.replace(/ Reevaluar[^.]*\.$/, '');

function applyRules(ideal, rules, state, nowIso) {
  const blocks = rules.actions[ideal.action]?.blocks ?? [];
  const blockIds = uniq(blocks.flatMap((b) => b.event_ids));

  if (rules.closed) {
    return {
      action: 'no_action', timing: 'not_applicable', scheduled_for: null,
      text: `El caso está cerrado (${state.closed_status}, ${state.closed_event_id}). Por R1 solo procede no_action; el cierre es definitivo.`,
      evidence: [state.closed_event_id], blocked: ideal.action !== 'no_action', blocks,
    };
  }

  // La acción ideal está permitida.
  if (!blocks.length) {
    // Si es una espera y hay restricciones de contacto, se explican y se ajusta la fecha.
    if (ideal.action === 'wait' && rules.contact_blocked) {
      const others = rules.restrictions.filter((r) => r.scope === 'contact' && r.rule !== 'CLIENTE');
      const ids = uniq(others.flatMap((r) => r.event_ids));
      const why = others.map((r) => r.message).join(' ');
      if (rules.contact_block_indefinite) {
        return {
          action: 'wait', timing: 'on_new_information', scheduled_for: null,
          text: `${stripReevaluate(ideal.text)} ${why} Reevaluar cuando cambie la restricción o llegue un mensaje del cliente.`,
          evidence: uniq([...ideal.evidence, ...ids]), blocked: false, blocks: [],
        };
      }
      if (ideal.timing === 'at_date' && rules.contact_available_at && toMs(rules.contact_available_at) > toMs(ideal.scheduled_for)) {
        return {
          action: 'wait', timing: 'at_date', scheduled_for: rules.contact_available_at,
          text: `${stripReevaluate(ideal.text)} ${why} Reevaluar el ${humanUtc(rules.contact_available_at)}.`,
          evidence: uniq([...ideal.evidence, ...ids]), blocked: false, blocks: [],
        };
      }
      if (!why) return { ...ideal, blocked: false, blocks: [] };
      const reeval = ideal.text.match(/ (Reevaluar[^.]*\.)$/);
      return {
        ...ideal,
        text: `${stripReevaluate(ideal.text)} ${why}${reeval ? ` ${reeval[1]}` : ''}`,
        evidence: uniq([...ideal.evidence, ...ids]), blocked: false, blocks: [],
      };
    }

    // Excepción de R4: el cliente escribió después del último contacto.
    const r4 = rules.r4;
    if (CONTACT_ACTIONS.includes(ideal.action) && r4?.reply_event_id && toMs(nowIso) < toMs(r4.cooldown_end)) {
      return {
        ...ideal,
        text: `${ideal.text} R4 no bloquea: el cliente escribió (${r4.reply_event_id}) después del último contacto (${r4.last_action.event_id}).`,
        evidence: uniq([...ideal.evidence, r4.last_action.event_id]), blocked: false, blocks: [],
      };
    }
    return { ...ideal, blocked: false, blocks: [] };
  }

  const others = blocks.filter((b) => b.rule !== 'R2');
  const whyOthers = others.map((b) => b.message).join(' ');

  // Contacto prohibido sin fecha de fin (R2).
  if (rules.contact_block_indefinite) {
    const r2 = blocks.find((b) => b.rule === 'R2');
    const r2Text = `el contacto con el cliente está prohibido (R2, ${r2.event_ids.join(', ') || 'restricción vigente'}).`;
    const it = ideal.interpretation;
    const explicitNeed = ideal.basis === 'message' && it && !['not_interested', 'request_delay'].includes(it.intent);
    if (explicitNeed) {
      return {
        action: 'escalate', timing: 'immediate', scheduled_for: null,
        text: `El cliente ${needPhrase(it)} (${ideal.message.event_id}), pero ${r2Text}${whyOthers ? ` ${whyOthers}` : ''} Escalar para revisión interna; nadie debe comunicarse con el cliente mientras siga la restricción.`,
        evidence: uniq([...ideal.evidence, ...blockIds]), blocked: true, blocks,
      };
    }
    return {
      action: 'wait', timing: 'on_new_information', scheduled_for: null,
      text: `${stripReevaluate(ideal.text)} Sin embargo, ${r2Text}${whyOthers ? ` ${whyOthers}` : ''} Reevaluar cuando cambie la restricción o llegue un mensaje del cliente.`,
      evidence: uniq([...ideal.evidence, ...blockIds]), blocked: true, blocks,
    };
  }

  // Bloqueo temporal (R3, R4 o solicitud del cliente): esperar hasta que termine.
  const until = maxIso(rules.contact_available_at, ideal.scheduled_for);
  const onlyR4 = blocks.every((b) => b.rule === 'R4');
  return {
    action: 'wait', timing: 'at_date', scheduled_for: until,
    text: `${stripReevaluate(ideal.text)} Todavía no es posible. ${blocks.map((b) => b.message).join(' ')} Reevaluar el ${humanUtc(until)}${onlyR4 ? ' o antes si el cliente escribe' : ''}.`,
    evidence: uniq([...ideal.evidence, ...blockIds]), blocked: true, blocks,
  };
}

// Paso 4: confianza, riesgo, revisión humana y datos faltantes.
function assess(ideal, final, state, rules, policy, customer) {
  const it = ideal.interpretation;
  const missing = [];
  const confidenceNotes = [];
  const riskNotes = [];
  let confidence;
  let risk = 'low';

  if (rules.closed) {
    confidence = 'high';
    confidenceNotes.push('El cierre es un evento estructurado y definitivo.');
  } else if (ideal.basis === 'message') {
    confidence = it.confidence;
    confidenceNotes.push(`Basada en un mensaje explícito interpretado con certeza ${LEVEL_ES[it.confidence]} (${it.source === 'heuristic' ? 'clasificador de respaldo' : `IA: ${it.model}`}).`);
    if (ideal.action === 'wait' && it.intent === 'request_delay' && state.contact_not_before_event_id) {
      confidenceNotes.push('La solicitud del cliente coincide con una restricción estructurada.');
    }
    if (ideal.manipulation) confidenceNotes.push('El contenido del mensaje no se toma como instrucción.');
    else if (it.intent !== 'not_interested') confidenceNotes.push('Limita la certeza: el mensaje no confirma intención de compra.');
    missing.push(...it.missing_information);
  } else if (ideal.basis === 'customer_pattern' || ideal.basis === 'customer_pattern_expired') {
    const c = customer;
    const strong = (c.purchases >= 3 && c.consistent) || (c.trusted && c.purchases >= 1);
    confidence = ideal.basis === 'customer_pattern' && strong ? 'high' : 'medium';
    confidenceNotes.push(c.purchases
      ? `Historial de ${c.purchases === 1 ? '1 compra' : `${c.purchases} compras`} con decisión en ${patternRange(c)}${c.consistent ? ', un patrón estable' : ''}.`
      : 'Basada en la ficha del cliente que llenó el equipo.');
    if (c.trusted) confidenceNotes.push('El equipo lo marcó como cliente de confianza.');
    confidenceNotes.push('Limita la certeza: el patrón no garantiza esta compra y abrir la propuesta no confirma intención (R5).');
    if (ideal.basis === 'customer_pattern') {
      missing.push('Decisión del cliente sobre esta cotización (sigue dentro de su tiempo habitual)');
      riskNotes.push('Esperar dentro de su tiempo habitual tiene bajo costo; intervenir antes podría presionar a un buen cliente.');
    } else {
      missing.push('Motivo por el que el cliente no ha decidido en su tiempo habitual');
      riskNotes.push('Ya pasó su tiempo habitual; un seguimiento amable reduce el riesgo de perder la venta.');
    }
  } else if (ideal.basis === 'views') {
    confidence = 'medium';
    confidenceNotes.push('Solo hay aperturas de la propuesta; no sabemos qué opina el cliente.');
    missing.push('Intención de compra del cliente: solo hay aperturas de la propuesta');
  } else if (ideal.basis === 'activity') {
    confidence = 'medium';
    confidenceNotes.push('La decisión depende del tiempo sin respuesta, no de un mensaje del cliente.');
    missing.push('Respuesta del cliente al último contacto');
  } else if (ideal.basis === 'opened') {
    confidence = 'medium';
    confidenceNotes.push('Solo existe la apertura del caso; no hay señales del cliente.');
    missing.push('Confirmación de que el cliente recibió la propuesta');
  } else {
    confidence = 'low';
    confidenceNotes.push('El historial no tiene información suficiente.');
  }

  const lf = policy.learned?.followUp;
  if (!rules.closed && lf?.source === 'aprendido' && ['views', 'opened', 'activity'].includes(ideal.basis)) {
    confidenceNotes.push(`Tiempo de seguimiento ajustado con lo aprendido: ${lf.value} h (predeterminado ${lf.default} h).`);
  }

  if (!rules.closed && final.blocked) {
    confidenceNotes.push(`La restricción aplicada (${uniq(final.blocks.map((b) => b.rule)).join(', ')}) es determinística.`);
  }

  if (!rules.closed && rules.contact_block_indefinite) {
    missing.push('Motivo y vigencia de la restricción de contacto');
    if (final.action === 'escalate') {
      confidence = minLevel(confidence, 'medium');
      confidenceNotes.push('No sabemos por qué se prohibió el contacto, por eso decide una persona.');
    }
  }

  if (!state.opened_event_id && !rules.closed) {
    missing.push('Evento de apertura del caso (monto y estado inicial)');
    confidence = minLevel(confidence, 'medium');
    riskNotes.push('Falta la apertura del caso.');
    risk = maxLevel(risk, 'medium');
  }

  // Riesgo de intervenir o de esperar.
  if (!rules.closed) {
    if (ideal.manipulation) {
      risk = 'high';
      riskNotes.push('El mensaje intenta cambiar las reglas o forzar condiciones.');
    }
    if (it?.intent === 'objection') { risk = maxLevel(risk, 'medium'); riskNotes.push('Un reparo sin respuesta puede hacer perder la propuesta.'); }
    if (it?.intent === 'comparing') { risk = maxLevel(risk, 'medium'); riskNotes.push('El cliente evalúa otras opciones.'); }
    if (it?.confidence === 'low') { risk = maxLevel(risk, 'medium'); riskNotes.push('La interpretación del mensaje es poco clara.'); }
    if (final.blocked && rules.contact_block_indefinite && final.action === 'escalate') {
      risk = maxLevel(risk, 'medium');
      riskNotes.push('Esperar puede enfriar el interés del cliente, pero contactarlo violaría la restricción.');
    }
    if (state.amount_mxn !== null && state.amount_mxn >= policy.highAmountMxn) {
      risk = maxLevel(risk, 'medium');
      riskNotes.push(`Monto alto (${state.amount_mxn.toLocaleString('es-MX')} MXN).`);
    }
  }

  const requiresHuman =
    final.action === 'escalate' ||
    risk === 'high' ||
    (!rules.closed && state.amount_mxn !== null && state.amount_mxn >= policy.highAmountMxn) ||
    (!rules.closed && confidence === 'low' && CONTACT_ACTIONS.includes(final.action));

  if (!riskNotes.length) {
    riskNotes.push(
      rules.closed ? 'El caso ya terminó.'
        : final.action === 'wait' ? 'Esperar no incumple ninguna regla y el cliente no tiene una petición pendiente urgente.'
          : 'Acción permitida y de bajo impacto.',
    );
  }

  return {
    confidence,
    confidence_reason: confidenceNotes.join(' '),
    risk_level: risk,
    risk_reason: riskNotes.join(' '),
    requires_human_review: requiresHuman,
    missing_information: rules.closed ? [] : uniq(missing),
  };
}

// Punto de entrada: devuelve la recomendación (contrato) y la traza de la decisión.
export function decide(state, interpretations, nowIso, policyOverrides = {}, customer = null) {
  const policy = { ...DEFAULT_POLICY, ...policyOverrides };
  const clientDelays = activeClientDelays(state, interpretations);
  const rules = evaluateRules(state, nowIso, { clientDelays });

  const ideal = rules.closed
    ? { basis: 'closed', action: 'no_action', timing: 'not_applicable', scheduled_for: null, evidence: [state.closed_event_id], text: 'Caso cerrado.' }
    : idealAction(state, interpretations, nowIso, policy, customer);
  const final = applyRules(ideal, rules, state, nowIso);
  const assessment = assess(ideal, final, state, rules, policy, customer);

  const recommendation = {
    case_id: state.case_id,
    action: final.action,
    timing: final.timing,
    scheduled_for: final.timing === 'at_date' ? final.scheduled_for : null,
    reason: final.text,
    evidence_event_ids: uniq(final.evidence),
    confidence: assessment.confidence,
    confidence_reason: assessment.confidence_reason,
    risk_level: assessment.risk_level,
    requires_human_review: assessment.requires_human_review,
    missing_information: assessment.missing_information,
  };

  const trace = {
    evaluation_at: nowIso,
    ideal: {
      action: ideal.action,
      timing: ideal.timing,
      scheduled_for: ideal.scheduled_for ?? null,
      basis: ideal.basis,
      reason: ideal.text,
      interpretation_event_id: ideal.message?.event_id ?? null,
    },
    blocked: Boolean(final.blocked),
    blocked_by: uniq((final.blocks || []).map((b) => b.rule)),
    risk_reason: assessment.risk_reason,
    inaction: ['wait', 'no_action'].includes(final.action),
    learning: policy.learned
      ? {
        version: policy.learned.version,
        follow_up_hours: policy.followUpHours,
        follow_up_source: policy.learned.followUp?.source ?? 'predeterminado',
        answer_within_hours: policy.learned.answerWithin?.value ?? null,
      }
      : null,
    customer: customer
      ? {
        customer_id: customer.customer_id,
        name: customer.name,
        tier: customer.tier,
        reliable: customer.reliable,
        trusted: customer.trusted,
        purchases: customer.purchases,
        typical_decision_hours: customer.typical_decision_hours,
        patience_hours: customer.patience_hours,
        used: ideal.basis === 'customer_pattern' || ideal.basis === 'customer_pattern_expired',
      }
      : null,
  };

  return { recommendation, trace, rules };
}
