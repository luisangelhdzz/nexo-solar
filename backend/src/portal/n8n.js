// Entrega de correos al cliente a través de un webhook de n8n (n8n los manda con Gmail).
//
// El backend arma el correo completo (destinatario, asunto, HTML y texto) y n8n solo lo entrega:
// así las plantillas viven en el repositorio, se prueban y no hay que editarlas dentro de n8n.
// Nunca lanza excepción: devuelve { status: 'sent' | 'failed' | 'not_configured', error, retryable }.

import { config } from '../config.js';

// Encabezado con el secreto compartido. En n8n es el "Name" de la credencial Header Auth del Webhook.
export const N8N_SECRET_HEADER = 'x-nexo-secret';

export function n8nConfigured(n8n = config.n8n) {
  return Boolean(n8n.webhookUrl);
}

// Mensajes en español que dicen qué revisar (sin mostrar la URL ni el secreto).
export function describeN8nFailure(status, body = '') {
  const detail = body ? ` Detalle: ${String(body).replace(/\s+/g, ' ').slice(0, 160)}` : '';
  if (status === 401 || status === 403) {
    return `n8n rechazó el secreto (${status}). N8N_WEBHOOK_SECRET debe ser igual al valor de la credencial Header Auth del nodo Webhook.`;
  }
  if (status === 404) {
    return 'n8n no encontró el webhook (404). Publica el flujo en n8n (botón Publish o interruptor Active) y usa la Production URL (/webhook/...), no la de prueba (/webhook-test/...).';
  }
  if (status === 429) return `n8n está recibiendo demasiadas solicitudes (429).${detail}`;
  if (status >= 500) return `El flujo de n8n falló (${status}). Revisa Executions en n8n: casi siempre es la cuenta de correo del nodo de envío (Gmail o SMTP).${detail}`;
  return `n8n respondió ${status}.${detail}`;
}

export async function sendToN8n(payload, { fetchImpl = fetch, n8n = config.n8n } = {}) {
  const { webhookUrl, secret, timeoutMs } = n8n;
  if (!webhookUrl) {
    return { status: 'not_configured', error: 'N8N_WEBHOOK_URL no está configurado; el correo no se envió.', retryable: false };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(webhookUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', ...(secret ? { [N8N_SECRET_HEADER]: secret } : {}) },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { status: 'failed', error: describeN8nFailure(res.status, body), retryable: res.status >= 500 || res.status === 429 };
    }
    return { status: 'sent', error: null, retryable: false };
  } catch (err) {
    const timedOut = err.name === 'AbortError';
    return {
      status: 'failed',
      error: timedOut ? `n8n no respondió en ${Math.round(timeoutMs / 1000)} s.` : `No se pudo conectar con n8n: ${err.cause?.code ?? err.message}`,
      retryable: true,
    };
  } finally {
    clearTimeout(timer);
  }
}
