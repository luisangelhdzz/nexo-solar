// Utilidades de fecha. Todo el sistema trabaja en UTC y con la hora de evaluación
// del manifest, nunca con el reloj de la computadora.

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]00:?00)$/;

export function isIsoUtc(value) {
  if (typeof value !== 'string' || !ISO_UTC.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

export function toMs(iso) {
  return Date.parse(iso);
}

// Formato canónico: 2026-10-09T15:00:00Z (sin milisegundos).
export function toIso(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function addHours(iso, hours) {
  return toIso(toMs(iso) + hours * 3600 * 1000);
}

export function maxIso(...values) {
  const valid = values.filter(Boolean);
  if (!valid.length) return null;
  return valid.reduce((a, b) => (toMs(a) >= toMs(b) ? a : b));
}

const MONTHS_ES = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];

// "12 oct 2026, 15:00 UTC" para usar dentro de explicaciones.
export function humanUtc(iso) {
  if (!iso) return '';
  const d = new Date(toMs(iso));
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS_ES[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

export function hoursBetween(fromIso, toIsoValue) {
  return (toMs(toIsoValue) - toMs(fromIso)) / 3600000;
}

export function humanDuration(hours) {
  const h = Math.abs(hours);
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${Math.round(h * 10) / 10} h`;
  return `${Math.round((h / 24) * 10) / 10} días`;
}
