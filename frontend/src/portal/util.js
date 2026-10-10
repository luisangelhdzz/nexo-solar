export const money = (n) => `$${Number(n).toLocaleString('es-MX')}`;
export const dateMx = (iso) => (iso ? new Date(iso).toLocaleString('es-MX', { timeZone: 'America/Monterrey', dateStyle: 'medium', timeStyle: 'short' }) : '');
export const dayMx = (iso) => (iso ? new Date(iso).toLocaleDateString('es-MX', { timeZone: 'America/Monterrey', weekday: 'long', day: 'numeric', month: 'long' }) : '');

// Rutas del portal, todas por hash: #/tienda/paneles?q=texto
export function parseHash(hash = window.location.hash) {
  const raw = hash.replace(/^#\/?/, '');
  const [path, qs = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  return {
    page: parts[0] || 'inicio',
    arg: parts[1] ? decodeURIComponent(parts.slice(1).join('/')) : null,
    q: new URLSearchParams(qs).get('q') || '',
  };
}

export const go = (path) => { window.location.hash = `#/${path}`; };
