// Portal del cliente + datos demo + comprobante, con un reloj controlado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorage } from '../src/storage/memory.js';
import { createEngine } from '../src/services/engine.js';
import { createPortal } from '../src/portal/service.js';
import { seedDemo } from '../src/portal/seed.js';
import { createApp } from '../src/app.js';

const H = 3600 * 1000;

async function setup({ sendInvoice } = {}) {
  let nowMs = Date.parse('2026-10-10T15:00:00Z');
  const storage = createMemoryStorage();
  const engine = createEngine({ storage, provider: null, clock: () => nowMs });
  const portal = createPortal({ engine, storage, ...(sendInvoice ? { sendInvoice } : {}) });
  await seedDemo({ engine, storage });
  return { storage, engine, portal, advance: (h) => { nowMs += h * H; } };
}

const recOf = async (engine, caseId) => (await engine.getCase(caseId)).current.recommendation;

test('Datos demo: cada cotización activa tiene una recomendación distinta y coherente', async () => {
  const { engine } = await setup();
  const cases = Object.fromEntries((await engine.listCases()).map((c) => [c.case_id, c]));
  assert.equal(cases['NS-1011'].recommendation.action, 'resolve_objection'); // pregunta pendiente
  assert.equal(cases['NS-1012'].recommendation.action, 'contact'); // cliente nuevo, solo aperturas viejas (R5: within_24h)
  assert.equal(cases['NS-1012'].recommendation.timing, 'within_24h');
  assert.equal(cases['NS-1013'].recommendation.action, 'wait'); // pidió no llamarlo hasta el lunes
  assert.equal(cases['NS-1014'].recommendation.action, 'escalate'); // interés + contacto prohibido
  assert.equal(cases['NS-1015'].recommendation.action, 'wait'); // buen cliente lento: inacción por patrón
  assert.equal(cases['NS-1015'].inaction_kind, 'pattern');
  assert.equal(cases['NS-1003'].recommendation.action, 'no_action'); // compra pasada cerrada
  const summary = await engine.summary();
  assert.ok(summary.inaction.count >= 2);
  assert.equal(summary.inaction.by_kind.pattern, 1);
});

test('Venta desde el portal de un buen cliente lento: inacción hasta su tiempo habitual, luego seguimiento', async () => {
  const { engine, portal, advance } = await setup();
  const quote = await portal.requestQuote('CUS-001', 'PKG-COMERCIO-10');
  assert.equal(quote.case_id, 'NS-1016');
  await portal.viewSection('CUS-001', quote.case_id, 'price');

  let rec = await recOf(engine, quote.case_id);
  assert.equal(rec.action, 'wait');
  assert.equal(rec.confidence, 'high');
  assert.match(rec.reason, /Abarrotes La Esperanza es cliente frecuente: 3 compras previas/);

  advance(30); // 30 h después: sigue dentro de su tiempo habitual
  await engine.evaluate();
  rec = await recOf(engine, quote.case_id);
  assert.equal(rec.action, 'wait');

  advance(30); // 60 h: ya pasó su tiempo habitual (57 h)
  await engine.evaluate();
  rec = await recOf(engine, quote.case_id);
  assert.equal(rec.action, 'contact');
  assert.equal(rec.timing, 'within_24h');

  // El cliente acepta: el caso se cierra y lo correcto es no actuar.
  await portal.decide('CUS-001', quote.case_id, 'accepted');
  rec = await recOf(engine, quote.case_id);
  assert.equal(rec.action, 'no_action');

  // El historial del cliente ahora tiene 4 compras.
  const c = await engine.getCustomer('CUS-001');
  assert.equal(c.profile.purchases, 4);
});

test('Comprobante: valida el correo, exige compra y reporta el estado del envío', async () => {
  const sent = [];
  const { portal, storage } = await setup({ sendInvoice: async (inv) => { sent.push(inv); return { status: 'sent', error: null }; } });
  const quote = await portal.requestQuote('CUS-003', 'PKG-NEGOCIO-20');
  await assert.rejects(portal.requestInvoice('CUS-003', quote.case_id, 'equipo@demo.mx'), /aceptas la cotización/);
  await portal.decide('CUS-003', quote.case_id, 'accepted');
  await assert.rejects(portal.requestInvoice('CUS-003', quote.case_id, 'no-es-correo'), /correo válido/);
  const r = await portal.requestInvoice('CUS-003', quote.case_id, 'equipo@demo.mx');
  assert.equal(r.status, 'sent');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].email, 'equipo@demo.mx');
  assert.equal(sent[0].total_mxn, 285000);
  assert.match(sent[0].html, /No es una factura fiscal/);
  const stored = await storage.listInvoices({ case_id: quote.case_id });
  assert.equal(stored[0].status, 'sent');
});

test('Sin n8n configurado, el comprobante se muestra en pantalla', async () => {
  const { portal } = await setup();
  const quote = await portal.requestQuote('CUS-002', 'PKG-COMERCIO-10');
  await portal.decide('CUS-002', quote.case_id, 'accepted');
  const r = await portal.requestInvoice('CUS-002', quote.case_id, 'taller@demo.mx');
  assert.equal(r.status, 'not_configured');
  assert.equal(r.preview.total_mxn, 150000);
});

test('Un cliente no puede tocar la cotización de otro', async () => {
  const { portal } = await setup();
  const quote = await portal.requestQuote('CUS-001', 'PKG-COMERCIO-10');
  await assert.rejects(portal.sendMessage('CUS-002', quote.case_id, 'hola'), /no pertenece/);
});

test('La ficha del equipo convierte a un cliente nuevo en "de confianza" y cambia la recomendación', async () => {
  const { engine } = await setup();
  assert.equal((await recOf(engine, 'NS-1012')).action, 'contact');
  await engine.updateCustomerProfile('CUS-003', { trusted: true, decision_hours_override: 72 });
  const rec = await recOf(engine, 'NS-1012');
  assert.equal(rec.action, 'wait');
});

test('Preferencias de contacto desde el portal generan constraint.updated', async () => {
  const { engine, portal } = await setup();
  const quote = await portal.requestQuote('CUS-001', 'PKG-COMERCIO-10');
  await portal.sendMessage('CUS-001', quote.case_id, '¿El precio incluye la instalación?');
  assert.equal((await recOf(engine, quote.case_id)).action, 'resolve_objection');
  await portal.setContactPreference('CUS-001', quote.case_id, { kind: 'no_contact' });
  assert.ok(!['contact', 'request_information', 'resolve_objection'].includes((await recOf(engine, quote.case_id)).action));
});

test('Con ADMIN_PASSWORD la consola pide contraseña y el portal sigue abierto', async () => {
  const { engine } = await setup();
  const app = createApp(engine, { adminPassword: 'secreto' });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    assert.equal((await fetch(`${base}/cases`)).status, 401);
    assert.equal((await fetch(`${base}/cases`, { headers: { 'x-admin-password': 'mal' } })).status, 401);
    assert.equal((await fetch(`${base}/cases`, { headers: { 'x-admin-password': 'secreto' } })).status, 200);
    assert.equal((await fetch(`${base}/reset`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${base}/portal/catalog`)).status, 200);
    assert.equal((await fetch(`${base}/health`)).status, 200);
    const auth = await (await fetch(`${base}/auth`)).json();
    assert.deepEqual(auth, { required: true, ok: false });
  } finally {
    server.close();
  }
});
