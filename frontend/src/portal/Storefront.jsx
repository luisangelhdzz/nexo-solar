import { useEffect, useMemo, useState } from 'react';
import { CATEGORIES, COMPONENTS, FACTS, PROMISES } from './products.js';
import { ProductArt, SolarPanelArt, BatteryArt, InverterArt } from './art.jsx';
import { IconArrow, IconBolt, IconCard, IconDoc, IconHeadset, IconMail, IconPhone, IconPin, IconShield, IconWrench } from './icons.jsx';
import { go, money } from './util.js';

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Los paquetes del backend y los componentes de la vitrina comparten la misma tarjeta.
export function buildProducts(catalog) {
  const packages = (catalog?.packages ?? []).map((p, i) => ({
    id: p.package_id,
    package_id: p.package_id,
    category: 'paquetes',
    name: p.name,
    spec: `${p.panels} paneles, ahorro estimado de ${money(p.monthly_saving_mxn)} al mes`,
    price_mxn: p.price_mxn,
    badge: i === 1 ? 'Más vendido' : undefined,
  }));
  return [...packages, ...COMPONENTS];
}

function ProductCard({ product, onQuote, busy }) {
  const isPackage = Boolean(product.package_id);
  return (
    <li className="s-product">
      {product.badge && <span className="s-badge">{product.badge}</span>}
      <div className="s-product-art"><ProductArt kind={product.category} size={product.category === 'paquetes' || product.category === 'paneles' ? 170 : 110} id={product.id} /></div>
      <h3>{product.name}</h3>
      <p className="s-product-spec">{product.spec}</p>
      <div className="s-product-foot">
        <span className="s-price">{money(product.price_mxn)}{isPackage && <small> MXN con IVA</small>}</span>
        <button type="button" className="s-icon-btn" disabled={busy} onClick={() => onQuote(product)} aria-label={`Cotizar ${product.name}`} title="Cotizar">
          <IconDoc />
        </button>
      </div>
    </li>
  );
}

// ---------- Hero: un carrusel con los paquetes reales del catálogo ----------
function Hero({ catalog, onQuote }) {
  const slides = catalog?.packages ?? [];
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (slides.length < 2 || paused || prefersReducedMotion()) return undefined;
    const id = setInterval(() => setIndex((i) => (i + 1) % slides.length), 6000);
    return () => clearInterval(id);
  }, [slides.length, paused]);

  const slide = slides[index];
  const modules = index + 1;

  return (
    <section className="s-hero" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="s-hero-copy">
        <span className="s-eyebrow"><IconBolt width={14} height={14} /> {slide ? 'Paquete recomendado' : 'Energía solar para empresas'}</span>
        <h1>{slide ? slide.name : 'Energía solar para tu negocio'}</h1>
        <p>
          {slide
            ? `${slide.ideal_for}. ${slide.panels} paneles, inversor e interconexión incluidos.`
            : 'Instalamos paneles, inversor e interconexión. Pide tu cotización y decide a tu ritmo.'}
        </p>
        <div className="s-hero-actions">
          <button type="button" className="s-btn s-btn-primary" onClick={() => (slide ? onQuote({ package_id: slide.package_id }) : go('cotizar'))}>
            Cotizar ahora <IconArrow width={18} height={18} />
          </button>
          <button type="button" className="s-btn s-btn-ghost" onClick={() => go('tienda/paquetes')}>Ver paquetes</button>
        </div>
        <ul className="s-hero-facts">
          <li><strong>25 años</strong><span>garantía en paneles</span></li>
          <li><strong>2 a 3 días</strong><span>de instalación</span></li>
        </ul>
      </div>

      <div className="s-hero-art" aria-live="polite">
        <div className="s-hero-disc" aria-hidden="true" />
        <SolarPanelArt modules={modules} size={520} id="hero" />
        {slide && (
          <div className="s-hero-price">
            <span>Desde</span>
            <strong>{money(slide.price_mxn)}</strong>
          </div>
        )}
        <div className="s-hero-float" aria-hidden="true"><InverterArt size={92} /></div>
      </div>

      {slides.length > 1 && (
        <div className="s-dots" role="tablist" aria-label="Paquetes destacados">
          {slides.map((p, i) => (
            <button key={p.package_id} type="button" role="tab" aria-selected={i === index} aria-label={p.name} className={i === index ? 'on' : ''} onClick={() => setIndex(i)} />
          ))}
        </div>
      )}
    </section>
  );
}

function CategoryRow({ products }) {
  const counts = useMemo(() => {
    const out = {};
    products.forEach((p) => { out[p.category] = (out[p.category] ?? 0) + 1; });
    return out;
  }, [products]);
  return (
    <section className="s-section">
      <div className="s-section-head">
        <div>
          <span className="s-kicker">Explora por categoría</span>
          <h2>Todo para tu sistema solar</h2>
        </div>
      </div>
      <ul className="s-categories">
        {CATEGORIES.map((c) => (
          <li key={c.slug}>
            <button type="button" className="s-category" onClick={() => go(`tienda/${c.slug}`)}>
              <ProductArt kind={c.slug} size={c.slug === 'paquetes' || c.slug === 'paneles' ? 84 : 56} id={`cat-${c.slug}`} />
              <strong>{c.label}</strong>
              <span>{counts[c.slug] ? `${counts[c.slug]} ${counts[c.slug] === 1 ? 'producto' : 'productos'}` : c.note}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// El diseño de referencia lleva aquí una cuenta regresiva. Este portal promete "sin prisa",
// así que en su lugar van los datos firmes de la oferta, con la misma forma de mosaico.
function OfferBanner() {
  return (
    <section className="s-offer" id="ofertas">
      <div className="s-offer-copy">
        <span className="s-tag"><IconBolt width={13} height={13} /> Cotiza con calma</span>
        <h2>Tu sistema solar, instalado y con garantía</h2>
        <ul className="s-facts">
          {FACTS.map((f) => (
            <li key={f.label}>
              <strong>{f.value}</strong>
              <em>{f.unit}</em>
              <span>{f.label}</span>
            </li>
          ))}
        </ul>
        <button type="button" className="s-btn s-btn-dark" onClick={() => go('cotizar')}>Pedir mi cotización <IconArrow width={18} height={18} /></button>
      </div>
      <div className="s-offer-art" aria-hidden="true">
        <div className="s-offer-disc" />
        <BatteryArt size={190} />
      </div>
    </section>
  );
}

function BestSellers({ products, onQuote, busy }) {
  const featured = products.filter((p) => p.package_id || p.badge).slice(0, 8);
  return (
    <section className="s-section">
      <div className="s-section-head">
        <div>
          <span className="s-kicker">Nuestra colección</span>
          <h2>Lo más pedido</h2>
        </div>
        <button type="button" className="s-btn s-btn-outline" onClick={() => go('tienda')}>Ver todos los productos <IconArrow width={16} height={16} /></button>
      </div>
      <ul className="s-grid">
        {featured.map((p) => <ProductCard key={p.id} product={p} onQuote={onQuote} busy={busy} />)}
      </ul>
    </section>
  );
}

const PROMISE_ICON = { install: IconWrench, warranty: IconShield, financing: IconCard, support: IconHeadset };

function Promises() {
  return (
    <section className="s-promises">
      {PROMISES.map((p) => {
        const Icon = PROMISE_ICON[p.key];
        return (
          <div key={p.key} className="s-promise">
            <span className="s-promise-icon"><Icon /></span>
            <div><strong>{p.title}</strong><span>{p.note}</span></div>
          </div>
        );
      })}
    </section>
  );
}

export function HomePage({ catalog, onQuote, busy }) {
  const products = useMemo(() => buildProducts(catalog), [catalog]);
  return (
    <>
      <Hero catalog={catalog} onQuote={onQuote} />
      <div className="s-container">
        <CategoryRow products={products} />
        <OfferBanner />
        <BestSellers products={products} onQuote={onQuote} busy={busy} />
        <Promises />
      </div>
    </>
  );
}

// ---------- Tienda: todas las categorías, con filtro y búsqueda ----------
export function ShopPage({ catalog, category, query, onQuote, busy }) {
  const products = useMemo(() => buildProducts(catalog), [catalog]);
  const q = query.trim().toLowerCase();
  const visible = products.filter((p) => (!category || p.category === category) && (!q || `${p.name} ${p.spec}`.toLowerCase().includes(q)));
  const current = CATEGORIES.find((c) => c.slug === category);
  return (
    <div className="s-container s-page">
      <div className="s-section-head">
        <div>
          <span className="s-kicker">Tienda</span>
          <h1 className="s-h1">{current ? current.label : 'Todos los productos'}</h1>
          {q && <p className="s-muted">Resultados para “{query}”</p>}
        </div>
      </div>
      <div className="s-chips" role="tablist" aria-label="Categorías">
        <button type="button" className={!category ? 'on' : ''} onClick={() => go('tienda')}>Todo</button>
        {CATEGORIES.map((c) => (
          <button key={c.slug} type="button" className={category === c.slug ? 'on' : ''} onClick={() => go(`tienda/${c.slug}`)}>{c.label}</button>
        ))}
      </div>
      {visible.length ? (
        <ul className="s-grid">{visible.map((p) => <ProductCard key={p.id} product={p} onQuote={onQuote} busy={busy} />)}</ul>
      ) : (
        <p className="s-empty">No encontramos productos con esa búsqueda. Prueba con otra palabra o pide tu cotización y un asesor te ayuda.</p>
      )}
      <p className="s-muted s-note">Los paquetes completos se cotizan y compran aquí mismo. Los componentes sueltos se incluyen dentro de tu paquete; si necesitas uno por separado, cuéntanoslo al cotizar.</p>
    </div>
  );
}

export function AboutPage() {
  return (
    <div className="s-container s-page s-prose">
      <span className="s-kicker">Nosotros</span>
      <h1 className="s-h1">Energía solar para empresas, sin vueltas</h1>
      <p>Nexo Solar diseña, instala y da seguimiento a sistemas fotovoltaicos para comercios, negocios y plantas industriales. Cada paquete incluye paneles, estructura, inversor y el trámite de interconexión.</p>
      <p>Creemos que una decisión de este tamaño se toma con calma: tu cotización queda guardada, puedes revisar cada sección de la propuesta, escribirnos tus dudas y elegir cuándo quieres que te contactemos.</p>
      <Promises />
    </div>
  );
}

export function ContactPage() {
  return (
    <div className="s-container s-page s-prose">
      <span className="s-kicker">Contacto</span>
      <h1 className="s-h1">Hablemos de tu proyecto</h1>
      <p>La forma más rápida es pedir tu cotización: queda registrada y puedes escribirnos tus dudas desde ahí.</p>
      <button type="button" className="s-btn s-btn-primary" onClick={() => go('cotizar')}>Pedir mi cotización <IconArrow width={18} height={18} /></button>
      <ul className="s-contact">
        <li><IconPhone /><span>Atención por teléfono: dato de demostración</span></li>
        <li><IconMail /><span>Correo de ventas: dato de demostración</span></li>
        <li><IconPin /><span>Monterrey, Nuevo León</span></li>
      </ul>
    </div>
  );
}
