import { useRef, useState } from 'react';
import ClockControl from './ClockControl.jsx';

const SECTIONS = [
  ['resumen', 'Dashboard', 'Resumen del seguimiento comercial', 'grid'],
  ['casos', 'Cotizaciones', 'Casos, etapas y próximos pasos', 'file'],
  ['clientes', 'Clientes', 'Historial y contexto de cada cliente', 'users'],
  ['aprendizaje', 'Aprendizaje', 'Resultados y lecciones del equipo', 'chart'],
];

function Icon({ name }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    file: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5" /></>,
    chart: <><path d="M4 3v17h17M8 15l4-5 4 3 5-7" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" /></>,
    moon: <path d="M20.5 13A9 9 0 0 1 11 3.5 9 9 0 1 0 20.5 13Z" />,
    arrow: <><path d="M7 17 17 7M7 7h10v10" /></>,
  };
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export default function TopBar({
  theme, onToggleTheme, status, busy, tab, onTab, onFiles, onEvaluate, onExport, onSetFixed, onSetClock, onAdvance,
  onToggleLoader, loaderOpen, canAct, onLogout, authRequired,
}) {
  const fileRef = useRef(null);
  const [search, setSearch] = useState('');
  const ai = status?.ai;
  const section = SECTIONS.find(([id]) => id === tab) ?? SECTIONS[0];
  const visibleSections = SECTIONS.filter(([, label]) => label.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es').trim()));

  return (
    <>
      <aside className="console-sidebar" aria-label="Navegación principal">
        <label className="sidebar-search">
          <Icon name="search" />
          <input type="search" aria-label="Buscar sección" placeholder="Buscar sección…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <p className="sidebar-label">ESPACIO DE TRABAJO</p>
        <nav className="console-nav" aria-label="Secciones">
          {visibleSections.map(([id, label, , icon]) => (
            <button key={id} type="button" className={`console-nav-item ${tab === id ? 'is-active' : ''}`} aria-current={tab === id ? 'page' : undefined} onClick={() => onTab(id)}>
              <Icon name={icon} /><span>{label}</span>
            </button>
          ))}
          {!visibleSections.length && <p className="sidebar-no-results">No hay secciones con ese nombre.</p>}
        </nav>
        <div className="sidebar-footer">
          <a className="console-nav-item" href="/portal" target="_blank" rel="noreferrer"><Icon name="arrow" /><span>Portal del cliente</span></a>
          <div className="sidebar-theme">
            <button type="button" className="theme-toggle" onClick={onToggleTheme} aria-label={theme === 'dark' ? 'Cambiar a modo día' : 'Cambiar a modo oscuro'} title={theme === 'dark' ? 'Cambiar a modo día' : 'Cambiar a modo oscuro'}>
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
              <span>{theme === 'dark' ? 'Modo día' : 'Modo oscuro'}</span>
            </button>
          </div>
          {authRequired && <button type="button" className="link" onClick={onLogout}>Cerrar sesión</button>}
        </div>
      </aside>
      <header className="console-header">
        <div className="console-breadcrumb"><Icon name={section[3]} /><span>Nexo Solar</span><span aria-hidden="true">/</span><strong>{section[1]}</strong></div>
        <a className="console-header-portal" href="/portal" target="_blank" rel="noreferrer">Ver portal <Icon name="arrow" /></a>
      </header>
      <div className="console-page-heading">
        <div><p className="console-eyebrow">GESTIÓN COMERCIAL</p><h1>{section[1]}</h1><p>{section[2]}</p></div>
        <details className="console-tools">
          <summary>Herramientas</summary>
          <div className="console-tools-panel">
            <ClockControl clock={status?.clock} busy={Boolean(busy)} onSetFixed={onSetFixed} onSetClock={onSetClock} onAdvance={onAdvance} />
            <input ref={fileRef} type="file" accept=".jsonl,.json,.ndjson,application/json" multiple hidden onChange={(e) => { if (e.target.files?.length) onFiles(e.target.files); e.target.value = ''; }} />
            <div className="console-tool-actions">
              <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={Boolean(busy)}>Cargar archivos</button>
              <button type="button" className="btn" onClick={onEvaluate} disabled={Boolean(busy) || !canAct || !status?.evaluation_at}>Evaluar</button>
              <button type="button" className="btn btn-primary" onClick={onExport} disabled={Boolean(busy) || !canAct}>Exportar JSON</button>
              <button type="button" className="btn" onClick={onToggleLoader} aria-expanded={loaderOpen}>{loaderOpen ? 'Ocultar carga' : 'Carga de datos'}</button>
            </div>
            {ai && <span className={`pill ${ai.mode === 'ai' ? 'pill-ai' : 'pill-fallback'}`} title={ai.note || ''}>{ai.mode === 'ai' ? `IA: ${ai.provider} (${ai.model})` : 'IA: clasificador de respaldo'}</span>}
            {status && <span className="pill">{status.storage === 'postgres' ? 'PostgreSQL' : 'Memoria'}</span>}
          </div>
        </details>
      </div>
      {busy && <div className="console-busy" role="status">{busy}…</div>}
    </>
  );
}
