import { fmtUtc, pct } from '../format.js';

const MODES = [
  ['auto', 'Automático', 'Aprende solo con el reloj en vivo. Con la hora del manifest (kit oficial) se apaga para que el resultado sea reproducible.'],
  ['on', 'Siempre', 'Aprende también con la hora del manifest.'],
  ['off', 'Apagado', 'Decide solo con los valores predeterminados.'],
];

// Embudo: cuántas cotizaciones llegaron a cada etapa. Una sola serie: barras sin leyenda.
function Funnel({ funnel }) {
  const max = Math.max(1, ...funnel.map((f) => f.reached));
  return (
    <figure className="funnel">
      <figcaption>Avance de las cotizaciones</figcaption>
      <ol>
        {funnel.map((f) => (
          <li key={f.stage} className={`funnel-row funnel-${f.stage}`} title={`${f.label}: ${f.reached} llegaron; ${f.open_now} abiertas están aquí ahora`}>
            <span className="funnel-label">{f.label}</span>
            <span className="funnel-track"><span className="funnel-bar" style={{ width: `${(f.reached / max) * 100}%` }} /></span>
            <span className="funnel-value">{f.reached}</span>
            <span className="funnel-now muted small">{f.open_now ? `${f.open_now} abierta${f.open_now === 1 ? '' : 's'} aquí` : ''}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

export default function Learning({ insights, onSetMode, onOpenCase, busy }) {
  if (!insights) return <section className="dash-empty">Cargando aprendizaje…</section>;
  const { totals, funnel, learning, history, lessons, mode, active } = insights;
  const fu = learning.params.follow_up_hours;
  const aw = learning.params.answer_within_hours;
  const labels = learning.stage_labels;

  return (
    <div className="dashboard learning">
      <section className="panel learn-mode" aria-label="Modo de aprendizaje">
        <div>
          <h3>Aprendizaje {active ? 'activo' : 'en pausa'}</h3>
          <p className="muted">
            {active
              ? 'Usamos los resultados anteriores para mejorar el seguimiento.'
              : 'El seguimiento usa los tiempos predeterminados.'}
          </p>
        </div>
        <div className="segmented" role="radiogroup" aria-label="Modo">
          {MODES.map(([id, label, hint]) => (
            <button key={id} type="button" role="radio" aria-checked={mode === id} title={hint} className={`seg ${mode === id ? 'seg-on' : ''}`} disabled={Boolean(busy)} onClick={() => onSetMode(id)}>
              {label}
            </button>
          ))}
        </div>
      </section>

      <div className="tiles-row">
        <div className="tile-stat"><span className="tile-stat-value">{pct(totals.conversion)}</span><span className="tile-stat-label">Conversión ({totals.won} de {totals.won + totals.lost} cerradas)</span></div>
        <div className="tile-stat tile-stat-go"><span className="tile-stat-value">{totals.won}</span><span className="tile-stat-label">Compras</span></div>
        <div className="tile-stat tile-stat-warn"><span className="tile-stat-value">{totals.lost}</span><span className="tile-stat-label">Perdidas</span></div>
        <div className="tile-stat"><span className="tile-stat-value">{history.length ? `v${history.at(-1).n}` : 'v0'}</span><span className="tile-stat-label">Versión de lo aprendido</span></div>
      </div>

      <div className="dash-columns">
        <div className="dash-side">
          <section className="panel">
            <h3>Embudo de cotizaciones</h3>
            <Funnel funnel={funnel} />
          </section>

          <section className="panel">
            <h3>Qué separa una compra de una pérdida</h3>
            {!learning.factor_stats.length && <p className="muted">Todavía no hay cotizaciones cerradas.</p>}
            {learning.factor_stats.length > 0 && (
              <table className="diff factors-table">
                <thead>
                  <tr><th scope="col">Factor</th><th scope="col">Efecto</th><th scope="col">En compras</th><th scope="col">En pérdidas</th></tr>
                </thead>
                <tbody>
                  {learning.factor_stats.map((f) => (
                    <tr key={f.id}>
                      <th scope="row">{f.label}</th>
                      <td className={f.direction === 'positive' ? 'eff-pos' : 'eff-neg'}>{f.direction === 'positive' ? 'Ayuda' : 'Frena'}</td>
                      <td>{f.won_with} de {f.won_total}</td>
                      <td>{f.lost_with} de {f.lost_total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {learning.insights.length > 0 && (
              <ul className="plain insights-list">
                {learning.insights.map((t) => <li key={t}>{t}</li>)}
              </ul>
            )}
          </section>

          <section className="panel">
            <h3>Tiempo en cada etapa (mediana)</h3>
            <table className="diff">
              <thead><tr><th scope="col">Etapa</th><th scope="col">Compras</th><th scope="col">Pérdidas</th></tr></thead>
              <tbody>
                {['enviada', 'revisando', 'con_dudas', 'decidiendo'].map((st) => (
                  <tr key={st}>
                    <th scope="row">{labels[st]}</th>
                    <td>{learning.stage_hours.won[st] !== null ? `${Math.round(learning.stage_hours.won[st])} h` : '—'}</td>
                    <td>{learning.stage_hours.lost[st] !== null ? `${Math.round(learning.stage_hours.lost[st])} h` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">Si una cotización pasa mucho más tiempo "Con dudas" que en las compras, es señal de dudas sin atender.</p>
          </section>
        </div>

        <div className="dash-side">
          <section className="panel">
            <h3>Tiempos ajustados con datos</h3>
            <dl className="learned">
              <div>
                <dt>Seguimiento tras silencio del cliente</dt>
                <dd>
                  <strong>{fu.value} h</strong> {fu.source === 'aprendido' ? `(aprendido; antes ${fu.default} h)` : '(predeterminado)'}
                  <span className="muted small">{fu.basis}</span>
                </dd>
              </div>
              <div>
                <dt>Responder dudas en</dt>
                <dd>
                  <strong>{aw.value !== null ? `~${aw.value} h` : 'sin datos'}</strong>
                  <span className="muted small">{aw.basis}</span>
                </dd>
              </div>
            </dl>
            <p className="muted small">Así se usa: el primer valor decide cuándo dar seguimiento a quien solo abrió la propuesta; el segundo se menciona al recomendar aclarar una duda.</p>
          </section>

          <section className="panel">
            <h3>Lecciones de cada cierre</h3>
            <p className="muted small">Se generan al cerrarse cada cotización. Con IA configurada, el modelo las redacta y se usan como contexto al interpretar mensajes nuevos.</p>
            {!lessons.length && <p className="muted">Aún no hay lecciones.</p>}
            <ul className="lessons">
              {lessons.map((l) => (
                <li key={l.case_id} className="lesson">
                  <div className="lesson-top">
                    <button type="button" className="link" onClick={() => onOpenCase(l.case_id)}>{l.case_id}</button>
                    <span className={`outcome-tag ${l.outcome === 'won' ? 'outcome-won' : 'outcome-lost'}`}>{l.outcome === 'won' ? 'Compra' : 'Pérdida'}</span>
                    <span className="muted small">{l.source === 'ia' ? `IA (${l.model})` : 'Plantilla'}</span>
                  </div>
                  <p className="lesson-text">{l.lesson}</p>
                  <p className="muted small">{l.summary}</p>
                </li>
              ))}
            </ul>
          </section>

          {history.length > 0 && (
            <section className="panel">
              <h3>Versiones de lo aprendido</h3>
              <ol className="plain">
                {[...history].reverse().map((h) => (
                  <li key={h.version}>
                    v{h.n}: {h.samples.won} compras y {h.samples.lost} pérdidas; seguimiento {h.follow_up_hours} h{h.answer_within_hours ? `, dudas en ~${h.answer_within_hours} h` : ''}
                    <span className="muted small"> ({fmtUtc(h.at)})</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
