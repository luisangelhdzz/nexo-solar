import { useCallback, useEffect, useState } from 'react';
import { portalApi, portalCustomer } from '../api.js';
import './portal.css';

// Portal público de Nexo Solar (empresa ficticia). Pensado para usarse desde el celular.
// Lo que hace el cliente aquí se registra como eventos; nunca se le muestra la recomendación interna.

const money = (n) => `$${Number(n).toLocaleString('es-MX')}`;
const dateMx = (iso) => (iso ? new Date(iso).toLocaleString('es-MX', { timeZone: 'America/Monterrey', dateStyle: 'medium', timeStyle: 'short' }) : '');
const dayMx = (iso) => (iso ? new Date(iso).toLocaleDateString('es-MX', { timeZone: 'America/Monterrey', weekday: 'long', day: 'numeric', month: 'long' }) : '');

function sectionText(id, pkg) {
  switch (id) {
    case 'price':
      return `Precio total ${money(pkg.price_mxn)} MXN con IVA. Se paga 30% de anticipo y 70% al terminar la instalación.`;
    case 'installation':
      return `Instalamos ${pkg.panels} paneles, estructura e inversor en 2 a 3 días hábiles. Incluye el trámite de interconexión.`;
    case 'warranty':
      return 'Garantía de 25 años en paneles, 10 años en inversor y 5 años en mano de obra.';
    case 'financing':
      return 'Financiamiento de hasta 24 meses con un banco aliado, sujeto a aprobación.';
    case 'delivery':
      return 'Entregamos e instalamos de 2 a 4 semanas después del anticipo.';
    default:
      return '';
  }
}

const STATUS = {
  open: { label: 'En revisión', cls: 'st-open' },
  accepted: { label: 'Comprada', cls: 'st-ok' },
  rejected: { label: 'Rechazada', cls: 'st-off' },
  cancelled: { label: 'Cancelada', cls: 'st-off' },
};
const statusOf = (q) => (q.status === 'closed' ? STATUS[q.closed_status] : STATUS.open);

function Header({ customer, onSwitch, onHome }) {
  return (
    <header className="p-header">
      <button type="button" className="p-brand" onClick={onHome} aria-label="Inicio">
        <span className="p-sun" aria-hidden="true" />
        <span>Nexo Solar</span>
      </button>
      {customer && (
        <button type="button" className="p-switch" onClick={onSwitch}>
          <span className="p-switch-name">{customer.name}</span>
          <span className="p-switch-hint">Cambiar</span>
        </button>
      )}
    </header>
  );
}

function PickCompany({ onPicked, onError }) {
  const [list, setList] = useState(null);
  const [form, setForm] = useState({ name: '', contact_name: '', segment: '', city: '' });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    portalApi.customers().then((r) => setList(r.customers)).catch((e) => onError(e.message));
  }, [onError]);

  return (
    <main className="p-main">
      <section className="p-hero">
        <h1>Energía solar para tu negocio</h1>
        <p>Pide tu cotización, revísala con calma y decide cuando estés listo.</p>
      </section>

      <section className="p-card">
        <h2>¿Con qué empresa entras?</h2>
        {!list && <p className="p-muted">Cargando…</p>}
        {list && !list.length && <p className="p-muted">Aún no hay empresas. Registra la tuya.</p>}
        <ul className="p-companies">
          {list?.map((c) => (
            <li key={c.customer_id}>
              <button type="button" className="p-company" onClick={() => onPicked(c.customer_id)}>
                <strong>{c.name}</strong>
                <span>{[c.segment, c.city].filter(Boolean).join(', ')}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="p-card">
        <h2>Registrar mi empresa</h2>
        <form
          className="p-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setCreating(true);
            try {
              const c = await portalApi.createCustomer(form);
              onPicked(c.customer_id);
            } catch (err) {
              onError(err.message);
            } finally {
              setCreating(false);
            }
          }}
        >
          <label>Nombre de la empresa<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={80} placeholder="Ej.: Ferretería Los Pinos" /></label>
          <label>Tu nombre<input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} maxLength={80} /></label>
          <label>Giro<input value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value })} maxLength={40} placeholder="Ej.: Comercio" /></label>
          <label>Ciudad<input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} maxLength={60} /></label>
          <button type="submit" className="p-btn p-btn-sun" disabled={creating}>Registrar y entrar</button>
        </form>
      </section>
    </main>
  );
}

function Home({ me, catalog, onOpen, onRequest, busy }) {
  const [showCatalog, setShowCatalog] = useState(!me.quotes.length);
  return (
    <main className="p-main">
      <section className="p-hero p-hero-small">
        <h1>Hola{me.customer.contact_name ? `, ${me.customer.contact_name.split(' ')[0]}` : ''}</h1>
        <p>{me.customer.name}</p>
      </section>

      {me.quotes.length > 0 && (
        <section className="p-card">
          <h2>Tus cotizaciones</h2>
          <ul className="p-quotes">
            {me.quotes.map((q) => (
              <li key={q.case_id}>
                <button type="button" className="p-quote" onClick={() => onOpen(q.case_id)}>
                  <span className="p-quote-top">
                    <strong>{q.package?.name ?? 'Propuesta'}</strong>
                    <span className={`p-status ${statusOf(q).cls}`}>{statusOf(q).label}</span>
                  </span>
                  <span className="p-muted">{q.case_id}, {money(q.amount_mxn)} MXN, {dateMx(q.opened_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="p-card">
        <div className="p-card-head">
          <h2>Pedir una cotización</h2>
          {me.quotes.length > 0 && (
            <button type="button" className="p-link" onClick={() => setShowCatalog((v) => !v)}>{showCatalog ? 'Ocultar' : 'Ver paquetes'}</button>
          )}
        </div>
        {showCatalog && (
          <ul className="p-packages">
            {catalog?.packages.map((p) => (
              <li key={p.package_id} className="p-package">
                <div className="p-package-kw">{p.kw}<span>kW</span></div>
                <div className="p-package-body">
                  <strong>{p.name}</strong>
                  <span className="p-muted">{p.ideal_for}</span>
                  <span>{p.panels} paneles, ahorro estimado de {money(p.monthly_saving_mxn)} al mes</span>
                  <span className="p-price">{money(p.price_mxn)} MXN</span>
                </div>
                <button type="button" className="p-btn p-btn-sun" disabled={busy} onClick={() => onRequest(p.package_id)}>Solicitar</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Quote({ customerId, quote, catalog, now, onUpdate, onBack, onError }) {
  const [openSection, setOpenSection] = useState(null);
  const [message, setMessage] = useState('');
  const [pauseDate, setPauseDate] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [email, setEmail] = useState('');
  const [invoice, setInvoice] = useState(null);
  const [sending, setSending] = useState(false);
  const pkg = quote.package;
  const st = statusOf(quote);
  const closed = quote.status === 'closed';

  const act = async (fn) => {
    setSending(true);
    try {
      onUpdate(await fn());
      return true;
    } catch (e) {
      onError(e.message);
      return false;
    } finally {
      setSending(false);
    }
  };

  const toggleSection = (id) => {
    const opening = openSection !== id;
    setOpenSection(opening ? id : null);
    if (opening && !closed) portalApi.viewSection(customerId, quote.case_id, id).then(onUpdate).catch(() => {});
  };

  return (
    <main className="p-main">
      <button type="button" className="p-link p-back" onClick={onBack}>Volver a mis cotizaciones</button>

      <section className="p-quote-hero">
        <span className={`p-status ${st.cls}`}>{st.label}</span>
        <h1>{pkg?.name ?? 'Propuesta'}</h1>
        <p className="p-price-big">{money(quote.amount_mxn)} <span>MXN con IVA</span></p>
        {pkg && <p>{pkg.panels} paneles, {pkg.kw} kW. Ahorro estimado de {money(pkg.monthly_saving_mxn)} al mes.</p>}
        <p className="p-muted-light">Cotización {quote.case_id}, {dateMx(quote.opened_at)}</p>
      </section>

      <section className="p-card">
        <h2>Revisa tu propuesta</h2>
        <ul className="p-sections">
          {catalog?.sections.map((s) => (
            <li key={s.id}>
              <button type="button" className="p-section" aria-expanded={openSection === s.id} onClick={() => toggleSection(s.id)}>
                <span>{s.title}</span>
                <span aria-hidden="true">{openSection === s.id ? '−' : '+'}</span>
              </button>
              {openSection === s.id && pkg && <p className="p-section-body">{sectionText(s.id, pkg)}</p>}
            </li>
          ))}
        </ul>
      </section>

      {!closed && (
        <section className="p-card">
          <h2>¿Tienes una duda?</h2>
          <form
            className="p-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!message.trim()) return;
              act(() => portalApi.sendMessage(customerId, quote.case_id, message)).then((ok) => ok && setMessage(''));
            }}
          >
            <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} placeholder="Escríbenos lo que necesites saber." />
            <button type="submit" className="p-btn" disabled={sending || !message.trim()}>Enviar mensaje</button>
          </form>
        </section>
      )}

      {quote.messages.length > 0 && (
        <section className="p-card">
          <h2>Tus mensajes</h2>
          <ul className="p-messages">
            {quote.messages.map((m) => (
              <li key={m.event_id}>
                <p>{m.message}</p>
                <span className="p-muted">{dateMx(m.at)}</span>
              </li>
            ))}
          </ul>
          <p className="p-muted">Un asesor te responderá. Si pediste que no te contactemos, lo respetaremos.</p>
        </section>
      )}

      {!closed && (
        <section className="p-card">
          <h2>¿Cómo prefieres que te contactemos?</h2>
          <p className="p-muted">
            {!quote.contact.allowed
              ? 'Pediste que no te contactemos.'
              : quote.contact.not_before && new Date(quote.contact.not_before) > new Date(now || Date.now())
                ? `Pediste que no te contactemos antes del ${dayMx(quote.contact.not_before)}.`
                : 'Podemos contactarte para resolver tus dudas.'}
          </p>
          <div className="p-pref">
            <label>
              No me contacten antes del
              <input type="date" value={pauseDate} onChange={(e) => setPauseDate(e.target.value)} />
            </label>
            <button
              type="button"
              className="p-btn"
              disabled={sending || !pauseDate}
              onClick={() => act(() => portalApi.contact(customerId, quote.case_id, { kind: 'pause_until', until: `${pauseDate}T15:00:00Z` })).then((ok) => ok && setPauseDate(''))}
            >
              Guardar fecha
            </button>
          </div>
          <div className="p-pref-row">
            {quote.contact.allowed ? (
              <button type="button" className="p-link" disabled={sending} onClick={() => act(() => portalApi.contact(customerId, quote.case_id, { kind: 'no_contact' }))}>Prefiero que no me contacten</button>
            ) : (
              <button type="button" className="p-link" disabled={sending} onClick={() => act(() => portalApi.contact(customerId, quote.case_id, { kind: 'allow' }))}>Pueden contactarme de nuevo</button>
            )}
          </div>
        </section>
      )}

      {!closed && (
        <section className="p-card p-decide">
          <h2>¿Listo para decidir?</h2>
          <p className="p-muted">Tómate el tiempo que necesites. No hay prisa.</p>
          {confirm ? (
            <div className="p-confirm">
              <p>{confirm === 'accept' ? `¿Confirmas la compra de ${pkg?.name} por ${money(quote.amount_mxn)} MXN?` : '¿Seguro que quieres rechazar esta cotización?'}</p>
              <div className="p-row">
                <button
                  type="button"
                  className={`p-btn ${confirm === 'accept' ? 'p-btn-sun' : 'p-btn-off'}`}
                  disabled={sending}
                  onClick={() => act(() => (confirm === 'accept' ? portalApi.accept(customerId, quote.case_id) : portalApi.reject(customerId, quote.case_id))).then(() => setConfirm(null))}
                >
                  {confirm === 'accept' ? 'Sí, comprar' : 'Sí, rechazar'}
                </button>
                <button type="button" className="p-link" onClick={() => setConfirm(null)}>Cancelar</button>
              </div>
            </div>
          ) : (
            <div className="p-row">
              <button type="button" className="p-btn p-btn-sun" onClick={() => setConfirm('accept')}>Aceptar y comprar</button>
              <button type="button" className="p-btn p-btn-ghost" onClick={() => setConfirm('reject')}>Rechazar</button>
            </div>
          )}
        </section>
      )}

      {closed && quote.closed_status === 'accepted' && (
        <section className="p-card p-done">
          <h2>¡Gracias por tu compra!</h2>
          <p>Un asesor te contactará para agendar la instalación.</p>
          {quote.invoice && !invoice && (
            <p className="p-muted">
              Comprobante {quote.invoice.invoice_number}: {quote.invoice.status === 'sent' ? `enviado a ${quote.invoice.email}` : 'generado'}.
            </p>
          )}
          {!invoice && (
            <form
              className="p-form"
              onSubmit={async (e) => {
                e.preventDefault();
                setSending(true);
                try {
                  const r = await portalApi.invoice(customerId, quote.case_id, email);
                  setInvoice(r);
                  onUpdate(r.case);
                } catch (err) {
                  onError(err.message);
                } finally {
                  setSending(false);
                }
              }}
            >
              <label>
                ¿A qué correo te enviamos tu comprobante?
                <input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="tucorreo@ejemplo.com" />
              </label>
              <button type="submit" className="p-btn p-btn-sun" disabled={sending}>{sending ? 'Enviando…' : 'Enviar comprobante'}</button>
            </form>
          )}
          {invoice && (
            <div className={`p-invoice ${invoice.status === 'sent' ? 'p-invoice-ok' : ''}`} role="status">
              <p><strong>{invoice.message}</strong></p>
              <dl>
                <div><dt>Folio</dt><dd>{invoice.invoice_number}</dd></div>
                <div><dt>Concepto</dt><dd>{invoice.preview.concept}</dd></div>
                <div><dt>Subtotal</dt><dd>{money(invoice.preview.subtotal_mxn)}</dd></div>
                <div><dt>IVA</dt><dd>{money(invoice.preview.iva_mxn)}</dd></div>
                <div><dt>Total</dt><dd><strong>{money(invoice.preview.total_mxn)} MXN</strong></dd></div>
              </dl>
              <p className="p-muted">Comprobante de demostración. No es una factura fiscal.</p>
            </div>
          )}
        </section>
      )}

      {closed && quote.closed_status !== 'accepted' && (
        <section className="p-card">
          <h2>Cotización {statusOf(quote).label.toLowerCase()}</h2>
          <p className="p-muted">Si cambias de opinión, puedes pedir una nueva cuando quieras.</p>
        </section>
      )}
    </main>
  );
}

export default function PortalApp() {
  const [customerId, setCustomerId] = useState(portalCustomer.get());
  const [me, setMe] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [caseId, setCaseId] = useState(() => window.location.hash.match(/^#\/cotizacion\/(.+)$/)?.[1] ?? null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const showError = useCallback((msg) => setError(msg), []);

  const load = useCallback(async (cid) => {
    if (!cid) return;
    try {
      setMe(await portalApi.me(cid));
    } catch (e) {
      if (e.status === 401) {
        portalCustomer.set(null);
        setCustomerId(null);
      } else setError(e.message);
    }
  }, []);

  useEffect(() => {
    portalApi.catalog().then(setCatalog).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(customerId); }, [customerId, load]);
  useEffect(() => {
    const onHash = () => setCaseId(window.location.hash.match(/^#\/cotizacion\/(.+)$/)?.[1] ?? null);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const pick = (cid) => {
    portalCustomer.set(cid);
    setCustomerId(cid);
    setError(null);
  };
  const switchCompany = () => {
    portalCustomer.set(null);
    setCustomerId(null);
    setMe(null);
    window.location.hash = '';
  };
  const openQuote = (id) => { window.location.hash = `#/cotizacion/${id}`; window.scrollTo(0, 0); };
  const goHome = () => { window.location.hash = ''; window.scrollTo(0, 0); };

  const requestQuote = async (packageId) => {
    setBusy(true);
    try {
      const q = await portalApi.requestQuote(customerId, packageId);
      await load(customerId);
      openQuote(q.case_id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const updateQuote = (q) => {
    setMe((prev) => (prev ? { ...prev, quotes: prev.quotes.map((x) => (x.case_id === q.case_id ? q : x)) } : prev));
    setError(null);
  };

  const quote = me?.quotes.find((q) => q.case_id === caseId);

  return (
    <div className="portal">
      <Header customer={me?.customer} onSwitch={switchCompany} onHome={goHome} />
      {error && (
        <div className="p-error" role="alert">
          <span>{error}</span>
          <button type="button" className="p-link" onClick={() => setError(null)}>Cerrar</button>
        </div>
      )}
      {!customerId && <PickCompany onPicked={pick} onError={showError} />}
      {customerId && me && !quote && <Home me={me} catalog={catalog} onOpen={openQuote} onRequest={requestQuote} busy={busy} />}
      {customerId && me && quote && (
        <Quote customerId={customerId} quote={quote} catalog={catalog} now={me.now} onUpdate={updateQuote} onBack={goHome} onError={showError} />
      )}
      <footer className="p-footer">Sitio de demostración del hackatón ByeCode. Nexo Solar es una empresa ficticia; no hay cobros reales.</footer>
    </div>
  );
}
