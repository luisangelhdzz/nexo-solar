// Lo que aprende el sistema de las cotizaciones cerradas.
//
// No se entrena ningún modelo. Con los análisis de compras y pérdidas se calculan:
//   1. Tiempos ajustados con datos (cuándo dar seguimiento si el cliente está en silencio).
//   2. Qué factores separan una compra de una pérdida.
// Las reglas R1–R6 nunca se aprenden ni cambian.

import { hoursBetween, toMs } from './time.js';
import { FACTORS } from './outcome.js';
import { STAGES, STAGE_LABEL } from './stages.js';

const MIN_WON_FOR_TIMES = 3;

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const percentile = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx];
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

// `closed`: [{ analysis, state }] de cotizaciones cerradas antes de la hora de evaluación.
export function computeLearning(closed, { defaults }) {
  const won = closed.filter((c) => c.analysis.outcome === 'won');
  const lost = closed.filter((c) => c.analysis.outcome === 'lost');

  // Horas entre la última actividad del cliente y su compra: cuánto suele tardar en decidir
  // alguien que se quedó en silencio. El percentil 75 cubre a la mayoría sin presionar de más.
  const silenceToBuy = won
    .map(({ state }) => {
      const acts = [state.opened_at, ...state.views.map((v) => v.at), ...state.messages.map((m) => m.at)]
        .filter((t) => t && toMs(t) <= toMs(state.closed_at));
      const last = acts.sort().at(-1);
      return last ? hoursBetween(last, state.closed_at) : null;
    })
    .filter((h) => h !== null);

  const followUp = won.length >= MIN_WON_FOR_TIMES && silenceToBuy.length >= MIN_WON_FOR_TIMES
    ? {
      value: clamp(Math.round(percentile(silenceToBuy, 75)), 12, 96),
      default: defaults.followUpHours,
      source: 'aprendido',
      basis: `Percentil 75 de las horas entre la última actividad del cliente y su compra (${silenceToBuy.length} compras).`,
    }
    : {
      value: defaults.followUpHours,
      default: defaults.followUpHours,
      source: 'predeterminado',
      basis: `Hacen falta al menos ${MIN_WON_FOR_TIMES} compras para ajustar este tiempo (hay ${won.length}).`,
    };

  // Tiempo de respuesta a dudas en compras ganadas vs perdidas.
  const wonResp = won.map((c) => c.analysis.metrics.median_response_hours).filter((h) => h !== null);
  const lostResp = lost.map((c) => c.analysis.metrics.median_response_hours).filter((h) => h !== null);
  const answerWithin = wonResp.length >= 2
    ? { value: Math.max(1, Math.round(median(wonResp))), source: 'aprendido', basis: `Mediana del tiempo de respuesta a dudas en ${wonResp.length} compras ganadas.` }
    : { value: null, source: 'sin_datos', basis: 'Aún no hay suficientes compras con dudas respondidas.' };

  // Qué factores aparecen en compras vs pérdidas.
  const factorStats = Object.entries(FACTORS).map(([id, f]) => {
    const wonWith = won.filter((c) => c.analysis.factors.some((x) => x.id === id)).length;
    const lostWith = lost.filter((c) => c.analysis.factors.some((x) => x.id === id)).length;
    const total = wonWith + lostWith;
    return {
      id,
      label: f.label,
      direction: f.direction,
      advice: f.advice,
      won_with: wonWith,
      lost_with: lostWith,
      won_total: won.length,
      lost_total: lost.length,
      win_rate_with: total ? wonWith / total : null,
    };
  }).filter((s) => s.won_with + s.lost_with > 0)
    .sort((a, b) => (b.won_with + b.lost_with) - (a.won_with + a.lost_with));

  // Tiempo promedio en cada etapa, separado por resultado.
  const stageHours = (group) => Object.fromEntries(STAGES.map((st) => {
    const hrs = group.map((c) => c.analysis.stage_hours[st]).filter((h) => typeof h === 'number');
    return [st, hrs.length ? Math.round(median(hrs) * 10) / 10 : null];
  }));

  // Frases claras para el equipo (y como contexto para la IA).
  const insights = [];
  if (followUp.source === 'aprendido') {
    insights.push(`Los clientes que compraron lo hicieron, en su mayoría, dentro de ${followUp.value} h después de su última actividad. Antes de eso no conviene insistir.`);
  }
  if (answerWithin.value !== null) {
    const lostMed = lostResp.length ? Math.round(median(lostResp)) : null;
    insights.push(`En las compras ganadas, las dudas se respondieron en ~${answerWithin.value} h${lostMed !== null ? `; en las perdidas, en ~${lostMed} h` : ''}.`);
  }
  for (const s of factorStats.slice(0, 6)) {
    if (s.direction === 'negative' && s.lost_with >= 1 && s.win_rate_with !== null && s.win_rate_with < 0.5) {
      insights.push(`Con "${s.label.toLowerCase()}" se compró ${s.won_with} de ${s.won_with + s.lost_with} ${s.won_with + s.lost_with === 1 ? 'vez' : 'veces'}.`);
    }
    if (s.direction === 'positive' && s.won_with >= 2 && s.win_rate_with !== null && s.win_rate_with >= 0.75) {
      insights.push(`Con "${s.label.toLowerCase()}" se compró ${s.won_with} de ${s.won_with + s.lost_with} ${s.won_with + s.lost_with === 1 ? 'vez' : 'veces'}.`);
    }
  }

  const fingerprint = closed.map((c) => `${c.state.case_id}:${c.analysis.outcome}`).sort().join('|');
  return {
    version: hashString(fingerprint || 'vacio'),
    samples: { won: won.length, lost: lost.length },
    params: { follow_up_hours: followUp, answer_within_hours: answerWithin },
    factor_stats: factorStats,
    stage_hours: { won: stageHours(won), lost: stageHours(lost) },
    stage_labels: STAGE_LABEL,
    insights,
  };
}

// Selecciona lecciones relevantes para dar contexto a la IA: primero las del mismo cliente.
export function pickLessons(lessons, { customerId = null, limit = 4 } = {}) {
  const own = lessons.filter((l) => customerId && l.customer_id === customerId);
  const others = lessons.filter((l) => !customerId || l.customer_id !== customerId);
  return [...own.slice(0, 2), ...others].slice(0, limit);
}
