// Catálogo de la tienda.
// Los PAQUETES no viven aquí: vienen del backend (/portal/catalog) y son lo único que se
// cotiza y compra de verdad. Aquí van los componentes sueltos que se muestran en la tienda.
// Sus precios son de demostración y se pueden editar.
//
// CAMPOS
//   id         Identificador único y estable.
//   categoria  Arma las pastillas del filtro. Escríbela siempre igual (acentos y mayúsculas),
//              o saldrán dos pastillas para lo mismo.
//   nombre     Lo que ve el cliente.
//   detalle    Una línea corta que lo describe.
//   beneficio  Lo que sale en verde con ▲, como el dato del panel de referencia.
//   precio     Sin signo de pesos ni comas.
//   unidad     "pieza", "kit"… solo texto.
//   foto       Clave de COMPONENT_PHOTOS en photos.js.
import { COMPONENT_PHOTOS } from './photos.js';

const componentes = [
  { id: 'C-PAN-550', categoria: 'Paneles', nombre: 'Panel monocristalino 550 W', detalle: 'Alta eficiencia (21.3%) para techo o suelo.', beneficio: '25 años de garantía', precio: 3890, unidad: 'pieza', foto: 'panel' },
  { id: 'C-INV-HIB-5', categoria: 'Inversores', nombre: 'Inversor híbrido 5 kW', detalle: 'Trabaja con o sin baterías.', beneficio: 'Pantalla de monitoreo', precio: 21900, unidad: 'pieza', foto: 'inversor' },
  { id: 'C-PROT', categoria: 'Protecciones', nombre: 'Tablero de protecciones', detalle: 'Breakers, fusibles y supresor de picos.', beneficio: 'Protege todo el sistema', precio: 6800, unidad: 'kit', foto: 'protecciones' },
  { id: 'C-BAT-200', categoria: 'Baterías', nombre: 'Batería de ciclo profundo', detalle: 'Libre de mantenimiento.', beneficio: 'Respaldo en apagones', precio: 7450, unidad: 'pieza', foto: 'bateria' },
  { id: 'C-BOMBA', categoria: 'Bombeo', nombre: 'Bomba solar sumergible', detalle: 'Para pozo, riego y abrevaderos.', beneficio: 'Sin depender de la red', precio: 12900, unidad: 'pieza', foto: 'bomba' },
  { id: 'C-VARIADOR', categoria: 'Bombeo', nombre: 'Variador para bombeo solar', detalle: 'Controla la bomba con energía del sol.', beneficio: 'Arranque suave', precio: 9800, unidad: 'pieza', foto: 'variador' },
];

export const COMPONENTES = componentes.map((c) => ({ ...c, etiqueta: c.categoria, unidad: `MXN · por ${c.unidad}`, foto: COMPONENT_PHOTOS[c.foto] ?? null }));
