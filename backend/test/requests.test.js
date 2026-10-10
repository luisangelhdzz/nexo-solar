import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorage } from '../src/storage/memory.js';
import { createEngine } from '../src/services/engine.js';
import { createPortal } from '../src/portal/service.js';
import { createApp } from '../src/app.js';

const input = { contact_name: 'Ana', city: 'Saltillo', segment: 'Comercio', email: 'ana@example.com', contact_channel: 'email', monthly_bill_mxn: 8000, bill_period: 'bimonthly', roof: 'Azotea de concreto', goal: 'Reducir el consumo de mi negocio.', contact_allowed: true };
const proposal = { package_id: 'PKG-COMERCIO-10', title: 'Sistema para mi negocio', amount_mxn: 165000, notes: 'Incluye instalación. Visita técnica por confirmar.' };
async function setup() {
  let now = Date.parse('2026-10-10T15:00:00Z');
  const storage = createMemoryStorage();
  const engine = createEngine({ storage, provider: null, clock: () => now });
  const portal = createPortal({ engine, storage });
  const c = await portal.createCustomer({ name: 'Comercio de prueba' });
  return { storage, engine, portal, cid: c.customer_id, advance: (hours) => { now += hours * 3600000; } };
}

test('Solicitud → propuesta → duda → respuesta → compra, con monto personalizado', async () => {
  const { engine, portal, cid, advance } = await setup();
  const q = await portal.submitRequest(cid, input);
  assert.equal(q.proposal_pending, true);
  assert.equal(q.amount_mxn, null);
  assert.equal(q.request.monthly_bill_mxn, 4000);
  assert.equal((await engine.getCase(q.case_id)).stages.current, 'solicitud');
  assert.equal((await engine.summary()).totals.requests, 1);
  assert.equal((await engine.getCase(q.case_id)).current.recommendation.action, 'escalate');
  await assert.rejects(portal.decide(cid, q.case_id, 'accepted'), { code: 'PROPOSAL_PENDING' });
  await assert.rejects(portal.viewSection(cid, q.case_id, 'price'), { code: 'PROPOSAL_PENDING' });
  advance(5);
  await portal.sendProposal(q.case_id, proposal);
  await assert.rejects(portal.sendProposal(q.case_id, proposal), { code: 'CONTACT_BLOCKED' });
  let view = (await portal.getCustomerView(cid)).quotes[0];
  assert.equal(view.amount_mxn, 165000);
  assert.equal(view.proposal.title, proposal.title);
  assert.equal(view.proposal_pending, false);
  assert.equal((await engine.summary()).totals.requests, 0);
  await portal.viewSection(cid, q.case_id, 'price');
  advance(1 / 60);
  await portal.sendMessage(cid, q.case_id, '¿La instalación está incluida?');
  await portal.reply(q.case_id, { message: 'Sí, incluye instalación.', action: 'contact' });
  view = (await portal.getCustomerView(cid)).quotes[0];
  assert.equal(view.conversation.at(-1).from, 'team');
  assert.equal(view.conversation.at(-1).message, 'Sí, incluye instalación.');
  advance(48);
  await portal.decide(cid, q.case_id, 'accepted');
  const details = await engine.getCase(q.case_id);
  assert.equal(details.current.recommendation.action, 'no_action');
  assert.equal(details.outcome.decision_hours, 48);
  await assert.rejects(portal.reply(q.case_id, { message: 'Hola' }), { code: 'CONTACT_BLOCKED' });
  const receipt = await portal.requestInvoice(cid, q.case_id, 'ana@example.com');
  assert.equal(receipt.preview.total_mxn, 165000);
});

test('Sin consumo se pide información; el permiso y fecha bloquean los envíos reales', async () => {
  const { engine, portal, cid, advance } = await setup();
  const q = await portal.submitRequest(cid, { ...input, monthly_bill_mxn: '' });
  assert.equal((await engine.getCase(q.case_id)).current.recommendation.action, 'request_information');
  await portal.setContactPreference(cid, q.case_id, { kind: 'no_contact' });
  await assert.rejects(portal.sendProposal(q.case_id, proposal), { code: 'CONTACT_BLOCKED' });
  await assert.rejects(portal.reply(q.case_id, { message: 'Comparte tu consumo.' }), { code: 'CONTACT_BLOCKED' });
  await portal.setContactPreference(cid, q.case_id, { kind: 'allow' });
  await portal.sendMessage(cid, q.case_id, 'No me contacten antes del 15 de octubre de 2026.');
  await assert.rejects(portal.sendProposal(q.case_id, proposal), { code: 'CONTACT_BLOCKED' });
  advance(24 * 7);
  await portal.sendProposal(q.case_id, proposal);
});

test('Formulario valida los datos y una empresa no accede a solicitudes ajenas', async () => {
  const { portal, cid } = await setup();
  await assert.rejects(portal.submitRequest(cid, { ...input, email: 'incorrecto' }), /correo válido/);
  await assert.rejects(portal.submitRequest(cid, { ...input, monthly_bill_mxn: -10 }), /positivo/);
  const q = await portal.submitRequest(cid, input);
  const other = await portal.createCustomer({ name: 'Otro negocio' });
  await assert.rejects(portal.sendMessage(other.customer_id, q.case_id, 'Hola'), { code: 'FORBIDDEN' });
});

test('La publicación y respuestas requieren contraseña de consola cuando está configurada', async () => {
  const { portal, cid, engine } = await setup();
  const q = await portal.submitRequest(cid, input);
  const server = createApp(engine, { adminPassword: 'equipo-test' }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/cases/${q.case_id}`;
  try {
    const blocked = await fetch(url + '/proposal', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(proposal) });
    assert.equal(blocked.status, 401);
    const allowed = await fetch(url + '/proposal', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-password': 'equipo-test' }, body: JSON.stringify(proposal) });
    assert.equal(allowed.status, 200);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('Dos publicaciones simultáneas producen una sola propuesta enviada', async () => {
  const { portal, storage, cid } = await setup();
  const q = await portal.submitRequest(cid, input);
  const results = await Promise.allSettled([portal.sendProposal(q.case_id, proposal), portal.sendProposal(q.case_id, proposal)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await storage.getCaseEvents(q.case_id)).filter((e) => e.event_type === 'proposal.sent').length, 1);
});

test('Un mensaje posterior dentro del mismo minuto permite responder sin romper R4', async () => {
  const { portal, cid, advance } = await setup();
  const q = await portal.submitRequest(cid, input);
  await portal.sendProposal(q.case_id, proposal);
  advance(1 / 3600); // Un segundo, no una hora ni un minuto.
  await portal.sendMessage(cid, q.case_id, '¿Incluye instalación?');
  await portal.reply(q.case_id, { message: 'Sí, incluye instalación.' });
  assert.equal((await portal.getCustomerView(cid)).quotes[0].conversation.at(-1).from, 'team');
});

test('Cierre comercial guarda motivo real, detiene seguimiento y no se puede cerrar dos veces', async () => {
  const { portal, cid, engine } = await setup();
  const q = await portal.submitRequest(cid, input);
  const results = await Promise.allSettled([
    portal.closeCase(q.case_id, { status: 'rejected', reason: 'Inconvenientes de instalación', notes: 'El techo necesita reparación.' }),
    portal.closeCase(q.case_id, { status: 'accepted', reason: 'Propuesta aceptada' }),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const closed = await engine.getCase(q.case_id);
  assert.equal(closed.state.closed_reason, 'Inconvenientes de instalación');
  assert.equal(closed.state.closed_notes, 'El techo necesita reparación.');
  assert.equal(closed.outcome.reported_reason, 'Inconvenientes de instalación');
  assert.equal(closed.current.recommendation.action, 'no_action');
  assert.equal((await engine.summary()).totals.rejected, 1);
  await assert.rejects(portal.reply(q.case_id, { message: 'Hola de nuevo.' }), { code: 'CONTACT_BLOCKED' });
  assert.equal((await portal.getCustomerView(cid)).quotes[0].closed_status, 'rejected');
});

test('Venta requiere propuesta publicada; cierre requiere motivo y autenticación de consola', async () => {
  const { portal, cid, engine } = await setup();
  const q = await portal.submitRequest(cid, input);
  await assert.rejects(portal.closeCase(q.case_id, { status: 'accepted', reason: 'Propuesta aceptada' }), { code: 'PROPOSAL_PENDING' });
  await assert.rejects(portal.closeCase(q.case_id, { status: 'rejected' }), /motivo/);
  await portal.sendProposal(q.case_id, proposal);
  const server = createApp(engine, { adminPassword: 'equipo-test', assistant: { mode: 'off', provider: null } }).listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/cases/${q.case_id}/close`;
    const body = JSON.stringify({ status: 'accepted', reason: 'Ahorro esperado' });
    assert.equal((await fetch(url, { method: 'POST', headers: {'content-type':'application/json'}, body })).status, 401);
    const r = await fetch(url, { method: 'POST', headers: {'content-type':'application/json','x-admin-password':'equipo-test'}, body });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).state.closed_status, 'accepted');
    assert.equal((await engine.summary()).totals.accepted, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
