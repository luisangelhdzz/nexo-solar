import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { EngineError, summarizeResult } from '../services/engine.js';
import { seedDemo } from '../portal/seed.js';

const KIT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../kit');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Comparación en tiempo constante para la contraseña de la consola.
export function passwordMatches(given, expected) {
  if (!expected) return true;
  const a = crypto.createHash('sha256').update(String(given ?? '')).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

// Protege la consola (todo /api menos /portal, /health y /auth) cuando hay ADMIN_PASSWORD.
export function adminGuard(adminPassword) {
  return (req, res, next) => {
    if (!adminPassword) return next();
    if (req.path.startsWith('/portal') || req.path === '/health' || req.path === '/auth') return next();
    if (passwordMatches(req.get('x-admin-password'), adminPassword)) return next();
    res.status(401).json({ error: 'Escribe la contraseña de la consola.', code: 'AUTH_REQUIRED' });
  };
}

// Límite simple por IP para el portal público (evita abusos cuando esté desplegado).
export function rateLimit({ windowMs = 60000, max = 120 } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || 'anon';
    const entry = hits.get(key);
    if (!entry || now - entry.start > windowMs) {
      hits.set(key, { start: now, count: 1 });
      if (hits.size > 5000) hits.clear();
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      res.status(429).json({ error: 'Demasiadas solicitudes. Espera un momento.', code: 'RATE_LIMIT' });
      return;
    }
    next();
  };
}

export function createApiRouter(engine, { portal, storage, adminPassword = '' } = {}) {
  const r = express.Router();

  r.get('/health', (req, res) => res.json({ ok: true }));
  r.get('/auth', (req, res) => {
    res.json({ required: Boolean(adminPassword), ok: passwordMatches(req.get('x-admin-password'), adminPassword) });
  });

  r.use(adminGuard(adminPassword));

  // ---------- Consola: estado, reloj y carga ----------
  r.get('/status', wrap(async (req, res) => {
    res.json(await engine.status());
  }));

  r.post('/manifest', wrap(async (req, res) => {
    const settings = await engine.setManifest(req.body);
    res.json({ evaluation_at: settings.evaluation_at, manifest: settings.manifest });
  }));

  // Hora fija (modo manifest), útil para la demo: "¿qué pasa el 12 de octubre?".
  r.put('/settings/evaluation-at', wrap(async (req, res) => {
    const settings = await engine.setEvaluationAt(req.body?.evaluation_at);
    res.json({ evaluation_at: settings.evaluation_at });
  }));

  // Reloj: { mode: 'manifest' | 'live', offset_hours } o adelantar { hours }.
  r.put('/settings/clock', wrap(async (req, res) => {
    res.json(await engine.setClock(req.body ?? {}));
  }));
  r.post('/settings/clock/advance', wrap(async (req, res) => {
    res.json(await engine.advanceClock(req.body?.hours));
  }));

  r.post('/events', wrap(async (req, res) => {
    const isText = typeof req.body === 'string';
    const content = isText ? req.body : req.body?.content;
    const source = (isText ? req.query.source : req.body?.source) || null;
    const evalFlag = isText ? req.query.evaluate : req.body?.evaluate;
    const autoEvaluate = !(evalFlag === false || evalFlag === 'false');
    res.json(await engine.ingest({ content, source, autoEvaluate }));
  }));

  r.post('/evaluate', wrap(async (req, res) => {
    const caseIds = Array.isArray(req.body?.case_ids) ? req.body.case_ids : null;
    const results = await engine.evaluate({ caseIds, force: req.body?.force === true });
    res.json({ evaluation_at: await engine.getEvaluationAt(), results: results.map(summarizeResult) });
  }));

  // ---------- Consola: casos, clientes y resumen ----------
  // En modo en vivo, cada consulta reevalúa para que las esperas que vencen se actualicen solas.
  const refreshIfLive = async () => {
    const clock = await engine.getClock();
    if (clock.mode === 'live' && clock.evaluation_at) await engine.evaluate();
  };

  r.get('/summary', wrap(async (req, res) => {
    await refreshIfLive();
    res.json(await engine.summary());
  }));

  r.get('/cases', wrap(async (req, res) => {
    await refreshIfLive();
    res.json({ evaluation_at: await engine.getEvaluationAt(), clock: await engine.getClock(), cases: await engine.listCases() });
  }));

  r.get('/cases/:id', wrap(async (req, res) => {
    res.json(await engine.getCase(req.params.id));
  }));

  r.get('/proposal-options', (req, res) => res.json(portal.catalog()));
  r.post('/cases/:id/proposal', wrap(async (req, res) => res.json(await portal.sendProposal(req.params.id, req.body ?? {}))));
  r.post('/cases/:id/reply', wrap(async (req, res) => res.json(await portal.reply(req.params.id, req.body ?? {}))));

  r.post('/cases/:id/events', wrap(async (req, res) => {
    res.json(await engine.addEvent(req.params.id, req.body));
  }));

  r.get('/customers', wrap(async (req, res) => {
    res.json({ customers: await engine.listCustomers() });
  }));

  r.get('/customers/:id', wrap(async (req, res) => {
    res.json(await engine.getCustomer(req.params.id));
  }));

  // Ficha del equipo: { trusted, decision_hours_override, notes }.
  r.patch('/customers/:id', wrap(async (req, res) => {
    res.json(await engine.updateCustomerProfile(req.params.id, req.body ?? {}));
  }));

  r.get('/insights', wrap(async (req, res) => {
    await refreshIfLive();
    res.json(await engine.insights());
  }));

  // Aprendizaje: { mode: 'auto' | 'on' | 'off' }. auto = solo con el reloj en vivo.
  r.put('/settings/learning', wrap(async (req, res) => {
    const r1 = await engine.setLearningMode(req.body?.mode);
    if (await engine.getEvaluationAt()) await engine.evaluate();
    res.json(r1);
  }));

  r.get('/export', wrap(async (req, res) => {
    const recs = await engine.exportRecommendations();
    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', 'attachment; filename="recomendaciones.json"');
    }
    res.type('application/json').send(JSON.stringify(recs, null, 2));
  }));

  // ---------- Consola: atajos de demostración ----------
  r.post('/demo/kit/:file', wrap(async (req, res) => {
    const allowed = ['manifest.json', 'events.jsonl', 'updates.jsonl'];
    const file = req.params.file;
    if (!allowed.includes(file)) throw new EngineError(`Archivo no permitido: ${file}`, 400);
    const full = path.join(KIT_DIR, file);
    if (!fs.existsSync(full)) throw new EngineError(`No se encontró ${file} en la carpeta kit/.`, 404, 'NOT_FOUND');
    const content = fs.readFileSync(full, 'utf8');
    if (file === 'manifest.json') {
      const settings = await engine.setManifest(JSON.parse(content));
      res.json({ file, evaluation_at: settings.evaluation_at });
      return;
    }
    res.json({ file, ...(await engine.ingest({ content, source: file })) });
  }));

  r.post('/demo/seed', wrap(async (req, res) => {
    res.json(await seedDemo({ engine, storage, force: req.body?.force === true }));
  }));

  r.post('/reset', wrap(async (req, res) => {
    await engine.reset();
    res.json({ ok: true });
  }));

  // ---------- Portal público del cliente ----------
  if (portal) {
    const p = express.Router();
    p.use(rateLimit());
    const cid = (req) => req.get('x-customer-id') || req.body?.customer_id || req.query.customer_id;

    p.get('/catalog', (req, res) => res.json(portal.catalog()));
    p.get('/customers', wrap(async (req, res) => res.json({ customers: await portal.listCustomers() })));
    p.post('/customers', wrap(async (req, res) => res.json(await portal.createCustomer(req.body ?? {}))));
    p.get('/me', wrap(async (req, res) => res.json(await portal.getCustomerView(cid(req)))));
    p.post('/requests', wrap(async (req, res) => res.json(await portal.submitRequest(cid(req), req.body ?? {}))));
    p.post('/quotes', wrap(async (req, res) => res.json(await portal.requestQuote(cid(req), req.body?.package_id))));
    p.post('/quotes/:id/view', wrap(async (req, res) => res.json(await portal.viewSection(cid(req), req.params.id, req.body?.section))));
    p.post('/quotes/:id/messages', wrap(async (req, res) => res.json(await portal.sendMessage(cid(req), req.params.id, req.body?.message))));
    p.post('/quotes/:id/contact', wrap(async (req, res) => res.json(await portal.setContactPreference(cid(req), req.params.id, req.body ?? {}))));
    p.post('/quotes/:id/accept', wrap(async (req, res) => res.json(await portal.decide(cid(req), req.params.id, 'accepted'))));
    p.post('/quotes/:id/reject', wrap(async (req, res) => res.json(await portal.decide(cid(req), req.params.id, 'rejected'))));
    p.post('/quotes/:id/invoice', wrap(async (req, res) => res.json(await portal.requestInvoice(cid(req), req.params.id, req.body?.email))));
    r.use('/portal', p);
  }

  return r;
}

// Errores con mensaje claro para la interfaz.
// eslint-disable-next-line no-unused-vars
export function apiErrorHandler(err, req, res, next) {
  if (err instanceof EngineError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  if (err.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'El cuerpo no es JSON válido.', code: 'BAD_JSON' });
    return;
  }
  if (err.type === 'entity.too.large') {
    res.status(413).json({ error: 'El archivo es demasiado grande (máximo 5 MB).', code: 'TOO_LARGE' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor.', code: 'INTERNAL' });
}
