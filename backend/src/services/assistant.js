// Asistente autónomo (paso 5 del plan).
//
//   nuevo mensaje, nueva solicitud o revisión programada
//   → consultar la cotización (con la decisión del motor al día)
//   → la IA propone el siguiente paso (respuesta estructurada)
//   → validar políticas y datos actuales (reglas R1–R6 + chequeos del borrador)
//   → ejecutar solo lo autorizado, según el modo
//   → registrar el resultado y la próxima revisión
//
// Modos (ASSISTANT_AUTOPILOT):
//   off    solo cuando el equipo presiona "Generar propuesta" en la consola
//   draft  además prepara propuestas solo; nunca envía nada (recomendado para empezar)
//   auto   envía SOLO los borradores de la IA que pasan todas las validaciones; lo demás queda para el equipo
//
// Aunque el modo sea auto, el envío vuelve a revisar las reglas justo antes de escribirle al cliente
// y usa un identificador fijo por situación, para no mandar el mismo mensaje dos veces.

import { createHash } from 'node:crypto';
import { analystBrief } from '../ai/analyst.js';
import { extractNumbers } from '../ai/knowledge.js';
import { config } from '../config.js';
import { CONTACT_ACTIONS } from '../domain/constants.js';
import { buildCaseState, pendingMessages } from '../domain/state.js';
import { evaluateRules } from '../domain/rules.js';
import { activeClientDelays } from '../domain/policy.js';
import { pickLessons } from '../domain/learning.js';
import { humanUtc } from '../domain/time.js';
import { activeProvider, providerStatus } from '../ai/providers.js';
import { approvedNumbers, buildKnowledge } from '../ai/knowledge.js';
import { EJEMPLOS } from '../ai/ejemplos.js';
import { personalNames, proposeNextStep, scrubPersonalData } from '../ai/assistant.js';
import { checkProposal, fillPlaceholders } from '../ai/assistant-checks.js';
import { normalizeText } from '../ai/heuristic.js';
import { EngineError } from './engine.js';

// Con estas acciones vale la pena llamar a la IA en segundo plano (hay que escribir o explicar algo).
const AI_ACTIONS = [...CONTACT_ACTIONS, 'escalate'];
const shortKey = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12);
const squash = (text) => normalizeText(text).replace(/[^a-z0-9ñ]+/g, ' ').trim();

function situationOf(state, interpretations, rec) {
  const last = pendingMessages(state).at(-1) ?? state.messages.at(-1) ?? null;
  const it = last ? interpretations[last.event_id] : null;
  return { intent: it?.intent ?? null, topic: it?.topic ?? null, action: rec.action };
}

// Hasta 3 correcciones del equipo, primero las de situaciones parecidas.
export function pickCorrections(feedback, situation, limit = 3) {
  const topic = situation.topic ? squash(situation.topic) : null;
  return feedback
    .filter((f) => f.edited)
    .map((f) => {
      let score = 0;
      if (situation.intent && f.situation?.intent === situation.intent) score += 2;
      if (topic && f.situation?.topic && squash(f.situation.topic) === topic) score += 2;
      if (f.situation?.action === situation.action) score += 1;
      return { f, score };
    })
    .sort((a, b) => b.score - a.score || b.f.id - a.f.id)
    .slice(0, limit)
    .map((x) => x.f);
}

// Textos cuyas cifras puede repetir un borrador (no incluye los mensajes del cliente:
// sus cifras no se convierten en compromisos de la empresa).
function caseTexts(state, events) {
  const texts = [state.amount_mxn, state.request?.bill_amount_mxn, state.request?.monthly_bill_mxn, state.proposal?.title, state.proposal?.notes]
    .filter((v) => v !== null && v !== undefined).map(String);
  for (const e of events) if (e.event_type === 'action.executed' && e.data?.message) texts.push(e.data.message);
  return texts;
}


export function createAssistant({
  engine, storage, portal, provider = activeProvider(), mode = config.assistant.autopilot,
  reviewMinutes = config.assistant.reviewMinutes, knowledge = buildKnowledge(), logger = console,
} = {}) {
  let active = false; // el trabajo en segundo plano solo corre después de start() (server.js)
  let timer = null;
  let firstTimer = null;
  let sweeping = false;
  let lastSweep = null;
  let queue = Promise.resolve();

  const enqueue = (fn) => {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
  };

  async function execute({ caseId, origin, rec, state, proposal, validation, runKey }) {
    const nextReview = rec.timing === 'at_date' ? rec.scheduled_for : null;
    if (state.status === 'closed' || rec.action === 'no_action') {
      return { status: 'no_action', result: { executed: 'ninguna', next_review_at: null, note: 'El motor recomienda no actuar: no se hace seguimiento.' } };
    }
    if (rec.action === 'wait') {
      return {
        status: 'scheduled',
        result: {
          executed: 'revision_programada',
          next_review_at: nextReview,
          note: nextReview ? `Revisión programada para el ${humanUtc(nextReview)}, o antes si el cliente escribe.` : 'Se revisa de nuevo cuando el cliente escriba o cambie una restricción.',
        },
      };
    }
    if (rec.action === 'escalate') {
      return { status: 'needs_review', result: { executed: 'escalado', next_review_at: null, note: 'Una persona del equipo debe decidir el siguiente paso.' } };
    }
    // Acciones de contacto.
    if (validation.requires_human_review) {
      return { status: 'needs_review', result: { executed: 'para_revision', next_review_at: null, note: 'El equipo debe revisar antes de escribirle al cliente.' } };
    }
    if (!validation.draft?.sendable) {
      return { status: 'needs_review', result: { executed: 'sin_borrador_valido', next_review_at: null, note: 'No hay un borrador que pase las validaciones: lo redacta una persona.' } };
    }
    const canAutoSend = mode === 'auto' && origin !== 'manual' && proposal.source !== 'plantilla' && proposal.confidence !== 'low';
    if (!canAutoSend) {
      return {
        status: 'draft',
        result: {
          executed: 'borrador',
          next_review_at: null,
          note: mode === 'auto' && origin !== 'manual'
            ? 'Modo automático: este borrador no cumple todas las condiciones para enviarse solo (requiere IA y certeza media o alta).'
            : 'Borrador listo para que el equipo lo revise y lo envíe.',
        },
      };
    }
    try {
      const sent = await portal.replyFromAssistant(caseId, {
        message: validation.draft.text_for_client,
        action: rec.action,
        key: shortKey(runKey),
        answering: pendingMessages(state).length > 0,
      });
      if (!sent.sent) return { status: 'skipped', result: { executed: 'omitido', next_review_at: null, note: sent.reason } };
      const after = await engine.getCase(caseId);
      const nextRec = after.current?.recommendation;
      return {
        status: 'sent',
        result: {
          executed: 'mensaje_enviado',
          event_id: sent.event_id,
          sent_at: sent.at,
          next_review_at: nextRec?.timing === 'at_date' ? nextRec.scheduled_for : null,
          note: 'Enviado automáticamente: pasó todas las validaciones y las reglas se revisaron justo antes de enviar.',
        },
      };
    } catch (err) {
      if (err.code === 'CONTACT_BLOCKED') return { status: 'blocked', result: { executed: 'bloqueado', next_review_at: null, note: err.message } };
      throw err;
    }
  }

  // Ciclo completo para una cotización.
  async function runForCase(caseId, { origin = 'manual', analysisQuestion = '' } = {}) {
    if (typeof analysisQuestion !== 'string' || analysisQuestion.length > 1200) throw new EngineError('La pregunta interna debe tener hasta 1200 caracteres.');
    analysisQuestion = analysisQuestion.trim();
    if (analysisQuestion && origin !== 'manual') throw new EngineError('Las preguntas internas solo se generan por solicitud del equipo.');
    const background = origin !== 'manual';
    const evaluationAt = await engine.getEvaluationAt();
    if (!evaluationAt) throw new EngineError('Falta la hora de evaluación: carga el manifest o activa el reloj en vivo.', 409, 'NO_EVALUATION_TIME');

    // 1) Consultar la cotización con la decisión del motor al día.
    await engine.evaluate({ caseIds: [caseId] });
    const detail = await engine.getCase(caseId);
    const rec = detail.current?.recommendation;
    if (!rec) throw new EngineError('El caso todavía no tiene una recomendación del motor.', 409, 'NO_DECISION');
    const state = buildCaseState(caseId, detail.events);
    const lastSeq = detail.events.at(-1)?.seq ?? 0;
    const runKey = [caseId, lastSeq, rec.action, rec.timing, rec.scheduled_for ?? '-', background ? 'auto' : `manual-${Date.now()}`].join('|');
    if (background) {
      const existing = await storage.findAssistantRunByKey(runKey);
      if (existing) return { ...existing, reused: true };
    }

    // 2) Reglas a esta hora (incluye las fechas de espera que pidió el cliente).
    const interpretations = detail.current.detail?.interpretations ?? {};
    const rules = evaluateRules(state, evaluationAt, { clientDelays: activeClientDelays(state, interpretations) });
    const customerRecord = state.customer_id ? await storage.getCustomer(state.customer_id) : null;
    const lessons = pickLessons(await storage.listLessons({ limit: 30 }), { customerId: state.customer_id, limit: 3 });
    const situation = situationOf(state, interpretations, rec);
    const corrections = pickCorrections(await storage.listAssistantFeedback({ limit: 60 }), situation);
    const contactName = state.request?.contact_name || customerRecord?.contact_name || null;
    const names = personalNames({ contactName, companyName: customerRecord?.name });

    // 3) La IA propone. En segundo plano no se gasta una llamada si el motor ya decidió esperar o cerrar.
    const useAI = !background || AI_ACTIONS.includes(rec.action);
    const proposal = await proposeNextStep({ provider, detail, state, rules, knowledge, customerRecord, lessons, corrections, evaluationAt, useAI, names, analysisQuestion });

    const brief = analystBrief({ state, detail });
    const reportedNumbers = new Set([30, state.amount_mxn, brief.questions_count, brief.purchases_recorded].filter(n => typeof n === 'number'));
    const collect = value => { if (typeof value === 'number') reportedNumbers.add(value); else if (value && typeof value === 'object') Object.values(value).forEach(collect); };
    collect(brief.energy);
    const safeText = text => {
      const numbers = extractNumbers(text);
      // La IA no puede generar un tamaño de sistema ni cambiar las cifras calculadas.
      return !/\d[\d,.]*\s*(?:paneles|kW\b)/i.test(text) && numbers.every(n => reportedNumbers.has(n));
    };
    const analysis = proposal.analyst_analysis;
    if (analysis) {
      for (const key of ['hypotheses', 'questions_for_client', 'checks_for_team', 'next_steps']) {
        brief[key] = [...new Set([...brief[key], ...analysis[key].filter(safeText)])].slice(0, key === 'hypotheses' || key === 'next_steps' ? 3 : 6);
      }
      if (analysis.assessment && safeText(analysis.assessment)) brief.assessment = analysis.assessment;
      else if (analysis.assessment) brief.analysis_note = 'El modelo propuso cifras sin respaldo; se conservó el análisis calculado con los datos registrados.';
    }
    proposal.analyst_brief = brief;
    proposal.analysis_question = scrubPersonalData(analysisQuestion, names);
    delete proposal.analyst_analysis;

    // 4) Validar con las políticas y los datos actuales.
    const approved = approvedNumbers(knowledge, caseTexts(state, detail.events));
    const validation = checkProposal(proposal, { state, rules, recommendation: rec, interpretations, approved });
    validation.situation = situation;
    if (validation.draft) validation.draft.text_for_client = fillPlaceholders(validation.draft.text, { contactName });

    // 5) Ejecutar lo autorizado y 6) registrar.
    const execution = analysisQuestion
      ? { status: 'needs_review', result: { executed: 'analisis_interno', note: 'Análisis solicitado por el equipo; no se envió ningún mensaje al cliente.' } }
      : await execute({ caseId, origin, rec, state, proposal, validation, runKey });
    const saved = await storage.saveAssistantRun({
      case_id: caseId,
      run_key: runKey,
      origin,
      last_seq: lastSeq,
      status: execution.status,
      source: proposal.source,
      model: proposal.model,
      knowledge_version: knowledge.version,
      proposal,
      validation,
      result: { ...execution.result, decision_id: detail.current.id },
    });
    if (background) logger.log?.(`[asistente] ${caseId}: ${execution.status} (${proposal.source})`);
    return saved;
  }

  // Llamado por el portal cuando el cliente escribe o envía una solicitud. No bloquea al cliente.
  function onActivity(caseId, origin = 'mensaje') {
    if (!active || mode === 'off') return Promise.resolve(null);
    return enqueue(() => runForCase(caseId, { origin })).catch((err) => {
      logger.error?.(`[asistente] ${caseId}: ${err.message}`);
      return null;
    });
  }

  // Revisión programada: busca cotizaciones del portal cuya decisión vigente pide actuar.
  async function sweep() {
    if (mode === 'off' || sweeping) return [];
    const clock = await engine.getClock();
    if (clock.mode !== 'live' || !clock.evaluation_at) return [];
    sweeping = true;
    try {
      await engine.evaluate();
      const due = (await engine.listCases()).filter((c) => c.customer_id && c.status !== 'closed' && c.recommendation && AI_ACTIONS.includes(c.recommendation.action));
      const runs = [];
      for (const c of due) {
        const run = await enqueue(() => runForCase(c.case_id, { origin: 'revision' })).catch((err) => {
          logger.error?.(`[asistente] ${c.case_id}: ${err.message}`);
          return null;
        });
        if (run) runs.push(run);
      }
      lastSweep = { at: new Date().toISOString(), cases: due.length, new_runs: runs.filter((r) => !r.reused).length };
      return runs;
    } finally {
      sweeping = false;
    }
  }

  // timers=false activa el trabajo por mensajes sin la revisión periódica (útil en pruebas).
  function start({ timers = true } = {}) {
    if (active) return;
    active = true;
    if (mode === 'off' || !timers) return;
    const tick = () => sweep().catch((err) => logger.error?.(`[asistente] revisión programada: ${err.message}`));
    firstTimer = setTimeout(tick, 5000);
    timer = setInterval(tick, Math.max(1, reviewMinutes) * 60000);
    firstTimer.unref?.();
    timer.unref?.();
  }

  function stop() {
    active = false;
    clearTimeout(firstTimer);
    clearInterval(timer);
    timer = null;
  }

  // La propuesta más reciente de una cotización, si sigue vigente y si viene una nueva en camino.
  async function latest(caseId) {
    const events = await storage.getCaseEvents(caseId);
    if (!events.length) throw new EngineError(`No existe el caso ${caseId}.`, 404, 'NOT_FOUND');
    const [run] = await storage.listAssistantRuns({ case_id: caseId, limit: 1 });
    const [decision] = await storage.decisionHistory(caseId, 1);
    let current = false;
    if (run) {
      const newer = events.filter((e) => e.seq > (run.last_seq ?? 0));
      // Si la propuesta ya se envió (el asistente o el equipo), sigue vigente mientras el cliente no haga algo nuevo.
      current = ['sent', 'sent_by_team'].includes(run.status)
        ? newer.every((e) => e.event_type === 'action.executed')
        : newer.length === 0 && run.validation?.authorized?.action === decision?.recommendation?.action;
    }
    // Llegará una propuesta sola si el asistente trabaja en segundo plano y el cliente hizo algo después.
    const lastClient = [...events].reverse().find((e) => e.event_type === 'message.received'
      || (e.event_type === 'case.opened' && e.data?.proposal_status === 'pending'));
    const closed = events.some((e) => e.event_type === 'case.closed');
    const expecting = active && mode !== 'off' && !closed && !current && Boolean(lastClient) && (!run || lastClient.seq > (run.last_seq ?? 0));
    return { case_id: caseId, mode, run: run ?? null, current, expecting, ai: providerStatus(provider) };
  }

  // El equipo envió una respuesta partiendo de un borrador: se guarda como corrección si la cambió.
  async function recordFeedback({ runId, caseId, finalMessage }) {
    const run = Number.isFinite(Number(runId)) ? await storage.getAssistantRun(Number(runId)) : null;
    if (!run || run.case_id !== caseId) return null;
    const draft = run.validation?.draft?.text_for_client ?? run.proposal?.draft_message ?? null;
    if (!draft) return null;
    const finalText = String(finalMessage ?? '').replace(/\s+/g, ' ').trim().slice(0, 1000);
    if (!finalText) return null;
    const edited = squash(draft) !== squash(finalText);
    const state = buildCaseState(caseId, await storage.getCaseEvents(caseId));
    const customer = state.customer_id ? await storage.getCustomer(state.customer_id) : null;
    const names = personalNames({ contactName: state.request?.contact_name || customer?.contact_name || '', companyName: customer?.name });
    const saved = await storage.saveAssistantFeedback({
      run_id: run.id,
      case_id: caseId,
      situation: run.validation?.situation ?? {},
      draft: scrubPersonalData(draft, names),
      final_message: scrubPersonalData(finalText, names),
      edited,
    });
    await storage.updateAssistantRun(run.id, {
      status: 'sent_by_team',
      result: {
        ...run.result,
        sent_by_team: true,
        edited,
        note: edited ? 'El equipo lo envió con cambios; la corrección se guardó como ejemplo para próximas propuestas.' : 'El equipo envió el borrador tal cual.',
      },
    });
    return saved;
  }

  async function status() {
    const runs = await storage.listAssistantRuns({ limit: 200 });
    const feedback = await storage.listAssistantFeedback({ limit: 500 });
    return {
      ai: providerStatus(provider),
      autopilot: { mode, active, review_minutes: reviewMinutes, last_sweep: lastSweep },
      knowledge: { version: knowledge.version, entries: knowledge.entries.length },
      examples: EJEMPLOS.length,
      corrections: {
        total: feedback.length,
        edited: feedback.filter((f) => f.edited).length,
        recent: feedback.filter((f) => f.edited).slice(0, 5),
      },
      runs: {
        recent: runs.length,
        by_status: runs.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {}),
        by_source: runs.reduce((acc, r) => ({ ...acc, [r.source]: (acc[r.source] || 0) + 1 }), {}),
      },
    };
  }

  return {
    mode, knowledge, runForCase, onActivity, sweep, start, stop, latest, recordFeedback, status,
    idle: () => queue,
  };
}
