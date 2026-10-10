import { useState } from 'react';
import { api } from '../api.js';
import { CLOSED_LABEL } from '../format.js';

const REASONS = {
  accepted: ['Propuesta aceptada', 'Ahorro esperado', 'Condiciones de financiamiento', 'Confianza en el equipo', 'Otro'],
  rejected: ['Precio', 'Financiamiento', 'Inconvenientes de instalación', 'Eligió otra empresa', 'No es el momento', 'Sin interés', 'Otro'],
  cancelled: ['Proyecto suspendido', 'Solicitud duplicada', 'Datos incorrectos', 'Otro'],
};

export default function CloseCasePanel({ detail, onUpdate, busy }) {
  const [status, setStatus] = useState('accepted');
  const [reason, setReason] = useState('Propuesta aceptada');
  const [notes, setNotes] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const state = detail.state;
  if (state.status === 'closed') return <section className="panel close-result"><h3>{CLOSED_LABEL[state.closed_status]}</h3><p>{state.closed_reason || 'Resultado registrado desde el portal o el historial.'}</p>{state.closed_notes && <p className="muted">{state.closed_notes}</p>}</section>;
  return <details className="panel close-panel">
    <summary>Cerrar cotización <span className="muted small">Registrar venta o motivo de pérdida</span></summary>
    <form className="proposal-form" onSubmit={async (e) => {
      e.preventDefault();
      if (!confirm) { setConfirm(true); return; }
      setSaving(true); setError('');
      try { await onUpdate(await api.closeCase(detail.case_id, { status, reason, notes })); }
      catch (err) { setError(err.message); }
      finally { setSaving(false); }
    }}>
      <div className="proposal-grid">
        <label>Resultado<select value={status} onChange={(e) => { setStatus(e.target.value); setReason(REASONS[e.target.value][0]); setConfirm(false); }}><option value="accepted">Venta concretada</option><option value="rejected">No se concretó</option><option value="cancelled">Solicitud cancelada</option></select></label>
        <label>Motivo<select value={reason} onChange={(e) => { setReason(e.target.value); setConfirm(false); }}>{REASONS[status].map(r => <option key={r}>{r}</option>)}</select></label>
      </div>
      <label>Comentario {reason !== 'Otro' && '(opcional)'}<textarea rows={2} required={reason === 'Otro'} maxLength={1000} value={notes} onChange={(e) => { setNotes(e.target.value); setConfirm(false); }} placeholder="Explica el resultado o inconveniente que reportó el cliente." /></label>
      {state.proposal_pending && status === 'accepted' && <p className="muted">Primero publica una propuesta con precio para registrar la venta.</p>}
      {error && <p className="proposal-error" role="alert">{error}</p>}
      {confirm && <p className="close-confirm">Vas a cerrar esta cotización. El seguimiento se detendrá y el cliente verá el resultado.</p>}
      <div className="kit-buttons"><button className="btn btn-primary" disabled={busy || saving || (state.proposal_pending && status === 'accepted')}>{saving ? 'Guardando…' : confirm ? 'Confirmar cierre' : 'Guardar resultado'}</button>{confirm && <button type="button" className="btn" onClick={() => setConfirm(false)}>Volver</button>}</div>
    </form>
  </details>;
}
