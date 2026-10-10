// Portal del cliente de Nexo Solar (empresa ficticia).
// Todo lo que hace el cliente aquí se convierte en eventos del contrato del reto
// (case.opened, proposal.viewed, message.received, constraint.updated, case.closed)
// y entra al mismo motor que los archivos JSONL.
//
// El portal nunca muestra la recomendación interna al cliente.

import { randomUUID } from 'node:crypto';
import { evaluateRules } from '../domain/rules.js';
import { activeClientDelays } from '../domain/policy.js';
import { EngineError } from '../services/engine.js';
import { buildCaseState } from '../domain/state.js';
import { isIsoUtc, toIso, toMs } from '../domain/time.js';
import { PACKAGES, SECTIONS, findPackage } from './catalog.js';
import { buildInvoice, isValidEmail, sendToN8n } from './invoice.js';

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function createPortal({ engine, storage, sendInvoice = sendToN8n }) {
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

  function caseView(state, events, invoices = []) {
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
        quotes.push(caseView(buildCaseState(id, events), events, await storage.listInvoices({ case_id: id })));
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
      const events = await storage.getCaseEvents(caseId);
      return caseView(buildCaseState(caseId, events), events);
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

    async requestQuote(customerId, packageId) {
      await requireCustomer(customerId);
      const pkg = findPackage(packageId);
      if (!pkg) throw new EngineError('Ese paquete no existe.');
      const caseId = await nextCaseId();
      await emit(caseId, 'case.opened', { status: 'open', proposal_amount_mxn: pkg.price_mxn, customer_id: customerId, package_id: pkg.package_id }, 0);
      const events = await storage.getCaseEvents(caseId);
      return caseView(buildCaseState(caseId, events), events);
    },

    async viewSection(customerId, caseId, section) {
      await requireCustomer(customerId);
      if (!SECTIONS.some((s) => s.id === section)) throw new EngineError('Sección desconocida.');
      const { events, state } = await caseOf(caseId, customerId);
      if (state.proposal_pending) throw new EngineError('La propuesta aún está en preparación.', 409, 'PROPOSAL_PENDING');
      if (state.status === 'closed') return caseView(state, events);
      await emit(caseId, 'proposal.viewed', { section }, events.length);
      const after = await storage.getCaseEvents(caseId);
      return caseView(buildCaseState(caseId, after), after);
    },

    async sendMessage(customerId, caseId, message) {
      await requireCustomer(customerId);
      const text = clean(message, 1000);
      if (!text) throw new EngineError('Escribe tu mensaje.');
      const { events, state } = await caseOf(caseId, customerId);
      if (state.status === 'closed') throw new EngineError('Esta cotización ya está cerrada.', 409, 'CLOSED');
      await emit(caseId, 'message.received', { message: text }, events.length);
      const after = await storage.getCaseEvents(caseId);
      return caseView(buildCaseState(caseId, after), after);
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
      const after = await storage.getCaseEvents(caseId);
      return caseView(buildCaseState(caseId, after), after);
    },

    async decide(customerId, caseId, decision) {
      await requireCustomer(customerId);
      if (!['accepted', 'rejected'].includes(decision)) throw new EngineError('Decisión inválida.');
      const { events, state } = await caseOf(caseId, customerId);
      if (state.status === 'closed') throw new EngineError('Esta cotización ya está cerrada.', 409, 'CLOSED');
      if (state.proposal_pending) throw new EngineError('Todavía no hay una propuesta para aceptar o rechazar.', 409, 'PROPOSAL_PENDING');
      await emit(caseId, 'case.closed', { status: decision }, events.length);
      const after = await storage.getCaseEvents(caseId);
      return caseView(buildCaseState(caseId, after), after);
    },

    // Después de comprar: el cliente da su correo y n8n le manda el comprobante por Gmail.
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
      const invoice = buildInvoice({
        caseId,
        customer,
        pkg: findPackage(state.package_id),
        amount: state.amount_mxn,
        email,
        issuedAt: state.closed_at,
      });
      const saved = await storage.saveInvoice({
        invoice_number: invoice.invoice_number,
        case_id: caseId,
        customer_id: customerId,
        email: invoice.email,
        amount_mxn: invoice.total_mxn,
        status: 'pending',
        detail: { subject: invoice.subject, concept: invoice.concept },
      });
      const result = await sendInvoice(invoice);
      await storage.updateInvoice(saved.id, {
        status: result.status,
        error: result.error,
        sent_at: result.status === 'sent' ? new Date().toISOString() : null,
      });
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
        case: caseView(state, events, await storage.listInvoices({ case_id: caseId })),
      };
    },
  };
}

function maskEmail(email) {
  const [user, domain] = String(email || '').split('@');
  return user ? `${user.slice(0, 2)}***@${domain ?? ''}` : '';
}
