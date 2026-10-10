import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createMemoryStorage } from '../src/storage/memory.js';
import { createEngine } from '../src/services/engine.js';
import { createApp } from '../src/app.js';

test('Enlace del correo: acceso directo, sin directorio ni acceso a otro folio', async () => {
  const storage = createMemoryStorage();
  const engine = createEngine({ storage, provider: null });
  const emails = [];
  const app = createApp(engine, { adminPassword: 'equipo', sendEmail: async payload => { emails.push(payload); return { status: 'sent' }; }, assistant: { mode: 'off', provider: null } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = (path, { token, method = 'GET', body, headers = {} } = {}) => fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { 'x-portal-access': token } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    assert.equal((await call('/portal/customers')).status, 403);
    const customer = await (await call('/portal/customers', { method: 'POST', body: { name: 'Negocio de prueba', contact_name: 'Ana' } })).json();
    assert.ok(customer.access_token);
    const body = { contact_name: 'Ana', city: 'Saltillo', email: 'ana@example.com', contact_channel: 'email', goal: 'Reducir gasto', bill_period: 'bimonthly', contact_allowed: true };
    const first = await (await call('/portal/requests', { method: 'POST', token: customer.access_token, body })).json();
    const second = await (await call('/portal/requests', { method: 'POST', token: customer.access_token, body })).json();
    assert.ok(first.case_id, JSON.stringify(first));
    assert.ok(second.case_id, JSON.stringify(second));
    await app.locals.portal.idle();
    const url = new URL(emails[0].portal_url, 'https://example.com');
    assert.ok(url.hash.startsWith(`#/cotizacion/${first.case_id}?access=`));
    const token = new URLSearchParams(url.hash.split('?')[1]).get('access');
    assert.ok(token);
    const view = await (await call('/portal/me', { token })).json();
    assert.equal(view.access_case_id, first.case_id);
    assert.deepEqual(view.quotes.map(q => q.case_id), [first.case_id]);
    assert.equal((await call('/portal/me', { headers: { 'x-customer-id': customer.customer_id } })).status, 401);
    assert.equal((await call(`/portal/quotes/${second.case_id}/messages`, { token, method: 'POST', body: { message: 'No debo acceder' } })).status, 403);
    assert.equal((await call(`/portal/quotes/${first.case_id}/messages`, { token, method: 'POST', body: { message: '¿Qué recibo necesitan?' } })).status, 200);
    assert.equal((await call('/portal/requests', { token, method: 'POST', body })).status, 403);
    assert.equal((await call('/portal/me', { token: 'x'.repeat(43) })).status, 401);
    assert.equal((await call(`/cases/${first.case_id}/portal-link`, { method: 'POST', body: {} })).status, 401);
    const link = await (await call(`/cases/${first.case_id}/portal-link`, { method: 'POST', body: {}, headers: { 'x-admin-password': 'equipo' } })).json();
    assert.ok(link.url.includes('?access='));
    // El mismo respaldo de almacenamiento conserva el acceso al recrear el servicio.
    assert.equal((await app.locals.portal.resolveAccess(token)).case_id, first.case_id);
    const key = `portal_access:${createHash('sha256').update(token).digest('hex')}`;
    await storage.setSettings({ [key]: { customer_id: customer.customer_id, case_id: first.case_id, expires_at: 0 } });
    assert.equal((await call('/portal/me', { token })).status, 401);
    assert.equal((await storage.getCaseEvents(second.case_id)).filter(e => e.event_type === 'message.received').length, 0);
  } finally { await app.locals.portal.idle(); await new Promise(resolve => server.close(resolve)); }
});
