// Almacenamiento en PostgreSQL. Misma interfaz que memory.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { sameEventContent } from '../domain/util.js';
import { postgresConnectionOptions } from './ssl.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function rowToDecision(r) {
  return {
    id: Number(r.id),
    case_id: r.case_id,
    evaluation_at: r.evaluation_at,
    fingerprint: r.fingerprint,
    last_seq: Number(r.last_seq),
    previous_id: r.previous_id === null ? null : Number(r.previous_id),
    recommendation: r.recommendation,
    detail: r.detail,
    new_event_ids: r.new_event_ids,
    changes: r.changes,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  };
}

function rowToCustomer(r) {
  return {
    customer_id: r.customer_id,
    name: r.name,
    contact_name: r.contact_name,
    segment: r.segment,
    city: r.city,
    trusted: r.trusted,
    decision_hours_override: r.decision_hours_override === null ? null : Number(r.decision_hours_override),
    notes: r.notes,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  };
}

function rowToInvoice(r) {
  const iso = (v) => (v instanceof Date ? v.toISOString() : v);
  return { ...r, id: Number(r.id), amount_mxn: Number(r.amount_mxn), sent_at: iso(r.sent_at), created_at: iso(r.created_at) };
}

function rowToLesson(r) {
  return { ...r, created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at };
}

const isoOf = (v) => (v instanceof Date ? v.toISOString() : v);

function rowToRun(r) {
  return {
    id: Number(r.id),
    case_id: r.case_id,
    run_key: r.run_key,
    origin: r.origin,
    last_seq: r.last_seq === null ? null : Number(r.last_seq),
    status: r.status,
    source: r.source,
    model: r.model,
    knowledge_version: r.knowledge_version,
    proposal: r.proposal,
    validation: r.validation,
    result: r.result,
    created_at: isoOf(r.created_at),
    updated_at: isoOf(r.updated_at),
  };
}

function rowToFeedback(r) {
  return { ...r, id: Number(r.id), run_id: r.run_id === null ? null : Number(r.run_id), created_at: isoOf(r.created_at) };
}

export function createPostgresStorage(databaseUrl) {
  const pool = new pg.Pool({ ...postgresConnectionOptions(databaseUrl), max: 5, connectionTimeoutMillis: 10000 });

  return {
    kind: 'postgres',
    async init() {
      const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
      await pool.query(sql);
    },
    async close() {
      await pool.end();
    },

    async createBatch({ source }) {
      const { rows } = await pool.query('INSERT INTO ingest_batches (source) VALUES ($1) RETURNING id', [source || null]);
      return Number(rows[0].id);
    },
    async finishBatch(id, summary) {
      await pool.query(
        'UPDATE ingest_batches SET accepted = $2, duplicates = $3, errors = $4 WHERE id = $1',
        [id, summary.accepted, summary.duplicates, JSON.stringify(summary.errors ?? [])],
      );
    },
    async listBatches(limit = 20) {
      const { rows } = await pool.query('SELECT * FROM ingest_batches ORDER BY id DESC LIMIT $1', [limit]);
      return rows.map((r) => ({ ...r, id: Number(r.id), created_at: r.created_at.toISOString() }));
    },

    async addEvents(list, batchId) {
      const inserted = [];
      const duplicates = [];
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const ev of list) {
          const res = await client.query(
            `INSERT INTO events (event_id, case_id, event_type, occurred_at, data, batch_id)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (event_id) DO NOTHING
             RETURNING event_id, case_id, event_type, occurred_at, data, seq, batch_id`,
            [ev.event_id, ev.case_id, ev.event_type, ev.occurred_at, JSON.stringify(ev.data), batchId ?? null],
          );
          if (res.rowCount) {
            inserted.push({ ...res.rows[0], seq: Number(res.rows[0].seq) });
          } else {
            const { rows } = await client.query('SELECT case_id, event_type, occurred_at, data FROM events WHERE event_id = $1', [ev.event_id]);
            const ex = rows[0];
            duplicates.push({
              event_id: ev.event_id,
              line: ev.line ?? null,
              case_id: ev.case_id,
              same_content: Boolean(ex) && sameEventContent(ex, ev),
            });
          }
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
      return { inserted, duplicates };
    },

    async listCaseIds() {
      const { rows } = await pool.query('SELECT DISTINCT case_id FROM events ORDER BY case_id');
      return rows.map((r) => r.case_id);
    },
    async getEventsByCase() {
      const { rows } = await pool.query(
        'SELECT event_id, case_id, event_type, occurred_at, data, seq, batch_id FROM events ORDER BY case_id, seq',
      );
      const grouped = {};
      for (const r of rows) (grouped[r.case_id] ||= []).push({ ...r, seq: Number(r.seq), batch_id: r.batch_id === null ? null : Number(r.batch_id) });
      return grouped;
    },
    async getCaseEvents(caseId) {
      const { rows } = await pool.query(
        'SELECT event_id, case_id, event_type, occurred_at, data, seq, batch_id FROM events WHERE case_id = $1 ORDER BY seq',
        [caseId],
      );
      return rows.map((r) => ({ ...r, seq: Number(r.seq), batch_id: r.batch_id === null ? null : Number(r.batch_id) }));
    },
    async maxSeqByCase() {
      const { rows } = await pool.query('SELECT case_id, MAX(seq) AS max_seq FROM events GROUP BY case_id');
      return Object.fromEntries(rows.map((r) => [r.case_id, Number(r.max_seq)]));
    },

    async getInterpretation(key) {
      const { rows } = await pool.query('SELECT result FROM interpretations WHERE cache_key = $1', [key]);
      return rows[0]?.result ?? null;
    },
    async saveInterpretation(key, eventId, value) {
      await pool.query(
        `INSERT INTO interpretations (cache_key, event_id, result) VALUES ($1, $2, $3)
         ON CONFLICT (cache_key) DO UPDATE SET result = EXCLUDED.result`,
        [key, eventId, JSON.stringify(value)],
      );
    },

    async getSettings() {
      const { rows } = await pool.query('SELECT key, value FROM settings');
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    },
    async setSettings(patch) {
      for (const [k, v] of Object.entries(patch)) {
        await pool.query(
          `INSERT INTO settings (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [k, JSON.stringify(v)],
        );
      }
      return this.getSettings();
    },

    async saveDecision(d) {
      const { rows } = await pool.query(
        `INSERT INTO decisions (case_id, evaluation_at, fingerprint, last_seq, previous_id, recommendation, detail, new_event_ids, changes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [d.case_id, d.evaluation_at, d.fingerprint, d.last_seq, d.previous_id ?? null,
          JSON.stringify(d.recommendation), JSON.stringify(d.detail), JSON.stringify(d.new_event_ids ?? []), JSON.stringify(d.changes ?? [])],
      );
      return rowToDecision(rows[0]);
    },
    async latestDecisions() {
      const { rows } = await pool.query(
        'SELECT DISTINCT ON (case_id) * FROM decisions ORDER BY case_id, id DESC',
      );
      return Object.fromEntries(rows.map((r) => [r.case_id, rowToDecision(r)]));
    },
    async decisionHistory(caseId, limit = 10) {
      const { rows } = await pool.query('SELECT * FROM decisions WHERE case_id = $1 ORDER BY id DESC LIMIT $2', [caseId, limit]);
      return rows.map(rowToDecision);
    },

    async updateDecision(id, patch) {
      const fields = [];
      const values = [id];
      for (const [k, v] of Object.entries(patch)) {
        if (!['evaluation_at', 'fingerprint', 'recommendation', 'detail'].includes(k)) continue;
        values.push(k === 'recommendation' || k === 'detail' ? JSON.stringify(v) : v);
        fields.push(`${k} = $${values.length}`);
      }
      if (!fields.length) return null;
      const { rows } = await pool.query(`UPDATE decisions SET ${fields.join(', ')} WHERE id = $1 RETURNING *`, values);
      return rows[0] ? rowToDecision(rows[0]) : null;
    },

    async listCustomers() {
      const { rows } = await pool.query('SELECT * FROM customers ORDER BY customer_id');
      return rows.map(rowToCustomer);
    },
    async getCustomer(id) {
      const { rows } = await pool.query('SELECT * FROM customers WHERE customer_id = $1', [id]);
      return rows[0] ? rowToCustomer(rows[0]) : null;
    },
    async upsertCustomer(c) {
      const prev = (await this.getCustomer(c.customer_id)) || {};
      const m = { trusted: false, decision_hours_override: null, notes: null, ...prev, ...c };
      const { rows } = await pool.query(
        `INSERT INTO customers (customer_id, name, contact_name, segment, city, trusted, decision_hours_override, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (customer_id) DO UPDATE SET name = EXCLUDED.name, contact_name = EXCLUDED.contact_name,
           segment = EXCLUDED.segment, city = EXCLUDED.city, trusted = EXCLUDED.trusted,
           decision_hours_override = EXCLUDED.decision_hours_override, notes = EXCLUDED.notes
         RETURNING *`,
        [m.customer_id, m.name, m.contact_name ?? null, m.segment ?? null, m.city ?? null, Boolean(m.trusted), m.decision_hours_override ?? null, m.notes ?? null],
      );
      return rowToCustomer(rows[0]);
    },
    async caseCustomerMap() {
      const { rows } = await pool.query(
        `SELECT DISTINCT ON (case_id) case_id, data->>'customer_id' AS customer_id
         FROM events WHERE event_type = 'case.opened' AND data ? 'customer_id' ORDER BY case_id, seq`,
      );
      return Object.fromEntries(rows.filter((r) => r.customer_id).map((r) => [r.case_id, r.customer_id]));
    },

    async saveInvoice(inv) {
      const { rows } = await pool.query(
        `INSERT INTO invoices (invoice_number, case_id, customer_id, email, amount_mxn, status, error, detail, sent_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [inv.invoice_number, inv.case_id, inv.customer_id ?? null, inv.email, inv.amount_mxn, inv.status, inv.error ?? null, JSON.stringify(inv.detail ?? {}), inv.sent_at ?? null],
      );
      return rowToInvoice(rows[0]);
    },
    async updateInvoice(id, patch) {
      const { rows } = await pool.query(
        'UPDATE invoices SET status = COALESCE($2, status), error = $3, sent_at = COALESCE($4, sent_at) WHERE id = $1 RETURNING *',
        [id, patch.status ?? null, patch.error ?? null, patch.sent_at ?? null],
      );
      return rows[0] ? rowToInvoice(rows[0]) : null;
    },
    async listInvoices({ customer_id: cid = null, case_id: caseId = null } = {}) {
      const { rows } = await pool.query(
        `SELECT * FROM invoices WHERE ($1::text IS NULL OR customer_id = $1) AND ($2::text IS NULL OR case_id = $2) ORDER BY id DESC`,
        [cid, caseId],
      );
      return rows.map(rowToInvoice);
    },

    async saveLesson(l) {
      const { rows } = await pool.query(
        `INSERT INTO lessons (case_id, customer_id, outcome, closed_at, summary, lesson, source, model, tags, analysis)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (case_id) DO UPDATE SET customer_id = EXCLUDED.customer_id, outcome = EXCLUDED.outcome,
           closed_at = EXCLUDED.closed_at, summary = EXCLUDED.summary, lesson = EXCLUDED.lesson, source = EXCLUDED.source,
           model = EXCLUDED.model, tags = EXCLUDED.tags, analysis = EXCLUDED.analysis
         RETURNING *`,
        [l.case_id, l.customer_id ?? null, l.outcome, l.closed_at ?? null, l.summary, l.lesson, l.source, l.model ?? null,
          JSON.stringify(l.tags ?? []), JSON.stringify(l.analysis ?? {})],
      );
      return rowToLesson(rows[0]);
    },
    async getLesson(caseId) {
      const { rows } = await pool.query('SELECT * FROM lessons WHERE case_id = $1', [caseId]);
      return rows[0] ? rowToLesson(rows[0]) : null;
    },
    async listLessons({ customer_id: cid = null, limit = 50 } = {}) {
      const { rows } = await pool.query(
        'SELECT * FROM lessons WHERE ($1::text IS NULL OR customer_id = $1) ORDER BY closed_at DESC NULLS LAST LIMIT $2',
        [cid, limit],
      );
      return rows.map(rowToLesson);
    },

    // Asistente: propuestas y correcciones del equipo.
    async saveAssistantRun(run) {
      const { rows } = await pool.query(
        `INSERT INTO assistant_runs (case_id, run_key, origin, last_seq, status, source, model, knowledge_version, proposal, validation, result)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (run_key) DO NOTHING
         RETURNING *`,
        [run.case_id, run.run_key ?? null, run.origin, run.last_seq ?? null, run.status, run.source, run.model ?? null, run.knowledge_version ?? null,
          JSON.stringify(run.proposal ?? {}), JSON.stringify(run.validation ?? {}), JSON.stringify(run.result ?? {})],
      );
      if (rows[0]) return rowToRun(rows[0]);
      // Otro proceso ya guardó este mismo trabajo (por ejemplo, dos servidores con la misma base).
      const existing = await this.findAssistantRunByKey(run.run_key);
      return existing ? { ...existing, reused: true } : null;
    },
    async updateAssistantRun(id, patch) {
      const fields = [];
      const values = [id];
      for (const [k, v] of Object.entries(patch)) {
        if (!['status', 'result', 'validation'].includes(k)) continue;
        values.push(k === 'status' ? v : JSON.stringify(v));
        fields.push(`${k} = $${values.length}`);
      }
      if (!fields.length) return null;
      const { rows } = await pool.query(`UPDATE assistant_runs SET ${fields.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, values);
      return rows[0] ? rowToRun(rows[0]) : null;
    },
    async getAssistantRun(id) {
      const { rows } = await pool.query('SELECT * FROM assistant_runs WHERE id = $1', [id]);
      return rows[0] ? rowToRun(rows[0]) : null;
    },
    async findAssistantRunByKey(key) {
      if (!key) return null;
      const { rows } = await pool.query('SELECT * FROM assistant_runs WHERE run_key = $1', [key]);
      return rows[0] ? rowToRun(rows[0]) : null;
    },
    async listAssistantRuns({ case_id: caseId = null, limit = 50 } = {}) {
      const { rows } = await pool.query(
        'SELECT * FROM assistant_runs WHERE ($1::text IS NULL OR case_id = $1) ORDER BY id DESC LIMIT $2',
        [caseId, limit],
      );
      return rows.map(rowToRun);
    },
    async saveAssistantFeedback(f) {
      const { rows } = await pool.query(
        `INSERT INTO assistant_feedback (run_id, case_id, situation, draft, final_message, edited)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [f.run_id ?? null, f.case_id, JSON.stringify(f.situation ?? {}), f.draft ?? null, f.final_message, Boolean(f.edited)],
      );
      return rowToFeedback(rows[0]);
    },
    async listAssistantFeedback({ limit = 50 } = {}) {
      const { rows } = await pool.query('SELECT * FROM assistant_feedback ORDER BY id DESC LIMIT $1', [limit]);
      return rows.map(rowToFeedback);
    },

    async reset() {
      await pool.query('TRUNCATE assistant_feedback, assistant_runs, lessons, invoices, customers, decisions, interpretations, events, ingest_batches, settings RESTART IDENTITY CASCADE');
    },
  };
}
