// Embudo de la cotización: en qué etapa está y cómo llegó ahí.
//
//   Enviada → Revisando → Con dudas → Decidiendo → Comprada | Perdida
//
// Las etapas se derivan de los eventos (determinístico). Una cotización puede regresar a
// "Con dudas" si el cliente vuelve a preguntar. Cada cambio guarda el evento que lo causó,
// así que se puede medir cuánto tiempo pasa en cada etapa.

import { hoursBetween, toMs } from './time.js';

export const STAGES = ['solicitud', 'enviada', 'revisando', 'con_dudas', 'decidiendo', 'comprada', 'perdida'];

export const STAGE_LABEL = {
  solicitud: 'Solicitud recibida',
  enviada: 'Enviada',
  revisando: 'Revisando',
  con_dudas: 'Con dudas',
  decidiendo: 'Decidiendo',
  comprada: 'Comprada',
  perdida: 'Perdida',
};

const DOUBT_INTENTS = ['question', 'objection', 'interest', 'other'];

// `interpretations`: { event_id: { intent, ... } } (puede faltar: entonces un mensaje cuenta como duda).
export function buildStages(state, interpretations = {}, nowIso = null) {
  const transitions = [];
  let current = null;
  let sectionsSeen = new Set();
  let priceViews = 0;
  let pendingDoubt = false;

  const go = (stage, ev, why) => {
    if (stage === current) return;
    transitions.push({ stage, at: ev.occurred_at, event_id: ev.event_id, why });
    current = stage;
  };

  for (const ev of state.events) {
    if (current === 'comprada' || current === 'perdida') break; // el cierre es definitivo
    switch (ev.event_type) {
      case 'case.opened':
        go(ev.data.proposal_status === 'pending' ? 'solicitud' : 'enviada', ev, ev.data.proposal_status === 'pending' ? 'El cliente solicitó una cotización; aún no hay propuesta enviada.' : 'Se envió la cotización.');
        break;
      case 'proposal.sent':
        go('enviada', ev, 'El equipo preparó y publicó la propuesta en el portal.');
        pendingDoubt = false;
        break;
      case 'proposal.viewed': {
        sectionsSeen.add(ev.data.section ?? 'general');
        if (ev.data.section === 'price') priceViews += 1;
        if (!current) go('enviada', ev, 'Primer evento del caso.');
        if (current === 'enviada') go('revisando', ev, 'El cliente abrió la cotización.');
        else if (current === 'revisando' && (sectionsSeen.size >= 3 || priceViews >= 2)) {
          go('decidiendo', ev, 'Revisó la cotización a fondo.');
        } else if (current === 'con_dudas' && !pendingDoubt) {
          go('decidiendo', ev, 'Volvió a revisar después de que se atendieron sus dudas.');
        }
        break;
      }
      case 'message.received': {
        if (current === 'solicitud') break;
        const intent = interpretations[ev.event_id]?.intent ?? 'question';
        if (!current) go('enviada', ev, 'Primer evento del caso.');
        if (DOUBT_INTENTS.includes(intent)) {
          pendingDoubt = true;
          go('con_dudas', ev, intent === 'objection' ? 'Expresó un reparo.' : intent === 'interest' ? 'Pidió más información.' : 'Hizo una pregunta.');
        } else if (intent === 'comparing') {
          go('decidiendo', ev, 'Dijo que compara opciones.');
        } else if (intent === 'request_delay') {
          go('decidiendo', ev, 'Pidió tiempo para decidir.');
        } else if (intent === 'provides_information') {
          go('decidiendo', ev, 'Compartió información para avanzar.');
        } else if (intent === 'not_interested') {
          go('decidiendo', ev, 'Dijo que no le interesa (sin cerrar el caso).');
        }
        break;
      }
      case 'action.executed':
        if (!current) go('enviada', ev, 'Primer evento del caso.');
        if (current === 'con_dudas' && pendingDoubt) {
          pendingDoubt = false;
          go('decidiendo', ev, 'La empresa atendió sus dudas.');
        }
        break;
      case 'case.closed':
        if (!current) go('enviada', ev, 'Primer evento del caso.');
        go(ev.data.status === 'accepted' ? 'comprada' : 'perdida', ev,
          ev.data.status === 'accepted' ? 'Aceptó la cotización.' : ev.data.status === 'rejected' ? 'Rechazó la cotización.' : 'Se canceló la cotización.');
        break;
      default:
        if (!current) go('enviada', ev, 'Primer evento del caso.');
        break;
    }
  }

  // Tiempo en cada etapa (la última corre hasta ahora, salvo que el caso esté cerrado).
  const endIso = nowIso;
  const withDurations = transitions.map((t, i) => {
    const next = transitions[i + 1];
    const terminal = t.stage === 'comprada' || t.stage === 'perdida';
    let hours = null;
    if (next) hours = Math.max(0, hoursBetween(t.at, next.at));
    else if (!terminal && endIso && toMs(endIso) >= toMs(t.at)) hours = hoursBetween(t.at, endIso);
    return { ...t, label: STAGE_LABEL[t.stage], hours: hours === null ? null : Math.round(hours * 10) / 10 };
  });

  return {
    current: current ?? 'enviada',
    current_label: STAGE_LABEL[current ?? 'enviada'],
    transitions: withDurations,
    reached: [...new Set(withDurations.map((t) => t.stage))],
    pending_doubt: pendingDoubt,
  };
}
