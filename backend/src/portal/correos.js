// Correos al cliente. El backend arma cada correo completo y n8n solo lo entrega (ver n8n.js).
//
//   solicitud.recibida  el cliente pidió una cotización en el portal (acuse con el resumen)
//   propuesta.enviada   el equipo publicó la propuesta (título, paquete, precio y alcance)
//   compra.completada   el cliente aceptó la propuesta (comprobante de compra; ver invoice.js)
//
// Solo se incluye lo que el cliente escribió o lo que el equipo publicó: ninguna condición
// comercial inventada. Todo texto del cliente o del equipo se escapa antes de ir al HTML.

import { config } from '../config.js';

export const EMAIL_EVENTS = {
  request: 'solicitud.recibida',
  proposal: 'propuesta.enviada',
  purchase: 'compra.completada',
  test: 'prueba',
};

const CHANNEL_ES = { email: 'Correo electrónico', whatsapp: 'WhatsApp', phone: 'Llamada' };

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escLines = (s) => esc(s).replace(/\r?\n/g, '<br>');

export function moneyMx(n, { decimals = false } = {}) {
  const value = Number(n);
  return `$${value.toLocaleString('es-MX', decimals ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 2 })}`;
}

export function portalLink(caseId, base = config.publicUrl, accessToken = null) {
  return `${String(base || '').replace(/\/+$/, '')}/portal#/cotizacion/${encodeURIComponent(caseId)}${accessToken ? `?access=${encodeURIComponent(accessToken)}` : ''}`;
}

export function greetingName({ request, customer } = {}) {
  return request?.contact_name || customer?.contact_name || customer?.name || '';
}

// ---------- Piezas del diseño (tablas y estilos en línea: así se ven bien en Gmail y Outlook) ----------

export function factsTable(rows) {
  const tr = rows
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([label, value]) => `<tr><td style="padding:7px 0;color:#5b6b7d;font-size:14px;vertical-align:top">${esc(label)}</td><td align="right" style="padding:7px 0 7px 16px;font-size:14px;color:#17222e;vertical-align:top">${value}</td></tr>`)
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 8px">${tr}</table>`;
}

function button(url, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 6px"><tr><td style="border-radius:999px;background:#1570cc">
<a href="${esc(url)}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:999px">${esc(label)}</a>
</td></tr></table>`;
}

export function emailLayout({ preheader = '', kicker = '', title, body, cta = null, note = '' }) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#edf1f4;font-family:Arial,Helvetica,sans-serif;color:#17222e">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#edf1f4;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#1e4567;padding:22px 28px;border-bottom:4px solid #f0b02c">
<div style="font-size:20px;font-weight:bold;color:#ffffff;letter-spacing:.3px">Nexo Solar</div>
${kicker ? `<div style="font-size:13px;color:#d5e2ee;margin-top:4px">${esc(kicker)}</div>` : ''}
</td></tr>
<tr><td style="padding:28px 28px 8px">
<h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:#13304d">${esc(title)}</h1>
${body}
${cta ? button(cta.url, cta.label) : ''}
${note ? `<p style="margin:18px 0 0;font-size:13px;line-height:1.5;color:#5b6b7d">${note}</p>` : ''}
</td></tr>
<tr><td style="padding:20px 28px 26px">
<hr style="border:0;border-top:1px solid #d3dce4;margin:0 0 14px">
<p style="margin:0;font-size:12px;line-height:1.5;color:#75838f">Recibes este correo por tu cotización en el portal de Nexo Solar. Si prefieres que no te contactemos, indícalo en tu portal.<br>Correo de demostración del hackatón ByeCode.</p>
</td></tr>
</table></td></tr></table></body></html>`;
}

const p = (html) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6">${html}</p>`;
const subhead = (text) => `<h2 style="margin:22px 0 6px;font-size:15px;color:#13304d">${esc(text)}</h2>`;
const quoteBlock = (text) => `<div style="margin:0 0 6px;padding:12px 14px;background:#f4f7fa;border-left:4px solid #f0b02c;border-radius:6px;font-size:14px;line-height:1.55;color:#17222e">${escLines(text)}</div>`;

function billText(request) {
  if (!request?.bill_amount_mxn) return 'Por confirmar';
  return `${moneyMx(request.bill_amount_mxn)} MXN ${request.bill_period === 'bimonthly' ? 'bimestrales' : 'mensuales'}`;
}

function base({ event, id, to, subject, html, text, caseId, customer, portalUrl, extra = {} }) {
  return {
    event,
    id,
    email: String(to ?? '').trim(),
    subject,
    html,
    text,
    case_id: caseId,
    customer_id: customer?.customer_id ?? null,
    customer_name: customer?.name ?? null,
    portal_url: portalUrl,
    ...extra,
  };
}

// ---------- 1. Solicitud recibida ----------
export function requestReceivedEmail({ caseId, customer, request, to, publicUrl = config.publicUrl, accessToken = null }) {
  const name = greetingName({ request, customer });
  const url = portalLink(caseId, publicUrl, accessToken);
  const subject = `Recibimos tu solicitud de cotización · ${caseId} | Nexo Solar`;
  const facts = [
    ['Folio', `<b>${esc(caseId)}</b>`],
    ['Empresa', esc(customer?.name)],
    ['Ciudad', esc(request?.city)],
    ['Tipo de negocio', esc(request?.segment)],
    ['Recibo de luz', esc(billText(request))],
    ['Espacio para instalar', esc(request?.roof)],
    ['Medio de contacto', esc(CHANNEL_ES[request?.contact_channel] ?? '')],
  ];
  const html = emailLayout({
    preheader: `Folio ${caseId}. Te avisaremos cuando tu propuesta esté lista.`,
    kicker: 'Solicitud de cotización',
    title: 'Recibimos tu solicitud',
    body: [
      p(`Hola${name ? ` ${esc(name)}` : ''},`),
      p('Gracias por pedir tu cotización. Vamos a revisar tu proyecto para preparar una propuesta a la medida. Te avisaremos cuando esté lista y también podrás verla en tu portal.'),
      subhead('Resumen de tu solicitud'),
      factsTable(facts),
      request?.goal ? subhead('Lo que nos pediste') + quoteBlock(request.goal) : '',
    ].join('\n'),
    cta: { url, label: 'Ver mi solicitud' },
    note: 'Esta solicitud no confirma una compra ni fija un precio.',
  });
  const text = [
    `Hola${name ? ` ${name}` : ''},`,
    '',
    'Recibimos tu solicitud de cotización en Nexo Solar. Te avisaremos cuando tu propuesta esté lista.',
    '',
    `Folio: ${caseId}`,
    `Empresa: ${customer?.name ?? ''}`,
    `Ciudad: ${request?.city ?? ''}`,
    `Recibo de luz: ${billText(request)}`,
    `Espacio para instalar: ${request?.roof ?? ''}`,
    request?.goal ? `Lo que nos pediste: ${request.goal}` : '',
    '',
    `Ver mi solicitud: ${url}`,
    '',
    'Esta solicitud no confirma una compra ni fija un precio.',
    'Correo de demostración del hackatón ByeCode.',
  ].filter((l) => l !== null).join('\n');
  return base({ event: EMAIL_EVENTS.request, id: `solicitud:${caseId}`, to, subject, html, text, caseId, customer, portalUrl: url });
}

// ---------- 2. Propuesta enviada ----------
export function proposalEmail({ caseId, customer, request, proposal, pkg, amount, to, publicUrl = config.publicUrl, accessToken = null }) {
  const name = greetingName({ request, customer });
  const url = portalLink(caseId, publicUrl, accessToken);
  const title = proposal?.title || pkg?.name || 'Tu propuesta solar';
  const subject = `Tu propuesta de Nexo Solar está lista · ${caseId}`;
  const facts = [
    ['Propuesta', `<b>${esc(title)}</b>`],
    ['Solución', pkg ? esc(`${pkg.name} (${pkg.panels} paneles, ${pkg.kw} kW)`) : ''],
    ['Precio total', `<span style="white-space:nowrap"><b>${esc(moneyMx(amount))} MXN</b> <span style="color:#5b6b7d">con IVA</span></span>`],
    ['Folio', esc(caseId)],
  ];
  const html = emailLayout({
    preheader: `${title}: ${moneyMx(amount)} MXN con IVA. Revísala con calma en tu portal.`,
    kicker: 'Tu propuesta',
    title: 'Tu propuesta está lista',
    body: [
      p(`Hola${name ? ` ${esc(name)}` : ''},`),
      p(`Ya preparamos la propuesta para ${esc(customer?.name || 'tu negocio')}. Estos son los datos principales:`),
      factsTable(facts),
      proposal?.notes ? subhead('Alcance y condiciones') + quoteBlock(proposal.notes) : '',
      p('<span style="color:#5b6b7d">En tu portal puedes revisar cada sección, escribirnos tus dudas y decidir cuando estés listo. No hay prisa.</span>'),
    ].join('\n'),
    cta: { url, label: 'Revisar mi propuesta' },
  });
  const text = [
    `Hola${name ? ` ${name}` : ''},`,
    '',
    `Tu propuesta de Nexo Solar está lista: ${title}.`,
    pkg ? `Solución: ${pkg.name} (${pkg.panels} paneles, ${pkg.kw} kW)` : '',
    `Precio total: ${moneyMx(amount)} MXN con IVA`,
    `Folio: ${caseId}`,
    proposal?.notes ? `Alcance y condiciones: ${proposal.notes}` : '',
    '',
    `Revisar mi propuesta: ${url}`,
    '',
    'Correo de demostración del hackatón ByeCode.',
  ].join('\n');
  return base({
    event: EMAIL_EVENTS.proposal,
    id: `propuesta:${caseId}`,
    to, subject, html, text, caseId, customer,
    portalUrl: url,
    extra: { title, amount_mxn: Number(amount), package_id: pkg?.package_id ?? null },
  });
}

// ---------- Correo de prueba (npm run n8n:check) ----------
export function testEmail({ to, publicUrl = config.publicUrl }) {
  const subject = 'Prueba de Nexo Solar: n8n está conectado';
  const html = emailLayout({
    preheader: 'Si ves este correo, el backend, n8n y Gmail ya están conectados.',
    kicker: 'Prueba de configuración',
    title: 'n8n está conectado',
    body: p('Si ves este correo, el backend de Nexo Solar ya puede mandar a tus clientes la confirmación de su solicitud, su propuesta y su comprobante de compra.'),
    cta: { url: `${String(publicUrl).replace(/\/+$/, '')}/portal`, label: 'Abrir el portal' },
  });
  const text = 'Si ves este correo, el backend de Nexo Solar, n8n y Gmail ya están conectados.';
  return { event: EMAIL_EVENTS.test, id: `prueba:${Date.now()}`, email: String(to).trim(), subject, html, text, case_id: null, customer_id: null, customer_name: null, portal_url: `${publicUrl}/portal` };
}
