// Comprobante de compra y envío a n8n (que lo manda por Gmail).
//
// Importante:
// - El agente de recomendaciones NUNCA envía correos. Este envío lo dispara el propio cliente
//   al completar su compra en el portal y escribir su correo.
// - Es un comprobante simulado para la demo, no una factura fiscal (CFDI).

import { config } from '../config.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`;

export function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

export function buildInvoice({ caseId, customer, pkg, amount, email, issuedAt }) {
  const total = Number(amount);
  const subtotal = Math.round((total / 1.16) * 100) / 100;
  const iva = Math.round((total - subtotal) * 100) / 100;
  const invoiceNumber = `NS-C-${caseId.replace(/[^A-Za-z0-9]/g, '')}`;
  const concept = pkg ? `Sistema solar ${pkg.name} (${pkg.panels} paneles, ${pkg.kw} kW) con instalación` : 'Sistema de paneles solares';
  const date = new Date(issuedAt).toLocaleString('es-MX', { timeZone: 'America/Monterrey', dateStyle: 'long', timeStyle: 'short' });
  const subject = `Comprobante de compra ${invoiceNumber} | Nexo Solar`;

  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#edf1f4;font-family:Arial,Helvetica,sans-serif;color:#172433">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden">
<tr><td style="background:#24476b;color:#ffffff;padding:20px 24px">
<div style="font-size:20px;font-weight:bold">Nexo Solar</div>
<div style="font-size:13px;opacity:.8">Comprobante de compra (simulado para demostración)</div></td></tr>
<tr><td style="padding:24px">
<p style="margin:0 0 12px">Hola ${esc(customer?.contact_name || customer?.name || '')},</p>
<p style="margin:0 0 16px">Gracias por tu compra. Este es el resumen de tu pedido.</p>
<table role="presentation" width="100%" cellpadding="6" cellspacing="0" style="font-size:14px;border-collapse:collapse">
<tr><td style="color:#75838f">Folio</td><td align="right"><b>${esc(invoiceNumber)}</b></td></tr>
<tr><td style="color:#75838f">Fecha</td><td align="right">${esc(date)}</td></tr>
<tr><td style="color:#75838f">Cliente</td><td align="right">${esc(customer?.name || '')}</td></tr>
<tr><td style="color:#75838f">Cotización</td><td align="right">${esc(caseId)}</td></tr>
</table>
<hr style="border:0;border-top:1px solid #d3dce4;margin:16px 0">
<table role="presentation" width="100%" cellpadding="6" cellspacing="0" style="font-size:14px;border-collapse:collapse">
<tr><td>${esc(concept)}</td><td align="right">${money(subtotal)}</td></tr>
<tr><td style="color:#75838f">IVA (16%)</td><td align="right">${money(iva)}</td></tr>
<tr><td><b>Total</b></td><td align="right"><b>${money(total)}</b></td></tr>
</table>
<p style="margin:16px 0 0;font-size:12px;color:#75838f">Documento de demostración del hackatón ByeCode. No es una factura fiscal (CFDI) ni implica un cobro real.</p>
</td></tr></table></td></tr></table></body></html>`;

  const text = `Nexo Solar: comprobante de compra (demostración)\nFolio: ${invoiceNumber}\nFecha: ${date}\nCliente: ${customer?.name || ''}\nCotización: ${caseId}\n${concept}: ${money(subtotal)}\nIVA (16%): ${money(iva)}\nTotal: ${money(total)}\nNo es una factura fiscal (CFDI).`;

  return {
    invoice_number: invoiceNumber,
    email: email.trim(),
    subject,
    html,
    text,
    case_id: caseId,
    customer_id: customer?.customer_id ?? null,
    customer_name: customer?.name ?? null,
    concept,
    subtotal_mxn: subtotal,
    iva_mxn: iva,
    total_mxn: total,
    issued_at: issuedAt,
  };
}

// Envía el comprobante al webhook de n8n. Nunca lanza excepción: devuelve el estado.
export async function sendToN8n(invoice, { fetchImpl = fetch } = {}) {
  const { webhookUrl, secret, timeoutMs } = config.n8n;
  if (!webhookUrl) {
    return { status: 'not_configured', error: 'N8N_WEBHOOK_URL no está configurado; el comprobante se muestra en pantalla.' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(webhookUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', ...(secret ? { 'x-nexo-secret': secret } : {}) },
      body: JSON.stringify(invoice),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { status: 'failed', error: `n8n respondió ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}` };
    }
    return { status: 'sent', error: null };
  } catch (err) {
    return { status: 'failed', error: err.name === 'AbortError' ? 'n8n no respondió a tiempo.' : `No se pudo contactar a n8n: ${err.message}` };
  } finally {
    clearTimeout(timer);
  }
}
