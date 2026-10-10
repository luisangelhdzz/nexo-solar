// Cola de correos al cliente: registra cada correo una sola vez (dedupe_key), lo envía en segundo
// plano para no hacer esperar al cliente y reintenta una vez si n8n no respondió o falló (5xx).
// El estado queda en la tabla notifications y la consola lo muestra en "Correos al cliente".

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

export function maskEmail(email) {
  const [user, domain] = String(email || '').split('@');
  return user ? `${user.slice(0, 2)}***@${domain ?? ''}` : '';
}

// Envía con un reintento para fallas pasajeras (sin red, tiempo agotado, 5xx o 429).
export async function sendWithRetry(send, payload, { retries = 1, delayMs = 4000, onAttempt = null } = {}) {
  let result = null;
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    if (attempt > 1) await sleep(delayMs);
    try {
      result = await send(payload);
    } catch (err) {
      result = { status: 'failed', error: err.message, retryable: true };
    }
    if (onAttempt) await onAttempt(attempt, result);
    if (result.status !== 'failed' || !result.retryable) break;
  }
  return result;
}

export function createNotifier({ storage, send, retryDelayMs = 4000, logger = console }) {
  const running = new Set();

  // Trabajo en segundo plano que nunca rompe el flujo del cliente.
  function background(fn) {
    const job = Promise.resolve()
      .then(fn)
      .catch((err) => logger.error?.(`[correos] error inesperado: ${err.message}`))
      .finally(() => running.delete(job));
    running.add(job);
    return job;
  }

  async function deliver(row, payload) {
    const result = await sendWithRetry(send, payload, {
      delayMs: retryDelayMs,
      onAttempt: (attempt, r) => storage.updateNotification(row.id, {
        status: r.status === 'failed' && r.retryable && attempt === 1 ? 'pending' : r.status,
        error: r.error ?? null,
        attempts: attempt,
        sent_at: r.status === 'sent' ? new Date().toISOString() : null,
      }),
    });
    if (result.status === 'failed') {
      logger.error?.(`[correos] ${row.kind} ${row.case_id} a ${maskEmail(row.email)}: ${result.error}`);
    }
    return result;
  }

  return {
    background,

    // `skip`: motivo para no enviar (sin correo, el cliente pidió no ser contactado...). Se registra
    // igual para que el equipo vea por qué no salió. Devuelve null si ese correo ya existía.
    async queue({ key, kind, caseId, customerId = null, payload, skip = null }) {
      const row = await storage.saveNotification({
        dedupe_key: key,
        kind,
        case_id: caseId,
        customer_id: customerId,
        email: payload?.email || null,
        subject: payload?.subject ?? null,
        status: skip ? 'skipped' : 'pending',
        error: skip,
      });
      if (!row || skip) return row;
      background(() => deliver(row, payload));
      return row;
    },

    // Espera a que terminen los envíos en curso (pruebas y comandos de consola).
    async idle() {
      while (running.size) await Promise.allSettled([...running]);
    },
  };
}
