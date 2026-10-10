// Catálogo ficticio de Nexo Solar (empresa inventada para el reto).
// Los precios incluyen IVA y son solo para la demostración.

export const PACKAGES = [
  {
    package_id: 'PKG-COMERCIO-10',
    name: 'Comercio 10 kW',
    kw: 10,
    panels: 18,
    price_mxn: 150000,
    ideal_for: 'Tiendas, talleres y oficinas pequeñas',
    monthly_saving_mxn: 3200,
  },
  {
    package_id: 'PKG-NEGOCIO-20',
    name: 'Negocio 20 kW',
    kw: 20,
    panels: 36,
    price_mxn: 285000,
    ideal_for: 'Restaurantes, clínicas y hoteles pequeños',
    monthly_saving_mxn: 6100,
  },
  {
    package_id: 'PKG-INDUSTRIA-50',
    name: 'Industria 50 kW',
    kw: 50,
    panels: 90,
    price_mxn: 690000,
    ideal_for: 'Naves industriales, agroindustria y bodegas',
    monthly_saving_mxn: 15400,
  },
];

// Secciones que el cliente puede abrir en su cotización. Cada apertura es un proposal.viewed.
export const SECTIONS = [
  { id: 'price', title: 'Precio y forma de pago' },
  { id: 'installation', title: 'Instalación' },
  { id: 'warranty', title: 'Garantía' },
  { id: 'financing', title: 'Financiamiento' },
  { id: 'delivery', title: 'Tiempos de entrega' },
];

export function findPackage(id) {
  return PACKAGES.find((p) => p.package_id === id) ?? null;
}
