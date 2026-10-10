// Datos de demostración: empresas ficticias con historial de compras y cotizaciones activas.
// Las fechas se calculan hacia atrás desde la hora actual del reloj en vivo, así la demo
// siempre se ve "fresca" aunque se cargue otro día.

import { toIso, toMs } from '../domain/time.js';

const H = 3600 * 1000;
const D = 24 * H;

export const DEMO_CUSTOMERS = [
  { customer_id: 'CUS-001', name: 'Abarrotes La Esperanza', contact_name: 'Rosa Elena Garza', segment: 'Comercio', city: 'Saltillo' },
  { customer_id: 'CUS-002', name: 'Taller Mecánico Ruiz', contact_name: 'Javier Ruiz', segment: 'Servicios', city: 'Ramos Arizpe' },
  { customer_id: 'CUS-003', name: 'Hotel Sierra Azul', contact_name: 'Mariana Treviño', segment: 'Hotelería', city: 'Arteaga' },
  { customer_id: 'CUS-004', name: 'Agrícola Los Nogales', contact_name: 'Ernesto Valdés', segment: 'Agroindustria', city: 'General Cepeda' },
  { customer_id: 'CUS-005', name: 'Clínica Dental Sonrisa', contact_name: 'Paola Mendoza', segment: 'Salud', city: 'Saltillo' },
  { customer_id: 'CUS-006', name: 'Panificadora El Trigal', contact_name: 'Tomás Herrera', segment: 'Alimentos', city: 'Monclova' },
];

const PRICES = { 'PKG-COMERCIO-10': 150000, 'PKG-NEGOCIO-20': 285000, 'PKG-INDUSTRIA-50': 690000 };

// Construye los eventos de una cotización. `steps` son [horasDesdeApertura, tipo, data].
function quote(caseId, customerId, packageId, openedMs, steps) {
  const evs = [{
    event_id: `${caseId}-e1`, case_id: caseId, event_type: 'case.opened', occurred_at: toIso(openedMs),
    data: { status: 'open', proposal_amount_mxn: PRICES[packageId], customer_id: customerId, package_id: packageId },
  }];
  for (const [hours, type, data] of steps) {
    evs.push({ event_id: `${caseId}-e${evs.length + 1}`, case_id: caseId, event_type: type, occurred_at: toIso(openedMs + hours * H), data });
  }
  return evs;
}

const view = (h, section) => [h, 'proposal.viewed', { section }];
const msg = (h, message) => [h, 'message.received', { message }];
const accept = (h) => [h, 'case.closed', { status: 'accepted' }];
const reject = (h) => [h, 'case.closed', { status: 'rejected' }];

export function buildDemoEvents(nowIso) {
  const now = toMs(nowIso);
  const ago = (ms) => Math.floor((now - ms) / 60000) * 60000;
  const events = [];
  const add = (...evs) => events.push(...evs);

  const contact = (h) => [h, 'action.executed', { action: 'contact' }];

  // CUS-001 Abarrotes La Esperanza: buen cliente que siempre tarda ~48 h en decidir (3 compras).
  // Cuando preguntó algo, se le respondió en ~2 h.
  add(...quote('NS-1001', 'CUS-001', 'PKG-COMERCIO-10', ago(300 * D), [view(3, 'price'), msg(5, '¿El precio incluye la instalación?'), contact(7), view(20, 'warranty'), accept(46)]));
  add(...quote('NS-1002', 'CUS-001', 'PKG-COMERCIO-10', ago(180 * D), [view(5, 'price'), view(30, 'installation'), accept(50)]));
  add(...quote('NS-1003', 'CUS-001', 'PKG-NEGOCIO-20', ago(60 * D), [view(2, 'price'), msg(10, '¿Tienen financiamiento a meses?'), contact(12), view(26, 'financing'), accept(47)]));

  // CUS-002 Taller Mecánico Ruiz: 1 compra rápida y 1 pérdida (su pregunta nunca se respondió).
  add(...quote('NS-0991', 'CUS-002', 'PKG-COMERCIO-10', ago(160 * D), [view(1, 'installation'), msg(3, '¿Pueden instalar en una semana?'), reject(60)]));
  add(...quote('NS-1004', 'CUS-002', 'PKG-COMERCIO-10', ago(120 * D), [view(1, 'price'), accept(20)]));
  add(...quote('NS-1011', 'CUS-002', 'PKG-NEGOCIO-20', ago(3 * H), [view(0.5, 'installation'), msg(1, '¿Cuánto tarda la instalación? No podemos cerrar el taller más de dos días.')]));

  // CUS-003 Hotel Sierra Azul: cliente nuevo; abrió el precio varias veces pero no escribe.
  add(...quote('NS-1012', 'CUS-003', 'PKG-NEGOCIO-20', ago(60 * H), [view(2, 'price'), view(6, 'price'), view(10, 'financing')]));

  // CUS-004 Agrícola Los Nogales: 2 compras y 1 pérdida (reparo de precio respondido tarde y con insistencia).
  add(...quote('NS-1005', 'CUS-004', 'PKG-INDUSTRIA-50', ago(240 * D), [view(4, 'price'), msg(6, '¿Cuál es la garantía de los paneles?'), contact(8), accept(30)]));
  add(...quote('NS-1006', 'CUS-004', 'PKG-INDUSTRIA-50', ago(150 * D), [view(4, 'warranty'), msg(6, 'Está muy caro comparado con otra cotización que tenemos.'), contact(40), contact(60), reject(90)]));
  add(...quote('NS-1007', 'CUS-004', 'PKG-NEGOCIO-20', ago(90 * D), [view(2, 'price'), accept(36)]));
  add(...quote('NS-1013', 'CUS-004', 'PKG-INDUSTRIA-50', ago(5 * H), [view(1, 'delivery'), msg(2, 'Estoy de viaje esta semana, por favor no me llamen hasta el lunes.')]));

  // CUS-005 Clínica Dental Sonrisa: 2 pérdidas (presión sin respuesta; comparaba con otro proveedor).
  add(...quote('NS-1008', 'CUS-005', 'PKG-COMERCIO-10', ago(200 * D), [view(3, 'price'), contact(5), contact(20), reject(70)]));
  add(...quote('NS-0992', 'CUS-005', 'PKG-COMERCIO-10', ago(130 * D), [view(2, 'price'), msg(4, 'Estamos comparando con otro proveedor.'), reject(50)]));
  add(...quote('NS-1014', 'CUS-005', 'PKG-COMERCIO-10', ago(20 * H), [
    view(1, 'financing'),
    msg(3, 'Me interesa conocer las opciones de financiamiento.'),
    [4, 'constraint.updated', { contact_allowed: false }],
  ]));

  // CUS-006 Panificadora El Trigal: buen cliente, pero lento (~72 h). Cotización activa sin mensajes.
  add(...quote('NS-1009', 'CUS-006', 'PKG-NEGOCIO-20', ago(210 * D), [view(10, 'price'), accept(70)]));
  add(...quote('NS-1010', 'CUS-006', 'PKG-NEGOCIO-20', ago(100 * D), [view(8, 'warranty'), accept(75)]));
  add(...quote('NS-1015', 'CUS-006', 'PKG-INDUSTRIA-50', ago(26 * H), [view(2, 'price'), view(20, 'warranty')]));

  // Orden de llegada = orden cronológico.
  return events.sort((a, b) => toMs(a.occurred_at) - toMs(b.occurred_at));
}

// Carga los datos de demostración. Si ya hay clientes y no se pide `force`, no hace nada.
export async function seedDemo({ engine, storage, force = false }) {
  const existing = await storage.listCustomers();
  if (existing.length && !force) return { seeded: false, reason: 'Ya hay clientes cargados.' };
  const clock = await engine.setClock({ mode: 'live' });
  for (const c of DEMO_CUSTOMERS) await storage.upsertCustomer(c);
  const events = buildDemoEvents(clock.evaluation_at);
  const result = await engine.ingest({ content: events.map((e) => JSON.stringify(e)).join('\n'), source: 'datos-demo' });
  return { seeded: true, customers: DEMO_CUSTOMERS.length, events: result.accepted, duplicates: result.duplicates.length };
}
