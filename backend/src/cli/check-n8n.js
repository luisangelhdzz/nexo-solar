// npm run n8n:check -- tucorreo@ejemplo.com [--todos]
//
// Comprueba la conexión con n8n SIN mostrar el secreto:
//   1. Qué leyó de backend/.env (N8N_WEBHOOK_URL, N8N_WEBHOOK_SECRET, PUBLIC_URL)
//   2. Manda un correo de prueba a la dirección que indiques
//   3. Con --todos, manda también los tres correos reales con datos ficticios
//      (solicitud recibida, propuesta lista y comprobante) para que veas cómo llegan.
//
// No toca tu base de datos ni le escribe a ningún cliente: solo a la dirección que escribes.

import { config } from '../config.js';
import { sendToN8n } from '../portal/n8n.js';
import { proposalEmail, requestReceivedEmail, testEmail } from '../portal/correos.js';
import { buildInvoice, isValidEmail } from '../portal/invoice.js';
import { findPackage } from '../portal/catalog.js';

const ok = (t) => console.log(`  ✔ ${t}`);
const bad = (t) => console.log(`  ✖ ${t}`);
const info = (t) => console.log(`    ${t}`);
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;

function describeUrl(raw) {
  try {
    const u = new URL(raw);
    return { host: u.host, path: u.pathname, test: u.pathname.includes('/webhook-test/'), local: ['localhost', '127.0.0.1'].includes(u.hostname) };
  } catch {
    return null;
  }
}

function hint(error = '') {
  if (/secreto|401|403/.test(error)) info('→ En n8n abre el nodo Webhook → credencial Header Auth: Name = x-nexo-secret y Value = el mismo texto que N8N_WEBHOOK_SECRET.');
  else if (/404/.test(error)) info('→ Activa (publica) el flujo en n8n y copia la Production URL del nodo Webhook en N8N_WEBHOOK_URL.');
  else if (/Executions|500/.test(error)) info('→ En n8n abre Executions, entra a la ejecución fallida y revisa el nodo "Enviar por Gmail" o "Enviar por SMTP" (casi siempre falta conectar la cuenta o la contraseña de aplicación).');
  else if (/conectar|ENOTFOUND|ECONNREFUSED/.test(error)) info('→ Revisa que la URL sea correcta y que n8n esté encendido y accesible desde esta computadora.');
  else if (/no respondió/.test(error)) info('→ n8n tardó demasiado. Reintenta; si se repite, revisa Executions en n8n.');
}

const SAMPLE = {
  caseId: 'NS-REQ-PRUEBA0001',
  customer: { customer_id: 'CUS-PRUEBA', name: 'Ferretería de Prueba', contact_name: 'Cliente de prueba' },
  request: {
    contact_name: 'Cliente de prueba', city: 'Saltillo, Coahuila', segment: 'Comercio', contact_channel: 'email',
    bill_amount_mxn: 7000, bill_period: 'bimonthly', roof: 'Azotea de concreto',
    goal: 'Quiero reducir el gasto de luz de mi negocio. (Correo de prueba enviado con npm run n8n:check)',
  },
};

async function send(label, payload) {
  const started = Date.now();
  const r = await sendToN8n(payload);
  if (r.status === 'sent') ok(`${label}: n8n lo aceptó en ${secs(Date.now() - started)}.`);
  else {
    bad(`${label}: ${r.error}`);
    hint(r.error);
  }
  return r.status === 'sent';
}

async function main() {
  const args = process.argv.slice(2);
  const to = args.find((a) => !a.startsWith('--'));
  const all = args.includes('--todos');
  console.log('Nexo Solar · prueba de correos con n8n (el secreto nunca se muestra)\n');

  console.log('1) Configuración leída de backend/.env');
  const url = describeUrl(config.n8n.webhookUrl);
  if (!config.n8n.webhookUrl) {
    bad('Falta N8N_WEBHOOK_URL. Pega ahí la Production URL del nodo Webhook de n8n (ver n8n/README.md).');
    process.exitCode = 1;
    return;
  }
  if (!url) {
    bad('N8N_WEBHOOK_URL no es una URL válida.');
    process.exitCode = 1;
    return;
  }
  ok(`Webhook: ${url.host}${url.path}`);
  if (url.test) info('Es la URL de PRUEBA (/webhook-test/): solo funciona mientras n8n está "escuchando". Para la app usa la Production URL (/webhook/...).');
  if (config.n8n.secret) ok(`N8N_WEBHOOK_SECRET: configurado (${config.n8n.secret.length} caracteres; no se muestra)`);
  else bad('Falta N8N_WEBHOOK_SECRET. Sin secreto, cualquiera que conozca la URL podría mandar correos con tu cuenta.');
  info(`Enlaces de los correos: ${config.publicUrl}/portal`);
  if (url.local && config.publicUrl.includes('onrender.com')) info('Ojo: el backend en Render no puede llamar a un n8n en localhost. Usa un n8n accesible desde internet.');

  if (!to || !isValidEmail(to)) {
    console.log('\n2) Para mandar un correo de prueba escribe tu correo:');
    info('npm run n8n:check -- tucorreo@gmail.com');
    info('npm run n8n:check -- tucorreo@gmail.com --todos   (además manda los 3 correos de ejemplo)');
    return;
  }

  console.log(`\n2) Correo de prueba a ${to}`);
  const first = await send('Prueba', testEmail({ to }));
  if (!first) {
    process.exitCode = 1;
    return;
  }

  if (all) {
    console.log('\n3) Los tres correos que recibe un cliente (con datos ficticios)');
    const pkg = findPackage('PKG-COMERCIO-10');
    await send('Solicitud recibida', requestReceivedEmail({ ...SAMPLE, to }));
    await send('Propuesta lista', proposalEmail({
      ...SAMPLE, to, pkg, amount: 158000,
      proposal: { title: 'Sistema solar para Ferretería de Prueba', notes: 'Ejemplo de alcance: la visita técnica confirma el estado de la azotea antes de instalar.' },
    }));
    await send('Comprobante de compra', buildInvoice({ ...SAMPLE, pkg, amount: 158000, email: to, issuedAt: new Date().toISOString() }));
  }
  console.log(`\nListo. Revisa la bandeja de ${to} (y la carpeta de spam la primera vez).`);
}

main().catch((err) => {
  console.error(`\nError inesperado: ${err.message}`);
  process.exitCode = 1;
});
