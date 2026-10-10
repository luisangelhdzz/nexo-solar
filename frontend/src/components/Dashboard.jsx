import { useState } from 'react';
import { ACTION_LABEL, INACTION_KIND, fmtRelative, timingText } from '../format.js';

function Tile({ value, label, tone, onClick }) {
  return <button type="button" className={`tile-stat ${tone ? `tile-stat-${tone}` : ''}`} onClick={onClick}><span className="tile-stat-value">{value}</span><span className="tile-stat-label">{label}</span></button>;
}
function CaseCards({ items, now, onOpenCase, empty }) {
  const [all, setAll] = useState(false);
  return <>{!items.length && <p className="muted">{empty}</p>}<ul className="act-list compact-case-list">{(all ? items : items.slice(0, 5)).map(c => <li key={c.case_id}><button type="button" className="act-item" onClick={() => onOpenCase(c.case_id)}><span className="task-title"><strong>{c.customer_name || c.case_id}</strong><span aria-hidden="true">→</span></span><span className={`act-${c.action}`}>{ACTION_LABEL[c.action] || 'Revisar cotización'} · {c.scheduled_for ? fmtRelative(c.scheduled_for, now) : (c.timing ? timingText(c) : 'Abrir cotización')}</span><span className="muted small">{c.kind ? INACTION_KIND[c.kind]?.label : c.requires_human_review ? 'Requiere revisión del equipo' : c.case_id}</span></button></li>)}</ul>{items.length > 5 && <button type="button" className="btn btn-small" onClick={() => setAll(!all)}>{all ? 'Ver menos' : `Ver las ${items.length} cotizaciones`}</button>}</>;
}
export default function Dashboard({ summary, onOpenCase, onSeed, onKit, busy }) {
  const [tab, setTab] = useState('attention');
  if (!summary) return <section className="dash-empty">Cargando resumen…</section>;
  const { totals, inaction, act_now: actNow, human_review: human, upcoming, clock } = summary;
  const now = clock?.evaluation_at;
  const humanCount = human.length;
  if (!totals.cases) return <section className="dash-empty"><h2>Todo listo para recibir solicitudes</h2><p className="muted">Comparte el formulario del portal con tus clientes.</p><a className="btn btn-primary" href="/portal#/cotizar" target="_blank" rel="noreferrer">Abrir formulario</a><details className="case-more"><summary>Probar con datos de demostración</summary><div className="kit-buttons"><button className="btn" disabled={Boolean(busy)} onClick={onSeed}>Cargar demo</button><button className="btn" disabled={Boolean(busy)} onClick={onKit}>Cargar casos del reto</button></div></details></section>;
  return <div className="dashboard">
    <section className="dash-hero"><p className="dash-kicker">Tu jornada comercial</p><h2 className="dash-headline">{actNow.length ? `${actNow.length} ${actNow.length === 1 ? 'cotización necesita' : 'cotizaciones necesitan'} atención` : 'Tu seguimiento está al día'}</h2><p className="dash-sub">{inaction.count} en espera · {totals.requests ?? 0} {(totals.requests ?? 0) === 1 ? 'solicitud por cotizar' : 'solicitudes por cotizar'}</p></section>
    <div className="tiles-row"><Tile value={totals.requests ?? 0} label="Por cotizar" tone="warn" onClick={() => setTab('attention')} /><Tile value={actNow.length} label="Atender ahora" tone="go" onClick={() => setTab('attention')} /><Tile value={inaction.count} label="En espera" tone="hold" onClick={() => setTab('waiting')} /><Tile value={humanCount} label="Revisar en equipo" tone="warn" onClick={() => setTab('review')} /><Tile value={totals.accepted} label="Ventas concretadas" onClick={() => setTab('results')} /></div>
    <section className="panel task-board"><div className="task-tabs" role="tablist" aria-label="Seguimiento"><button type="button" role="tab" aria-selected={tab === 'attention'} onClick={() => setTab('attention')}>Atender ahora</button><button type="button" role="tab" aria-selected={tab === 'waiting'} onClick={() => setTab('waiting')}>En espera</button><button type="button" role="tab" aria-selected={tab === 'review'} onClick={() => setTab('review')}>Revisión del equipo</button><button type="button" role="tab" aria-selected={tab === 'results'} onClick={() => setTab('results')}>Resultados</button></div>
      {tab === 'attention' && <CaseCards key="attention" items={actNow} now={now} onOpenCase={onOpenCase} empty="No hay acciones urgentes. Consulta la agenda para los próximos seguimientos." />}
      {tab === 'waiting' && <><p className="muted small">Respeta estos tiempos antes de volver a contactar.</p><CaseCards key="waiting" items={inaction.cases} now={now} onOpenCase={onOpenCase} empty="No hay cotizaciones en espera." /></>}
      {tab === 'review' && <CaseCards key="review" items={human.map(id => [...actNow, ...inaction.cases].find(c => c.case_id === id) || {case_id:id,requires_human_review:true})} now={now} onOpenCase={onOpenCase} empty="No hay revisiones pendientes." />}
      {tab === 'results' && <div className="result-stats"><p><strong>{totals.accepted}</strong> ventas concretadas</p><p><strong>{totals.rejected ?? 0}</strong> no concretadas</p><p><strong>{totals.cancelled ?? 0}</strong> canceladas</p></div>}
    </section>
    <section className="panel"><h3>Próximos seguimientos</h3><CaseCards key="agenda" items={upcoming} now={now} onOpenCase={onOpenCase} empty="No hay seguimientos programados." /></section>
  </div>;
}
