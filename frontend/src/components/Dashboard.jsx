import { ACTION_LABEL, INACTION_KIND, LEVEL_LABEL, RISK_LABEL, fmtRelative, fmtUtc, timingText } from '../format.js';

const KIND_ORDER = ['pattern', 'client', 'rules', 'no_signal'];
const lowerFirst = (t) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);

function Tile({ value, label, tone }) {
  return (
    <div className={`tile-stat ${tone ? `tile-stat-${tone}` : ''}`}>
      <span className="tile-stat-value">{value}</span>
      <span className="tile-stat-label">{label}</span>
    </div>
  );
}

function shorten(text, max = 210) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export default function Dashboard({ summary, onOpenCase, onSeed, onKit, busy }) {
  if (!summary) return <section className="dash-empty">Cargando resumen…</section>;
  const { totals, inaction, act_now: actNow, human_review: human, upcoming, invoices, clock } = summary;
  const now = clock?.evaluation_at;

  if (!totals.cases) {
    return (
      <section className="dash-empty">
        <h2>Todavía no hay cotizaciones</h2>
        <p className="muted">Carga los datos de demostración del portal (clientes con historial de compras) o el kit público del reto.</p>
        <div className="kit-buttons">
          <button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={onSeed}>Cargar datos de demostración</button>
          <button type="button" className="btn" disabled={Boolean(busy)} onClick={onKit}>Cargar kit del reto</button>
        </div>
      </section>
    );
  }

  const groups = KIND_ORDER.map((k) => ({ kind: k, items: inaction.cases.filter((c) => c.kind === k) })).filter((g) => g.items.length);

  return (
    <div className="dashboard">
      <section className="dash-hero" aria-label="Resumen de inacción">
        <p className="dash-kicker">Con la información de {fmtUtc(now)}</p>
        <h2 className="dash-headline">
          Lo correcto es no intervenir en {inaction.count} de {inaction.open_cases} cotizaciones abiertas.
        </h2>
        <p className="dash-sub">
          {actNow.length === 1 ? '1 necesita' : `${actNow.length} necesitan`} una acción
          {human.length ? `; ${human.length} ${human.length === 1 ? 'requiere' : 'requieren'} revisión humana` : ''}.
        </p>
      </section>

      <div className="tiles-row">
        <Tile value={totals.open} label="Cotizaciones abiertas" />
        <Tile value={inaction.count} label="No intervenir" tone="hold" />
        <Tile value={actNow.length} label="Actuar ahora" tone="go" />
        <Tile value={human.length} label="Revisión humana" tone="warn" />
        <Tile value={totals.accepted} label="Compras cerradas" />
        <Tile value={invoices.sent} label="Comprobantes enviados" />
      </div>

      <div className="dash-columns">
        <section className="panel" aria-label="Dónde no intervenir">
          <div className="section-head">
            <h3>Dónde no intervenir y por qué</h3>
            <p className="muted">Esperar también es una decisión: cada caso dice hasta cuándo y qué lo haría cambiar.</p>
          </div>
          {!groups.length && <p className="muted">Ninguna cotización abierta está en espera.</p>}
          {groups.map((g) => (
            <div key={g.kind} className="inaction-group">
              <h4>
                <span className={`kind-tag kind-${g.kind}`}>{INACTION_KIND[g.kind].label}</span>
                <span className="muted small">{INACTION_KIND[g.kind].hint}</span>
              </h4>
              <ul className="inaction-list">
                {g.items.map((c) => (
                  <li key={c.case_id}>
                    <button type="button" className="inaction-item" onClick={() => onOpenCase(c.case_id)}>
                      <span className="inaction-top">
                        <strong>{c.case_id}</strong>
                        {c.customer_name && <span>{c.customer_name}</span>}
                        <span className={`act-${c.action}`}>{ACTION_LABEL[c.action]}</span>
                      </span>
                      <span className="inaction-when">
                        {c.timing === 'at_date' ? `Reevaluar ${fmtRelative(c.scheduled_for, now)} (${fmtUtc(c.scheduled_for)})` : timingText(c)}
                      </span>
                      <span className="inaction-reason">{shorten(c.reason)}</span>
                      <span className="muted small">
                        Confianza {LEVEL_LABEL[c.confidence].toLowerCase()}{human.includes(c.case_id) ? ', con revisión humana (monto alto o riesgo)' : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <div className="dash-side">
          <section className="panel" aria-label="Actuar ahora">
            <h3>Actuar ahora</h3>
            {!actNow.length && <p className="muted">Nada urgente.</p>}
            <ul className="act-list">
              {actNow.map((c) => (
                <li key={c.case_id}>
                  <button type="button" className="act-item" onClick={() => onOpenCase(c.case_id)}>
                    <span><strong>{c.case_id}</strong> {c.customer_name ?? ''}</span>
                    <span className={`act-${c.action}`}>{ACTION_LABEL[c.action]}, {lowerFirst(timingText(c))}</span>
                    <span className={`risk risk-${c.risk_level}`}>Riesgo {RISK_LABEL[c.risk_level].toLowerCase()}{c.requires_human_review ? ', revisión humana' : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel" aria-label="Agenda de reevaluación">
            <h3>Agenda de reevaluación</h3>
            {!upcoming.length && <p className="muted">No hay fechas programadas.</p>}
            <ol className="agenda">
              {upcoming.map((u) => (
                <li key={u.case_id}>
                  <button type="button" className="agenda-item" onClick={() => onOpenCase(u.case_id)}>
                    <span className="agenda-when">{fmtRelative(u.scheduled_for, now)}</span>
                    <span>
                      <strong>{u.case_id}</strong> {u.customer_name ?? ''}
                      <span className="muted small"> {fmtUtc(u.scheduled_for)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}
