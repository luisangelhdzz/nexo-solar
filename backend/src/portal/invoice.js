// Comprobante de compra. Cuando el cliente acepta su propuesta en el portal, el backend lo manda
// solo al correo de su solicitud (por n8n + Gmail); el cliente también puede pedirlo a otro correo.
//
// Importante:
// - El agente de recomendaciones NUNCA envía correos. El comprobante sale porque el propio
//   cliente completó su compra en el portal.
// - Es un comprobante simulado para la demo, no una factura fiscal (CFDI).

import { config } from '../config.js';
import { EMAIL_EVENTS, emailLayout, esc, factsTable, greetingName, moneyMx, portalLink } from './correos.js';

// Se conserva este export para quien ya lo importaba desde aquí.
export { sendToN8n } from './n8n.js';

export function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

export function invoiceNumberFor(caseId) {
  return `NS-C-${String(caseId).replace(/[^A-Za-z0-9]/g, '')}`;
}

export function buildInvoice({ caseId, customer, request = null, pkg, amount, email, issuedAt, publicUrl = config.publicUrl, accessToken = null }) {
  const total = Number(amount);
  const subtotal = Math.round((total / 1.16) * 100) / 100;
  const iva = Math.round((total - subtotal) * 100) / 100;
  const invoiceNumber = invoiceNumberFor(caseId);
  const concept = pkg ? `Sistema solar ${pkg.name} (${pkg.panels} paneles, ${pkg.kw} kW) con instalación` : 'Sistema de paneles solares';
  const date = new Date(issuedAt).toLocaleString('es-MX', { timeZone: 'America/Monterrey', dateStyle: 'long', timeStyle: 'short' });
  const subject = `Comprobante de compra ${invoiceNumber} | Nexo Solar`;
  const name = greetingName({ request, customer });
  const url = portalLink(caseId, publicUrl, accessToken);
  const money = (n) => `${moneyMx(n, { decimals: true })} MXN`;
  const nowrap = (html) => `<span style="white-space:nowrap">${html}</span>`;

  const html = emailLayout({
    preheader: `Folio ${invoiceNumber}. Total ${money(total)}.`,
    kicker: 'Comprobante de compra (simulado para demostración)',
    title: '¡Gracias por tu compra!',
    body: [
      `<p style="margin:0 0 14px;font-size:15px;line-height:1.6">Hola${name ? ` ${esc(name)}` : ''},</p>`,
      '<p style="margin:0 0 14px;font-size:15px;line-height:1.6">Este es tu comprobante de compra. Un asesor te contactará para agendar la visita técnica y la instalación.</p>',
      factsTable([
        ['Folio', `<b>${esc(invoiceNumber)}</b>`],
        ['Fecha', esc(date)],
        ['Cliente', esc(customer?.name || '')],
        ['Cotización', esc(caseId)],
      ]),
      '<hr style="border:0;border-top:1px solid #d3dce4;margin:10px 0 6px">',
      factsTable([
        [concept, nowrap(esc(money(subtotal)))],
        ['IVA (16%)', nowrap(esc(money(iva)))],
        ['Total', nowrap(`<b>${esc(money(total))}</b>`)],
      ]),
    ].join('\n'),
    cta: { url, label: 'Ver mi compra en el portal' },
    note: 'Documento de demostración del hackatón ByeCode. No es una factura fiscal (CFDI) ni implica un cobro real.',
  });

  const text = [
    'Nexo Solar: comprobante de compra (demostración)',
    `Folio: ${invoiceNumber}`,
    `Fecha: ${date}`,
    `Cliente: ${customer?.name || ''}`,
    `Cotización: ${caseId}`,
    `${concept}: ${money(subtotal)}`,
    `IVA (16%): ${money(iva)}`,
    `Total: ${money(total)}`,
    `Ver mi compra: ${url}`,
    'No es una factura fiscal (CFDI).',
  ].join('\n');

  return {
    event: EMAIL_EVENTS.purchase,
    id: `compra:${invoiceNumber}`,
    invoice_number: invoiceNumber,
    email: String(email ?? '').trim(),
    subject,
    html,
    text,
    case_id: caseId,
    customer_id: customer?.customer_id ?? null,
    customer_name: customer?.name ?? null,
    portal_url: url,
    concept,
    subtotal_mxn: subtotal,
    iva_mxn: iva,
    total_mxn: total,
    issued_at: issuedAt,
  };
}
