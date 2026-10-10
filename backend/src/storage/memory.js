import { sameEventContent } from '../domain/util.js';

// Almacenamiento en memoria. Misma interfaz que postgres.js.
// Útil para pruebas, para la CLI y para correr el proyecto sin instalar PostgreSQL.

export function createMemoryStorage() {
  let events = new Map(); // event_id -> evento (con seq)
  let seq = 0;
  let interpretations = new Map();
  let decisions = []; // ordenadas por id
  let decisionSeq = 0;
  let batches = [];
  let batchSeq = 0;
  let settings = {};
  let customers = new Map();
  let invoices = [];
  let invoiceSeq = 0;
  let lessons = new Map();

  return {
    kind: 'memory',
    async init() {},
    async close() {},

    async createBatch({ source }) {
      batchSeq += 1;
      const b = { id: batchSeq, source: source || null, created_at: new Date().toISOString(), accepted: 0, duplicates: 0, errors: [] };
      batches.push(b);
      return b.id;
    },
    async finishBatch(id, summary) {
      const b = batches.find((x) => x.id === id);
      if (b) Object.assign(b, summary);
    },
    async listBatches(limit = 20) {
      return [...batches].reverse().slice(0, limit);
    },

    // Inserta eventos ignorando event_id repetidos. Devuelve insertados y duplicados.
    async addEvents(list, batchId) {
      const inserted = [];
      const duplicates = [];
      for (const ev of list) {
        const existing = events.get(ev.event_id);
        if (existing) {
          duplicates.push({
            event_id: ev.event_id,
            line: ev.line ?? null,
            case_id: ev.case_id,
            same_content: sameEventContent(existing, ev),
          });
          continue;
        }
        seq += 1;
        const row = {
          event_id: ev.event_id, case_id: ev.case_id, event_type: ev.event_type,
          occurred_at: ev.occurred_at, data: ev.data, seq, batch_id: batchId ?? null,
        };
        events.set(ev.event_id, row);
        inserted.push(row);
      }
      return { inserted, duplicates };
    },

    async listCaseIds() {
      return [...new Set([...events.values()].map((e) => e.case_id))].sort();
    },
    async getCaseEvents(caseId) {
      return [...events.values()].filter((e) => e.case_id === caseId).sort((a, b) => a.seq - b.seq);
    },
    async maxSeqByCase() {
      const out = {};
      for (const e of events.values()) out[e.case_id] = Math.max(out[e.case_id] ?? 0, e.seq);
      return out;
    },

    async getInterpretation(key) {
      return interpretations.get(key) ?? null;
    },
    async saveInterpretation(key, eventId, value) {
      interpretations.set(key, value);
    },

    async getSettings() {
      return { ...settings };
    },
    async setSettings(patch) {
      settings = { ...settings, ...patch };
      return { ...settings };
    },

    async saveDecision(d) {
      decisionSeq += 1;
      const row = { ...d, id: decisionSeq, created_at: new Date().toISOString() };
      decisions.push(row);
      return row;
    },
    async latestDecisions() {
      const out = {};
      for (const d of decisions) out[d.case_id] = d;
      return out;
    },
    async decisionHistory(caseId, limit = 10) {
      return decisions.filter((d) => d.case_id === caseId).reverse().slice(0, limit);
    },

    async updateDecision(id, patch) {
      const d = decisions.find((x) => x.id === id);
      if (d) Object.assign(d, patch);
      return d ?? null;
    },

    // Clientes (extensión del portal).
    async listCustomers() {
      return [...customers.values()].sort((a, b) => a.customer_id.localeCompare(b.customer_id));
    },
    async getCustomer(id) {
      return customers.get(id) ?? null;
    },
    async upsertCustomer(c) {
      const prev = customers.get(c.customer_id);
      const row = { created_at: new Date().toISOString(), trusted: false, decision_hours_override: null, notes: null, ...prev, ...c };
      customers.set(c.customer_id, row);
      return row;
    },
    // Relación caso -> cliente, a partir de data.customer_id del evento case.opened.
    async caseCustomerMap() {
      const out = {};
      for (const e of events.values()) {
        if (e.event_type === 'case.opened' && typeof e.data?.customer_id === 'string' && !out[e.case_id]) out[e.case_id] = e.data.customer_id;
      }
      return out;
    },

    // Comprobantes de compra enviados por n8n.
    async saveInvoice(inv) {
      invoiceSeq += 1;
      const row = { ...inv, id: invoiceSeq, created_at: new Date().toISOString() };
      invoices.push(row);
      return row;
    },
    async updateInvoice(id, patch) {
      const row = invoices.find((x) => x.id === id);
      if (row) Object.assign(row, patch);
      return row ?? null;
    },
    async listInvoices({ customer_id: cid = null, case_id: caseId = null } = {}) {
      return invoices
        .filter((x) => (!cid || x.customer_id === cid) && (!caseId || x.case_id === caseId))
        .sort((a, b) => b.id - a.id);
    },

    // Lecciones de cotizaciones cerradas (aprendizaje).
    async saveLesson(lesson) {
      const row = { created_at: new Date().toISOString(), ...lessons.get(lesson.case_id), ...lesson };
      lessons.set(lesson.case_id, row);
      return row;
    },
    async getLesson(caseId) {
      return lessons.get(caseId) ?? null;
    },
    async listLessons({ customer_id: cid = null, limit = 50 } = {}) {
      return [...lessons.values()]
        .filter((l) => !cid || l.customer_id === cid)
        .sort((a, b) => String(b.closed_at).localeCompare(String(a.closed_at)))
        .slice(0, limit);
    },

    async reset() {
      lessons = new Map();
      customers = new Map();
      invoices = [];
      invoiceSeq = 0;
      events = new Map();
      seq = 0;
      interpretations = new Map();
      decisions = [];
      decisionSeq = 0;
      batches = [];
      batchSeq = 0;
      settings = {};
    },
  };
}
