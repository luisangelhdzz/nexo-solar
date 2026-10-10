// CONOCIMIENTO APROBADO DE NEXO SOLAR (empresa ficticia del hackatón)
//
// Es lo único que el asistente puede afirmar sobre condiciones comerciales. Si un cliente
// pregunta algo que no está aquí, el asistente lo marca como dato faltante y pide revisión humana.
//
// ⚠️ Son DATOS DE DEMOSTRACIÓN. Revísenlos en equipo y ajústenlos antes de usarlos con clientes reales.
//
// Cómo editar:
//   - Cambia el texto de una entrada o agrega otra con un id nuevo y reinicia el backend.
//   - Los paquetes, precios de lista y ahorros vienen de src/portal/catalog.js: no los repitas aquí.
//   - Cada número que escribas aquí (años, días, meses…) queda "aprobado": el validador revisa que
//     los borradores solo usen números que estén en este archivo, en el catálogo o en la cotización.
//
// Campos:
//   id         identificador corto; el asistente lo cita en `knowledge_used`
//   tema       título corto
//   seccion    sección de la propuesta relacionada (price, installation, warranty, financing, delivery) o null
//   claves     palabras para encontrar la entrada cuando no hay IA (borradores con plantilla)
//   texto      la condición aprobada
//   respuesta  (opcional) cómo decírselo al cliente en una o dos oraciones

export const CONOCIMIENTO_VERSION = '2026-10-10-consumo';

export const CONDICIONES = [
  {
    id: 'datos-consumo', tema: 'Datos para revisar el consumo', seccion: null,
    claves: ['recibo', 'consumo', 'kwh', 'aparatos', 'electrodomesticos', 'cuartos'],
    texto: 'Para revisar el consumo se solicita el recibo con kWh, días del periodo y tarifa, además de cantidad, potencia y horarios de los aparatos principales. El número de cuartos es contexto del inmueble y no permite calcular consumo ni cantidad de paneles. Los pesos del recibo no se convierten directamente en kWh. Si faltan datos, se solicitan; no se adivinan.',
    respuesta: 'Comparte el consumo en kWh, los días del periodo y la tarifa de tu recibo, junto con los aparatos principales y sus horarios. Si no conoces la potencia de un aparato, podemos dejarla pendiente para revisión.',
  },
  {
    id: 'precio-incluye',
    tema: 'Qué incluye el precio',
    seccion: 'price',
    claves: ['precio', 'incluye', 'incluido', 'iva', 'costo', 'total', 'cuesta'],
    texto: 'El precio de cada paquete incluye IVA, equipos (paneles, inversor, estructura y protecciones), instalación estándar, el trámite de interconexión con CFE y la puesta en marcha. El precio que vale para cada cliente es el de su propuesta publicada.',
    respuesta: 'Sí. El precio de tu propuesta ya incluye IVA, equipos, la instalación estándar, el trámite de interconexión con CFE y la puesta en marcha.',
  },
  {
    id: 'instalacion-alcance',
    tema: 'Alcance de la instalación',
    seccion: 'installation',
    claves: ['instalacion', 'instalar', 'instalan', 'techo', 'azotea', 'estructura', 'obra', 'montaje'],
    texto: 'La instalación estándar incluye la visita técnica, el montaje en azotea o techo en buen estado, el cableado hasta el tablero principal y el monitoreo por app. El medidor bidireccional lo coloca CFE. No incluye obra civil, refuerzos estructurales ni cambios a la acometida o al transformador; si la visita técnica detecta que hacen falta, se cotizan aparte antes de instalar.',
    respuesta: 'La instalación estándar incluye la visita técnica, el montaje, el cableado hasta tu tablero y el monitoreo por app. Si en la visita vemos que hace falta obra adicional, te la cotizamos aparte antes de instalar.',
  },
  {
    id: 'tiempos',
    tema: 'Tiempos de visita, instalación e interconexión',
    seccion: 'delivery',
    claves: ['tiempo', 'tarda', 'tardan', 'dias', 'cuando', 'entrega', 'semana', 'semanas', 'plazo', 'cerrar', 'fecha'],
    texto: 'Después de aceptar la propuesta, la visita técnica se agenda en 3 a 5 días hábiles. La instalación dura de 1 a 2 días para Comercio 10 kW, de 2 a 3 días para Negocio 20 kW y de 4 a 6 días para Industria 50 kW; se puede programar por etapas o en horarios que no detengan la operación del negocio. La interconexión con CFE tarda de 2 a 6 semanas y depende de CFE.',
    respuesta: 'Después de aceptar, agendamos la visita técnica en 3 a 5 días hábiles. La instalación dura de 1 a 2 días (10 kW), de 2 a 3 días (20 kW) o de 4 a 6 días (50 kW), y la podemos programar para no detener tu operación.',
  },
  {
    id: 'garantias',
    tema: 'Garantías',
    seccion: 'warranty',
    claves: ['garantia', 'garantias', 'anos', 'falla', 'fallas', 'defecto', 'dura', 'durabilidad', 'vida util'],
    texto: 'Paneles: 25 años de garantía de rendimiento (al menos 80% de su producción) y 12 años contra defectos de fabricación. Inversor: 10 años. Instalación (mano de obra de Nexo Solar): 3 años.',
    respuesta: 'Los paneles tienen 25 años de garantía de rendimiento y 12 años contra defectos de fabricación; el inversor tiene 10 años y nuestra instalación, 3 años.',
  },
  {
    id: 'pagos',
    tema: 'Forma de pago',
    seccion: 'price',
    claves: ['pago', 'pagos', 'pagar', 'anticipo', 'contado', 'transferencia'],
    texto: 'Pago de contado: 50% de anticipo al aceptar la propuesta y 50% al terminar la instalación, por transferencia bancaria. El portal no cobra nada.',
    respuesta: 'De contado se paga 50% de anticipo al aceptar y 50% al terminar la instalación, por transferencia bancaria.',
  },
  {
    id: 'financiamiento',
    tema: 'Financiamiento',
    seccion: 'financing',
    claves: ['financiamiento', 'financiar', 'financiado', 'meses', 'credito', 'mensualidades', 'plazos'],
    texto: 'Hay financiamiento de 12 a 36 meses con una financiera aliada, sujeto a aprobación de crédito. La tasa y la mensualidad las define la financiera al revisar la solicitud; no se promete aprobación ni tasa.',
    respuesta: 'Tenemos financiamiento de 12 a 36 meses con una financiera aliada, sujeto a aprobación. La tasa y la mensualidad las define la financiera al revisar tu solicitud.',
  },
  {
    id: 'ahorro',
    tema: 'Ahorro estimado',
    seccion: 'price',
    claves: ['ahorro', 'ahorrar', 'ahorra', 'recibo', 'retorno', 'recupero', 'recuperar'],
    texto: 'El ahorro mensual de cada paquete es una estimación con consumo y tarifa típicos. El ahorro real depende del recibo de CFE del cliente y se confirma con su consumo de los últimos 12 meses.',
    respuesta: 'El ahorro de cada paquete es una estimación; lo confirmamos con tu consumo de los últimos 12 meses.',
  },
  {
    id: 'mantenimiento',
    tema: 'Mantenimiento',
    seccion: null,
    claves: ['mantenimiento', 'limpieza', 'limpiar', 'revision', 'cuidado'],
    texto: 'El sistema requiere poco mantenimiento: limpieza de paneles de 2 a 4 veces al año y una revisión anual.',
  },
  {
    id: 'apagones',
    tema: 'Apagones y baterías',
    seccion: null,
    claves: ['apagon', 'apagones', 'bateria', 'baterias', 'respaldo', 'se va la luz'],
    texto: 'Un sistema interconectado con CFE se apaga por seguridad durante un apagón. Para tener respaldo hacen falta baterías, que se cotizan aparte.',
  },
  {
    id: 'descuentos',
    tema: 'Descuentos y condiciones especiales',
    seccion: 'price',
    claves: ['descuento', 'descuentos', 'rebaja', 'promocion', 'precio especial', 'mas barato', 'negociar', 'mejorar el precio'],
    texto: 'No hay descuentos ni promociones aprobados. Un cambio de precio, descuento o condición especial solo lo autoriza el comercial responsable: el asistente escala el caso y no promete nada.',
  },
  {
    id: 'facturacion',
    tema: 'Factura y asesoría fiscal',
    seccion: null,
    claves: ['factura', 'cfdi', 'deducir', 'deducible', 'impuestos', 'sat'],
    texto: 'Nexo Solar emite factura (CFDI) al recibir el pago. No da asesoría fiscal: para deducciones el cliente debe consultar a su contador.',
  },
];
