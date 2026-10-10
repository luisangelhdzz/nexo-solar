import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { ACTION_LABEL, fmtUtc, timingText } from '../format.js';
import './assistant.css';

// Propuesta del asistente (Gemini u otra IA): resumen, necesidad, acción y momento, explicación,
// borrador, datos faltantes y revisión humana. La acción autorizada siempre es la del motor de reglas.

const STATUS = {
  draft: { label: 'Borrador listo', tone: 'go' },
  needs_review: { label: 'Requiere revisión humana', tone: 'warn' },
  sent: { label: 'Enviado por el asistente', tone: 'go' },
  sent_by_team: { label: 'Enviado por el equipo', tone: 'go' },
  scheduled: { label: 'Revisión programada', tone: 'hold' },
  no_action: { label: 'Sin acción', tone: 'hold' },
  blocked: { label: 'Bloqueado por las reglas', tone: 'stop' },
  skipped: { label: 'Omitido', tone: 'hold' },
};
const MODE = {
  off: 'solo cuando lo pides',
  draft: 'prepara borradores solo, nunca envía',
  auto: 'envía solo lo que pasa todas las validaciones',
};
const ORIGIN = { manual: 'pedido por el equipo', mensaje: 'nuevo mensaje', solicitud: 'nueva solicitud', revision: 'revisión programada' };

export default function AssistantPanel({ detail, onUseDraft, disabled }) {
  const caseId = detail.case_id;
  const lastSeq = detail.events[detail.events.length - 1]?.seq ?? 0;
  const decisionId = detail.current?.id ?? null;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [question, setQuestion] = useState('');
  useEffect(() => { setQuestion(''); }, [caseId]);

  const load = useCallback(async () => {
    try {
      setData(await api.assistant(caseId));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [caseId]);

  useEffect(() => { load(); }, [load, lastSeq, decisionId]);

  // Mientras el asistente trabaja en segundo plano, se consulta cada 5 s durante un minuto.
  const waiting = Boolean(data?.expecting);
  useEffect(() => {
    if (!waiting) return undefined;
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      if (n > 12) clearInterval(id);
      else load();
    }, 5000);
    return () => clearInterval(id);
  }, [waiting, load]);

  const generate = async (analysisQuestion = '') => {
    setLoading(true);
    setError('');
    try {
      const run = await api.runAssistant(caseId, analysisQuestion);
      setData((d) => ({ ...(d || {}), run, current: true }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const ai = data?.ai;
  const run = data?.run;
  return (
    <div className="assistant" aria-live="polite">
      <div className="assistant-head">
        <div>
          <h4>Asistente comercial</h4>
          <p className="muted small">
            {ai?.mode === 'ai' ? `Conectado a ${ai.provider}` : 'Usando borradores de apoyo'}
            {data?.mode ? ` · ${MODE[data.mode] ?? data.mode}` : ''}.
          </p>
        </div>
        <button type="button" className="btn btn-small" onClick={() => generate()} disabled={loading || disabled}>
          {loading ? 'Pensando…' : run ? 'Generar de nuevo' : 'Generar propuesta'}
        </button>
      </div>
      <details className="assistant-internal">
        <summary>Consultar al asistente como analista</summary>
        <form onSubmit={(e) => { e.preventDefault(); generate(question.trim()); }}>
          <label>¿Qué necesitas analizar?<textarea required minLength={5} maxLength={1200} rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="¿Qué datos de consumo faltan y qué aparatos debemos revisar antes de cotizar?" /></label>
          <button type="submit" className="btn btn-small" disabled={loading || disabled || question.trim().length < 5}>{loading ? 'Analizando…' : 'Analizar para el equipo'}</button>
          <p className="muted small">Esta consulta es interna y no envía mensajes al cliente.</p>
        </form>
      </details>
      {ai?.note && ai.mode === 'ai' && <p className="assistant-alert small">{ai.note}</p>}
      {error && <p className="proposal-error" role="alert">{error}</p>}
      {!run && !loading && <p className="muted small">{waiting ? 'El asistente está preparando su propuesta…' : 'Aún no hay propuesta del asistente para esta cotización.'}</p>}
      {run && <AssistantRun run={run} current={data.current} waiting={waiting} onUseDraft={onUseDraft} disabled={disabled} />}
    </div>
  );
}

function AssistantRun({ run, current, waiting, onUseDraft, disabled }) {
  const p = run.proposal;
  const v = run.validation;
  const st = STATUS[run.status] ?? { label: run.status, tone: 'hold' };
  const draft = v.draft;
  const canUse = draft && v.allowed_now && ['contact', 'request_information', 'resolve_objection'].includes(v.authorized.action) && !['sent', 'sent_by_team'].includes(run.status);
  return (
    <div className="assistant-run">
      <div className="assistant-meta">
        <span className={`pill assistant-tone-${st.tone}`}>{st.label}</span>
        <span className="pill">{run.source === 'plantilla' ? 'Plantilla (sin IA)' : run.source}</span>

      </div>
      {!current && <p className="assistant-alert small">{waiting ? 'Hay cambios en la cotización; el asistente está preparando una propuesta nueva.' : 'Hay cambios después de esta propuesta. Genera una nueva para usarla.'}</p>}
      {(p.fallback_reason || p.note) && <p className="muted small">{p.fallback_reason || p.note}</p>}

      {p.analyst_brief && <AnalystBrief brief={p.analyst_brief} question={p.analysis_question} />}
      <p className="assistant-next"><strong>{ACTION_LABEL[v.authorized.action] ?? v.authorized.action}</strong> · {timingText(v.authorized)}</p>
      <details className="assistant-checks"><summary>Ver análisis del asistente</summary><dl className="assistant-grid">
        <div><dt>Resumen</dt><dd>{p.summary}</dd></div>
        <div><dt>Necesidad del cliente</dt><dd>{p.customer_need}</dd></div>
        <div>
          <dt>Acción y momento</dt>
          <dd>
            <strong>{ACTION_LABEL[v.authorized.action] ?? v.authorized.action}</strong> · {timingText(v.authorized)}
            {!v.agrees_with_engine && <span className="assistant-note">La IA sugería «{ACTION_LABEL[p.proposed_action] ?? p.proposed_action}»; manda el motor de reglas.</span>}
          </dd>
        </div>
        <div>
          <dt>Revisión humana</dt>
          <dd>{v.requires_human_review ? <ul>{v.human_review_reasons.map((r) => <li key={r}>{r}</li>)}</ul> : 'No hace falta.'}</dd>
        </div>
        <div className="wide">
          <dt>Explicación y evidencia</dt>
          <dd>
            {p.explanation}
            {(p.evidence_event_ids.length > 0 || p.knowledge_used.length > 0) && (
              <span className="assistant-refs">
                {p.evidence_event_ids.length > 0 && <>Eventos: {p.evidence_event_ids.join(', ')}</>}
                {p.evidence_event_ids.length > 0 && p.knowledge_used.length > 0 && ' · '}
                {p.knowledge_used.length > 0 && <>Conocimiento: {p.knowledge_used.join(', ')}</>}
              </span>
            )}
          </dd>
        </div>
        {p.missing_information.length > 0 && (
          <div className="wide"><dt>Datos faltantes</dt><dd><ul>{p.missing_information.map((m) => <li key={m}>{m}</li>)}</ul></dd></div>
        )}
      </dl></details>

      {draft && (
        <div className={`assistant-draft${draft.sendable ? '' : ' is-blocked'}`}>
          <p className="assistant-draft-label">{draft.sendable ? 'Borrador para el cliente' : 'Borrador (no se puede enviar así)'}</p>
          <blockquote>{draft.text_for_client}</blockquote>
          {canUse && (
            <button type="button" className="btn btn-small" disabled={disabled} onClick={() => onUseDraft(draft.text_for_client, run.id)}>
              {draft.sendable ? 'Usar este borrador' : 'Usar y corregir'}
            </button>
          )}
        </div>
      )}
      {run.result?.note && <p className="muted small">{run.result.note}{run.result.next_review_at ? ` Próxima revisión: ${fmtUtc(run.result.next_review_at)}.` : ''}</p>}

      <details className="assistant-checks">
        <summary>Comprobaciones y detalles</summary>
        <p className="muted small">{run.model} · {ORIGIN[run.origin] ?? run.origin} · {fmtUtc(run.created_at)}</p>
        <ul>
          {v.checks.map((c) => (
            <li key={c.id} className={c.ok ? 'ok' : c.severity === 'warning' ? 'warn' : 'bad'}>
              <span aria-hidden="true">{c.ok ? '✓' : c.severity === 'warning' ? '!' : '✕'}</span> {c.message}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function AnalystBrief({ brief, question }) {
  const e = brief.energy;
  const value = (n, unit) => n == null ? 'Falta dato' : `${n.toLocaleString('es-MX')} ${unit}`;
  return <section className="assistant-analyst" aria-label="Análisis para preparar la cotización">
    <h4>Análisis para preparar la cotización</h4>
    {question && <details className="assistant-checks" open><summary>Respuesta a tu consulta</summary><p className="muted small">{question}</p><p>{brief.assessment}</p></details>}
    <dl className="assistant-grid">
      <div><dt>Consumo reportado</dt><dd>{value(e.reported_kwh, 'kWh')}{e.billing_days ? ` en ${e.billing_days} días` : ''}</dd></div>
      <div><dt>Consumo · 30 días</dt><dd>{value(e.normalized_kwh_30_days, 'kWh')}</dd></div>
      <div><dt>Aparatos · estimación</dt><dd>{value(e.inventory_estimated_kwh_month, 'kWh/mes')}{e.appliances.length > 0 && !e.inventory_complete && <span className="assistant-note">Completar datos de aparatos.</span>}</dd></div>
      <div><dt>Inmueble</dt><dd>{e.property_type === 'home' ? 'Casa' : 'Negocio'}{e.rooms ? ` · ${e.rooms} cuartos o áreas` : ''}</dd></div>
    </dl>
    {brief.questions_count >= 4 && <p className="assistant-alert small">{brief.questions_count} preguntas · Compra pendiente</p>}
    {brief.analysis_note && <p className="assistant-alert small">{brief.analysis_note}</p>}
    <p className="assistant-next"><strong>Para el equipo:</strong> {brief.next_steps[0]}</p>
    <details className="assistant-checks"><summary>Qué falta para cotizar</summary>
      {!question && <p>{brief.assessment}</p>}
      <p className="muted small">{brief.commercial_signal}</p>
      {[['Pedir al cliente', brief.questions_for_client], ['Validar con el equipo', brief.checks_for_team], ['Siguiente paso interno', brief.next_steps], ['Hipótesis por confirmar', brief.hypotheses]].map(([label, items]) => items.length > 0 && <div key={label}><h5>{label}</h5><ul>{items.map(item => <li key={item}>{item}</li>)}</ul></div>)}
      {e.appliances.length > 0 && <div className="assistant-appliances"><table><thead><tr><th>Aparato</th><th>Cantidad</th><th>Estimación kWh/mes</th></tr></thead><tbody>{e.appliances.map((a, i) => <tr key={i}><td>{a.name}</td><td>{a.quantity}</td><td>{value(a.estimated_kwh_month, 'kWh')}</td></tr>)}</tbody></table></div>}
      <p className="muted small">{e.method}</p><ul>{e.limitations.map(text => <li key={text}>{text}</li>)}</ul>
    </details>
  </section>;
}
