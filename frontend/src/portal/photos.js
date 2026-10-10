// Imágenes del portal. Vite las copia a dist/assets con un nombre único al compilar.
// Para cambiar una foto, reemplaza el archivo en ./img con otro del mismo nombre.
// El fondo del header (portada-equipos.jpg) y el de "Mis cotizaciones" (fondo-respaldo.jpg)
// se usan desde storefront.css y portal.css.
import logo from './img/logo-nexo.svg';
import kitComercio from './img/kit-comercio.jpg';
import kitNegocio from './img/kit-negocio.jpg';
import kitIndustria from './img/kit-industria.jpg';
import compPanel from './img/comp-panel.jpg';
import compInversor from './img/comp-inversor.jpg';
import compProtecciones from './img/comp-protecciones.jpg';
import compBateria from './img/comp-bateria.jpg';
import compBomba from './img/comp-bomba.jpg';
import compVariador from './img/comp-variador.jpg';

export const LOGO = logo;

const BY_PACKAGE = {
  'PKG-COMERCIO-10': kitComercio,
  'PKG-NEGOCIO-20': kitNegocio,
  'PKG-INDUSTRIA-50': kitIndustria,
};
export const packagePhoto = (packageId) => BY_PACKAGE[packageId] ?? null;

export const COMPONENT_PHOTOS = {
  panel: compPanel,
  inversor: compInversor,
  protecciones: compProtecciones,
  bateria: compBateria,
  bomba: compBomba,
  variador: compVariador,
};
