// Servicio principal: une almacenamiento, validación y evaluación.
// Lo usan el API (routes/api.js), el portal (services/portal.js) y la CLI (cli/evaluate.js).

import { parseJsonl, validateEvent } from '../domain/validation.js';
import { buildCaseState } from '../domain/state.js';
import { evaluateCase, diffRecommendations, sameDecision, toContract } from '../domain/evaluate.js';
import { buildCustomerProfile, profileFingerprint } from '../domain/customer.js';
import { isIsoUtc, toIso, toMs } from '../domain/time.js';
import { activeProvider, providerStatus } from '../ai/providers.js';
import { interpretCase } from '../ai/interpreter.js';
import { generateLesson } from '../ai/lessons.js';
import { buildStages, STAGES, STAGE_LABEL } from '../domain/stages.js';
import { analyzeOutcome } from '../domain/outcome.js';
import { computeLearning, pickLessons } from '../domain/learning.js';

export class EngineError extends Error {
  constructor(message, status = 400, code = 'BAD_REQUEST') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const HOUR = 3600 * 1000;
const truncMinute = (ms) => Math.floor(ms / 60000) * 60000;

export function createEngine({ storage, provider = activeProvider(), policy = {}, clock = () => Date.now() }) {
  const providerKey = provider ? `${provider.name}:${provider.model}` : 'heuristic';

  // ---------- Reloj ----------
  // manifest: hora fija del manifest.json (reproducible, para el kit y los jueces).
  // live: hora real (+ un adelanto simulado opcional), para el portal y la demo en vivo.
  async function getClock() {
    const s = await storage.getSettings();
    const mode = s.clock_mode === 'live' ? 'live' : 'manifest';
    const offsetMs = Number(s.clock_offset_ms) || 0;
    const evaluationAt = mode === 'live' ? toIso(truncMinute(clock() + offsetMs)) : s.evaluation_at ?? null;
    return { mode, offset_ms: offsetMs, offset_hours: offsetMs / HOUR, evaluation_at: evaluationAt, manifest_evaluation_at: s.evaluation_at ?? null };
  }

  async function getEvaluationAt() {
    return (await getClock()).evaluation_at;
  }

  async function requireEvaluationAt() {
    const at = await getEvaluationAt();
    if (!at) {
      throw new EngineError('Falta la hora de evaluación: carga manifest.json o activa el reloj en vivo.', 409, 'NO_EVALUATION_TIME');
    }
    return at;
  }

  async function setManifest(manifest) {
    if (!manifest || typeof manifest !== 'object') throw new EngineError('manifest.json debe ser un objeto JSON.');
    if (!isIsoUtc(manifest.evaluation_at)) throw new EngineError('manifest.evaluation_at debe ser una fecha ISO 8601 en UTC.');
    return storage.setSettings({ evaluation_at: toIso(toMs(manifest.evaluation_at)), manifest, clock_mode: 'manifest' });
  }

  async function setEvaluationAt(iso) {
    if (!isIsoUtc(iso)) throw new EngineError('evaluation_at debe ser una fecha ISO 8601 en UTC (termina en Z).');
    return storage.setSettings({ evaluation_at: toIso(toMs(iso)), clock_mode: 'manifest' });
  }

  async function setClock({ mode, offset_hours: offsetHours } = {}) {
    const patch = {};
    if (mode !== undefined) {
      if (!['manifest', 'live'].includes(mode)) throw new EngineError('mode debe ser "manifest" o "live".');
      if (mode === 'manifest' && !(await storage.getSettings()).evaluation_at) {
        throw new EngineError('No hay manifest cargado: carga manifest.json antes de usar su hora.', 409, 'NO_MANIFEST');
      }
      patch.clock_mode = mode;
    }
    if (offsetHours !== undefined) {
      const h = Number(offsetHours);
      if (!Number.isFinite(h) || h < 0 || h > 24 * 60) throw new EngineError('El adelanto debe estar entre 0 y 1440 horas.');
      patch.clock_offset_ms = Math.round(h * HOUR);
    }
    await storage.setSettings(patch);
    return getClock();
  }

  async function advanceClock(hours) {
    const c = await getClock();
    return setClock({ mode: 'live', offset_hours: c.offset_hours + Number(hours || 0) });
  }

  // ---------- Clientes ----------
  async function customerIndex() {
    const map = await storage.caseCustomerMap();
    const byCustomer = {};
    for (const [caseId, cid] of Object.entries(map)) (byCustomer[cid] ||= []).push(caseId);
    return { caseToCustomer: map, byCustomer };
  }

  async function profileFor(customerId, { excludeCaseId = null, evaluationAt, index, eventsByCase, customersById } = {}) {
    if (!customerId) return null;
    const customer = customersById ? customersById[customerId] : await storage.getCustomer(customerId);
    if (!customer) return null;
    const idx = index ?? (await customerIndex());
    const states = [];
    for (const caseId of idx.byCustomer[customerId] ?? []) {
      states.push(buildCaseState(caseId, eventsByCase ? eventsByCase[caseId] ?? [] : await storage.getCaseEvents(caseId)));
    }
    const profile = buildCustomerProfile(customer, states, { excludeCaseId, nowIso: evaluationAt });
    profile.patience_window_hours = profile.patience_hours ? Math.ceil(profile.patience_hours * (policy.patienceMargin ?? 1.2)) : null;
    return profile;
  }

  // ---------- Evaluación ----------
  // Guarda una decisión nueva solo si llegaron eventos o cambió la decisión.
  // Si solo pasó el tiempo y la decisión es la misma, actualiza la vigente (sin ensuciar el historial).
  // Las evaluaciones se hacen una a la vez: si la consola y el portal piden evaluar al mismo
  // tiempo, no se duplican decisiones.
  let queue = Promise.resolve();
  function evaluate(opts) {
    const run = queue.then(() => evaluateNow(opts));
    queue = run.catch(() => {});
    return run;
  }

  // ---------- Aprendizaje ----------
  // auto: aprende solo con el reloj en vivo (portal/demo). Con la hora del manifest (kit, jueces)
  // queda apagado para que la evaluación oficial sea reproducible.
  async function learningMode() {
    const s = await storage.getSettings();
    return ['on', 'off', 'auto'].includes(s.learning_mode) ? s.learning_mode : 'auto';
  }
  async function learningActive(clockInfo) {
    const mode = await learningMode();
    return mode === 'on' || (mode === 'auto' && clockInfo.mode === 'live');
  }
  async function setLearningMode(mode) {
    if (!['on', 'off', 'auto'].includes(mode)) throw new EngineError('mode debe ser "auto", "on" u "off".');
    await storage.setSettings({ learning_mode: mode });
    return { mode, active: await learningActive(await getClock()) };
  }

  const analysisCache = new Map(); // case_id -> { key, analysis, state }
  // Análisis de todas las cotizaciones cerradas antes de `untilIso`.
  async function closedAnalyses(untilIso, { index, latest, eventsByCase, customersById }) {
    eventsByCase ??= await storage.getEventsByCase();
    customersById ??= Object.fromEntries((await storage.listCustomers()).map((c) => [c.customer_id, c]));
    const out = [];
    for (const id of Object.keys(eventsByCase).sort()) {
      const events = eventsByCase[id];
      if (!events.length) continue;
      const state = buildCaseState(id, events);
      if (state.status !== 'closed' || !state.closed_at || (untilIso && toMs(state.closed_at) > toMs(untilIso))) continue;
      const key = `${events[events.length - 1].seq}`;
      const cached = analysisCache.get(id);
      if (cached && cached.key === key) {
        out.push(cached);
        continue;
      }
      const interpretations = latest[id]?.detail?.interpretations ?? (await interpretCase(state, storage, provider));
      const stages = buildStages(state, interpretations, state.closed_at);
      const decisions = await storage.decisionHistory(id, 50);
      const customer = await profileFor(index.caseToCustomer[id] ?? null, { excludeCaseId: id, evaluationAt: state.closed_at, index, eventsByCase, customersById });
      const analysis = analyzeOutcome({ state, interpretations, stages, decisions, customer });
      const entry = { key, analysis, state };
      analysisCache.set(id, entry);
      out.push(entry);
    }
    return out;
  }

  async function recordLearningSnapshot(learning, evaluationAt) {
    const s = await storage.getSettings();
    const history = Array.isArray(s.learning_history) ? s.learning_history : [];
    if (history.at(-1)?.version === learning.version) return history;
    const next = [...history, {
      n: (history.at(-1)?.n ?? 0) + 1,
      version: learning.version,
      at: evaluationAt,
      samples: learning.samples,
      follow_up_hours: learning.params.follow_up_hours.value,
      follow_up_source: learning.params.follow_up_hours.source,
      answer_within_hours: learning.params.answer_within_hours.value,
    }].slice(-20);
    await storage.setSettings({ learning_history: next });
    return next;
  }

  // Al cerrarse una cotización se guarda su análisis y una lección (IA o plantilla).
  async function learnFromClosed(caseIds, { evaluationAt, index, latest }) {
    const created = [];
    for (const id of caseIds) {
      if (await storage.getLesson(id)) continue;
      const events = await storage.getCaseEvents(id);
      const state = buildCaseState(id, events);
      if (state.status !== 'closed' || !state.closed_at || toMs(state.closed_at) > toMs(evaluationAt)) continue;
      const [entry] = (await closedAnalyses(evaluationAt, { index, latest })).filter((e) => e.state.case_id === id);
      if (!entry) continue;
      const lesson = await generateLesson(entry.analysis, provider);
      const saved = await storage.saveLesson({
        case_id: id,
        customer_id: state.customer_id ?? null,
        outcome: entry.analysis.outcome,
        closed_at: state.closed_at,
        summary: entry.analysis.summary,
        lesson: lesson.lesson,
        source: lesson.source,
        model: lesson.model,
        tags: lesson.tags,
        analysis: entry.analysis,
      });
      created.push(saved);
    }
    return created;
  }

  async function evaluateNow({ caseIds = null, force = false } = {}) {
    const evaluationAt = await requireEvaluationAt();
    const [eventsByCase, latest, index, customers] = await Promise.all([
      storage.getEventsByCase(), storage.latestDecisions(), customerIndex(), storage.listCustomers(),
    ]);
    const ids = caseIds ?? Object.keys(eventsByCase).sort();
    const customersById = Object.fromEntries(customers.map((c) => [c.customer_id, c]));
    const results = [];

    const clockInfo = await getClock();
    const active = await learningActive(clockInfo);
    let learning = null;
    let lessonsAll = [];
    if (active) {
      const closed = await closedAnalyses(evaluationAt, { index, latest, eventsByCase, customersById });
      learning = computeLearning(closed, { defaults: { followUpHours: policy.followUpHours ?? 48 } });
      lessonsAll = await storage.listLessons({ limit: 50 });
      await recordLearningSnapshot(learning, evaluationAt);
    }
    const effectivePolicy = learning
      ? {
        ...policy,
        followUpHours: learning.params.follow_up_hours.value,
        learned: { version: learning.version, followUp: learning.params.follow_up_hours, answerWithin: learning.params.answer_within_hours },
      }
      : policy;

    for (const caseId of ids) {
      const events = eventsByCase[caseId] ?? [];
      if (!events.length) continue;
      const lastSeq = events[events.length - 1].seq;
      const customerId = index.caseToCustomer[caseId] ?? null;
      const customer = await profileFor(customerId, { excludeCaseId: caseId, evaluationAt, index, eventsByCase, customersById });
      const fingerprint = `${lastSeq}|${evaluationAt}|${providerKey}|${profileFingerprint(customer)}|L:${learning?.version ?? 'off'}`;
      const prev = latest[caseId] ?? null;

      if (prev && prev.fingerprint === fingerprint && !force) {
        results.push({ case_id: caseId, decision: prev, created: false, changes: prev.changes ?? [] });
        continue;
      }

      const lessons = active ? pickLessons(lessonsAll, { customerId }) : [];
      const evaluation = await evaluateCase({ caseId, events, evaluationAt, storage, provider, policy: effectivePolicy, customer, lessons });
      for (const ev of events) {
        if (toMs(ev.occurred_at) > toMs(evaluationAt)) {
          evaluation.state.warnings.push({ event_id: ev.event_id, message: `${ev.event_id} tiene fecha posterior a la hora de evaluación.` });
        }
      }
      const detail = {
        state: evaluation.state,
        rules: evaluation.rules,
        interpretations: evaluation.interpretations,
        trace: evaluation.trace,
        customer: evaluation.customer,
        previous_evaluation_at: prev?.evaluation_at ?? null,
      };

      const noNewEvents = prev && prev.last_seq === lastSeq;
      if (noNewEvents && sameDecision(prev.recommendation, evaluation.recommendation) && !force) {
        const updated = await storage.updateDecision(prev.id, {
          evaluation_at: evaluationAt,
          fingerprint,
          recommendation: evaluation.recommendation,
          detail: { ...detail, previous_evaluation_at: prev.detail?.previous_evaluation_at ?? null },
        });
        results.push({ case_id: caseId, decision: updated ?? prev, created: false, changes: prev.changes ?? [] });
        continue;
      }

      const changes = diffRecommendations(prev?.recommendation, evaluation.recommendation);
      const newEventIds = prev ? events.filter((e) => e.seq > prev.last_seq).map((e) => e.event_id) : events.map((e) => e.event_id);
      const decision = await storage.saveDecision({
        case_id: caseId,
        evaluation_at: evaluationAt,
        fingerprint,
        last_seq: lastSeq,
        previous_id: prev?.id ?? null,
        recommendation: evaluation.recommendation,
        detail,
        new_event_ids: newEventIds,
        changes,
      });
      results.push({ case_id: caseId, decision, created: true, changes });
    }

    // Las cotizaciones que se cerraron dejan su análisis y su lección.
    const closedIds = results.filter((r) => r.decision?.detail?.state?.status === 'closed').map((r) => r.case_id);
    if (closedIds.length) await learnFromClosed(closedIds, { evaluationAt, index, latest: await storage.latestDecisions() });
    return results;
  }

  // ---------- Carga de eventos ----------
  async function ingest({ content, source = null, autoEvaluate = true }) {
    if (typeof content !== 'string' || !content.trim()) throw new EngineError('El archivo está vacío.');
    const { events, errors } = parseJsonl(content);
    const batchId = await storage.createBatch({ source });
    const { inserted, duplicates } = await storage.addEvents(events, batchId);
    const affected = [...new Set(inserted.map((e) => e.case_id))].sort();
    await storage.finishBatch(batchId, {
      accepted: inserted.length,
      duplicates: duplicates.length,
      errors: { errors, duplicates },
    });

    let evaluated = [];
    let evaluationNote = null;
    if (autoEvaluate && affected.length) {
      if (await getEvaluationAt()) {
        // También se reevalúan otros casos del mismo cliente: su historial pudo cambiar.
        const index = await customerIndex();
        const related = new Set(affected);
        for (const caseId of affected) {
          const cid = index.caseToCustomer[caseId];
          for (const other of index.byCustomer[cid] ?? []) related.add(other);
        }
        evaluated = (await evaluate({ caseIds: [...related].sort() })).map(summarizeResult);
      } else {
        evaluationNote = 'Eventos guardados. Carga manifest.json o activa el reloj en vivo para evaluar.';
      }
    }

    return {
      batch_id: batchId,
      source,
      lines_read: events.length + errors.length,
      accepted: inserted.length,
      duplicates,
      errors,
      affected_cases: affected,
      evaluated,
      evaluation_note: evaluationNote,
    };
  }

  // Simulador de la consola: agrega un evento a un caso y reevalúa.
  async function addEvent(caseId, input = {}) {
    const evaluationAt = await requireEvaluationAt();
    const event = {
      event_id: input.event_id?.trim() || `SIM-${caseId}-${Date.now().toString(36)}`,
      case_id: caseId,
      event_type: input.event_type,
      occurred_at: input.occurred_at || evaluationAt,
      data: input.data ?? {},
    };
    const problems = validateEvent(event);
    if (problems.length) throw new EngineError(`Evento inválido: ${problems.join('; ')}`);
    return ingest({ content: JSON.stringify(event), source: input.source || 'simulador', autoEvaluate: true });
  }

  // ---------- Consultas para la consola ----------
  function caseSummary(id, events, state, d, maxSeq, clockInfo, customersById, caseToCustomer) {
    const cid = caseToCustomer[id] ?? null;
    const customer = cid ? customersById[cid] : null;
    const stale = !d || d.last_seq < (maxSeq[id] ?? 0) || (clockInfo.mode === 'manifest' && d.evaluation_at !== clockInfo.evaluation_at);
    const stages = buildStages(state, d?.detail?.interpretations ?? {}, clockInfo.evaluation_at);
    return {
      case_id: id,
      stage: stages.current,
      stage_label: stages.current_label,
      status: state.status,
      closed_status: state.closed_status,
      amount_mxn: state.amount_mxn,
      package_id: state.package_id,
      customer_id: cid,
      customer_name: customer?.name ?? null,
      event_count: events.length,
      opened_at: state.opened_at,
      last_event_at: events.length ? events[events.length - 1].occurred_at : null,
      contact_allowed: state.contact_allowed,
      recommendation: d?.recommendation ?? null,
      basis: d?.detail?.trace?.ideal?.basis ?? null,
      inaction_kind: inactionKind(d, state),
      customer_pattern_used: Boolean(d?.detail?.trace?.customer?.used),
      evaluated_at: d?.evaluation_at ?? null,
      stale,
      changed: Boolean(d?.changes?.length),
      changes: d?.changes ?? [],
      replaced_by_guardian: Boolean(d?.detail?.trace?.guardian?.replaced),
    };
  }

  async function listCases() {
    const [eventsByCase, latest, clockInfo, customers, index] = await Promise.all([
      storage.getEventsByCase(), storage.latestDecisions(), getClock(), storage.listCustomers(), customerIndex(),
    ]);
    const customersById = Object.fromEntries(customers.map((c) => [c.customer_id, c]));
    const maxSeq = Object.fromEntries(Object.entries(eventsByCase).map(([id, events]) => [id, events.at(-1)?.seq ?? 0]));
    return Object.keys(eventsByCase).sort().map((id) => {
      const events = eventsByCase[id];
      return caseSummary(id, events, buildCaseState(id, events), latest[id] ?? null, maxSeq, clockInfo, customersById, index.caseToCustomer);
    });
  }

  async function getCase(caseId) {
    const events = await storage.getCaseEvents(caseId);
    if (!events.length) throw new EngineError(`No existe el caso ${caseId}.`, 404, 'NOT_FOUND');
    const history = await storage.decisionHistory(caseId, 10);
    const current = history[0] ?? null;
    const previous = current?.previous_id ? history.find((h) => h.id === current.previous_id) ?? history[1] ?? null : null;
    const batches = await storage.listBatches(50);
    const ingestIssues = [];
    for (const b of batches) {
      const detail = b.errors ?? {};
      for (const dup of detail.duplicates ?? []) {
        if (dup.case_id === caseId) ingestIssues.push({ kind: 'duplicate', batch_id: b.id, source: b.source, ...dup });
      }
      for (const err of detail.errors ?? []) {
        if (err.case_id === caseId) ingestIssues.push({ kind: 'error', batch_id: b.id, source: b.source, ...err });
      }
    }
    const state = current?.detail?.state ?? publicState(buildCaseState(caseId, events));
    const clockInfo = await getClock();
    const customerId = buildCaseState(caseId, events).customer_id;
    const customer = customerId
      ? await profileFor(customerId, { excludeCaseId: caseId, evaluationAt: clockInfo.evaluation_at })
      : null;
    const fullState = buildCaseState(caseId, events);
    const interps = current?.detail?.interpretations ?? {};
    const stages = buildStages(fullState, interps, clockInfo.evaluation_at);
    const lesson = await storage.getLesson(caseId);
    let outcome = lesson?.analysis ?? null;
    if (!outcome && fullState.status === 'closed') {
      const decisions = await storage.decisionHistory(caseId, 50);
      const custAtClose = customerId ? await profileFor(customerId, { excludeCaseId: caseId, evaluationAt: fullState.closed_at }) : null;
      outcome = analyzeOutcome({ state: fullState, interpretations: interps, stages, decisions, customer: custAtClose });
    }
    return {
      case_id: caseId,
      events,
      state,
      stages,
      outcome,
      lesson: lesson ? { lesson: lesson.lesson, source: lesson.source, model: lesson.model, tags: lesson.tags, created_at: lesson.created_at } : null,
      ingest_issues: ingestIssues,
      evaluation_at: clockInfo.evaluation_at,
      clock: clockInfo,
      customer,
      invoices: (await storage.listInvoices({ case_id: caseId })).map(maskInvoice),
      current,
      previous,
      history: history.map((h) => ({
        id: h.id,
        evaluation_at: h.evaluation_at,
        created_at: h.created_at,
        action: h.recommendation.action,
        timing: h.recommendation.timing,
        scheduled_for: h.recommendation.scheduled_for,
        new_event_ids: h.new_event_ids,
        changes: h.changes.map((c) => c.field),
      })),
    };
  }

  // Lista de clientes con su perfil, sus cotizaciones y la recomendación vigente de cada una.
  async function listCustomers() {
    const [customers, index, latest, evaluationAt, eventsByCase] = await Promise.all([
      storage.listCustomers(), customerIndex(), storage.latestDecisions(), getEvaluationAt(), storage.getEventsByCase(),
    ]);
    const out = [];
    for (const c of customers) {
      const caseIds = (index.byCustomer[c.customer_id] ?? []).sort();
      const states = [];
      for (const id of caseIds) states.push(buildCaseState(id, eventsByCase[id] ?? []));
      const profile = buildCustomerProfile(c, states, { nowIso: evaluationAt });
      profile.patience_window_hours = profile.patience_hours ? Math.ceil(profile.patience_hours * (policy.patienceMargin ?? 1.2)) : null;
      const cases = states.map((s) => ({
        case_id: s.case_id,
        status: s.status,
        closed_status: s.closed_status,
        amount_mxn: s.amount_mxn,
        package_id: s.package_id,
        opened_at: s.opened_at,
        closed_at: s.closed_at,
        decision_hours: s.closed_at && s.opened_at ? Math.round(((toMs(s.closed_at) - toMs(s.opened_at)) / HOUR) * 10) / 10 : null,
        recommendation: latest[s.case_id]?.recommendation ?? null,
        basis: latest[s.case_id]?.detail?.trace?.ideal?.basis ?? null,
      }));
      out.push({ ...c, profile, cases });
    }
    return out;
  }

  async function getCustomer(customerId) {
    const all = await listCustomers();
    const c = all.find((x) => x.customer_id === customerId);
    if (!c) throw new EngineError(`No existe el cliente ${customerId}.`, 404, 'NOT_FOUND');
    return { ...c, invoices: (await storage.listInvoices({ customer_id: customerId })).map(maskInvoice) };
  }

  // Ficha que llena el equipo (lo que "ya sabe" del cliente). Reevalúa sus casos abiertos.
  async function updateCustomerProfile(customerId, patch = {}) {
    const c = await storage.getCustomer(customerId);
    if (!c) throw new EngineError(`No existe el cliente ${customerId}.`, 404, 'NOT_FOUND');
    const next = {};
    if ('trusted' in patch) next.trusted = patch.trusted === true;
    if ('decision_hours_override' in patch) {
      const v = patch.decision_hours_override;
      if (v === null || v === '') next.decision_hours_override = null;
      else {
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0 || n > 24 * 60) throw new EngineError('El tiempo típico debe ser un número de horas entre 1 y 1440.');
        next.decision_hours_override = n;
      }
    }
    if ('notes' in patch) next.notes = patch.notes ? String(patch.notes).slice(0, 500) : null;
    await storage.upsertCustomer({ ...c, ...next });
    const index = await customerIndex();
    const caseIds = index.byCustomer[customerId] ?? [];
    let evaluated = [];
    if (caseIds.length && (await getEvaluationAt())) evaluated = (await evaluate({ caseIds })).map(summarizeResult);
    return { customer: await getCustomer(customerId), evaluated };
  }

  // Resumen para el dashboard, centrado en la inacción.
  async function summary() {
    const [cases, clockInfo, invoices] = await Promise.all([listCases(), getClock(), storage.listInvoices()]);
    const evaluated = cases.filter((c) => c.recommendation);
    const open = evaluated.filter((c) => c.status !== 'closed');
    const byAction = {};
    for (const c of evaluated) byAction[c.recommendation.action] = (byAction[c.recommendation.action] || 0) + 1;
    const inactionOpen = open.filter((c) => ['wait', 'no_action'].includes(c.recommendation.action));
    const upcoming = open
      .filter((c) => c.recommendation.timing === 'at_date' && c.recommendation.scheduled_for)
      .sort((a, b) => toMs(a.recommendation.scheduled_for) - toMs(b.recommendation.scheduled_for))
      .map((c) => ({ case_id: c.case_id, customer_name: c.customer_name, action: c.recommendation.action, scheduled_for: c.recommendation.scheduled_for, basis: c.basis }));
    return {
      clock: clockInfo,
      totals: {
        cases: cases.length,
        open: cases.filter((c) => c.status !== 'closed').length,
        closed: cases.filter((c) => c.status === 'closed').length,
        accepted: cases.filter((c) => c.closed_status === 'accepted').length,
        evaluated: evaluated.length,
        stale: cases.filter((c) => c.stale).length,
      },
      by_action: byAction,
      inaction: {
        open_cases: open.length,
        count: inactionOpen.length,
        share: open.length ? inactionOpen.length / open.length : 0,
        by_kind: inactionOpen.reduce((acc, c) => ({ ...acc, [c.inaction_kind]: (acc[c.inaction_kind] || 0) + 1 }), {}),
        cases: inactionOpen.map((c) => ({
          case_id: c.case_id,
          customer_name: c.customer_name,
          action: c.recommendation.action,
          timing: c.recommendation.timing,
          scheduled_for: c.recommendation.scheduled_for,
          reason: c.recommendation.reason,
          basis: c.basis,
          kind: c.inaction_kind,
          confidence: c.recommendation.confidence,
        })),
      },
      act_now: open
        .filter((c) => !['wait', 'no_action'].includes(c.recommendation.action))
        .map((c) => ({ case_id: c.case_id, customer_name: c.customer_name, action: c.recommendation.action, timing: c.recommendation.timing, risk_level: c.recommendation.risk_level, requires_human_review: c.recommendation.requires_human_review })),
      human_review: open.filter((c) => c.recommendation.requires_human_review).map((c) => c.case_id),
      contact_blocked: open.filter((c) => c.contact_allowed === false).map((c) => c.case_id),
      upcoming,
      invoices: {
        total: invoices.length,
        sent: invoices.filter((i) => i.status === 'sent').length,
        failed: invoices.filter((i) => i.status === 'failed').length,
        not_configured: invoices.filter((i) => i.status === 'not_configured').length,
      },
    };
  }

  // Pestaña Aprendizaje: embudo, qué separa compras de pérdidas, lecciones y tiempos aprendidos.
  async function insights() {
    const [clockInfo, latest, index, eventsByCase, settings] = await Promise.all([
      getClock(), storage.latestDecisions(), customerIndex(), storage.getEventsByCase(), storage.getSettings(),
    ]);
    const closed = await closedAnalyses(clockInfo.evaluation_at, { index, latest, eventsByCase });
    const learning = computeLearning(closed, { defaults: { followUpHours: policy.followUpHours ?? 48 } });

    // Embudo: cuántas cotizaciones llegaron a cada etapa y dónde están las abiertas.
    const funnel = Object.fromEntries(STAGES.map((st) => [st, { stage: st, label: STAGE_LABEL[st], reached: 0, open_now: 0 }]));
    let open = 0;
    for (const id of Object.keys(eventsByCase).sort()) {
      const events = eventsByCase[id];
      if (!events.length) continue;
      const state = buildCaseState(id, events);
      const stages = buildStages(state, latest[id]?.detail?.interpretations ?? {}, clockInfo.evaluation_at);
      for (const st of stages.reached) funnel[st].reached += 1;
      if (state.status !== 'closed') {
        open += 1;
        funnel[stages.current].open_now += 1;
      }
    }
    const won = learning.samples.won;
    const lost = learning.samples.lost;
    return {
      clock: clockInfo,
      mode: await learningMode(),
      active: await learningActive(clockInfo),
      totals: { open, won, lost, conversion: won + lost ? won / (won + lost) : null },
      funnel: STAGES.map((st) => funnel[st]),
      learning,
      history: Array.isArray(settings.learning_history) ? settings.learning_history : [],
      lessons: await storage.listLessons({ limit: 30 }),
    };
  }

  async function exportRecommendations() {
    if (await getEvaluationAt()) await evaluate();
    const latest = await storage.latestDecisions();
    return Object.keys(latest).sort().map((id) => toContract(latest[id].recommendation));
  }

  async function status() {
    const settings = await storage.getSettings();
    return {
      storage: storage.kind,
      ai: providerStatus(),
      clock: await getClock(),
      learning: { mode: await learningMode(), active: await learningActive(await getClock()) },
      evaluation_at: await getEvaluationAt(),
      manifest: settings.manifest ?? null,
      batches: await storage.listBatches(10),
    };
  }

  async function reset() {
    await storage.reset();
  }

  return {
    getClock, getEvaluationAt, setManifest, setEvaluationAt, setClock, advanceClock,
    evaluate, ingest, addEvent, listCases, getCase, listCustomers, getCustomer, updateCustomerProfile,
    profileFor, summary, insights, setLearningMode, learningMode, exportRecommendations, status, reset, storage,
  };
}

// Por qué se recomienda no intervenir (solo para wait / no_action).
//   pattern: historial del cliente · rules: una regla impide contactar · client: el cliente lo pidió
//   closed: caso cerrado · no_signal: no hay señal que justifique intervenir
export function inactionKind(d, state) {
  const rec = d?.recommendation;
  if (!rec || !['wait', 'no_action'].includes(rec.action)) return null;
  if (state.status === 'closed') return 'closed';
  const trace = d.detail?.trace ?? {};
  if (trace.ideal?.basis === 'customer_pattern') return 'pattern';
  const intent = d.detail?.interpretations?.[trace.ideal?.interpretation_event_id]?.intent;
  if (intent === 'request_delay' || intent === 'not_interested') return 'client';
  if (trace.blocked || d.detail?.rules?.contact_blocked) return 'rules';
  return 'no_signal';
}

function publicState(state) {
  const { events, ...rest } = state;
  return { ...rest, event_count: events.length };
}

// En la consola no se muestra el correo completo del cliente.
export function maskInvoice(inv) {
  const [user, domain] = String(inv.email || '').split('@');
  const masked = user ? `${user.slice(0, 2)}***@${domain ?? ''}` : '';
  const { detail, ...rest } = inv;
  return { ...rest, email: masked };
}

export function summarizeResult(r) {
  return {
    case_id: r.case_id,
    created: r.created,
    action: r.decision.recommendation.action,
    timing: r.decision.recommendation.timing,
    scheduled_for: r.decision.recommendation.scheduled_for,
    changes: r.changes.map((c) => ({ field: c.field, before: c.before, after: c.after })),
  };
}
