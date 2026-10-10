import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { fmtMoney, fmtUtc } from '../format.js';
import AssistantPanel from './AssistantPanel.jsx';

const CHANNEL = { email: 'Correo', whatsapp: 'WhatsApp', phone: 'Llamada' };

export default function ProposalPanel({ detail, onUpdate, busy }) {
  const { state, current } = detail;
  const intake = state.request;
  const [options, setOptions] = useState([]);
  const [form, setForm] = useState({ package_id: '', title: '', amount_mxn: '', notes: '' });
  const [message, setMessage] = useState('');
  // Borrador del asistente que se está usando: al enviar, el backend guarda si el equipo lo corrigió.
  const [assistantRunId, setAssistantRunId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (state.proposal_pending) api.proposalOptions().then((r) => setOptions(r.packages)).catch((e) => setError(e.message));
  }, [state.proposal_pending]);
  if (!state.customer_id) return null;
  const blocked = state.status === 'closed' || current?.detail?.rules?.contact_blocked;
  const run = async (fn) => {
    setSaving(true); setError('');
    try { const updated = await fn(); await onUpdate(updated); setMessage(''); setAssistantRunId(null); }
    catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };
  const choose = (id) => {
    const p = options.find((o) => o.package_id === id);
    setForm({ ...form, package_id: id, title: p ? `Propuesta solar para ${detail.customer?.name ?? 'tu negocio'}` : '', amount_mxn: p?.price_mxn ?? '', notes: '' });
  };
  return (
    <section className="panel proposal-panel" aria-label="Atender solicitud y conversar con el cliente">
      <div className="section-head"><h3>{state.proposal_pending ? 'Preparar propuesta' : 'Atender al cliente'}</h3><p className="muted">Lo que publiques aquí estará disponible en el portal del cliente.</p></div>
      {intake && <details className="request-details"><summary>Ver datos de la solicitud</summary>
        <p className="request-goal">{intake.goal}</p>
        <dl className="request-facts">
          <div><dt>Contacto</dt><dd>{intake.contact_name}</dd></div>
          <div><dt>Ciudad / negocio</dt><dd>{intake.city} · {intake.segment || 'Por confirmar'}</dd></div>
          <div><dt>Recibo de luz</dt><dd>{intake.bill_amount_mxn ? `${fmtMoney(intake.bill_amount_mxn)} ${intake.bill_period === 'bimonthly' ? 'bimestrales' : 'mensuales'}` : 'Por confirmar'}</dd></div>
          <div><dt>Instalación</dt><dd>{intake.roof}</dd></div>
          <div><dt>Medio preferido</dt><dd>{CHANNEL[intake.contact_channel]} · {intake.contact_channel === 'email' ? intake.email : intake.phone}</dd></div>
          <div><dt>Permiso de contacto</dt><dd>{state.contact_allowed ? 'Autorizado' : 'No autorizado'}{state.contact_not_before ? ` · a partir del ${fmtUtc(state.contact_not_before)}` : ''}</dd></div>
        </dl>
      </details>}
      {error && <p className="proposal-error" role="alert">{error}</p>}
      {blocked && <p className="muted">El envío no está disponible ahora. Revisa las restricciones y el siguiente paso recomendado.</p>}
      {state.proposal_pending && <form className="proposal-form" onSubmit={(e) => { e.preventDefault(); run(() => api.sendProposal(detail.case_id, form)); }}>
        <label>Solución de referencia interna<select required value={form.package_id} onChange={(e) => choose(e.target.value)}><option value="">Seleccionar solución…</option>{options.map((p) => <option key={p.package_id} value={p.package_id}>{p.name} · {p.kw} kW</option>)}</select></label>
        <p className="muted small">El catálogo sirve de base. Confirma el consumo, el sitio y las condiciones antes de publicar.</p>
        <div className="proposal-grid"><label>Título de la propuesta<input required maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label><label>Precio total con IVA · MXN<input type="number" min="1" max="100000000" required value={form.amount_mxn} onChange={(e) => setForm({ ...form, amount_mxn: e.target.value })} /></label></div>
        <label>Alcance y condiciones particulares<textarea rows={3} maxLength={1500} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Describe qué incluye la solución y qué debe confirmarse en la visita técnica." /></label>
        <button className="btn btn-primary" disabled={blocked || saving || busy}>{saving ? 'Publicando…' : 'Publicar propuesta en el portal'}</button>
      </form>}
      {state.status !== 'closed' && <AssistantPanel detail={detail} disabled={saving || busy} onUseDraft={(text, runId) => { setMessage(text); setAssistantRunId(runId); }} />}
      {state.status !== 'closed' && <form className="proposal-form" onSubmit={(e) => { e.preventDefault(); run(() => api.reply(detail.case_id, { message, action: current?.recommendation?.action, ...(assistantRunId ? { assistant_run_id: assistantRunId } : {}) })); }}>
        <label>Mensaje para el cliente<textarea rows={4} maxLength={1000} required value={message} onChange={(e) => { setMessage(e.target.value); if (!e.target.value.trim()) setAssistantRunId(null); }} placeholder="Responde una duda o pide los datos que faltan. También puedes partir del borrador del asistente." /></label>
        {assistantRunId && <p className="muted small">Partiste del borrador del asistente: si lo cambias, la corrección se guarda como ejemplo para la próxima vez.</p>}
        <div className="kit-buttons">
          <button className="btn btn-primary" disabled={blocked || saving || busy || !message.trim()}>{saving ? 'Enviando…' : 'Enviar mensaje al portal'}</button>
        </div>
        <p className="muted small">El mensaje se entrega en el portal. El correo y WhatsApp son preferencias registradas para futuras integraciones.</p>
      </form>}
    </section>
  );
}
