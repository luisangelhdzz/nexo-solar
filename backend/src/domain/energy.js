// Datos reportados y estimaciones reproducibles; nunca dimensiona paneles desde pesos o cuartos.
import { EngineError } from '../services/engine.js';
const num = (value, name, min, max, integer = false) => {
  if (value === '' || value == null) return null;
  const n = Number(value);
  if (typeof value === 'boolean' || !Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) throw new EngineError(`${name}: escribe un valor entre ${min} y ${max}${integer ? ', sin decimales' : ''}.`);
  return n;
};
export function normalizeEnergyInput(input = {}) {
  const property_type = input.property_type || 'business';
  if (!['home', 'business'].includes(property_type)) throw new EngineError('Selecciona casa o negocio.');
  if (input.appliances != null && (!Array.isArray(input.appliances) || input.appliances.length > 25)) throw new EngineError('Registra hasta 25 tipos de aparatos.');
  const appliances = (input.appliances || []).map(a => {
    if (!a || typeof a !== 'object' || Array.isArray(a)) throw new EngineError('Revisa los datos de cada aparato.');
    const name = String(a.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const empty = !name && [a.watts, a.hours_per_day, a.days_per_month].every(v => v == null || v === '');
    if (empty) return null;
    if (!name) throw new EngineError('Escribe el nombre del aparato.');
    return { name, quantity: num(a.quantity ?? 1, 'Cantidad', 1, 1000, true) ?? 1, watts: num(a.watts, 'Potencia en watts', 0.1, 1000000), hours_per_day: num(a.hours_per_day, 'Horas al día', 0, 24), days_per_month: num(a.days_per_month, 'Días al mes', 0, 31, true) };
  }).filter(Boolean);
  return { property_type, rooms: num(input.rooms, 'Cuartos o áreas', 1, 1000, true), bill_kwh: num(input.bill_kwh, 'Consumo en kWh', 0.1, 10000000), billing_days: num(input.billing_days, 'Días del recibo', 1, 366, true), tariff: String(input.tariff ?? '').trim().slice(0, 40), appliances };
}
const round = n => Math.round(n * 100) / 100;
export function energyAnalysis(request = {}) {
  const bill = Number(request.bill_kwh) > 0 ? Number(request.bill_kwh) : null;
  const days = Number(request.billing_days) > 0 ? Number(request.billing_days) : null;
  const rows = (request.appliances || []).map(a => {
    const complete = [a.quantity, a.watts, a.hours_per_day, a.days_per_month].every(v => typeof v === 'number' && Number.isFinite(v));
    return { ...a, estimated_kwh_month: complete ? round(a.quantity * a.watts * a.hours_per_day * a.days_per_month / 1000) : null };
  });
  const missing = [];
  if (!bill) missing.push('Consumo en kWh del recibo; el importe en pesos no sustituye este dato.');
  if (!days) missing.push('Número de días que cubre el recibo.');
  if (!request.tariff) missing.push('Tarifa que aparece en el recibo.');
  if (!rows.length) missing.push('Lista de aparatos: cantidad, watts, horas de uso al día y días al mes.');
  for (const a of rows.filter(a => a.estimated_kwh_month === null)) missing.push(`Completar potencia y horario de uso de ${a.name}.`);
  const allComplete = rows.length > 0 && rows.every(a => a.estimated_kwh_month !== null);
  return {
    property_type: request.property_type || 'business', rooms: request.rooms ?? null,
    tariff: request.tariff || null, reported_kwh: bill, billing_days: days, daily_kwh: bill && days ? round(bill / days) : null,
    normalized_kwh_30_days: bill && days ? round(bill / days * 30) : null,
    appliances: rows, inventory_complete: allComplete,
    inventory_estimated_kwh_month: allComplete ? round(rows.reduce((sum,a) => sum + a.estimated_kwh_month, 0)) : null,
    missing_information: missing,
    method: 'Cantidad × watts × horas al día × días al mes ÷ 1000. Es una estimación con datos declarados, no una medición.',
    limitations: ['Los cuartos y el número de aparatos no determinan por sí solos el consumo.', 'Refrigeradores, aires acondicionados y equipos con ciclos requieren validar su consumo real; la potencia nominal no equivale a uso continuo.', 'No se calcula cantidad de paneles, ahorro ni precio final sin evaluación técnica del sitio y datos de generación solar.'],
  };
}
