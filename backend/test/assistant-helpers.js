// Utilidades para probar el asistente sin red: proveedor falso y un caso del portal listo.
import { createMemoryStorage } from '../src/storage/memory.js';
import { createEngine } from '../src/services/engine.js';
import { createPortal } from '../src/portal/service.js';
import { createAssistant } from '../src/services/assistant.js';

export const REQUEST = {
  contact_name: 'Ana López', city: 'Saltillo', segment: 'Comercio', email: 'ana.lopez@example.com', phone: '844 123 4567',
  contact_channel: 'email', monthly_bill_mxn: 8000, bill_period: 'bimonthly', roof: 'Azotea de concreto',
  goal: 'Reducir el gasto de luz de mi tienda.', contact_allowed: true,
};
export const PROPOSAL = { package_id: 'PKG-COMERCIO-10', title: 'Sistema solar para tu tienda', amount_mxn: 150000, notes: 'Incluye instalación estándar.' };

// Proveedor falso: arma una propuesta con la acción del motor que viene en el contexto.
export function fakeProvider(build = () => ({})) {
  const calls = [];
  return {
    name: 'gemini',
    model: 'gemini-3.8-flash',
    calls,
    async structured(args) {
      calls.push(args);
      const action = /- acción: (\w+)/.exec(args.user)?.[1] ?? 'wait';
      const timing = /momento: (\w+)/.exec(args.user)?.[1] ?? 'on_new_information';
      const date = /· fecha: (\S+)/.exec(args.user)?.[1] ?? null;
      const ids = [...args.user.matchAll(/\[([A-Z0-9-]+-e\d+) ·/g)].map((m) => m[1]);
      const base = {
        summary: 'El cliente pregunta si el precio incluye la instalación.',
        customer_need: 'Saber qué incluye el precio.',
        proposed_action: action,
        timing,
        scheduled_for: timing === 'at_date' ? date : null,
        explanation: 'Hay una pregunta concreta y el conocimiento aprobado la responde.',
        evidence_event_ids: ids.slice(-1),
        knowledge_used: ['precio-incluye'],
        draft_message: ['contact', 'request_information', 'resolve_objection'].includes(action)
          ? 'Hola, {nombre}. Sí: el precio de tu propuesta ya incluye IVA, equipos, la instalación estándar y el trámite con CFE. Saludos, equipo Nexo Solar.'
          : null,
        missing_information: [],
        requires_human_review: false,
        human_review_reason: null,
        confidence: 'high',
      };
      const extra = build(args, base);
      if (extra instanceof Error) throw extra;
      return { output: { ...base, ...extra }, model: 'gemini-3.8-flash' };
    },
  };
}

export async function setup({ provider = fakeProvider(), mode = 'draft', request = REQUEST, sendProposal = true } = {}) {
  let now = Date.parse('2026-10-10T15:00:00Z');
  const storage = createMemoryStorage();
  const engine = createEngine({ storage, provider: null, clock: () => now });
  const hooks = {};
  const portal = createPortal({ engine, storage, onActivity: (id, origin) => hooks.onActivity?.(id, origin) });
  const assistant = createAssistant({ engine, storage, portal, provider, mode, logger: { log() {}, error() {} } });
  hooks.onActivity = assistant.onActivity;
  const customer = await portal.createCustomer({ name: 'Abarrotes Doña Ana', contact_name: 'Ana López' });
  const quote = await portal.submitRequest(customer.customer_id, request);
  if (sendProposal) {
    now += 3600000;
    await portal.sendProposal(quote.case_id, PROPOSAL);
  }
  now += 3600000;
  return {
    storage, engine, portal, assistant, provider, cid: customer.customer_id, caseId: quote.case_id,
    advance: (hours) => { now += hours * 3600000; },
    say: (text) => portal.sendMessage(customer.customer_id, quote.case_id, text),
  };
}
