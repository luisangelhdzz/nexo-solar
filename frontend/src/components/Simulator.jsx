import { useState } from 'react';
import { fmtUtc } from '../format.js';

const TYPES = [
  ['message.received', 'Mensaje del cliente'],
  ['constraint.updated', 'Restricción de contacto'],
  ['action.executed', 'Acción ejecutada por la empresa'],
  ['proposal.viewed', 'Apertura de la propuesta'],
  ['case.closed', 'Cierre del caso'],
];

const toUtc = (local) => (local ? `${local}:00Z` : null);

// Agrega un evento sintético al caso para mostrar en vivo cómo cambia la decisión.
// No contacta a nadie: solo registra el evento y reevalúa.
export default function Simulator({ caseId, evaluationAt, onSubmit, busy, closed }) {
  const [type, setType] = useState('message.received');
  const [message, setMessage] = useState('');
  const [allowed, setAllowed] = useState('keep');
  const [notBefore, setNotBefore] = useState('');
  const [actionKind, setActionKind] = useState('contact');
  const [section, setSection] = useState('price');
  const [closeStatus, setCloseStatus] = useState('accepted');
  const [occurredAt, setOccurredAt] = useState('');
  const [error, setError] = useState(null);

  const build = () => {
    switch (type) {
      case 'message.received':
        if (!message.trim()) throw new Error('Escribe el mensaje del cliente.');
        return { message: message.trim() };
      case 'constraint.updated': {
        const data = {};
        if (allowed !== 'keep') data.contact_allowed = allowed === 'true';
        if (notBefore) data.contact_not_before = toUtc(notBefore);
        if (!Object.keys(data).length) throw new Error('Elige al menos un cambio de restricción.');
        return data;
      }
      case 'action.executed':
        return { action: actionKind };
      case 'proposal.viewed':
        return { section };
      case 'case.closed':
        return { status: closeStatus };
      default:
        return {};
    }
  };

  const submit = (e) => {
    e.preventDefault();
    setError(null);
    try {
      const data = build();
      onSubmit({ event_type: type, data, occurred_at: occurredAt ? toUtc(occurredAt) : undefined });
      setMessage('');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <section className="simulator" aria-label="Simulador de eventos">
      <div className="section-head">
        <h3>Simular un evento en {caseId}</h3>
        <p className="muted">
          Para la demostración: agrega un evento y el caso se reevalúa. No se contacta a nadie.
          {closed && ' El caso está cerrado: cualquier evento nuevo se registra, pero no cambia la decisión.'}
        </p>
      </div>
      <form onSubmit={submit} className="sim-form">
        <label>
          Tipo de evento
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>

        {type === 'message.received' && (
          <label className="sim-wide">
            Mensaje
            <textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Ej.: ¿El precio incluye la instalación?" />
          </label>
        )}

        {type === 'constraint.updated' && (
          <>
            <label>
              Contacto
              <select value={allowed} onChange={(e) => setAllowed(e.target.value)}>
                <option value="keep">Sin cambio</option>
                <option value="false">Prohibido</option>
                <option value="true">Permitido</option>
              </select>
            </label>
            <label>
              No contactar antes de (UTC)
              <input type="datetime-local" value={notBefore} onChange={(e) => setNotBefore(e.target.value)} />
            </label>
          </>
        )}

        {type === 'action.executed' && (
          <label>
            Acción
            <select value={actionKind} onChange={(e) => setActionKind(e.target.value)}>
              <option value="contact">contact</option>
              <option value="request_information">request_information</option>
            </select>
          </label>
        )}

        {type === 'proposal.viewed' && (
          <label>
            Sección
            <input value={section} onChange={(e) => setSection(e.target.value)} />
          </label>
        )}

        {type === 'case.closed' && (
          <label>
            Resultado
            <select value={closeStatus} onChange={(e) => setCloseStatus(e.target.value)}>
              <option value="accepted">Aceptada</option>
              <option value="rejected">Rechazada</option>
              <option value="cancelled">Cancelada</option>
            </select>
          </label>
        )}

        <label>
          Fecha del evento (UTC)
          <input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
          <span className="muted small">Vacío: {fmtUtc(evaluationAt)}</span>
        </label>

        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="sim-actions">
          <button type="submit" className="btn btn-primary" disabled={Boolean(busy) || !evaluationAt}>Agregar y reevaluar</button>
        </div>
      </form>
    </section>
  );
}
