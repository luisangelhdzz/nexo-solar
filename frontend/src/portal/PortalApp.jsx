import { useCallback, useEffect, useRef, useState } from 'react';
import { portalApi, portalCustomer, portalAccess } from '../api.js';
import { BotonCotizaciones, HomePage, MenuBar, Pie, SECCION_DE_RUTA, useSeccionActiva } from './Storefront.jsx';
import { dateMx, dayMx, go, money, parseHash } from './util.js';
import { packagePhoto } from './photos.js';
import RequestForm from './RequestForm.jsx';
import './portal.css';
import './storefront.css';

// Portal público de Nexo Solar: solicitud del proyecto y revisión de propuestas.
// Lo que hace el cliente aquí se registra como eventos; nunca se le muestra la recomendación interna.

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
const statusOf = (q) => (q.status === 'closed' ? STATUS[q.closed_status] : q.proposal_pending ? { label: 'Solicitud recibida', cls: 'st-open' } : STATUS.open);

function PortalEntry() {
  return <main className="p-main"><section className="p-card">
    <h1>Accede a tu cotización</h1>
    <p>Abre el enlace que te enviamos por correo para revisar tu solicitud o propuesta.</p>
    <p className="p-muted">Si el enlace venció o no encuentras el correo, solicita uno nuevo al equipo de Nexo Solar.</p>
    <button type="button" className="p-btn p-btn-sun" onClick={() => go('cotizar')}>Solicitar una cotización</button>
  </section></main>;
}

function QuoteHome({ me, onOpen, onSwitch }) {
  return (
    <main className="p-main">
      <section className="p-hero p-hero-small">
        <h1>Hola{me.customer.contact_name ? `, ${me.customer.contact_name.split(' ')[0]}` : ''}</h1>
        <p>{me.customer.name}</p>
        <button type="button" className="p-link p-link-light" onClick={onSwitch}>Cerrar sesión</button>
      </section>

      {me.quotes.length > 0 && (
        <section className="p-card">
          <h2>Tus solicitudes y cotizaciones</h2>
          <ul className="p-quotes">
            {me.quotes.map((q) => (
              <li key={q.case_id}>
                <button type="button" className="p-quote" onClick={() => onOpen(q.case_id)}>
                  {packagePhoto(q.package?.package_id) ? <img className="p-thumb" src={packagePhoto(q.package.package_id)} alt="" loading="lazy" /> : <span className="p-thumb" aria-hidden="true" />}
                  <span className="p-quote-text">
                    <span className="p-quote-top">
                      <strong>{q.proposal?.title ?? q.package?.name ?? 'Tu proyecto solar'}</strong>
                      <span className={`p-status ${statusOf(q).cls}`}>{statusOf(q).label}</span>
                    </span>
                    <span className="p-muted">{q.proposal_pending ? 'Propuesta en preparación' : `${money(q.amount_mxn)} MXN`} · {dateMx(q.opened_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="p-card">
        <h2>Un nuevo proyecto</h2>
        <p className="p-muted">Cuéntanos qué necesitas y prepararemos una solución para tu negocio.</p>
        <button type="button" className="p-btn p-btn-sun" onClick={() => go('cotizar')}>Solicitar cotización</button>
      </section>
    </main>
  );
}

// Mientras un correo se está enviando, se consulta cada 2.5 s (hasta ~30 s) para mostrar si ya salió.
function usePendingMailRefresh(quote, onRefresh) {
  const tries = useRef(0);
  const pending = quote.invoice?.status === 'pending' || quote.email_copy?.status === 'pending';
  useEffect(() => {
    if (!pending) { tries.current = 0; return undefined; }
    if (tries.current >= 12) return undefined;
    const t = setTimeout(() => { tries.current += 1; onRefresh?.(); }, 2500);
    return () => clearTimeout(t);
  }, [pending, quote, onRefresh]);
}

function Quote({ customerId, quote, catalog, now, onUpdate, onRefresh, onBack, onError }) {
  const [openSection, setOpenSection] = useState(null);
  const [message, setMessage] = useState('');
  const [pauseDate, setPauseDate] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [email, setEmail] = useState(quote.request?.email ?? '');
  const [invoice, setInvoice] = useState(null);
  const [otherEmail, setOtherEmail] = useState(false);
  const [sending, setSending] = useState(false);
  const pkg = quote.package;
  const st = statusOf(quote);
  const closed = quote.status === 'closed';
  const autoInvoice = quote.invoice?.status;
  usePendingMailRefresh(quote, onRefresh);

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

      <section className={`p-quote-hero ${packagePhoto(pkg?.package_id) ? 'has-photo' : ''}`}>
        <div className="p-quote-hero-text">
          <span className={`p-status ${st.cls}`}>{st.label}</span>
          <h1>{quote.proposal?.title ?? (quote.proposal_pending ? 'Recibimos tu solicitud' : pkg?.name ?? 'Propuesta')}</h1>
          {quote.proposal_pending ? <p>Estamos revisando tu proyecto. Aquí verás tu propuesta cuando el equipo la prepare.</p> : <p className="p-price-big">{money(quote.amount_mxn)} <span>MXN con IVA</span></p>}
          {pkg && <p>{pkg.panels} paneles, {pkg.kw} kW. Ahorro estimado de {money(pkg.monthly_saving_mxn)} al mes.</p>}
          <p className="p-muted-light">Cotización {quote.case_id}, {dateMx(quote.opened_at)}</p>
        </div>
        {packagePhoto(pkg?.package_id) && <img className="p-quote-photo" src={packagePhoto(pkg.package_id)} alt={`Equipo del paquete ${pkg.name} (imagen ilustrativa)`} />}
      </section>

      {quote.request && <section className="p-card">
        <h2>Tu proyecto</h2><p>{quote.request.goal}</p>
        <p className="p-muted">{quote.request.city} · {quote.request.roof}</p>
        <p>{quote.request.bill_amount_mxn ? `${money(quote.request.bill_amount_mxn)} por recibo ${quote.request.bill_period === 'bimonthly' ? 'bimestral' : 'mensual'}` : 'Gasto de electricidad por confirmar'}</p>
        {quote.email_copy?.status === 'sent' && <p className="p-muted p-mail-note">Te enviamos una copia de tu solicitud a {quote.email_copy.email}.</p>}
        {quote.email_copy?.status === 'pending' && <p className="p-muted p-mail-note" role="status">Enviando una copia de tu solicitud a {quote.email_copy.email}…</p>}
      </section>}
      {!quote.proposal_pending && <section className="p-card">
        <h2>Revisa tu propuesta</h2>
        {quote.proposal?.notes && <p>{quote.proposal.notes}</p>}
        <ul className="p-sections">
          {catalog?.sections.map((s) => (
            <li key={s.id}>
              <button type="button" className="p-section" aria-expanded={openSection === s.id} onClick={() => toggleSection(s.id)}>
                <span>{s.title}</span>
                <span aria-hidden="true">{openSection === s.id ? '−' : '+'}</span>
              </button>
              {openSection === s.id && pkg && <p className="p-section-body">{sectionText(s.id, { ...pkg, price_mxn: quote.amount_mxn })}</p>}
            </li>
          ))}
        </ul>
      </section>}

      {!closed && (
        <section className="p-card">
          <h2>{quote.proposal_pending ? '¿Quieres agregar información?' : '¿Tienes una duda?'}</h2>
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

      {(quote.conversation ?? quote.messages).length > 0 && (
        <section className="p-card">
          <h2>Conversación con Nexo Solar</h2>
          <ul className="p-messages">
            {(quote.conversation ?? quote.messages).map((m) => (
              <li key={m.event_id} className={m.from === 'team' ? 'p-team-message' : ''}>
                <strong>{m.from === 'team' ? 'Nexo Solar' : 'Tú'}</strong>
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

      {!closed && !quote.proposal_pending && (
        <section className="p-card p-decide">
          <h2>¿Listo para decidir?</h2>
          <p className="p-muted">Tómate el tiempo que necesites. No hay prisa.</p>
          {confirm ? (
            <div className="p-confirm">
              <p>{confirm === 'accept' ? `¿Confirmas la compra de ${quote.proposal?.title ?? pkg?.name} por ${money(quote.amount_mxn)} MXN?` : '¿Seguro que quieres rechazar esta cotización?'}</p>
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
          {!invoice && autoInvoice === 'sent' && (
            <p className="p-mail-note p-mail-ok" role="status">
              Te enviamos tu comprobante {quote.invoice.invoice_number} a {quote.invoice.email}.{' '}
              {!otherEmail && <button type="button" className="p-link" onClick={() => { setOtherEmail(true); setEmail(''); }}>Enviarlo a otro correo</button>}
            </p>
          )}
          {!invoice && autoInvoice === 'pending' && (
            <p className="p-mail-note" role="status">Estamos enviando tu comprobante a {quote.invoice.email}…</p>
          )}
          {!invoice && autoInvoice === 'failed' && (
            <p className="p-muted">No pudimos enviar tu comprobante a {quote.invoice.email}. Puedes intentarlo de nuevo.</p>
          )}
          {!invoice && (otherEmail || !['sent', 'pending'].includes(autoInvoice)) && (
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
  const [customerId, setCustomerId] = useState(() => parseHash().access ? null : portalAccess.get() ? portalCustomer.get() : null);
  const [me, setMe] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [route, setRoute] = useState(() => parseHash());
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [openingAccess, setOpeningAccess] = useState(() => Boolean(parseHash().access));

  const showError = useCallback((msg) => setError(msg), []);

  const load = useCallback(async (cid) => {
    if (!cid) return;
    const credential = portalAccess.get();
    try {
      const view = await portalApi.me(cid);
      if (credential !== portalAccess.get()) return;
      setMe(view);
    } catch (e) {
      if (credential !== portalAccess.get()) return;
      if (e.status === 401) {
        portalCustomer.set(null);
        portalAccess.set(null);
        setCustomerId(null);
        setMe(null);
        setError(e.message);
      } else setError(e.message);
    }
  }, []);

  useEffect(() => {
    portalApi.catalog().then(setCatalog).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(customerId); }, [customerId, load]);
  useEffect(() => {
    if (!customerId) return;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(customerId); }, 15000);
    const onFocus = () => load(customerId);
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [customerId, load]);
  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (!route.access) return;
    let cancelled = false;
    setOpeningAccess(true);
    setMe(null);
    setCustomerId(null);
    portalCustomer.set(null);
    portalAccess.set(route.access);
    portalApi.me().then((view) => {
      if (cancelled) return;
      if (route.page !== 'cotizacion' || view.access_case_id !== route.arg) throw new Error('Este enlace no corresponde a la cotización solicitada.');
      portalCustomer.set(view.customer.customer_id);
      setCustomerId(view.customer.customer_id);
      setMe(view);
      setError(null);
      // El secreto queda en la sesión de esta pestaña; se retira de la barra de direcciones.
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/cotizacion/${encodeURIComponent(view.access_case_id)}`);
      setOpeningAccess(false);
      setRoute(parseHash());
    }).catch((e) => {
      if (cancelled) return;
      portalAccess.set(null);
      setError(e.message);
    }).finally(() => { if (!cancelled) setOpeningAccess(false); });
    return () => { cancelled = true; };
  }, [route.access, route.arg, route.page]);

  const inQuoteSection = ['cotizar', 'mis-cotizaciones', 'cotizacion'].includes(route.page);

  // Las rutas de las secciones del inicio (#/productos, #/como-cotizar, #/contacto) bajan
  // a su lugar; "Mis cotizaciones" y el inicio empiezan arriba.
  useEffect(() => {
    const id = inQuoteSection ? null : SECCION_DE_RUTA[route.page];
    if (!id || id === 'inicio') { window.scrollTo(0, 0); return; }
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  }, [route.page, route.arg, inQuoteSection, catalog]);

  const seccion = useSeccionActiva(!inQuoteSection, [catalog]);

  const pick = (cid) => {
    portalCustomer.set(cid);
    setCustomerId(cid);
    setError(null);
  };
  const switchCompany = (destination = 'mis-cotizaciones') => {
    portalCustomer.set(null);
    portalAccess.set(null);
    setCustomerId(null);
    setMe(null);
    go(typeof destination === 'string' ? destination : 'mis-cotizaciones');
  };
  const openQuote = (id) => go(`cotizacion/${id}`);

  const submitRequest = async (form) => {
    setBusy(true); setError(null);
    try {
      let cid = me?.access_case_id ? null : customerId;
      if (!cid) { const c = await portalApi.createCustomer(form); cid = c.customer_id; pick(cid); }
      const q = await portalApi.submitRequest(cid, form);
      await load(cid);
      openQuote(q.case_id);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const updateQuote = (q) => {
    setMe((prev) => (prev ? { ...prev, quotes: prev.quotes.map((x) => (x.case_id === q.case_id ? q : x)) } : prev));
    setError(null);
  };

  const quote = route.page === 'cotizacion' ? me?.quotes.find((q) => q.case_id === route.arg) : null;
  const refresh = useCallback(() => load(customerId), [load, customerId]);

  let page;
  if (inQuoteSection) {
    if (openingAccess) page = <main className="p-main"><p role="status">Abriendo tu cotización…</p></main>;
    else if (route.page === 'cotizar') page = <RequestForm key={me?.access_case_id ? 'new' : customerId || 'new'} customer={me?.access_case_id ? null : me?.customer} onNewCustomer={() => switchCompany('cotizar')} onSubmit={submitRequest} busy={busy} />;
    else if (!customerId) page = <PortalEntry />;
    else if (!me) page = <main className="p-main"><p className="p-muted">Cargando tus cotizaciones…</p></main>;
    else if (quote) page = <Quote customerId={customerId} quote={quote} catalog={catalog} now={me.now} onUpdate={updateQuote} onRefresh={refresh} onBack={() => go('mis-cotizaciones')} onError={showError} />;
    else if (route.page === 'cotizacion') page = <main className="p-main"><section className="p-card"><h1>No encontramos esta cotización</h1><p>Revisa el enlace que recibiste por correo.</p></section></main>;
    else page = <QuoteHome me={me} onOpen={openQuote} onSwitch={switchCompany} />;
  } else {
    page = <HomePage />;
  }

  return (
    <div className="portal">
      <MenuBar activo={route.page === 'cotizar' ? 'solicitar' : inQuoteSection ? 'cotizar' : seccion} />
      {error && (
        <div className="p-error" role="alert">
          <span>{error}</span>
          <button type="button" className="p-link" onClick={() => setError(null)}>Cerrar</button>
        </div>
      )}
      {page}
      <Pie />
      {!inQuoteSection && <BotonCotizaciones cantidad={me?.quotes.length ?? 0} />}
    </div>
  );
}
