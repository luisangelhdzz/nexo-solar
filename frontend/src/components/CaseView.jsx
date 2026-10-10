import { useState } from 'react';
import {
  ACTIONS, ACTION_HINT, ACTION_LABEL, CLOSED_LABEL, EVENT_LABEL, FIELD_LABEL, INTENT_LABEL,
  LEVEL_LABEL, RISK_LABEL, fmtMoney, fmtUtc, eventSummary, timingText, valueText,
} from '../format.js';
import ProposalPanel from './ProposalPanel.jsx';
import Simulator from './Simulator.jsx';
import PatienceMeter from './PatienceMeter.jsx';
import { TIER_LABEL, fmtHours } from '../format.js';

function customerEventSummary(ev) {
  const data = ev.data || {};
  if (ev.event_type === 'case.opened') return data.proposal_status === 'pending' ? 'El cliente envió una solicitud de cotización' : `Cotización enviada por ${fmtMoney(data.proposal_amount_mxn)}`;
  if (ev.event_type === 'proposal.sent') return `Propuesta publicada: ${data.title}, ${fmtMoney(data.proposal_amount_mxn)}`;
  if (ev.event_type === 'action.executed' && data.message) return `Respuesta del equipo: ${data.message}`;
  if (ev.event_type === 'action.executed') return `Acción realizada: ${ACTION_LABEL[data.action] ?? 'Actividad del equipo'}`;
  if (ev.event_type === 'proposal.viewed') {
    const section = { price: 'Precio', installation: 'Instalación', warranty: 'Garantía', financing: 'Financiamiento', delivery: 'Entrega' }[data.section];
    return section ? `Sección consultada: ${section}` : 'El cliente revisó la cotización';
  }
  return eventSummary(ev);
}

function revealEvidence(id) {
  const item = document.getElementById(`ev-${id}`);
  const container = item?.closest('.timeline-scroll');
  if (!container) return;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  container.scrollTo({ top: container.scrollTop + item.getBoundingClientRect().top - container.getBoundingClientRect().top - 12, behavior: reducedMotion ? 'auto' : 'smooth' });
  container.focus({ preventScroll: true });
}

const fmtStageHours = (h) => (h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24 * 10) / 10} días`);

function StagePath({ stages }) {
  if (!stages?.transitions?.length) return null;
  const last = stages.transitions.length - 1;
  return (
    <section className="panel stages-panel" aria-label="Etapas de la cotización">
      <div className="section-head">
        <h3>Etapa actual: {stages.current_label}</h3>
        <p className="muted">Cómo avanzó la cotización y cuánto tiempo pasó en cada etapa.</p>
      </div>
      <ol className="stage-path">
        {stages.transitions.map((t, i) => (
          <li key={`${t.stage}-${t.event_id}`} className={`stage-step stage-${t.stage} ${i === last ? 'stage-current' : ''}`}>
            <span className="stage-name">{t.label}</span>
            <span className="stage-time">
              {t.hours !== null ? fmtStageHours(t.hours) : ['comprada', 'perdida'].includes(t.stage) ? 'Final' : '—'}
              {i === last && t.hours !== null ? ' hasta ahora' : ''}
            </span>
            <span className="stage-why muted small">{t.why}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function OutcomePanel({ outcome, lesson }) {
  if (!outcome) return null;
  const won = outcome.outcome === 'won';
  const pos = outcome.factors.filter((f) => f.direction === 'positive');
  const neg = outcome.factors.filter((f) => f.direction === 'negative');
  return (
    <section className={`panel outcome-panel ${won ? 'outcome-panel-won' : 'outcome-panel-lost'}`} aria-label="Análisis del resultado">
      <h3>{won ? 'Por qué se compró' : 'Por qué no se compró'}</h3>
      <p className="outcome-summary">{outcome.summary}</p>
      <div className="factor-cols">
        <div>
          <h4>A favor de la compra</h4>
          {pos.length ? <ul className="plain">{pos.map((f) => <li key={f.id}><strong>{f.label}.</strong> {f.detail}</li>)}</ul> : <p className="muted small">Ninguno destacado.</p>}
        </div>
        <div>
          <h4>En contra de la compra</h4>
          {neg.length ? <ul className="plain">{neg.map((f) => <li key={f.id}><strong>{f.label}.</strong> {f.detail}</li>)}</ul> : <p className="muted small">Ninguno destacado.</p>}
        </div>
      </div>
      <p className="muted small">
        Dudas: {outcome.metrics.doubts} ({outcome.metrics.unanswered} sin respuesta). Contactos de la empresa: {outcome.metrics.company_contacts}
        {outcome.metrics.contacts_during_wait ? `, ${outcome.metrics.contacts_during_wait} durante una espera recomendada` : ''}. Secciones revisadas: {outcome.metrics.sections_viewed}.
      </p>
      {lesson && (
        <p className="lesson-box">
          <strong>Lección:</strong> {lesson.lesson}{' '}
          <span className="muted small">({lesson.source === 'ia' ? `redactada por IA, ${lesson.model}` : 'plantilla'})</span>
        </p>
      )}
    </section>
  );
}

function CustomerContext({ customer, trace, state, rec, now }) {
  if (!customer) return null;
  const used = Boolean(trace?.customer?.used);
  const windowEnd = customer.patience_window_hours && (state.proposal_sent_at ?? state.opened_at)
    ? new Date(new Date(state.proposal_sent_at ?? state.opened_at).getTime() + customer.patience_window_hours * 3600000).toISOString()
    : null;
  return (
    <section className={`panel customer-ctx ${used ? 'customer-ctx-used' : ''}`} aria-label="Contexto del cliente">
      <div className="section-head">
        <h3>Contexto del cliente: {customer.name}</h3>
        <p className="muted">
          {used
            ? 'El historial de este cliente se usó para decidir cuánto esperar.'
            : customer.reliable
              ? 'Es buen cliente, pero en este caso manda lo que pidió o lo que permiten las reglas.'
              : 'No hay un patrón de compra suficiente; se decide con las reglas generales.'}
        </p>
      </div>
      <div className="ctx-facts">
        <span className="pill">{TIER_LABEL[customer.tier]}</span>
        <span className="pill">{customer.purchases} {customer.purchases === 1 ? 'compra' : 'compras'} previas</span>
        {customer.typical_decision_hours !== null && <span className="pill">Suele decidir en {fmtHours(customer.typical_decision_hours)}</span>}
        {customer.trusted && <span className="pill pill-trust">Cliente de confianza (ficha del equipo)</span>}
        {customer.decision_hours_override && <span className="pill">Equipo: decide en ~{customer.decision_hours_override} h</span>}
      </div>
      {used && windowEnd && <PatienceMeter openedAt={state.proposal_sent_at ?? state.opened_at} windowEnd={windowEnd} nowIso={now} typicalHours={customer.patience_hours} />}
      {customer.notes && <p className="muted small">Nota del equipo: {customer.notes}</p>}
      {rec?.action === 'wait' && used && <p className="small">Mientras tanto, nadie del equipo necesita hacer nada con esta cotización.</p>}
    </section>
  );
}

function DecisionHero({ rec, trace, evaluatedAt }) {
  return (
    <section className={`hero hero-${rec.action}`} aria-label="Recomendación vigente">
      <div className="hero-main">
        <p className="hero-kicker">Siguiente paso recomendado</p>
        <h2 className="hero-action">{ACTION_LABEL[rec.action]}</h2>
        <p className="hero-when">{timingText(rec)}</p>
      </div>
      <div className="hero-facts">
        <div>
          <span className="fact-label">Confianza</span>
          <span className={`fact-value lvl-${rec.confidence}`}>{LEVEL_LABEL[rec.confidence]}</span>
        </div>
        <div>
          <span className="fact-label">Riesgo</span>
          <span className={`fact-value risk-${rec.risk_level}`}>{RISK_LABEL[rec.risk_level]}</span>
        </div>
        <div>
          <span className="fact-label">Revisión humana</span>
          <span className="fact-value">{rec.requires_human_review ? 'Sí' : 'No'}</span>
        </div>
      </div>
      {trace?.guardian?.replaced && (
        <p className="hero-warning">
          El validador reemplazó la recomendación original ({trace.guardian.replaced_reason}).
        </p>
      )}
      <p className="hero-evaluated">Última evaluación: {fmtUtc(evaluatedAt)}</p>
    </section>
  );
}

function ActionBoard({ rec, rules, trace }) {
  return (
    <section className="board" aria-label="Acciones permitidas y bloqueadas">
      <div className="section-head">
        <h3>Qué permiten las reglas ahora</h3>
        <p className="muted">Las opciones disponibles respetan las preferencias del cliente y las políticas de contacto.</p>
      </div>
      <ol className="tiles">
        {ACTIONS.map((a) => {
          const info = rules?.actions?.[a];
          const allowed = info?.allowed ?? true;
          const chosen = rec.action === a;
          const suggestedBlocked = trace?.ideal?.action === a && !chosen && !allowed;
          return (
            <li
              key={a}
              className={`tile ${allowed ? 'tile-ok' : 'tile-blocked'} ${chosen ? 'tile-chosen' : ''} ${suggestedBlocked ? 'tile-suggested' : ''}`}
              title={ACTION_HINT[a]}
            >
              <span className="tile-name">{ACTION_LABEL[a]}</span>
              <span className="tile-state">
                {chosen ? 'Elegida' : allowed ? 'Permitida' : 'No disponible'}
              </span>
              {suggestedBlocked && <span className="tile-note">Era lo ideal, pero una regla lo impide</span>}
            </li>
          );
        })}
      </ol>
      {rules?.restrictions?.length > 0 && (
        <ul className="restrictions">
          {rules.restrictions.map((r) => (
            <li key={`${r.rule}-${r.until}`}>
              <span className="rule-tag">{r.rule === 'CLIENTE' ? 'Cliente' : 'Política'}</span>
              <span>{r.message}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function WhyPanel({ rec, trace, onHover }) {
  return (
    <section className="why" aria-label="Explicación">
      <h3>Por qué</h3>
      <p className="why-reason">{rec.reason}</p>

      <div className="why-evidence">
        <span className="fact-label">Evidencia</span>
        <div className="chips">
          {rec.evidence_event_ids.map((id, index) => (
            <button
              key={id}
              type="button"
              className="chip chip-evidence"
              onMouseEnter={() => onHover(id)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(id)}
              onBlur={() => onHover(null)}
              onClick={() => revealEvidence(id)}
            >
              Actividad {index + 1}
            </button>
          ))}
        </div>
      </div>

      <dl className="why-grid">
        <div>
          <dt>Confianza {LEVEL_LABEL[rec.confidence].toLowerCase()}</dt>
          <dd>{rec.confidence_reason}</dd>
        </div>
        <div>
          <dt>Riesgo {RISK_LABEL[rec.risk_level].toLowerCase()}</dt>
          <dd>{trace?.risk_reason || 'Sin detalle.'}</dd>
        </div>
        <div>
          <dt>Información faltante</dt>
          <dd>
            {rec.missing_information.length ? (
              <ul className="plain">
                {rec.missing_information.map((m) => <li key={m}>{m}</li>)}
              </ul>
            ) : 'No falta información esencial.'}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function ChangePanel({ current, previous }) {
  if (!previous) return null;
  const changes = current.changes ?? [];
  return (
    <section className="changes" aria-label="Qué cambió">
      <div className="section-head">
        <h3>Qué cambió desde la decisión anterior</h3>
        <p className="muted">
          Antes evaluado con {fmtUtc(previous.evaluation_at)}
          {current.new_event_ids?.length ? `; ${current.new_event_ids.length} actividades nuevas` : '; sin eventos nuevos (cambió la hora de evaluación)'}.
        </p>
      </div>
      {changes.length === 0 ? (
        <p>La recomendación se mantuvo igual.</p>
      ) : (
        <table className="diff">
          <thead>
            <tr><th scope="col">Campo</th><th scope="col">Antes</th><th scope="col">Ahora</th></tr>
          </thead>
          <tbody>
            {changes.filter((c) => c.field !== 'reason').map((c) => (
              <tr key={c.field}>
                <th scope="row">{FIELD_LABEL[c.field] ?? c.field}</th>
                <td className="diff-before">{valueText(c.field, c.before)}</td>
                <td className="diff-after">{valueText(c.field, c.after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {changes.some((c) => c.field === 'reason') && (
        <details className="diff-reason">
          <summary>Ver la explicación anterior</summary>
          <p>{previous.recommendation.reason}</p>
        </details>
      )}
    </section>
  );
}

function Interpretation({ it }) {
  if (!it) return null;
  return (
    <div className={`interp ${it.manipulation_attempt ? 'interp-alert' : ''}`}>
      <div className="interp-head">
        <span className="chip">{INTENT_LABEL[it.intent] ?? it.intent}{it.topic ? `: ${it.topic}` : ''}</span>
        <span className="muted">
          {it.source === 'heuristic' ? 'Clasificador de respaldo' : `IA ${it.model}`}, certeza {LEVEL_LABEL[it.confidence].toLowerCase()}
          {it.lessons_used ? `, con ${it.lessons_used} lecciones como contexto` : ''}
        </span>
      </div>
      {it.manipulation_attempt && (
        <p className="interp-warning">
          Este mensaje intenta dar instrucciones al sistema. Se trata como dato: no cambia ninguna regla.
        </p>
      )}
      <div className="interp-cols">
        <div>
          <h5>Hechos observados</h5>
          <ul className="plain">{it.facts.map((f) => <li key={f}>{f}</li>)}</ul>
        </div>
        <div>
          <h5>Inferencias</h5>
          <ul className="plain">{it.inferences.length ? it.inferences.map((f) => <li key={f}>{f}</li>) : <li>Ninguna</li>}</ul>
        </div>
        <div>
          <h5>Falta saber</h5>
          <ul className="plain">{it.missing_information.length ? it.missing_information.map((f) => <li key={f}>{f}</li>) : <li>Nada esencial</li>}</ul>
        </div>
      </div>
      {it.fallback_reason && <p className="muted small">{it.fallback_reason}</p>}
    </div>
  );
}

function Timeline({ events, interpretations, evidence, highlighted, newIds, hasPrevious, warnings }) {
  return (
    <section className="timeline" aria-label="Historial del caso">
      <div className="section-head">
        <h3>Historial</h3>
        <p className="muted">{events.length} actividades. Desplázate aquí para revisar el historial; las destacadas respaldan la recomendación.</p>
      </div>
      <div className="timeline-scroll" tabIndex={0} role="region" aria-label="Actividades de la cotización">
      <ol>
        {events.map((ev) => {
          const isEvidence = evidence.includes(ev.event_id);
          const warning = warnings?.filter((w) => w.event_id === ev.event_id) ?? [];
          return (
            <li
              key={ev.event_id}
              id={`ev-${ev.event_id}`}
              className={`tl-item tl-${ev.event_type.replace('.', '-')} ${isEvidence ? 'tl-evidence' : ''} ${highlighted === ev.event_id ? 'tl-highlight' : ''}`}
            >
              <div className="tl-meta">
                <span className="tl-time">{fmtUtc(ev.occurred_at, { withYear: false })}</span>
                {hasPrevious && newIds?.includes(ev.event_id) && <span className="flag flag-changed">Nuevo</span>}
              </div>
              <div className="tl-body">
                <span className="tl-type">{ev.event_type === 'case.opened' && ev.data.proposal_status === 'pending' ? 'Solicitud recibida' : EVENT_LABEL[ev.event_type]}</span>
                <p className={ev.event_type === 'message.received' ? 'tl-message' : 'tl-text'}>{customerEventSummary(ev)}</p>
                {ev.event_type === 'message.received' && interpretations?.[ev.event_id] && <details className="timeline-analysis"><summary>Ver análisis del mensaje</summary><Interpretation it={interpretations[ev.event_id]} /></details>}
                {warning.map((w) => <p key={w.message} className="tl-warning">{w.message}</p>)}
              </div>
            </li>
          );
        })}
      </ol>
      </div>
    </section>
  );
}

function TracePanel({ trace, rec }) {
  if (!trace) return null;
  const g = trace.guardian;
  const basis = {
    request: 'la solicitud y los datos del proyecto',
    message: 'el último mensaje del cliente',
    views: 'las aperturas de la propuesta',
    activity: 'el tiempo sin respuesta al último contacto',
    opened: 'la propuesta enviada sin actividad',
    closed: 'el cierre del caso',
    none: 'la falta de información',
    customer_pattern: 'el historial de compras del cliente (sigue dentro de su tiempo habitual)',
    customer_pattern_expired: 'el historial del cliente (ya pasó su tiempo habitual)',
  }[trace.ideal.basis];
  return (
    <section className="trace" aria-label="Cómo se decidió">
      <h3>Cómo se decidió</h3>
      <ol className="steps">
        <li>
          <strong>Interpretación.</strong>{' '}
          {trace.ideal.interpretation_event_id
            ? `Se interpretó el mensaje ${trace.ideal.interpretation_event_id} (ver historial).`
            : `No hay mensaje pendiente; se usó ${basis}.`}
        </li>
        <li>
          <strong>Acción sugerida:</strong> {ACTION_LABEL[trace.ideal.action]}, basada en {basis}.
        </li>
        <li>
          <strong>Reglas.</strong>{' '}
          {trace.blocked
            ? `La acción sugerida está bloqueada por ${trace.blocked_by.join(', ')}; se eligió ${ACTION_LABEL[rec.action]}.`
            : 'La acción sugerida está permitida.'}
        </li>
        {trace.learning && (
          <li>
            <strong>Lo aprendido.</strong> Versión {trace.learning.version}: seguimiento a las {trace.learning.follow_up_hours} h
            {trace.learning.follow_up_source === 'aprendido' ? ' (ajustado con datos)' : ' (predeterminado)'}
            {trace.learning.answer_within_hours ? `; las compras ganadas respondieron dudas en ~${trace.learning.answer_within_hours} h` : ''}.
          </li>
        )}
        <li>
          <strong>Validación final.</strong>{' '}
          {g.replaced ? `No pasó (${g.replaced_reason}); se publicó una alternativa segura.` : `Pasó ${g.checks.filter((c) => c.ok).length} de ${g.checks.length} comprobaciones.`}
          <ul className="checks">
            {g.checks.map((c) => (
              <li key={c.id} className={c.ok ? 'check-ok' : 'check-fail'}>
                <span aria-hidden="true">{c.ok ? '✓' : '✗'}</span> {c.message}
              </li>
            ))}
            {g.fixes.map((f) => (
              <li key={f} className="check-fix"><span aria-hidden="true">~</span> {f}</li>
            ))}
          </ul>
        </li>
      </ol>
    </section>
  );
}

function Issues({ issues }) {
  if (!issues?.length) return null;
  return (
    <section className="issues" aria-label="Problemas de carga">
      <h3>Problemas al cargar eventos de este caso</h3>
      <ul className="plain">
        {issues.map((i, idx) => (
          <li key={`${i.kind}-${i.event_id}-${idx}`}>
            {i.kind === 'duplicate'
              ? `${i.event_id} repetido en ${i.source ?? 'una carga'} (línea ${i.line}); se ignoró.`
              : `Línea ${i.line} de ${i.source ?? 'una carga'}: ${i.errors.join('; ')}`}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function CaseView({ detail, evaluationAt, clockMode, onSimulate, onEvaluate, onUpdate, busy }) {
  const [highlighted, setHighlighted] = useState(null);
  const { current, previous, state, events } = detail;
  const rec = current?.recommendation;
  const d = current?.detail;
  const lastSeq = events[events.length - 1]?.seq;
  const stale = !current || current.last_seq < lastSeq || (clockMode !== 'live' && current.evaluation_at !== evaluationAt);

  return (
    <article className="caseview">
      <header className="case-header">
        <h2>{detail.case_id}</h2>
        <span className="pill">{state.proposal_pending ? 'Monto por definir' : fmtMoney(state.amount_mxn)}</span>
        <span className="pill">
          {state.status === 'closed' ? `Cerrado: ${CLOSED_LABEL[state.closed_status]}` : state.status === 'open' ? 'Abierto' : 'Sin apertura'}
        </span>
        {state.status !== 'closed' && (
          <span className={`pill ${state.contact_allowed ? '' : 'pill-stop'}`}>
            {state.contact_allowed ? 'Contacto permitido' : 'Contacto prohibido'}
          </span>
        )}
        {state.contact_not_before && <span className="pill">No antes del {fmtUtc(state.contact_not_before)}</span>}
        <span className="pill">{events.length} eventos</span>
      </header>

      {stale && (
        <div className="stale">
          <span>{current ? 'Hay cambios sin evaluar en este caso.' : 'Este caso aún no se evalúa.'}</span>
          <button type="button" className="btn btn-small" onClick={onEvaluate} disabled={Boolean(busy) || !evaluationAt}>Evaluar ahora</button>
        </div>
      )}

      <ProposalPanel key={detail.case_id} detail={detail} onUpdate={onUpdate} busy={Boolean(busy)} />

      {rec && (
        <>
          <DecisionHero rec={rec} trace={d?.trace} evaluatedAt={current.evaluation_at} />
          <OutcomePanel outcome={detail.outcome} lesson={detail.lesson} />
          <CustomerContext customer={detail.customer} trace={d?.trace} state={state} rec={rec} now={evaluationAt} />
          <StagePath stages={detail.stages} />
          <ChangePanel current={current} previous={previous} />
          <ActionBoard rec={rec} rules={d?.rules} trace={d?.trace} />
          <div className="case-columns">
            <div className="col-left">
              <WhyPanel rec={rec} trace={d?.trace} onHover={setHighlighted} />
              <details className="case-more"><summary>Ver cómo se decidió</summary><TracePanel trace={d?.trace} rec={rec} /></details>
            </div>
            <div className="col-right">
              <Timeline
                events={events}
                interpretations={d?.interpretations}
                evidence={rec.evidence_event_ids}
                highlighted={highlighted}
                newIds={current.new_event_ids}
                hasPrevious={Boolean(previous)}
                warnings={d?.state?.warnings}
              />
              <Issues issues={detail.ingest_issues} />
              <Simulator caseId={detail.case_id} evaluationAt={evaluationAt} onSubmit={onSimulate} busy={busy} closed={state.status === 'closed'} />
            </div>
          </div>
        </>
      )}

      {!rec && (
        <Timeline events={events} interpretations={{}} evidence={[]} highlighted={null} newIds={[]} hasPrevious={false} warnings={state.warnings} />
      )}
    </article>
  );
}
