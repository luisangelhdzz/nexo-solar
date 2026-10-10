import { useRef } from 'react';
import ClockControl from './ClockControl.jsx';

const TABS = [
  ['resumen', 'Resumen'],
  ['casos', 'Casos'],
  ['clientes', 'Clientes'],
  ['aprendizaje', 'Aprendizaje'],
];

export default function TopBar({
  status, busy, tab, onTab, onFiles, onEvaluate, onExport, onSetFixed, onSetClock, onAdvance,
  onToggleLoader, loaderOpen, canAct, onLogout, authRequired,
}) {
  const fileRef = useRef(null);
  const ai = status?.ai;

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <div>
          <div className="brand-name">Nexo Solar</div>
          <div className="brand-sub">Siguiente paso para cada cotización</div>
        </div>
      </div>

      <ClockControl clock={status?.clock} busy={Boolean(busy)} onSetFixed={onSetFixed} onSetClock={onSetClock} onAdvance={onAdvance} />

      <div className="topbar-actions">
        <input
          ref={fileRef}
          type="file"
          accept=".jsonl,.json,.ndjson,application/json"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) onFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={Boolean(busy)}>
          Cargar archivos
        </button>
        <button type="button" className="btn" onClick={onEvaluate} disabled={Boolean(busy) || !canAct || !status?.evaluation_at}>
          Evaluar
        </button>
        <button type="button" className="btn btn-primary" onClick={onExport} disabled={Boolean(busy) || !canAct}>
          Exportar JSON
        </button>
      </div>

      <nav className="tabs" aria-label="Secciones">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" className={`tab ${tab === id ? 'tab-active' : ''}`} aria-current={tab === id ? 'page' : undefined} onClick={() => onTab(id)}>
            {label}
          </button>
        ))}
        <a className="tab tab-link" href="/portal" target="_blank" rel="noreferrer">Abrir portal del cliente</a>
      </nav>

      <div className="topbar-meta">
        {busy && <span className="busy" role="status">{busy}…</span>}
        {ai && (
          <span className={`pill ${ai.mode === 'ai' ? 'pill-ai' : 'pill-fallback'}`} title={ai.note || ''}>
            {ai.mode === 'ai' ? `IA: ${ai.provider} (${ai.model})` : 'IA: clasificador de respaldo'}
          </span>
        )}
        {status && <span className="pill">{status.storage === 'postgres' ? 'PostgreSQL' : 'Memoria'}</span>}
        <button type="button" className="link" onClick={onToggleLoader} aria-expanded={loaderOpen}>
          {loaderOpen ? 'Ocultar carga' : 'Carga de datos'}
        </button>
        {authRequired && <button type="button" className="link" onClick={onLogout}>Salir</button>}
      </div>
    </header>
  );
}
