// Ciclo autónomo del asistente (paso 5): borradores en segundo plano, envío automático seguro y API.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStorage } from '../src/storage/memory.js';
import { createEngine } from '../src/services/engine.js';
import { createApp } from '../src/app.js';
import { fakeProvider, setup, REQUEST, PROPOSAL } from './assistant-helpers.js';

const assistantEvents = async (t) => (await t.storage.getCaseEvents(t.caseId)).filter((e) => e.event_type === 'action.executed' && e.data.author === 'asistente');

test('Modo borrador: un mensaje nuevo deja una propuesta lista y no envía nada', async () => {
  const t = await setup({ mode: 'draft' });
  t.assistant.start({ timers: false });
  await t.say('¿El precio incluye la instalación?');
  await t.assistant.idle();
  const { run, current, expecting } = await t.assistant.latest(t.caseId);
  assert.equal(current, true);
  assert.equal(expecting, false);
  assert.equal(run.origin, 'mensaje');
  assert.equal(run.status, 'draft');
  assert.equal((await assistantEvents(t)).length, 0);
  // Una segunda revisión del mismo estado no vuelve a llamar a la IA.
  const calls = t.provider.calls.length;
  await t.assistant.sweep();
  assert.equal(t.provider.calls.length, calls);
  // Si el cliente vuelve a escribir, la consola sabe que viene una propuesta nueva.
  t.advance(1);
  t.assistant.stop();
  await t.say('¿Y la garantía?');
  const after = await t.assistant.latest(t.caseId);
  assert.equal(after.current, false);
  assert.equal(after.expecting, false); // detenido: no hay trabajo en segundo plano
});

test('Modo automático: envía una sola vez lo que pasa todas las validaciones', async () => {
  const t = await setup({ mode: 'auto' });
  t.assistant.start({ timers: false });
  await t.say('¿El precio incluye la instalación?');
  await t.assistant.idle();
  const { run, current, expecting } = await t.assistant.latest(t.caseId);
  assert.equal(run.status, 'sent');
  // El mensaje enviado no cuenta como "cambio": la propuesta sigue vigente y no se espera otra.
  assert.equal(current, true);
  assert.equal(expecting, false);
  const sent = await assistantEvents(t);
  assert.equal(sent.length, 1);
  assert.match(sent[0].data.message, /^Hola, Ana\. Sí: el precio/);
  const view = (await t.portal.getCustomerView(t.cid)).quotes[0];
  assert.equal(view.conversation.at(-1).from, 'team');
  // Revisiones posteriores no duplican el mensaje (R4 y el identificador fijo lo impiden).
  await t.assistant.sweep();
  t.advance(1);
  await t.assistant.sweep();
  assert.equal((await assistantEvents(t)).length, 1);
});

test('Modo automático: si hace falta revisión humana, no se envía', async () => {
  const t = await setup({ mode: 'auto' });
  t.assistant.start({ timers: false });
  await t.say('Si me hacen 20% de descuento firmo hoy.');
  await t.assistant.idle();
  const { run } = await t.assistant.latest(t.caseId);
  assert.equal(run.status, 'needs_review');
  assert.equal((await assistantEvents(t)).length, 0);
});

test('Modo automático sin IA: la plantilla queda como borrador, nunca se envía sola', async () => {
  const t = await setup({ mode: 'auto', provider: null });
  t.assistant.start({ timers: false });
  await t.say('¿El precio incluye la instalación?');
  await t.assistant.idle();
  const { run } = await t.assistant.latest(t.caseId);
  assert.equal(run.source, 'plantilla');
  assert.equal(run.status, 'draft');
  assert.equal((await assistantEvents(t)).length, 0);
});

test('Si el cliente pide esperar, se programa la revisión sin gastar una llamada a la IA', async () => {
  const t = await setup({ mode: 'draft' });
  t.assistant.start({ timers: false });
  await t.say('No me contacten antes del 20 de octubre de 2026.');
  await t.assistant.idle();
  const { run } = await t.assistant.latest(t.caseId);
  assert.equal(run.status, 'scheduled');
  assert.equal(run.result.next_review_at, '2026-10-20T15:00:00Z');
  assert.equal(t.provider.calls.length, 0);
});

test('Una solicitud nueva sin recibo de luz prepara el borrador para pedir el dato', async () => {
  const t = await setup({ mode: 'draft', provider: null, sendProposal: false, request: { ...REQUEST, monthly_bill_mxn: '' } });
  // La solicitud se creó antes de start(): se pide manualmente, como el botón de la consola.
  const run = await t.assistant.runForCase(t.caseId);
  assert.equal(run.validation.authorized.action, 'request_information');
  assert.match(run.validation.draft.text_for_client, /recibo de luz/);
  assert.equal(run.status, 'draft');
});

test('API: la propuesta del asistente pide contraseña y el envío guarda la corrección del equipo', async () => {
  const storage = createMemoryStorage();
  let now = Date.parse('2026-10-10T15:00:00Z');
  const engine = createEngine({ storage, provider: null, clock: () => now });
  const provider = fakeProvider();
  const app = createApp(engine, { adminPassword: 'equipo', assistant: { provider, mode: 'off', logger: { log() {}, error() {} } } });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = (method, path, body, pass = 'equipo') => fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(pass ? { 'x-admin-password': pass } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  try {
    const customer = await (await call('POST', '/portal/customers', { name: 'Taller Prueba', contact_name: 'Luis Pérez' }, null)).json();
    const asCustomer = { 'content-type': 'application/json', 'x-portal-access': customer.access_token };
    const q = await (await fetch(`${base}/portal/requests`, { method: 'POST', headers: asCustomer, body: JSON.stringify({ ...REQUEST, contact_name: 'Luis Pérez' }) })).json();
    now += 3600000;
    assert.equal((await call('POST', `/cases/${q.case_id}/proposal`, PROPOSAL)).status, 200);
    now += 3600000;
    await fetch(`${base}/portal/quotes/${q.case_id}/messages`, { method: 'POST', headers: asCustomer, body: JSON.stringify({ message: '¿El precio incluye la instalación?' }) });

    assert.equal((await call('POST', `/cases/${q.case_id}/assistant`, {}, null)).status, 401);
    const run = await (await call('POST', `/cases/${q.case_id}/assistant`, {})).json();
    assert.equal(run.status, 'draft');
    assert.match(run.validation.draft.text_for_client, /^Hola, Luis\./);
    const latest = await (await call('GET', `/cases/${q.case_id}/assistant`)).json();
    assert.equal(latest.current, true);
    assert.equal(latest.run.id, run.id);

    const edited = `${run.validation.draft.text_for_client} Te esperamos.`;
    assert.equal((await call('POST', `/cases/${q.case_id}/reply`, { message: edited, action: 'resolve_objection', assistant_run_id: run.id })).status, 200);
    const status = await (await call('GET', '/assistant/status')).json();
    assert.equal(status.corrections.edited, 1);
    assert.equal(status.examples >= 4, true);
    assert.equal(status.autopilot.mode, 'off');
    assert.match(status.corrections.recent[0].final_message, /^Hola, \{nombre\}\./);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
