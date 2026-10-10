// Ilustraciones en SVG para los componentes sueltos y las categorías. Los paquetes completos
// usan fotografías (ver photos.js). Todo se dibuja con la misma paleta (azul de celda + ámbar solar).

const CELL = '#24476b';
const CELL_DEEP = '#142c45';
const CELL_LIGHT = '#3f6d98';
const SUN = '#f2b134';
const SUN_GLOW = '#ffd873';
const METAL = '#c9d4de';
const METAL_DARK = '#8fa0b0';

// Un módulo fotovoltaico visto en ligera perspectiva (cuadrícula de celdas + marco).
function Module({ x = 0, y = 0, w = 200, h = 120, cols = 6, rows = 4, id }) {
  const lines = [];
  for (let c = 1; c < cols; c += 1) lines.push(<line key={`c${c}`} x1={(w / cols) * c} y1="0" x2={(w / cols) * c} y2={h} />);
  for (let r = 1; r < rows; r += 1) lines.push(<line key={`r${r}`} x1="0" y1={(h / rows) * r} x2={w} y2={(h / rows) * r} />);
  return (
    <g transform={`translate(${x} ${y}) skewY(-10)`}>
      <rect x="-5" y="-5" width={w + 10} height={h + 10} rx="5" fill={METAL} stroke={METAL_DARK} strokeWidth="1.5" />
      <rect width={w} height={h} rx="2" fill={`url(#cell-${id})`} />
      <g stroke="#9fc0de" strokeWidth="1" opacity="0.5">{lines}</g>
      <path d={`M0 ${h} L${w * 0.55} 0 H${w * 0.8} L${w * 0.25} ${h}z`} fill="#fff" opacity="0.08" />
    </g>
  );
}

export function SolarPanelArt({ modules = 1, size = 360, id = 'a' }) {
  const rowsOfModules = Math.max(1, Math.min(3, modules));
  return (
    <svg viewBox="0 0 400 300" width={size} height={size * 0.75} role="img" aria-label="Paneles solares" style={{ maxWidth: '100%', height: 'auto' }}>
      <defs>
        <linearGradient id={`cell-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={CELL_LIGHT} />
          <stop offset="1" stopColor={CELL_DEEP} />
        </linearGradient>
        <radialGradient id={`glow-${id}`}>
          <stop offset="0" stopColor={SUN_GLOW} stopOpacity="0.9" />
          <stop offset="1" stopColor={SUN_GLOW} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="320" cy="60" r="70" fill={`url(#glow-${id})`} />
      <circle cx="320" cy="60" r="22" fill={SUN} />
      <g stroke={METAL_DARK} strokeWidth="5" strokeLinecap="round">
        <line x1="90" y1="258" x2="110" y2="200" />
        <line x1="290" y1="238" x2="270" y2="190" />
      </g>
      {Array.from({ length: rowsOfModules }).map((_, i) => (
        <Module key={i} id={id} x={50 + i * 14} y={110 - i * 36} w={250} h={110 - i * 6} cols={6} rows={4} />
      ))}
      <ellipse cx="200" cy="274" rx="150" ry="9" fill="#11212f" opacity="0.12" />
    </svg>
  );
}

export function InverterArt({ size = 120 }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label="Inversor">
      <rect x="22" y="14" width="76" height="92" rx="10" fill="#e8eef3" stroke={METAL_DARK} strokeWidth="2" />
      <rect x="30" y="24" width="60" height="30" rx="5" fill={CELL_DEEP} />
      <path d="M36 44l8-10 8 6 8-10 8 6 6-4" fill="none" stroke={SUN} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="40" cy="68" r="3.5" fill="#2e7a55" />
      <circle cx="52" cy="68" r="3.5" fill={SUN} />
      <circle cx="64" cy="68" r="3.5" fill={METAL_DARK} />
      <g stroke={METAL_DARK} strokeWidth="2.5" strokeLinecap="round"><line x1="34" y1="82" x2="86" y2="82" /><line x1="34" y1="90" x2="86" y2="90" /><line x1="34" y1="98" x2="86" y2="98" /></g>
    </svg>
  );
}

export function BatteryArt({ size = 120 }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label="Batería de respaldo">
      <rect x="26" y="12" width="68" height="96" rx="9" fill="#e8eef3" stroke={METAL_DARK} strokeWidth="2" />
      <rect x="42" y="6" width="36" height="9" rx="3" fill={METAL_DARK} />
      <rect x="36" y="26" width="48" height="12" rx="3" fill={CELL} />
      <rect x="36" y="44" width="48" height="12" rx="3" fill={CELL} />
      <rect x="36" y="62" width="48" height="12" rx="3" fill={CELL_LIGHT} />
      <rect x="36" y="80" width="30" height="12" rx="3" fill={SUN} />
    </svg>
  );
}

export function StructureArt({ size = 120 }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label="Estructura de montaje">
      <g stroke={METAL_DARK} strokeWidth="5" strokeLinecap="round" fill="none">
        <path d="M18 98 L48 38 L102 38" />
        <path d="M32 98 L56 52" />
        <path d="M64 98 L84 38" />
        <line x1="12" y1="102" x2="108" y2="102" />
      </g>
      <rect x="40" y="26" width="68" height="14" rx="3" fill={CELL} transform="rotate(-8 74 33)" />
      <circle cx="48" cy="38" r="4" fill={SUN} />
      <circle cx="102" cy="38" r="4" fill={SUN} />
    </svg>
  );
}

export function MonitorArt({ size = 120 }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label="Monitoreo">
      <rect x="30" y="10" width="60" height="100" rx="11" fill={CELL_DEEP} />
      <rect x="35" y="20" width="50" height="78" rx="4" fill="#eaf1f7" />
      <g fill={CELL_LIGHT}>
        <rect x="42" y="68" width="8" height="22" rx="2" />
        <rect x="56" y="56" width="8" height="34" rx="2" />
        <rect x="70" y="44" width="8" height="46" rx="2" />
      </g>
      <circle cx="46" cy="34" r="6" fill={SUN} />
      <rect x="54" y="31" width="24" height="6" rx="3" fill={METAL} />
      <circle cx="60" cy="104" r="2.5" fill={METAL_DARK} />
    </svg>
  );
}

export function CableArt({ size = 120 }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label="Cableado y conectores">
      <path d="M14 86 C34 86 34 34 60 34 S86 86 106 86" fill="none" stroke="#11212f" strokeWidth="7" strokeLinecap="round" />
      <path d="M14 86 C34 86 34 34 60 34 S86 86 106 86" fill="none" stroke={SUN} strokeWidth="2" strokeLinecap="round" strokeDasharray="1 9" />
      <rect x="6" y="78" width="16" height="16" rx="4" fill={METAL} stroke={METAL_DARK} strokeWidth="2" />
      <rect x="98" y="78" width="16" height="16" rx="4" fill={METAL} stroke={METAL_DARK} strokeWidth="2" />
    </svg>
  );
}

const ART = {
  paquetes: SolarPanelArt,
  paneles: SolarPanelArt,
  inversores: InverterArt,
  baterias: BatteryArt,
  estructuras: StructureArt,
  monitoreo: MonitorArt,
  accesorios: CableArt,
};

export function ProductArt({ kind, size = 120, ...rest }) {
  const Art = ART[kind] ?? SolarPanelArt;
  // Los paneles se dibujan en formato 4:3, así que usan el mismo ancho que el resto.
  return <Art size={size} {...rest} />;
}
