// Vitrina de la tienda.
// Los paquetes completos NO viven aquí: vienen del backend (/portal/catalog) y son lo único
// que se cotiza de verdad. Esta lista son los componentes sueltos que se muestran para explorar
// la tienda; sus nombres, especificaciones y precios son de demostración y se pueden editar aquí.

export const CATEGORIES = [
  { slug: 'paquetes', label: 'Paquetes completos', note: 'Todo instalado' },
  { slug: 'paneles', label: 'Paneles', note: 'Módulos fotovoltaicos' },
  { slug: 'inversores', label: 'Inversores', note: 'Convierten la energía' },
  { slug: 'baterias', label: 'Baterías', note: 'Respaldo y autonomía' },
  { slug: 'estructuras', label: 'Estructuras', note: 'Montaje en techo o suelo' },
  { slug: 'monitoreo', label: 'Monitoreo', note: 'Mide tu producción' },
  { slug: 'accesorios', label: 'Accesorios', note: 'Cableado y protecciones' },
];

export const COMPONENTS = [
  { id: 'C-PAN-550', category: 'paneles', name: 'Panel monocristalino 550 W', spec: 'Eficiencia 21.3%, 25 años de garantía', price_mxn: 3890, badge: 'Más vendido' },
  { id: 'C-PAN-450', category: 'paneles', name: 'Panel monocristalino 450 W', spec: 'Ideal para techos con poco espacio', price_mxn: 3290 },
  { id: 'C-INV-10', category: 'inversores', name: 'Inversor de red 10 kW', spec: 'Trifásico, con Wi-Fi integrado', price_mxn: 38500, badge: 'Nuevo' },
  { id: 'C-INV-5', category: 'inversores', name: 'Inversor de red 5 kW', spec: 'Monofásico, 10 años de garantía', price_mxn: 21900 },
  { id: 'C-BAT-10', category: 'baterias', name: 'Batería de litio 10 kWh', spec: 'Respaldo para apagones, 6,000 ciclos', price_mxn: 89000 },
  { id: 'C-EST-TECHO', category: 'estructuras', name: 'Estructura para techo (por panel)', spec: 'Aluminio anodizado, antiviento', price_mxn: 1150 },
  { id: 'C-MON-APP', category: 'monitoreo', name: 'Monitoreo en app', spec: 'Producción y ahorro en tiempo real', price_mxn: 4200, badge: 'Nuevo' },
  { id: 'C-ACC-CAB', category: 'accesorios', name: 'Kit de cableado y protecciones', spec: 'Cable solar, conectores y breakers', price_mxn: 6800 },
];

// Lo que se garantiza en cada cotización (coincide con el texto de las secciones de la propuesta).
export const PROMISES = [
  { key: 'install', title: 'Instalación incluida', note: 'En 2 a 3 días hábiles' },
  { key: 'warranty', title: 'Hasta 25 años de garantía', note: 'Paneles, inversor y mano de obra' },
  { key: 'financing', title: 'Financiamiento', note: 'Hasta 24 meses, sujeto a aprobación' },
  { key: 'support', title: 'Asesor a tu ritmo', note: 'Sin presión: tú decides cuándo' },
];

export const FACTS = [
  { value: '25', unit: 'años', label: 'Garantía en paneles' },
  { value: '24', unit: 'meses', label: 'Financiamiento' },
  { value: '2–3', unit: 'días', label: 'De instalación' },
  { value: '2–4', unit: 'sem.', label: 'Para entregar' },
];
