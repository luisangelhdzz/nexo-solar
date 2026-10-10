// Correos al cliente por n8n: acuse de la solicitud, propuesta y comprobante de compra.
// Usa un servidor HTTP local que simula el webhook de n8n (sin red ni Gmail).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createMemoryStorage } from '../src/storage/memory.js';
import { createPostgresStorage } from '../src/storage/postgres.js';
import { createEngine } from '../src/services/engine.js';
import { createPortal } from '../src/portal/service.js';
import { sendToN8n } from '../src/portal/n8n.js';
import { requestReceivedEmail, proposalEmail } from '../src/portal/correos.js';

const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = 'secreto-de-prueba-123';
const silent = { log() {}, error() {} };
const input = {
  contact_name: 'Ana Prueba', city: 'Saltillo', segment: 'Comercio', email: 'ana@example.com', contact_channel: 'email',
  monthly_bill_mxn: 8000, bill_period: 'bimonthly', roof: 'Azotea de concreto', goal: 'Reducir el gasto de luz de mi tienda.', contact_allowed: true,
};
const proposal = { package_id: 'PKG-COMERCIO-10', title: 'Sistema para mi tienda', amount_mxn: 165000, notes: 'Incluye visita técnica.\nEl techo se confirma en la visita.' };

// `reply(req, todos)`: { status, body } para cada llamada. Por omisión responde 200.
function fakeN8n(reply = () => ({ status: 200, body: { ok: true } })) {
  const received = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const call = { headers: req.headers, url: req.url, body: JSON.parse(raw || '{}') };
      received.push(call);
      const r = reply(call, received);
      res.writeHead(r.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(r.body ?? {}));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    received,
    url: `http://127.0.0.1:${server.address().port}/webhook/nexo-solar-correos`,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  })));
}

async function setup({ n8n, storage = createMemoryStorage() } = {}) {
  await storage.init();
  await storage.reset();
  let now = Date.parse('2026-10-10T15:00:00Z');
  const engine = createEngine({ storage, provider: null, clock: () => now });
  const send = (payload) => sendToN8n(payload, { n8n: { webhookUrl: n8n?.url ?? '', secret: SECRET, timeoutMs: 2000 } });
  const portal = createPortal({ engine, storage, sendEmail: send, retryDelayMs: 10, logger: silent, publicUrl: 'https://nexo-solar.onrender.com' });
  const c = await portal.createCustomer({ name: 'Comercio de prueba' });
  return { storage, engine, portal, cid: c.customer_id, advance: (h) => { now += h * 3600000; } };
}

const events = (n8n) => n8n.received.map((r) => r.body.event);

async function fullFlow(storage) {
  const n8n = await fakeN8n();
  try {
    const { engine, portal, cid, advance } = await setup({ n8n, storage });

    // 1) Solicitud: acuse con el resumen, al correo del formulario y con el secreto en el encabezado.
    const q = await portal.submitRequest(cid, input);
    await portal.idle();
    assert.deepEqual(events(n8n), ['solicitud.recibida']);
    const [ack] = n8n.received;
    assert.equal(ack.headers['x-nexo-secret'], SECRET);
    assert.equal(ack.body.email, 'ana@example.com');
    assert.equal(ack.body.id, `solicitud:${q.case_id}`);
    assert.match(ack.body.subject, new RegExp(q.case_id));
    assert.match(ack.body.html, /Hola Ana Prueba/);
    assert.match(ack.body.html, /Reducir el gasto de luz de mi tienda/);
    assert.match(ack.body.html, /\$8,000 MXN bimestrales/);
    assert.ok(ack.body.portal_url.startsWith(`https://nexo-solar.onrender.com/portal#/cotizacion/${q.case_id}?access=`));
    let view = (await portal.getCustomerView(cid)).quotes[0];
    assert.deepEqual({ status: view.email_copy.status, email: view.email_copy.email }, { status: 'sent', email: 'an***@example.com' });

    // 2) Propuesta publicada: va al correo con título, precio y alcance. Nunca sale dos veces.
    advance(5);
    await portal.sendProposal(q.case_id, proposal);
    await portal.idle();
    assert.deepEqual(events(n8n), ['solicitud.recibida', 'propuesta.enviada']);
    const prop = n8n.received[1].body;
    assert.equal(prop.title, 'Sistema para mi tienda');
    assert.equal(prop.amount_mxn, 165000);
    assert.match(prop.html, /\$165,000 MXN/);
    assert.match(prop.html, /Alcance y condiciones/);
    assert.match(prop.html, /Incluye visita técnica\. El techo se confirma/);
    await assert.rejects(portal.sendProposal(q.case_id, proposal));
    await portal.idle();
    assert.equal(n8n.received.length, 2);

    // La consola ve el registro de ambos correos (con el correo enmascarado).
    const detail = await engine.getCase(q.case_id);
    assert.deepEqual(detail.notifications.map((n) => [n.kind, n.status, n.email]), [
      ['propuesta', 'sent', 'an***@example.com'],
      ['solicitud', 'sent', 'an***@example.com'],
    ]);

    // 3) Compra: el comprobante sale solo al correo de la solicitud, sin que el cliente lo escriba.
    advance(30);
    await portal.decide(cid, q.case_id, 'accepted');
    await portal.idle();
    assert.deepEqual(events(n8n), ['solicitud.recibida', 'propuesta.enviada', 'compra.completada']);
    const buy = n8n.received[2].body;
    assert.equal(buy.email, 'ana@example.com');
    assert.equal(buy.total_mxn, 165000);
    assert.equal(buy.subtotal_mxn + buy.iva_mxn, 165000);
    assert.match(buy.html, /No es una factura fiscal/);
    view = (await portal.getCustomerView(cid)).quotes[0];
    assert.equal(view.invoice.status, 'sent');
    assert.equal(view.invoice.email, 'an***@example.com');

    // Si lo pide a otro correo, también se envía (y espera la respuesta de n8n).
    const again = await portal.requestInvoice(cid, q.case_id, 'compras@example.com');
    assert.equal(again.status, 'sent');
    assert.equal(n8n.received.at(-1).body.email, 'compras@example.com');
  } finally {
    await n8n.close();
    await storage.close();
  }
}

test('Solicitud → propuesta → compra: tres correos por n8n, en orden y sin duplicados', () => fullFlow(createMemoryStorage()));

test('Mismo flujo con PostgreSQL', { skip: !process.env.TEST_DATABASE_URL && 'define TEST_DATABASE_URL para probar PostgreSQL' }, () => fullFlow(createPostgresStorage(process.env.TEST_DATABASE_URL)));

test('El acuse respeta R2 y R3, y sin correo no se intenta', async () => {
  const n8n = await fakeN8n();
  try {
    const { portal, engine, cid } = await setup({ n8n });
    const noContact = await portal.submitRequest(cid, { ...input, contact_allowed: false });
    const later = await portal.submitRequest(cid, { ...input, contact_not_before: '2026-10-20T15:00:00Z' });
    const whatsapp = await portal.submitRequest(cid, { ...input, email: '', contact_channel: 'whatsapp', phone: '844 123 4567' });
    await portal.idle();
    assert.equal(n8n.received.length, 0);
    const why = async (id) => (await engine.getCase(id)).notifications[0];
    assert.equal((await why(noContact.case_id)).status, 'skipped');
    assert.match((await why(noContact.case_id)).error, /^R2/);
    assert.match((await why(later.case_id)).error, /^R3/);
    assert.match((await why(whatsapp.case_id)).error, /no dejó correo/);
    // Al cliente no se le muestran motivos internos ni un correo que no existe.
    const quotes = (await portal.getCustomerView(cid)).quotes;
    assert.equal(quotes.find((x) => x.case_id === whatsapp.case_id).email_copy, null);
    assert.equal(quotes.find((x) => x.case_id === noContact.case_id).email_copy.status, 'skipped');
  } finally {
    await n8n.close();
  }
});

test('Un mismo correo recibe como máximo 3 acuses por hora (el portal es público)', async () => {
  const n8n = await fakeN8n();
  try {
    const { portal, engine, cid } = await setup({ n8n });
    const ids = [];
    for (let i = 0; i < 4; i += 1) ids.push((await portal.submitRequest(cid, { ...input, email: i % 2 ? 'ANA@example.com' : 'ana@example.com' })).case_id);
    await portal.idle();
    assert.equal(n8n.received.length, 3);
    const last = (await engine.getCase(ids[3])).notifications[0];
    assert.equal(last.status, 'skipped');
    assert.match(last.error, /Límite de 3 acuses/);
  } finally {
    await n8n.close();
  }
});

test('Compra con contacto prohibido: el comprobante no sale solo, pero el cliente puede pedirlo', async () => {
  const n8n = await fakeN8n();
  try {
    const { portal, cid, advance } = await setup({ n8n });
    const q = await portal.submitRequest(cid, input);
    advance(5);
    await portal.sendProposal(q.case_id, proposal);
    await portal.setContactPreference(cid, q.case_id, { kind: 'no_contact' });
    advance(1);
    const closed = await portal.decide(cid, q.case_id, 'accepted');
    await portal.idle();
    assert.equal(closed.invoice.status, 'skipped');
    assert.deepEqual(events(n8n), ['solicitud.recibida', 'propuesta.enviada']);
    // Pedirlo en el portal es una solicitud explícita del cliente: sí se envía.
    const r = await portal.requestInvoice(cid, q.case_id, 'ana@example.com');
    assert.equal(r.status, 'sent');
    assert.deepEqual(events(n8n), ['solicitud.recibida', 'propuesta.enviada', 'compra.completada']);
  } finally {
    await n8n.close();
  }
});

test('Si n8n falla, reintenta una vez, lo registra y el cliente no se entera', async () => {
  const n8n = await fakeN8n(() => ({ status: 500, body: { message: 'Error in workflow' } }));
  try {
    const { portal, engine, cid } = await setup({ n8n });
    const q = await portal.submitRequest(cid, input);
    assert.equal(q.proposal_pending, true);
    await portal.idle();
    assert.equal(n8n.received.length, 2);
    const [row] = (await engine.getCase(q.case_id)).notifications;
    assert.equal(row.status, 'failed');
    assert.equal(row.attempts, 2);
    assert.match(row.error, /Executions/);
  } finally {
    await n8n.close();
  }
});

test('Secreto incorrecto (401): no reintenta y dice qué revisar', async () => {
  const n8n = await fakeN8n(() => ({ status: 401, body: { message: 'Authorization data is wrong!' } }));
  try {
    const { portal, engine, cid } = await setup({ n8n });
    const q = await portal.submitRequest(cid, input);
    await portal.idle();
    assert.equal(n8n.received.length, 1);
    const [row] = (await engine.getCase(q.case_id)).notifications;
    assert.equal(row.status, 'failed');
    assert.match(row.error, /N8N_WEBHOOK_SECRET/);
  } finally {
    await n8n.close();
  }
});

test('Sin N8N_WEBHOOK_URL no se intenta enviar y queda registrado', async () => {
  const { portal, engine, cid } = await setup({ n8n: null });
  const q = await portal.submitRequest(cid, input);
  await portal.idle();
  const [row] = (await engine.getCase(q.case_id)).notifications;
  assert.equal(row.status, 'not_configured');
  assert.equal((await engine.getCase(q.case_id)).email_delivery.configured, false);
});

test('Si falla el registro de correos, la solicitud y la compra siguen funcionando', async () => {
  const storage = createMemoryStorage();
  storage.saveNotification = async () => { throw new Error('base de datos caída'); };
  storage.saveInvoice = async () => { throw new Error('base de datos caída'); };
  const n8n = await fakeN8n();
  try {
    const { portal, cid, advance } = await setup({ n8n, storage });
    const q = await portal.submitRequest(cid, input);
    assert.equal(q.proposal_pending, true);
    advance(5);
    await portal.sendProposal(q.case_id, proposal);
    advance(1);
    const closed = await portal.decide(cid, q.case_id, 'accepted');
    assert.equal(closed.closed_status, 'accepted');
    await portal.idle();
    assert.equal(n8n.received.length, 0);
  } finally {
    await n8n.close();
  }
});

test('Lo que escribe el cliente o el equipo se escapa en el HTML', () => {
  const evil = '<script>alert(1)</script> & "comillas"';
  const a = requestReceivedEmail({ caseId: 'NS-REQ-X', customer: { name: evil }, request: { ...input, goal: evil, contact_name: evil }, to: 'a@b.mx', publicUrl: 'https://x.test' });
  const b = proposalEmail({ caseId: 'NS-REQ-X', customer: { name: 'C' }, request: input, proposal: { title: evil, notes: evil }, pkg: null, amount: 1000, to: 'a@b.mx', publicUrl: 'https://x.test' });
  for (const html of [a.html, b.html]) {
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;comillas&quot;/);
  }
});

test('npm test nunca usa el n8n ni la IA de tu backend/.env', () => {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', "import('./src/config.js').then(({ config }) => console.log(JSON.stringify({ url: config.n8n.webhookUrl, ai: config.ai.provider })))"], {
    cwd: BACKEND,
    env: { ...process.env, NODE_TEST_CONTEXT: 'child', N8N_WEBHOOK_URL: 'https://n8n.example.invalid/webhook/x', AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'no-se-usa' },
  }).toString();
  assert.deepEqual(JSON.parse(out), { url: '', ai: 'heuristic' });
});
