// Envío del comprobante a un webhook de n8n (servidor HTTP local que simula n8n).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { config } from '../src/config.js';
import { buildInvoice, sendToN8n, isValidEmail } from '../src/portal/invoice.js';

function fakeN8n(status = 200) {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      received.push({ headers: req.headers, body: JSON.parse(body) });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: status < 300 }));
    });
  });
  return new Promise((resolve) => server.listen(0, () => resolve({ server, received, url: `http://127.0.0.1:${server.address().port}/webhook/nexo-solar-comprobante` })));
}

const invoice = buildInvoice({
  caseId: 'NS-1016',
  customer: { customer_id: 'CUS-001', name: 'Abarrotes La Esperanza', contact_name: 'Rosa Elena Garza' },
  pkg: { name: 'Comercio 10 kW', panels: 18, kw: 10 },
  amount: 150000,
  email: ' equipo@ejemplo.com ',
  issuedAt: '2026-10-12T18:00:00Z',
});

test('El comprobante desglosa el IVA y aclara que no es CFDI', () => {
  assert.equal(invoice.email, 'equipo@ejemplo.com');
  assert.equal(invoice.subtotal_mxn + invoice.iva_mxn, 150000);
  assert.equal(invoice.invoice_number, 'NS-C-NS1016');
  assert.match(invoice.html, /No es una factura fiscal/);
  assert.match(invoice.html, /Rosa Elena Garza/);
});

test('Validación de correo', () => {
  assert.equal(isValidEmail('a@b.mx'), true);
  assert.equal(isValidEmail('sin-arroba'), false);
  assert.equal(isValidEmail('a@b'), false);
});

test('Envía a n8n con el secreto y el comprobante completo', async () => {
  const n8n = await fakeN8n(200);
  const prev = { ...config.n8n };
  Object.assign(config.n8n, { webhookUrl: n8n.url, secret: 's3cr3to' });
  try {
    const r = await sendToN8n(invoice);
    assert.equal(r.status, 'sent');
    assert.equal(n8n.received.length, 1);
    assert.equal(n8n.received[0].headers['x-nexo-secret'], 's3cr3to');
    assert.equal(n8n.received[0].body.email, 'equipo@ejemplo.com');
    assert.match(n8n.received[0].body.html, /Comprobante de compra/);
  } finally {
    Object.assign(config.n8n, prev);
    n8n.server.close();
  }
});

test('Si n8n falla, se reporta sin romper la compra', async () => {
  const n8n = await fakeN8n(500);
  const prev = { ...config.n8n };
  Object.assign(config.n8n, { webhookUrl: n8n.url, secret: '' });
  try {
    const r = await sendToN8n(invoice);
    assert.equal(r.status, 'failed');
    assert.match(r.error, /500/);
  } finally {
    Object.assign(config.n8n, prev);
    n8n.server.close();
  }
});

test('Sin N8N_WEBHOOK_URL no se intenta enviar', async () => {
  const prev = { ...config.n8n };
  Object.assign(config.n8n, { webhookUrl: '' });
  try {
    assert.equal((await sendToN8n(invoice)).status, 'not_configured');
  } finally {
    Object.assign(config.n8n, prev);
  }
});
