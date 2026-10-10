import { ACTION_LABEL, CLOSED_LABEL, RISK_LABEL, fmtMoney, valueText } from '../format.js';

function shortTiming(rec) {
  if (!rec) return '';
  if (rec.timing === 'at_date') return valueText('scheduled_for', rec.scheduled_for);
  return valueText('timing', rec.timing);
}

// Primero las cotizaciones abiertas (lo que hay que atender), luego las cerradas; las más recientes arriba.
function ordered(cases) {
  return [...cases].sort((a, b) => {
    const ca = a.status === 'closed' ? 1 : 0;
    const cb = b.status === 'closed' ? 1 : 0;
    if (ca !== cb) return ca - cb;
    const ta = a.last_event_at ? Date.parse(a.last_event_at) : 0;
    const tb = b.last_event_at ? Date.parse(b.last_event_at) : 0;
    return tb - ta || a.case_id.localeCompare(b.case_id);
  });
}

export default function CaseList({ cases, selected, onSelect }) {
  return (
    <nav className="caselist" aria-label="Casos">
      <div className="caselist-head">
        <h2>Casos</h2>
        <span className="muted">{cases.length}</span>
      </div>
      <ul>
        {ordered(cases).map((c) => {
          const rec = c.recommendation;
          return (
            <li key={c.case_id}>
              <button
                type="button"
                className={`case-row ${selected === c.case_id ? 'case-row-active' : ''}`}
                onClick={() => onSelect(c.case_id)}
                aria-current={selected === c.case_id ? 'true' : undefined}
              >
                <span className="case-row-top">
                  <span className="case-id">{c.case_id}</span>
                  <span className="case-amount">{c.proposal_pending ? 'Por cotizar' : fmtMoney(c.amount_mxn)}</span>
                </span>
                {c.customer_name && <span className="case-customer">{c.customer_name}</span>}
                {c.stage_label && <span className={`stage-chip stage-${c.stage}`}>{c.stage_label}</span>}
                {rec ? (
                  <span className={`case-action act-${rec.action}`}>{ACTION_LABEL[rec.action]}</span>
                ) : (
                  <span className="case-action act-none">Sin evaluar</span>
                )}
                <span className="case-row-bottom">
                  <span>{shortTiming(rec)}</span>
                  {rec && <span className={`risk risk-${rec.risk_level}`}>Riesgo {RISK_LABEL[rec.risk_level].toLowerCase()}</span>}
                </span>
                <span className="case-flags">
                  {c.status === 'closed' && <span className="flag">Cerrado ({CLOSED_LABEL[c.closed_status]})</span>}
                  {c.contact_allowed === false && c.status !== 'closed' && <span className="flag flag-stop">Contacto prohibido</span>}
                  {rec?.requires_human_review && <span className="flag">Revisión humana</span>}
                  {c.inaction_kind === 'pattern' && <span className="flag flag-trust">Espera por historial</span>}
                  {c.changed && <span className="flag flag-changed">Cambió</span>}
                  {c.stale && <span className="flag flag-stale">Pendiente de evaluar</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
