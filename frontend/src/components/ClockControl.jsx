import { useState } from 'react';
import { fmtUtc } from '../format.js';

// Reloj de evaluación.
//  - Hora del manifest: fija y reproducible (kit del reto, exportación oficial).
//  - En vivo: hora real; se puede adelantar para simular que pasaron horas.
export default function ClockControl({ clock, busy, onSetFixed, onSetClock, onAdvance }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);

  if (!clock) return null;

  if (!clock.evaluation_at && !editing) {
    return (
      <div className="clock clock-missing">
        <span>Sin hora de evaluación</span>
        <button type="button" className="btn btn-small" onClick={() => onSetClock({ mode: 'live' })} disabled={busy}>Usar hora real</button>
      </div>
    );
  }

  if (editing) {
    return (
      <form
        className="clock clock-edit"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft) onSetFixed(`${draft}:00Z`);
          setEditing(false);
        }}
      >
        <label htmlFor="eval-at">Evaluar como si fuera (UTC)</label>
        <input id="eval-at" type="datetime-local" value={draft} onChange={(e) => setDraft(e.target.value)} required />
        <button type="submit" className="btn btn-small">Aplicar</button>
        <button type="button" className="link" onClick={() => setEditing(false)}>Cancelar</button>
      </form>
    );
  }

  const live = clock.mode === 'live';
  return (
    <div className={`clock-wrap ${open ? 'clock-open' : ''}`}>
      <button type="button" className={`clock ${live ? 'clock-live' : ''}`} onClick={() => setOpen((v) => !v)} aria-expanded={open} disabled={busy}>
        <span className="clock-label">
          {live ? (clock.offset_hours ? `En vivo, adelantado ${Math.round(clock.offset_hours)} h` : 'En vivo') : 'Hora del manifest'}
        </span>
        <span className="clock-value">{fmtUtc(clock.evaluation_at)}</span>
      </button>
      {open && (
        <div className="clock-menu" role="group" aria-label="Opciones del reloj">
          {live ? (
            <>
              <p className="muted small">Simula que pasó el tiempo para ver cómo cambian las esperas.</p>
              <div className="clock-row">
                {[6, 24, 48].map((h) => (
                  <button key={h} type="button" className="btn btn-small" disabled={busy} onClick={() => onAdvance(h)}>+{h} h</button>
                ))}
              </div>
              {clock.offset_hours > 0 && (
                <button type="button" className="link" disabled={busy} onClick={() => onSetClock({ offset_hours: 0 })}>Volver a la hora real</button>
              )}
              {clock.manifest_evaluation_at && (
                <button type="button" className="link" disabled={busy} onClick={() => { onSetClock({ mode: 'manifest' }); setOpen(false); }}>
                  Usar la hora del manifest ({fmtUtc(clock.manifest_evaluation_at)})
                </button>
              )}
            </>
          ) : (
            <>
              <p className="muted small">La hora del manifest hace que la evaluación sea reproducible.</p>
              <button type="button" className="btn btn-small" disabled={busy} onClick={() => { setDraft(clock.evaluation_at?.slice(0, 16) ?? ''); setEditing(true); setOpen(false); }}>
                Cambiar la hora fija
              </button>
              <button type="button" className="link" disabled={busy} onClick={() => { onSetClock({ mode: 'live' }); setOpen(false); }}>Usar hora real (en vivo)</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
