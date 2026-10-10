import { useEffect, useState } from 'react';
import { go } from './util.js';

export default function RequestForm({ customer, onSubmit, busy }) {
  const [form, setForm] = useState(() => ({
    name: customer?.name ?? '', contact_name: customer?.contact_name ?? '',
    segment: customer?.segment ?? '', city: customer?.city ?? '',
    email: '', phone: '', contact_channel: 'email', monthly_bill_mxn: '', bill_period: 'bimonthly',
    roof: 'Por confirmar', goal: '', contact_allowed: true, contact_date: '',
  }));
  useEffect(() => {
    if (!customer) return;
    setForm((f) => ({ ...f, name: customer.name, contact_name: f.contact_name || customer.contact_name || '', city: f.city || customer.city || '', segment: f.segment || customer.segment || '' }));
  }, [customer?.customer_id]);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  return (
    <main className="p-main p-request-main">
      <section className="p-hero p-hero-small">
        <span className="p-eyebrow">Una solución para tu negocio</span>
        <h1>Cotiza tu proyecto solar</h1>
        <p>Cuéntanos qué necesitas. Revisaremos tu información y prepararemos una propuesta para que puedas decidir con calma.</p>
      </section>
      <form className="p-card p-form p-request-form" onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ ...form, contact_not_before: form.contact_date ? new Date(`${form.contact_date}T09:00:00`).toISOString() : null });
      }}>
        <fieldset disabled={busy}>
          <legend>1. Tu negocio y contacto</legend>
          <div className="p-form-grid">
            <label>Nombre de la empresa<input required maxLength={80} value={form.name} onChange={set('name')} autoComplete="organization" placeholder="Ferretería Los Pinos" readOnly={Boolean(customer)} /></label>
            <label>Tu nombre<input required maxLength={80} value={form.contact_name} onChange={set('contact_name')} autoComplete="name" /></label>
            <label>Ciudad<input required maxLength={60} value={form.city} onChange={set('city')} autoComplete="address-level2" placeholder="Saltillo, Coahuila" /></label>
            <label>Tipo de negocio<input maxLength={60} value={form.segment} onChange={set('segment')} placeholder="Comercio, taller, industria…" /></label>
            <label>Correo electrónico<input type="email" required={form.contact_channel === 'email'} maxLength={160} value={form.email} onChange={set('email')} autoComplete="email" /></label>
            <label>Teléfono<input type="tel" required={form.contact_channel !== 'email'} maxLength={30} value={form.phone} onChange={set('phone')} autoComplete="tel" placeholder="844 123 4567" /></label>
          </div>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>2. Tu proyecto</legend>
          <div className="p-form-grid">
            <label><span className="p-field-heading">¿Cuánto pagas de luz? <small>Opcional</small></span><input type="number" min="1" max="10000000" value={form.monthly_bill_mxn} onChange={set('monthly_bill_mxn')} placeholder="Ej.: 8000" /><span className="p-field-help">Importe de tu recibo en pesos mexicanos (MXN).</span></label>
            <label>Periodo del recibo<select value={form.bill_period} onChange={set('bill_period')}><option value="bimonthly">Cada dos meses</option><option value="monthly">Cada mes</option></select></label>
            <label className="p-full">Espacio para instalar<select value={form.roof} onChange={set('roof')}><option>Por confirmar</option><option>Azotea de concreto</option><option>Techo de lámina</option><option>Terreno</option><option>Otro</option></select></label>
            <label className="p-full">¿Qué necesitas?<textarea required minLength={5} maxLength={1000} rows={4} value={form.goal} onChange={set('goal')} placeholder="Quiero reducir el gasto de luz de mi negocio. También me interesa conocer las opciones de financiamiento." /></label>
          </div>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>3. Contacto a tu ritmo</legend>
          <div className="p-form-grid">
            <label>Medio preferido<select value={form.contact_channel} onChange={set('contact_channel')}><option value="email">Correo electrónico</option><option value="whatsapp">WhatsApp</option><option value="phone">Llamada</option></select></label>
            <label><span className="p-field-heading">Contactarme a partir de <small>Opcional</small></span><input type="date" value={form.contact_date} onChange={set('contact_date')} /></label>
          </div>
          <label className="p-check"><input type="checkbox" checked={form.contact_allowed} onChange={set('contact_allowed')} /><span>Autorizo que me contacten sobre esta solicitud.</span></label>
          {!form.contact_allowed && <p className="p-muted">Guardaremos tu solicitud. El equipo no podrá enviarte mensajes ni publicar la propuesta hasta que habilites el contacto.</p>}
        </fieldset>
        <div className="p-request-actions"><p className="p-muted">Esta solicitud no confirma una compra ni fija un precio. Tu propuesta aparecerá en Mis cotizaciones cuando esté preparada.</p>
        <button type="submit" className="p-btn p-btn-sun" disabled={busy}>{busy ? 'Enviando solicitud…' : 'Solicitar mi cotización'}</button>
        <button type="button" className="p-link" onClick={() => go('mis-cotizaciones')}>Ver mis solicitudes y cotizaciones</button></div>
      </form>
    </main>
  );
}
