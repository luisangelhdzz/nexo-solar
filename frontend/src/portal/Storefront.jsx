import { Fragment, useEffect, useMemo, useState } from 'react';
import { LOGO } from './photos.js';
import { go, money } from './util.js';

// Portal de Nexo Solar: presentación del proyecto, solicitud y seguimiento de propuestas.

const reducirMovimiento = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/* ============================================================
   NAVEGACIÓN
   Las secciones de la página de inicio tienen su propia ruta (#/como-cotizar,
   #/contacto) para que se puedan compartir junto con el formulario y
   "Mis cotizaciones" (#/mis-cotizaciones).
   ============================================================ */
export const SECCION_DE_RUTA = {
  inicio: 'inicio',
  productos: 'inicio',
  tienda: 'inicio',
  'como-cotizar': 'metodos',
  contacto: 'contacto',
  ofertas: 'promo',
  nosotros: 'promo',
};

const LINKS = [
  { key: 'inicio', label: 'Inicio', ruta: '' },
  { key: 'solicitar', label: 'Solicitar cotización', ruta: 'cotizar' },
  { key: 'metodos', label: 'Cómo cotizar', ruta: 'como-cotizar' },
  { key: 'contacto', label: 'Contacto', ruta: 'contacto' },
  { key: 'cotizar', label: 'Mis cotizaciones', ruta: 'mis-cotizaciones' },
];

export function irA(ruta) {
  const destino = `#/${ruta}`;
  const actual = window.location.hash || '#/';
  if (actual !== destino) { go(ruta); return; }
  // Mismo hash: el navegador no avisa del cambio, así que se baja a mano.
  const id = SECCION_DE_RUTA[ruta || 'inicio'];
  if (!id || id === 'inicio') window.scrollTo({ top: 0, behavior: reducirMovimiento() ? 'auto' : 'smooth' });
  else document.getElementById(id)?.scrollIntoView({ behavior: reducirMovimiento() ? 'auto' : 'smooth' });
}

/* Marca en la barra la sección que se está viendo. La franja de detección va a
   media pantalla: la sección se marca cuando de verdad es la que se ve. */
export function useSeccionActiva(activa, deps = []) {
  const [seccion, setSeccion] = useState('inicio');
  useEffect(() => {
    if (!activa || !('IntersectionObserver' in window)) return undefined;
    const ids = ['inicio', 'metodos', 'contacto'];
    const obs = new IntersectionObserver((entradas) => {
      entradas.forEach((e) => { if (e.isIntersecting) setSeccion(e.target.id); });
    }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });
    ids.forEach((id) => { const el = document.getElementById(id); if (el) obs.observe(el); });
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activa, ...deps]);
  return seccion;
}

export function MenuBar({ activo }) {
  const [abierto, setAbierto] = useState(false);
  const [fijo, setFijo] = useState(false);

  // Al bajar, la barra gana un poco de sombra y se encoge.
  useEffect(() => {
    const onScroll = () => setFijo(window.scrollY > 30);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // El menú del celular se cierra al pasar a escritorio y con Escape.
  useEffect(() => {
    const onResize = () => { if (window.innerWidth > 870) setAbierto(false); };
    const onKey = (e) => { if (e.key === 'Escape') setAbierto(false); };
    window.addEventListener('resize', onResize);
    document.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('resize', onResize); document.removeEventListener('keydown', onKey); };
  }, []);

  const navegar = (e, ruta) => { e.preventDefault(); setAbierto(false); irA(ruta); };

  return (
    <div className={`menu${fijo ? ' menu--fijo' : ''}`} id="barraMenu">
      <a href="#/" className="logo" aria-label="Nexo Solar, inicio" onClick={(e) => navegar(e, '')}>
        <img src={LOGO} alt="Nexo Solar" width="54" height="54" />
      </a>

      <button
        type="button"
        className={`menu-label${abierto ? ' abierta' : ''}`}
        aria-label={abierto ? 'Cerrar menú' : 'Abrir menú'}
        aria-expanded={abierto}
        aria-controls="navPrincipal"
        onClick={() => setAbierto((v) => !v)}
      >
        <span /><span /><span />
      </button>

      <nav className={`navbar${abierto ? ' abierta' : ''}`} id="navPrincipal" aria-label="Principal">
        <ul>
          {LINKS.map((l) => (
            <li key={l.key}>
              <a href={`#/${l.ruta}`} className={activo === l.key ? 'activo' : ''} aria-current={activo === l.key ? 'true' : undefined} onClick={(e) => navegar(e, l.ruta)}>
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

/* ============================================================
   TÍTULO DEL HEADER: MÁQUINA DE ESCRIBIR
   Cada palabra va en un .word que no se parte, y cada letra en un .letter con su
   tinte. Las letras se ocultan con visibility (no display) para que el bloque
   conserve su tamaño mientras se escribe y la página no dé saltos.
   ============================================================ */
const TINTES = ['var(--titulo-tinte-1)', 'var(--titulo-tinte-2)', 'var(--titulo-tinte-3)', 'var(--titulo-tinte-4)'];
const ESCRITURA = {
  velocidad: 55, // ms por letra al escribir
  borrado: 28, // ms por letra al borrar
  esperaLleno: 4000, // ms con el texto completo antes de borrar
  esperaVacio: 550, // ms en blanco antes de volver a escribir
  inicio: 350, // respiro antes de arrancar
};

function partirEnLetras(lineas) {
  let i = 0;
  const partes = lineas.map((linea) => linea.split(/(\s+)/).filter(Boolean).map((trozo) => (
    /^\s+$/.test(trozo) ? { espacio: true } : { letras: [...trozo].map((ch) => ({ ch, i: i++ })) }
  )));
  return { partes, total: i };
}

function TituloEscrito({ lineas }) {
  const { partes, total } = useMemo(() => partirEnLetras(lineas), [lineas]);
  const [quieto] = useState(reducirMovimiento);
  const [vistas, setVistas] = useState(quieto ? total : 0);

  useEffect(() => {
    if (quieto) return undefined;
    let n = 0;
    let borrando = false;
    let reloj;
    const paso = () => {
      if (!borrando) {
        if (n < total) { n += 1; setVistas(n); reloj = setTimeout(paso, ESCRITURA.velocidad); return; }
        borrando = true; reloj = setTimeout(paso, ESCRITURA.esperaLleno); return;
      }
      if (n > 0) { n -= 1; setVistas(n); reloj = setTimeout(paso, ESCRITURA.borrado); return; }
      borrando = false; reloj = setTimeout(paso, ESCRITURA.esperaVacio);
    };
    reloj = setTimeout(paso, ESCRITURA.inicio);
    return () => clearTimeout(reloj);
  }, [quieto, total]);

  const cursor = (i) => {
    if (quieto) return '';
    if (vistas === 0) return i === 0 ? ' cursor-antes' : '';
    return i === vistas - 1 ? ' cursor' : '';
  };

  return (
    <h1 className={quieto ? '' : 'escribiendo-modo'} aria-label={lineas.join(' ')}>
      {partes.map((linea, li) => (
        <Fragment key={li}>
          {li > 0 && <br />}
          {linea.map((p, pi) => (p.espacio ? ' ' : (
            <span className="word" key={pi} aria-hidden="true">
              {p.letras.map(({ ch, i }) => (
                <span key={i} className={`letter${i < vistas ? ' visible' : ''}${cursor(i)}`} style={{ '--tinte': TINTES[i % TINTES.length] }}>{ch}</span>
              ))}
            </span>
          )))}
        </Fragment>
      ))}
    </h1>
  );
}

/* ============================================================
   "PRODUCTOS": las letras caen y se quedan colgando, meciéndose en ola.
   ============================================================ */
function TituloColgante({ texto, paso = 0.065 }) {
  const [animar, setAnimar] = useState(false);
  useEffect(() => {
    // Doble requestAnimationFrame: las letras se pintan primero y se animan en el
    // cuadro siguiente; si se hace todo junto se ve un tirón.
    let r2;
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setAnimar(true)); });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, []);
  let i = 0;
  const letras = [...texto.replace(/\s+/g, '')].length;
  return (
    <h2 className={animar ? 'animar' : ''} style={{ '--recorrido': `${(letras * paso + 0.6).toFixed(2)}s` }} aria-label={texto}>
      {texto.split(/(\s+)/).filter(Boolean).map((palabra, wi) => (/^\s+$/.test(palabra) ? ' ' : (
        <span className="word" key={wi} aria-hidden="true">
          {[...palabra].map((ch) => {
            const k = i++;
            return <span key={k} className="letter" style={{ '--letter-delay': `${(k * paso).toFixed(3)}s` }}>{ch}</span>;
          })}
        </span>
      )))}
    </h2>
  );
}

/* ============================================================
   HEADER
   ============================================================ */
const TITULO = ['Nexo Solar', 'energía para tu negocio'];

function Encabezado() {
  return (
    <header className="header" id="inicio">
      <div className="header-content">
        <div className="header-texto">
          <TituloEscrito lineas={TITULO} />
          <p className="request-hero-copy">Tu negocio es único. Tu solución solar también.</p>
          <button type="button" className="btn-1" onClick={() => go('cotizar')}>Cotizar mi proyecto</button>
        </div>
      </div>
    </header>
  );
}

/* ============================================================
   PRODUCTOS
   ============================================================ */
/* ============================================================
   PROMO + MAPA
   ============================================================ */
const CIUDAD = 'Instituto Tecnológico de Saltillo, Saltillo, Coahuila, México';

function Promo() {
  const consulta = encodeURIComponent(CIUDAD);
  return (
    <section className="promo" id="promo">
      <div className="promo-inner container">
        <div className="promo-texto">
          <span className="eyebrow">Sin prisa, sin presión</span>
          <h2>Energía solar a tu ritmo</h2>
          <span className="divisor divisor--izq" />
          <p>Revisamos tu consumo y las condiciones de instalación para preparar una solución adecuada. Tu cotización queda guardada: revísala con calma y decide cuando estés listo.</p>
          <button type="button" className="btn-1 btn-1--claro" onClick={() => go('cotizar')}>Pedir mi cotización</button>
        </div>
        <div className="promo-mapa">
          <div className="mapa-marco">
            <iframe
              title="Ubicación de Nexo Solar"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              src={`https://www.google.com/maps?q=${consulta}&z=12&output=embed`}
              allowFullScreen
            />
          </div>
          <div className="mapa-pie">
            <span className="mapa-direccion">{CIUDAD}</span>
            <a className="mapa-link" href={`https://www.google.com/maps/dir/?api=1&destination=${consulta}`} target="_blank" rel="noopener noreferrer">Cómo llegar</a>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   CÓMO COTIZAR
   ============================================================ */
const PASOS = [
  { n: '01', acento: '#198ef5', titulo: 'Cuéntanos tu proyecto', texto: 'Comparte los datos de tu negocio, tu gasto de luz y cómo prefieres que te contactemos.' },
  { n: '02', acento: 'linear-gradient(90deg, #fdc468, #df4996)', titulo: 'Revísala con calma', texto: 'Abre cada sección de la propuesta, escríbenos tus dudas y dinos desde cuándo prefieres que te contactemos.' },
  { n: '03', acento: '#1db489', titulo: 'Decide y recibe tu comprobante', texto: 'Cuando estés listo, acéptala y te enviamos el comprobante a tu correo. No se cobra nada en línea.' },
];

function Metodos() {
  return (
    <section className="metodos" id="metodos">
      <div className="container">
        <span className="eyebrow">Fácil y directo</span>
        <h2>Tu proyecto, paso a paso</h2>
        <span className="divisor" />
        <div className="metodos-content">
          {PASOS.map((p) => (
            <div className="metodo-card" key={p.n} style={{ '--acento': p.acento }}>
              <span className="metodo-num" aria-hidden="true">{p.n}</span>
              <h3>{p.titulo}</h3>
              <p>{p.texto}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   FOOTER Y BOTÓN FLOTANTE
   ============================================================ */
export function Pie() {
  const consulta = encodeURIComponent(CIUDAD);
  return (
    <footer className="footer" id="contacto">
      <div className="footer-content container">
        <div className="footer-col">
          <h3 className="footer-marca">Nexo Solar</h3>
          <p className="footer-desc">Sistemas solares instalados para comercios, negocios e industria.</p>
        </div>
        <div className="footer-col">
          <h3>México</h3>
          <a href={`https://www.google.com/maps?q=${consulta}`} target="_blank" rel="noopener noreferrer">{CIUDAD}</a>
          <a href="#/cotizar" onClick={(e) => { e.preventDefault(); irA('cotizar'); }}>Escríbenos desde tu cotización</a>
        </div>
        <div className="footer-col">
          <h3>Tu cuenta</h3>
          <a href="#/cotizar" onClick={(e) => { e.preventDefault(); irA('cotizar'); }}>Pedir cotización</a>
          <a href="#/mis-cotizaciones" onClick={(e) => { e.preventDefault(); irA('mis-cotizaciones'); }}>Mis cotizaciones</a>
        </div>
      </div>
      <p className="footer-copy">© {new Date().getFullYear()} Nexo Solar. Sitio de demostración del hackatón ByeCode: empresa ficticia, sin cobros reales.</p>
    </footer>
  );
}

export function BotonCotizaciones({ cantidad }) {
  return (
    <button type="button" className="boton-carrito" aria-label={`Mis cotizaciones${cantidad ? `, ${cantidad}` : ''}`} title="Mis cotizaciones" onClick={() => irA('mis-cotizaciones')}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 3h7l5 5v13H7z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M14 3v5h5M10 13h6M10 17h6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <span className={`carrito-contador${cantidad > 0 ? ' visible' : ''}`}>{cantidad}</span>
    </button>
  );
}

/* ============================================================
   PÁGINA DE INICIO
   ============================================================ */
export function HomePage() {
  return (
    <>
      <Encabezado />
      <Promo />
      <Metodos />
    </>
  );
}
