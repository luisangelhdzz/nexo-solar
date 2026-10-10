import { useEffect, useState } from 'react';
import { ACTION_LABEL, CLOSED_LABEL, PACKAGE_LABEL, TIER_LABEL, fmtHours, fmtMoney, fmtUtc, timingText } from '../format.js';
import PatienceMeter from './PatienceMeter.jsx';

const lowerFirst = (t) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);

// Barras horizontales: horas que tardó en decidir cada compra. Una sola serie, sin leyenda.
function DecisionChart({ cases, typical }) {
  const bought = cases.filter((c) => c.closed_status === 'accepted' && c.decision_hours !== null);
  if (!bought.length) return <p className="muted">Todavía no tiene compras: no hay un patrón que respetar.</p>;
  const max = Math.max(...bought.map((c) => c.decision_hours), typical || 0) * 1.1;
  return (
    <figure className="dchart">
      <figcaption>Horas que tardó en decidir cada compra</figcaption>
      <ul>
        {bought.map((c) => (
          <li key={c.case_id} title={`${c.case_id}: ${c.decision_hours} h (${fmtUtc(c.closed_at)})`}>
            <span className="dchart-label">{c.case_id}</span>
            <span className="dchart-track">
              <span className="dchart-bar" style={{ width: `${(c.decision_hours / max) * 100}%` }} />
              {typical ? <span className="dchart-typical" style={{ left: `${(typical / max) * 100}%` }} /> : null}
            </span>
            <span className="dchart-value">{Math.round(c.decision_hours)} h</span>
          </li>
        ))}
      </ul>
      {typical ? <p className="muted small">La línea punteada es su tiempo típico: {Math.round(typical)} h.</p> : null}
    </figure>
  );
}

function TeamProfileForm({ customer, onSave, busy }) {
  const [trusted, setTrusted] = useState(Boolean(customer.trusted));
  const [hours, setHours] = useState(customer.decision_hours_override ?? '');
  const [notes, setNotes] = useState(customer.notes ?? '');
  useEffect(() => {
    setTrusted(Boolean(customer.trusted));
    setHours(customer.decision_hours_override ?? '');
    setNotes(customer.notes ?? '');
  }, [customer.customer_id, customer.trusted, customer.decision_hours_override, customer.notes]);

  return (
    <form
      className="team-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ trusted, decision_hours_override: hours === '' ? null : Number(hours), notes });
      }}
    >
      <label className="check">
        <input type="checkbox" checked={trusted} onChange={(e) => setTrusted(e.target.checked)} />
        Cliente de confianza (el equipo lo conoce)
      </label>
      <label>
        Suele decidir en (horas)
        <input type="number" min="1" max="1440" step="1" value={hours} onChange={(e) => setHours(e.target.value)} placeholder={customer.profile.typical_decision_hours ? `Según su historial: ${Math.round(customer.profile.typical_decision_hours)}` : 'Ej.: 48'} />
      </label>
      <label className="team-notes">
        Notas del equipo
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej.: siempre consulta con su socio antes de comprar." />
      </label>
      <p className="muted small team-hint">Solo cambia cuánto esperar cuando el cliente no ha pedido nada. Nunca permite saltarse una regla de contacto.</p>
      <button type="submit" className="btn btn-primary btn-small" disabled={Boolean(busy)}>Guardar ficha</button>
    </form>
  );
}

export default function Customers({ customers, selectedId, detail, onSelect, onSave, onOpenCase, now, busy }) {
  if (!customers.length) {
    return <section className="dash-empty"><h2>No hay clientes</h2><p className="muted">Los clientes se crean desde el portal o con los datos de demostración.</p></section>;
  }
  const c = detail && detail.customer_id === selectedId ? detail : customers.find((x) => x.customer_id === selectedId);

  return (
    <main className="workspace">
      <nav className="caselist" aria-label="Clientes">
        <div className="caselist-head"><h2>Clientes</h2><span className="muted">{customers.length}</span></div>
        <ul>
          {customers.map((x) => {
            const active = x.cases.filter((k) => k.status !== 'closed');
            return (
              <li key={x.customer_id}>
                <button type="button" className={`case-row ${selectedId === x.customer_id ? 'case-row-active' : ''}`} onClick={() => onSelect(x.customer_id)}>
                  <span className="case-row-top"><span className="case-id">{x.name}</span></span>
                  <span className="case-row-bottom">
                    <span>{TIER_LABEL[x.profile.tier]}</span>
                    <span>{x.profile.purchases} {x.profile.purchases === 1 ? 'compra' : 'compras'}</span>
                  </span>
                  <span className="case-flags">
                    {x.profile.reliable && <span className="flag flag-trust">Buen cliente</span>}
                    {x.trusted && <span className="flag">Ficha del equipo</span>}
                    {active.map((k) => k.recommendation && (
                      <span key={k.case_id} className={`flag act-${k.recommendation.action}`}>{k.case_id}: {ACTION_LABEL[k.recommendation.action]}</span>
                    ))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {c && (
        <article className="caseview">
          <header className="case-header">
            <h2>{c.name}</h2>
            <span className="pill">{TIER_LABEL[c.profile.tier]}</span>
            {c.segment && <span className="pill">{c.segment}</span>}
            {c.city && <span className="pill">{c.city}</span>}
            {c.profile.reliable && <span className="pill pill-trust">Buen cliente</span>}
          </header>

          <div className="tiles-row">
            <div className="tile-stat"><span className="tile-stat-value">{c.profile.purchases}</span><span className="tile-stat-label">Compras</span></div>
            <div className="tile-stat"><span className="tile-stat-value">{fmtMoney(c.profile.total_purchased_mxn).replace(' MXN', '')}</span><span className="tile-stat-label">Total comprado (MXN)</span></div>
            <div className="tile-stat">
              <span className="tile-stat-value">{fmtHours(c.profile.typical_decision_hours ?? c.profile.decision_hours_override)}</span>
              <span className="tile-stat-label">Tiempo típico para decidir{c.profile.typical_decision_hours === null && c.profile.decision_hours_override ? ' (según el equipo)' : ''}</span>
            </div>
            <div className="tile-stat"><span className="tile-stat-value">{c.profile.rejected}</span><span className="tile-stat-label">Cotizaciones rechazadas</span></div>
          </div>

          <div className="case-columns">
            <div className="col-left">
              <section className="panel">
                <h3>Cómo decide este cliente</h3>
                <DecisionChart cases={c.cases} typical={c.profile.typical_decision_hours} />
              </section>
              <section className="panel">
                <h3>Lo que sabe el equipo</h3>
                <TeamProfileForm customer={c} onSave={(patch) => onSave(c.customer_id, patch)} busy={busy} />
              </section>
            </div>
            <div className="col-right">
              <section className="panel">
                <h3>Cotizaciones</h3>
                <ul className="quote-list">
                  {[...c.cases].reverse().map((k) => (
                    <li key={k.case_id} className="quote-item">
                      <div className="quote-top">
                        <button type="button" className="link" onClick={() => onOpenCase(k.case_id)}>{k.case_id}</button>
                        <span>{PACKAGE_LABEL[k.package_id] ?? 'Propuesta'}</span>
                        <span className="muted">{fmtMoney(k.amount_mxn)}</span>
                      </div>
                      {k.status === 'closed' ? (
                        <p className="muted small">
                          {k.closed_status === 'accepted' ? `Compró en ${Math.round(k.decision_hours)} h` : `Cotización ${CLOSED_LABEL[k.closed_status]}`} ({fmtUtc(k.closed_at)})
                        </p>
                      ) : (
                        <>
                          {k.recommendation && (
                            <p>
                              <strong className={`act-${k.recommendation.action}`}>{ACTION_LABEL[k.recommendation.action]}</strong>
                              <span className="muted">, {lowerFirst(timingText(k.recommendation))}</span>
                            </p>
                          )}
                          {(k.basis === 'customer_pattern' || k.basis === 'customer_pattern_expired') && c.profile.patience_window_hours && (
                            <PatienceMeter
                              openedAt={k.opened_at}
                              windowEnd={new Date(new Date(k.opened_at).getTime() + c.profile.patience_window_hours * 3600000).toISOString()}
                              nowIso={now}
                              typicalHours={c.profile.patience_hours}
                            />
                          )}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
              {detail?.invoices?.length > 0 && (
                <section className="panel">
                  <h3>Comprobantes enviados</h3>
                  <ul className="plain">
                    {detail.invoices.map((i) => (
                      <li key={i.id}>
                        {i.invoice_number} para {i.email}: {i.status === 'sent' ? 'enviado' : i.status === 'not_configured' ? 'mostrado en pantalla (n8n sin configurar)' : i.status === 'failed' ? `falló (${i.error})` : 'pendiente'}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </div>
        </article>
      )}
    </main>
  );
}
