// Portal del cliente de Nexo Solar (empresa ficticia).
// Todo lo que hace el cliente aquí se convierte en eventos del contrato del reto
// (case.opened, proposal.viewed, message.received, constraint.updated, case.closed)
// y entra al mismo motor que los archivos JSONL.
//
// El portal nunca muestra la recomendación interna al cliente.

import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { evaluateRules } from '../domain/rules.js';
import { activeClientDelays } from '../domain/policy.js';
import { EngineError } from '../services/engine.js';
import { buildCaseState, pendingMessages } from '../domain/state.js';
import { isIsoUtc, toIso, toMs } from '../domain/time.js';
import { PACKAGES, SECTIONS, findPackage } from './catalog.js';
import { buildInvoice, isValidEmail } from './invoice.js';
import { sendToN8n } from './n8n.js';
import { proposalEmail, requestReceivedEmail, portalLink } from './correos.js';
import { createNotifier, maskEmail, sendWithRetry } from './notifier.js';
import { config } from '../config.js';

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// `onActivity(caseId, origen)`: aviso opcional cuando el cliente escribe o envía una solicitud
// (lo usa el asistente para preparar su propuesta en segundo plano). Nunca bloquea al cliente.
//
// Correos al cliente (por n8n): `sendEmail` entrega la confirmación de la solicitud y la propuesta;
// `sendInvoice`, el comprobante de compra. Por omisión ambos usan el webhook de N8N_WEBHOOK_URL.
export function createPortal({
  engine, storage, sendEmail = sendToN8n, sendInvoice = sendEmail, onActivity = null,
  publicUrl = null, retryDelayMs = 4000, logger = console,
}) {
  const mailer = createNotifier({ storage, send: sendEmail, retryDelayMs, logger });
  const siteUrl = () => publicUrl ?? config.publicUrl;
  // Un problema con los correos nunca deshace ni rompe lo que hizo el cliente o el equipo.
  const safely = (label, fn) => fn().catch((err) => {
    logger.error?.(`[correos] ${label}: ${err.message}`);
    return null;
  });
  const notify = (caseId, origin) => {
    if (!onActivity) return;
    try {
      Promise.resolve(onActivity(caseId, origin)).catch(() => {});
    } catch { /* el asistente nunca rompe el portal */ }
  };

  // El portal trabaja con la hora real: si la consola estaba en la hora del manifest, cambia a "en vivo".
  async function liveNow() {
    let clock = await engine.getClock();
    if (clock.mode !== 'live') clock = await engine.setClock({ mode: 'live' });
    return clock.evaluation_at;
  }

  async function requireCustomer(customerId) {
    const c = customerId ? await storage.getCustomer(customerId) : null;
    if (!c) throw new EngineError('Elige tu empresa para continuar.', 401, 'NO_CUSTOMER');
    return c;
  }

  // El enlace es una credencial aleatoria. En la base solo se guarda su hash.
  async function issueAccess(customerId, caseId = null) {
    const token = randomBytes(32).toString('base64url');
    const key = `portal_access:${createHash('sha256').update(token).digest('hex')}`;
    await storage.setSettings({ [key]: { customer_id: customerId, case_id: caseId, expires_at: Date.now() + 30 * 86400000 } });
    return token;
  }

  async function resolveAccess(token) {
    const invalid = () => new EngineError('Este enlace no es válido o venció. Pide al equipo un nuevo enlace para tu cotización.', 401, 'PORTAL_ACCESS_REQUIRED');
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw invalid();
    const key = `portal_access:${createHash('sha256').update(token).digest('hex')}`;
    const access = (await storage.getSettings())[key];
    if (!access || access.expires_at <= Date.now()) throw invalid();
    await requireCustomer(access.customer_id);
    if (access.case_id) await caseOf(access.case_id, access.customer_id);
    return access;
  }

  async function caseOf(caseId, customerId) {
    const events = await storage.getCaseEvents(caseId);
    if (!events.length) throw new EngineError('No encontramos esa cotización.', 404, 'NOT_FOUND');
    const state = buildCaseState(caseId, events);
    if (state.customer_id !== customerId) throw new EngineError('Esa cotización no pertenece a tu empresa.', 403, 'FORBIDDEN');
    return { events, state };
  }

  async function emit(caseId, eventType, data, existingCount) {
    const occurredAt = await liveNow();
    const event = {
      event_id: `${caseId}-e${existingCount + 1}`,
      case_id: caseId,
      event_type: eventType,
      occurred_at: occurredAt,
      data,
    };
    const result = await engine.ingest({ content: JSON.stringify(event), source: 'portal', autoEvaluate: true });
    if (!result.accepted) {
      // Choque de event_id poco probable (dos clics al mismo tiempo): se reintenta con sufijo.
      event.event_id = `${caseId}-e${existingCount + 1}-${Date.now().toString(36)}`;
      await engine.ingest({ content: JSON.stringify(event), source: 'portal', autoEvaluate: true });
    }
    return event;
  }

  function caseView(state, events, invoices = [], notices = []) {
    const copy = notices.find((n) => n.kind === 'solicitud');
    const pkg = findPackage(state.package_id);
    const viewed = [...new Set(state.views.map((v) => v.section))];
    return {
      case_id: state.case_id,
      package: pkg,
      amount_mxn: state.amount_mxn,
      proposal_pending: state.proposal_pending,
      proposal_sent_at: state.proposal_sent_at,
      proposal: state.proposal,
      request: state.request,
      conversation: events.filter((e) => e.event_type === 'message.received' || (e.event_type === 'action.executed' && e.data.message)).map((e) => ({
        event_id: e.event_id, message: e.data.message, at: e.occurred_at, from: e.event_type === 'message.received' ? 'customer' : 'team',
      })),
      status: state.status,
      closed_status: state.closed_status,
      opened_at: state.opened_at,
      closed_at: state.closed_at,
      viewed_sections: viewed,
      messages: state.messages.map((m) => ({ event_id: m.event_id, message: m.message, at: m.at })),
      contact: { allowed: state.contact_allowed, not_before: state.contact_not_before },
      invoice: invoices[0]
        ? { invoice_number: invoices[0].invoice_number, status: invoices[0].status, email: maskEmail(invoices[0].email), sent_at: invoices[0].sent_at }
        : null,
      // Copia de la solicitud por correo (solo el estado; los motivos internos no se muestran al cliente).
      email_copy: copy && copy.email ? { status: copy.status, email: maskEmail(copy.email), sent_at: copy.sent_at } : null,
      event_count: events.length,
    };
  }

  async function writableCase(caseId, action = 'contact') {
    const events = await storage.getCaseEvents(caseId);
    if (!events.length) throw new EngineError('No encontramos esa solicitud.', 404, 'NOT_FOUND');
    const state = buildCaseState(caseId, events);
    const now = await liveNow();
    await engine.evaluate({ caseIds: [caseId] });
    const latest = (await storage.latestDecisions())[caseId];
    const delays = activeClientDelays(state, latest?.detail?.interpretations ?? {});
    const rules = evaluateRules(state, now, { clientDelays: delays });
    if (!rules.actions[action]?.allowed) throw new EngineError('El envío está bloqueado por las preferencias del cliente o la política de contacto. Revisa la recomendación vigente.', 409, 'CONTACT_BLOCKED');
    return { events, state };
  }

  // Vista del cliente con el estado de sus correos y comprobantes.
  async function fullView(caseId, events = null) {
    const evs = events ?? await storage.getCaseEvents(caseId);
    const [invoices, notices] = await Promise.all([
      storage.listInvoices({ case_id: caseId }),
      storage.listNotifications({ case_id: caseId }),
    ]);
    return caseView(buildCaseState(caseId, evs), evs, invoices, notices);
  }

  // Los correos automáticos respetan lo que pidió el cliente: R2 (no contactar), R3 (fecha mínima)
  // y las esperas que pidió por mensaje. No aplican R1 (el comprobante sale justo al cerrar la compra)
  // ni R4 (la espera de 24 h es para seguimientos comerciales, no para acuses ni comprobantes).
  // Devuelve el motivo del bloqueo o null.
  async function emailBlock(caseId, state) {
    const now = await liveNow();
    const latest = (await storage.latestDecisions())[caseId];
    const delays = activeClientDelays(state, latest?.detail?.interpretations ?? {});
    const block = evaluateRules(state, now, { clientDelays: delays }).restrictions
      .find((r) => ['R2', 'R3', 'CLIENTE'].includes(r.rule));
    return block ? block.message : null;
  }

  // El portal es público: para que nadie lo use para llenar de correos la bandeja de otra persona,
  // cada dirección recibe como máximo ACK_LIMIT acuses por hora.
  const ACK_LIMIT = 3;
  const acks = new Map();
  function ackAllowed(email) {
    const key = String(email).trim().toLowerCase();
    const hourAgo = Date.now() - 3600000;
    const recent = (acks.get(key) ?? []).filter((t) => t > hourAgo);
    if (recent.length >= ACK_LIMIT) return false;
    recent.push(Date.now());
    acks.set(key, recent);
    if (acks.size > 5000) acks.clear();
    return true;
  }

  async function queueRequestEmail(caseId, customer, state) {
    const request = state.request ?? {};
    const payload = requestReceivedEmail({ caseId, customer, request, to: request.email, publicUrl: siteUrl(), accessToken: await issueAccess(customer.customer_id, caseId) });
    let skip = !request.email ? 'El cliente no dejó correo en su solicitud.' : await emailBlock(caseId, state);
    if (!skip && !ackAllowed(request.email)) skip = `Límite de ${ACK_LIMIT} acuses por hora para este correo (protección contra abusos).`;
    return mailer.queue({ key: payload.id, kind: 'solicitud', caseId, customerId: customer.customer_id, payload, skip });
  }

  async function queueProposalEmail(caseId, state) {
    const customer = state.customer_id ? await storage.getCustomer(state.customer_id) : null;
    const payload = proposalEmail({
      caseId,
      customer,
      request: state.request,
      proposal: state.proposal,
      pkg: findPackage(state.package_id),
      amount: state.amount_mxn,
      to: state.request?.email,
      publicUrl: siteUrl(),
      accessToken: await issueAccess(state.customer_id, caseId),
    });
    const skip = !state.request?.email ? 'El cliente no dejó correo en su solicitud.' : await emailBlock(caseId, state);
    return mailer.queue({ key: payload.id, kind: 'propuesta', caseId, customerId: state.customer_id, payload, skip });
  }

  // Envía un comprobante ya registrado y guarda el resultado. `retries`: reintentos ante fallas pasajeras.
  async function deliverInvoice(saved, invoice, { retries = 0 } = {}) {
    const result = await sendWithRetry(sendInvoice, invoice, { retries, delayMs: retryDelayMs });
    await storage.updateInvoice(saved.id, {
      status: result.status,
      error: result.error,
      sent_at: result.status === 'sent' ? new Date().toISOString() : null,
    });
    if (result.status === 'failed') logger.error?.(`[correos] comprobante ${invoice.invoice_number} a ${maskEmail(invoice.email)}: ${result.error}`);
    return result;
  }

  async function invoiceFor(caseId, customer, state, email) {
    return buildInvoice({
      caseId,
      customer,
      request: state.request,
      pkg: findPackage(state.package_id),
      amount: state.amount_mxn,
      email,
      issuedAt: state.closed_at,
      publicUrl: siteUrl(),
      accessToken: await issueAccess(state.customer_id, caseId),
    });
  }

  // Al comprar: el comprobante se manda solo al correo de la solicitud (en segundo plano: la compra
  // nunca espera a n8n). Sin correo, o si el cliente pidió no ser contactado, se queda en el portal
  // y el cliente lo pide con un clic.
  async function autoInvoice(caseId, customer) {
    const events = await storage.getCaseEvents(caseId);
    const state = buildCaseState(caseId, events);
    const email = state.request?.email;
    if (!email || !isValidEmail(email)) return null;
    const block = await emailBlock(caseId, state);
    const invoice = await invoiceFor(caseId, customer, state, email);
    const saved = await storage.saveInvoice({
      invoice_number: invoice.invoice_number,
      case_id: caseId,
      customer_id: customer.customer_id,
      email: invoice.email,
      amount_mxn: invoice.total_mxn,
      status: block ? 'skipped' : 'pending',
      error: block,
      detail: { subject: invoice.subject, concept: invoice.concept, origin: 'automatico' },
    });
    if (!block) mailer.background(() => deliverInvoice(saved, invoice, { retries: 1 }));
    return saved;
  }

  async function nextCaseId() {
    const ids = await storage.listCaseIds();
    const nums = ids.map((id) => /^NS-(\d+)$/.exec(id)?.[1]).filter(Boolean).map(Number);
    return `NS-${String((nums.length ? Math.max(...nums) : 1000) + 1).padStart(4, '0')}`;
  }

  async function nextCustomerId() {
    const all = await storage.listCustomers();
    const nums = all.map((c) => /^CUS-(\d+)$/.exec(c.customer_id)?.[1]).filter(Boolean).map(Number);
    return `CUS-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`;
  }

  let deliveryQueue = Promise.resolve();
  function deliver(fn) {
    const run = deliveryQueue.then(fn);
    deliveryQueue = run.catch(() => {});
    return run;
  }

  return {
    issueAccess,
    resolveAccess,
    async createCaseLink(caseId) {
      const events = await storage.getCaseEvents(caseId);
      const state = buildCaseState(caseId, events);
      if (!events.length || !state.customer_id) throw new EngineError('No encontramos esa cotización.', 404, 'NOT_FOUND');
      await requireCustomer(state.customer_id);
      return { url: portalLink(caseId, siteUrl(), await issueAccess(state.customer_id, caseId)), expires_in_days: 30 };
    },
    async getAccessView(access) {
      if (!access.case_id) return this.getCustomerView(access.customer_id);
      const customer = await requireCustomer(access.customer_id);
      const { events } = await caseOf(access.case_id, access.customer_id);
      return { customer: { customer_id: customer.customer_id, name: customer.name, contact_name: customer.contact_name }, quotes: [await fullView(access.case_id, events)], now: await liveNow(), access_case_id: access.case_id };
    },
    catalog() {
      return { packages: PACKAGES, sections: SECTIONS };
    },

    async listCustomers() {
      return (await storage.listCustomers()).map((c) => ({ customer_id: c.customer_id, name: c.name, segment: c.segment, city: c.city }));
    },

    async createCustomer(input = {}) {
      const name = clean(input.name, 80);
      if (name.length < 2) throw new EngineError('Escribe el nombre de tu empresa.');
      const customer = {
        customer_id: await nextCustomerId(),
        name,
        contact_name: clean(input.contact_name, 80) || null,
        segment: clean(input.segment, 40) || null,
        city: clean(input.city, 60) || null,
      };
      await storage.upsertCustomer(customer);
      return { customer_id: customer.customer_id, name: customer.name, segment: customer.segment, city: customer.city };
    },

    async getCustomerView(customerId) {
      const c = await requireCustomer(customerId);
      const map = await storage.caseCustomerMap();
      const caseIds = Object.entries(map).filter(([, cid]) => cid === customerId).map(([id]) => id).sort().reverse();
      const quotes = [];
      for (const id of caseIds) {
        const events = await storage.getCaseEvents(id);
        quotes.push(await fullView(id, events));
      }
      return {
        customer: { customer_id: c.customer_id, name: c.name, contact_name: c.contact_name, segment: c.segment, city: c.city },
        quotes,
        now: await liveNow(),
      };
    },

    async submitRequest(customerId, input = {}) {
      const customer = await requireCustomer(customerId);
      const contactName = clean(input.contact_name, 80);
      const city = clean(input.city, 60);
      const phone = clean(input.phone, 30);
      const email = clean(input.email, 160);
      const channel = input.contact_channel;
      if (!contactName || !city) throw new EngineError('Escribe tu nombre y ciudad.');
      if (!['email', 'whatsapp', 'phone'].includes(channel)) throw new EngineError('Selecciona cómo prefieres que te contactemos.');
      if (channel === 'email' && !isValidEmail(email)) throw new EngineError('Escribe un correo válido.');
      if (channel !== 'email' && !/^\+?[0-9 ()-]{8,30}$/.test(phone)) throw new EngineError('Escribe un teléfono válido.');
      if (email && !isValidEmail(email)) throw new EngineError('Escribe un correo válido.');
      const bill = input.monthly_bill_mxn === '' || input.monthly_bill_mxn == null ? null : Number(input.monthly_bill_mxn);
      if (bill !== null && (!Number.isFinite(bill) || bill <= 0 || bill > 10000000)) throw new EngineError('El gasto de electricidad debe ser un monto positivo.');
      if (!['monthly', 'bimonthly'].includes(input.bill_period)) throw new EngineError('Selecciona si tu recibo es mensual o bimestral.');
      const goal = clean(input.goal, 1000);
      if (goal.length < 5) throw new EngineError('Cuéntanos qué necesitas para tu proyecto.');
      if (typeof input.contact_allowed !== 'boolean') throw new EngineError('Indica si autorizas el contacto.');
      const now = await liveNow();
      const notBefore = input.contact_not_before || null;
      if (notBefore && (!isIsoUtc(notBefore) || toMs(notBefore) <= toMs(now))) throw new EngineError('La fecha de contacto debe ser futura.');
      const request = {
        contact_name: contactName, city, phone: phone || null, email: email || null,
        segment: clean(input.segment, 60) || customer.segment,
        monthly_bill_mxn: bill === null ? null : bill / (input.bill_period === 'bimonthly' ? 2 : 1),
        bill_amount_mxn: bill, bill_period: input.bill_period,
        roof: clean(input.roof, 60) || 'Por confirmar', goal,
        contact_channel: channel, contact_allowed: input.contact_allowed, contact_not_before: notBefore,
      };
      const caseId = `NS-REQ-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
      await emit(caseId, 'case.opened', { status: 'open', proposal_amount_mxn: null, customer_id: customerId, proposal_status: 'pending', request }, 0);
      notify(caseId, 'solicitud');
      const events = await storage.getCaseEvents(caseId);
      // Acuse por correo con el resumen (en segundo plano; el cliente no espera a n8n).
      await safely('acuse de solicitud', () => queueRequestEmail(caseId, customer, buildCaseState(caseId, events)));
      return fullView(caseId, events);
    },

    async closeCase(caseId, input = {}) {
      return deliver(async () => {
        const events = await storage.getCaseEvents(caseId);
        if (!events.length) throw new EngineError('No encontramos esa cotización.', 404, 'NOT_FOUND');
        const state = buildCaseState(caseId, events);
        if (state.status !== 'open') throw new EngineError('Esta cotización ya está cerrada.', 409, 'ALREADY_CLOSED');
        if (!['accepted', 'rejected', 'cancelled'].includes(input.status)) throw new EngineError('Selecciona un resultado válido.');
        if (input.status === 'accepted' && state.proposal_pending) throw new EngineError('Publica una propuesta con precio antes de registrar la venta.', 409, 'PROPOSAL_PENDING');
        const reason = clean(input.reason, 200);
        if (!reason) throw new EngineError('Selecciona el motivo del cierre.');
        await emit(caseId, 'case.closed', { status: input.status, reason, notes: clean(input.notes, 1000), closed_by: 'team' }, events.length);
        return engine.getCase(caseId);
      });
    },

    async sendProposal(caseId, input = {}) {
      return deliver(async () => {
        const pkg = findPackage(input.package_id);
        const amount = Number(input.amount_mxn);
        const title = clean(input.title, 120);
        if (!pkg || !title || !Number.isFinite(amount) || amount <= 0 || amount > 100000000) throw new EngineError('Elige una solución interna e indica un título y monto válidos.');
        const { events, state } = await writableCase(caseId);
        if (!state.proposal_pending) throw new EngineError('Esta propuesta ya fue enviada.', 409, 'ALREADY_SENT');
        await emit(caseId, 'proposal.sent', { package_id: pkg.package_id, proposal_amount_mxn: amount, title, notes: clean(input.notes, 1500) }, events.length);
        // La propuesta también va al correo del cliente (las reglas ya permitieron publicarla).
        await safely('propuesta', async () => queueProposalEmail(caseId, buildCaseState(caseId, await storage.getCaseEvents(caseId))));
        return engine.getCase(caseId);
      });
    },

    async reply(caseId, input = {}) {
      return deliver(async () => {
        const message = clean(input.message, 1000);
        if (!message) throw new EngineError('Escribe la respuesta al cliente.');
        const action = input.action === 'request_information' ? 'request_information' : 'contact';
        const { events } = await writableCase(caseId, action);
        await emit(caseId, 'action.executed', { action, message, channel: 'portal' }, events.length);
        return engine.getCase(caseId);
      });
    },

    // Respuesta automática del asistente (modo auto). Las reglas se revisan justo antes de enviar
    // y el event_id es fijo por situación: si dos servidores intentan enviar lo mismo, la base
    // de datos guarda solo uno y nunca se reintenta con otro id.
    // `answering`: el borrador responde mensajes pendientes del cliente; si alguien del equipo ya
    // los respondió mientras tanto, no se envía.
    async replyFromAssistant(caseId, { message, action, key, answering = false } = {}) {
      return deliver(async () => {
        const text = clean(message, 1000);
        if (!text) throw new EngineError('El borrador está vacío.');
        if (!/^[a-z0-9-]{6,40}$/i.test(String(key ?? ''))) throw new EngineError('Falta la clave del envío automático.');
        const act = action === 'request_information' ? 'request_information' : 'contact';
        const { state } = await writableCase(caseId, act);
        if (answering && !pendingMessages(state).length) {
          return { sent: false, reason: 'El equipo ya respondió el último mensaje del cliente.' };
        }
        const event = {
          event_id: `${caseId}-ia-${key}`,
          case_id: caseId,
          event_type: 'action.executed',
          occurred_at: await liveNow(),
          data: { action: act, message: text, channel: 'portal', author: 'asistente' },
        };
        const result = await engine.ingest({ content: JSON.stringify(event), source: 'asistente', autoEvaluate: true });
        if (!result.accepted) return { sent: false, reason: 'Este mensaje ya se había enviado.', event_id: event.event_id };
        return { sent: true, event_id: event.event_id, at: event.occurred_at };
      });
    },

    async requestQuote(customerId, packageId) {
      await requireCustomer(customerId);
      const pkg = findPackage(packageId);
      if (!pkg) throw new EngineError('Ese paquete no existe.');
      const caseId = await nextCaseId();
      await emit(caseId, 'case.opened', { status: 'open', proposal_amount_mxn: pkg.price_mxn, customer_id: customerId, package_id: pkg.package_id }, 0);
      return fullView(caseId);
    },

    async viewSection(customerId, caseId, section) {
      await requireCustomer(customerId);
      if (!SECTIONS.some((s) => s.id === section)) throw new EngineError('Sección desconocida.');
      const { events, state } = await caseOf(caseId, customerId);
      if (state.proposal_pending) throw new EngineError('La propuesta aún está en preparación.', 409, 'PROPOSAL_PENDING');
      if (state.status === 'closed') return fullView(caseId, events);
      await emit(caseId, 'proposal.viewed', { section }, events.length);
      return fullView(caseId);
    },

    async sendMessage(customerId, caseId, message) {
      await requireCustomer(customerId);
      const text = clean(message, 1000);
      if (!text) throw new EngineError('Escribe tu mensaje.');
      const { events, state } = await caseOf(caseId, customerId);
      if (state.status === 'closed') throw new EngineError('Esta cotización ya está cerrada.', 409, 'CLOSED');
      await emit(caseId, 'message.received', { message: text }, events.length);
      notify(caseId, 'mensaje');
      return fullView(caseId);
    },

    // Preferencias de contacto del cliente: pausa hasta una fecha, no contactar, o volver a permitir.
    async setContactPreference(customerId, caseId, { kind, until } = {}) {
      await requireCustomer(customerId);
      const { events, state } = await caseOf(caseId, customerId);
      if (state.status === 'closed') throw new EngineError('Esta cotización ya está cerrada.', 409, 'CLOSED');
      let data;
      if (kind === 'pause_until') {
        if (!isIsoUtc(until)) throw new EngineError('Elige una fecha válida.');
        if (toMs(until) <= toMs(await liveNow())) throw new EngineError('La fecha debe ser futura.');
        data = { contact_not_before: toIso(toMs(until)) };
      } else if (kind === 'no_contact') {
        data = { contact_allowed: false };
      } else if (kind === 'allow') {
        data = { contact_allowed: true, contact_not_before: null };
      } else {
        throw new EngineError('Preferencia desconocida.');
      }
      await emit(caseId, 'constraint.updated', data, events.length);
      return fullView(caseId);
    },

    async decide(customerId, caseId, decision) {
      const customer = await requireCustomer(customerId);
      if (!['accepted', 'rejected'].includes(decision)) throw new EngineError('Decisión inválida.');
      const { events, state } = await caseOf(caseId, customerId);
      if (state.status === 'closed') throw new EngineError('Esta cotización ya está cerrada.', 409, 'CLOSED');
      if (state.proposal_pending) throw new EngineError('Todavía no hay una propuesta para aceptar o rechazar.', 409, 'PROPOSAL_PENDING');
      await emit(caseId, 'case.closed', { status: decision }, events.length);
      if (decision === 'accepted') await safely('comprobante automático', () => autoInvoice(caseId, customer));
      return fullView(caseId);
    },

    // Después de comprar, el cliente puede pedir (o volver a pedir) su comprobante a cualquier correo.
    // Aquí sí espera la respuesta de n8n para decirle en pantalla si salió.
    async requestInvoice(customerId, caseId, email) {
      const customer = await requireCustomer(customerId);
      if (!isValidEmail(email)) throw new EngineError('Escribe un correo válido.');
      const { events, state } = await caseOf(caseId, customerId);
      if (state.status !== 'closed' || state.closed_status !== 'accepted') {
        throw new EngineError('El comprobante se genera cuando aceptas la cotización.', 409, 'NOT_PURCHASED');
      }
      const previous = await storage.listInvoices({ case_id: caseId });
      if (previous.filter((i) => i.status === 'sent').length >= 3) {
        throw new EngineError('Ya enviamos este comprobante varias veces. Revisa tu bandeja de spam.', 429, 'TOO_MANY');
      }
      const invoice = await invoiceFor(caseId, customer, state, email);
      const saved = await storage.saveInvoice({
        invoice_number: invoice.invoice_number,
        case_id: caseId,
        customer_id: customerId,
        email: invoice.email,
        amount_mxn: invoice.total_mxn,
        status: 'pending',
        detail: { subject: invoice.subject, concept: invoice.concept, origin: 'cliente' },
      });
      const result = await deliverInvoice(saved, invoice);
      return {
        invoice_number: invoice.invoice_number,
        status: result.status,
        message: result.status === 'sent'
          ? `Te enviamos el comprobante a ${maskEmail(invoice.email)}.`
          : result.status === 'not_configured'
            ? 'Tu comprobante está listo. El envío por correo no está configurado en esta demo, así que te lo mostramos aquí.'
            : 'No pudimos enviar el correo en este momento. Aquí tienes tu comprobante.',
        preview: {
          concept: invoice.concept,
          subtotal_mxn: invoice.subtotal_mxn,
          iva_mxn: invoice.iva_mxn,
          total_mxn: invoice.total_mxn,
          issued_at: invoice.issued_at,
        },
        case: await fullView(caseId, events),
      };
    },

    // Espera los correos que se están enviando en segundo plano (pruebas y comandos de consola).
    idle: () => mailer.idle(),
  };
}
