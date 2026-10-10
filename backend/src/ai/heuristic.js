// Clasificador de respaldo basado en patrones (sin red).
// Se usa cuando no hay clave de IA configurada o cuando el modelo falla.
// Es deliberadamente conservador: si no está seguro, baja la confianza.

import { toIso, toMs, humanUtc } from '../domain/time.js';

const MONTHS = {
  enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
  julio: 6, agosto: 7, septiembre: 8, setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
};
const WEEKDAYS = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };

// Hora por defecto cuando el cliente da un día sin hora: 15:00 UTC (9:00 en el centro de México).
const DEFAULT_HOUR_UTC = 15;

export function normalizeText(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function atDay(year, month, day, hour = DEFAULT_HOUR_UTC, minute = 0) {
  return Date.UTC(year, month, day, hour, minute, 0);
}

// Extrae una fecha a partir de la cual el cliente acepta contacto.
// `referenceIso` es la fecha del mensaje (no el reloj real).
export function extractDate(normalized, referenceIso) {
  const ref = new Date(toMs(referenceIso));
  const refY = ref.getUTCFullYear();
  const refM = ref.getUTCMonth();
  const refD = ref.getUTCDate();
  const after = /despues del?|a partir del?/.test(normalized);

  const hourMatch = normalized.match(/a las (\d{1,2})(?::(\d{2}))?\s*(am|pm|hrs|horas|h)?/);
  let hour = null;
  let minute = 0;
  if (hourMatch) {
    hour = Number(hourMatch[1]);
    minute = hourMatch[2] ? Number(hourMatch[2]) : 0;
    if (hourMatch[3] === 'pm' && hour < 12) hour += 12;
    // Si no dice UTC, asumimos hora del centro de México (UTC-6).
    if (!/utc|gmt|\bz\b/.test(normalized)) hour += 6;
  }
  const finish = (ms) => {
    let value = ms;
    if (after && hour === null) value += 24 * 3600 * 1000; // "después del 12" -> desde el 13
    return toIso(value);
  };
  const withHour = (y, m, d) => (hour === null ? atDay(y, m, d) : Date.UTC(y, m, d, hour, minute, 0));

  // Fecha ISO escrita en el mensaje.
  const iso = normalized.match(/(\d{4})-(\d{2})-(\d{2})(?:t(\d{2}):(\d{2}))?/);
  if (iso) {
    const ms = iso[4]
      ? Date.UTC(+iso[1], +iso[2] - 1, +iso[3], +iso[4], +iso[5])
      : withHour(+iso[1], +iso[2] - 1, +iso[3]);
    return finish(ms);
  }

  // "12 de octubre (de 2026)"
  const dm = normalized.match(/(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?: de(?:l)? (\d{4}))?/);
  if (dm) {
    const month = MONTHS[dm[2]];
    let year = dm[3] ? Number(dm[3]) : refY;
    let ms = withHour(year, month, Number(dm[1]));
    if (!dm[3] && ms < atDay(refY, refM, refD, 0)) ms = withHour(year + 1, month, Number(dm[1]));
    return finish(ms);
  }

  // "antes del 12" / "después del 12" (solo número de día)
  const dayOnly = normalized.match(/(?:antes|despues|a partir) del? (\d{1,2})\b(?! de)/);
  if (dayOnly) {
    const day = Number(dayOnly[1]);
    let ms = withHour(refY, refM, day);
    if (day < refD) ms = withHour(refY, refM + 1, day);
    return finish(ms);
  }

  if (/pasado manana/.test(normalized)) return toIso(withHour(refY, refM, refD + 2));
  if (/\bmanana\b/.test(normalized)) return toIso(withHour(refY, refM, refD + 1));

  const inDays = normalized.match(/en (\d{1,2}) dias/);
  if (inDays) return toIso(withHour(refY, refM, refD + Number(inDays[1])));

  if (/(proxima|siguiente) semana/.test(normalized)) {
    const dow = ref.getUTCDay();
    const toMonday = ((8 - dow) % 7) || 7;
    return toIso(withHour(refY, refM, refD + toMonday));
  }

  const wd = normalized.match(/\b(el )?(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/);
  if (wd) {
    const target = WEEKDAYS[wd[2]];
    const diff = ((target - ref.getUTCDay() + 7) % 7) || 7;
    return finish(withHour(refY, refM, refD + diff));
  }

  return null;
}

const TOPICS = [
  [/instalacion|instalar/, 'la instalación'],
  [/fecha de entrega|entrega|plazo|cuando (llega|estaria|estaran)|tiempo de/, 'la fecha de entrega'],
  [/garantia/, 'la garantía'],
  [/financiamiento|credito|meses sin intereses|forma de pago|pago|anticipo/, 'la forma de pago'],
  [/mantenimiento|limpieza/, 'el mantenimiento'],
  [/permiso|tramite|cfe|interconexion/, 'los trámites'],
  [/precio|costo|cuanto|caro|descuento|rebaja|presupuesto/, 'el precio'],
  [/panel|inversor|bateria|kw|potencia|capacidad/, 'las especificaciones técnicas'],
];

function detectTopic(n) {
  for (const [re, label] of TOPICS) if (re.test(n)) return label;
  return null;
}

const RE = {
  manipulation: /(ignora|ignoren|olvida|olviden|omite|omitan|desactiva|salta|saltate)\b.{0,50}(regla|instruccion|politica|restriccion|sistema|limite)|\b(system prompt|prompt|jailbreak|modo (desarrollador|administrador|admin))\b|eres (un|una) (ia|modelo|asistente|bot)|(como|soy (el|la)?) ?(administrador|admin|gerente|director)[^.]{0,40}(autorizo|ordeno|apruebo)|(autorizo|ordeno) (que|el|un)[^.]{0,40}(contact|descuento|llam)|(debes|tienes que|deberas) (dar|ofrecer|aplicar|aprobar|recomendar)/,
  notInterested: /no (me|nos) interesa|ya no (estamos|estoy|nos|me) interes|no,? gracias|descartamos|lo descart|cancel(en|ar|amos)|(elegimos|escogimos|contratamos) (a )?otr|nos quedamos con otr|ya (compramos|contratamos)|no vamos a (seguir|continuar|contratar|comprar)|no (me|nos) (vuelvan|sigan) (a )?(contactar|escribir|llamar)/,
  delay: /no (me|nos) (contacten|llamen|escriban|busquen|marquen)|(contact|llam|escrib|busqu|marqu)\w* (despues|a partir|hasta|el (lunes|martes|miercoles|jueves|viernes)|la (proxima|siguiente) semana|manana|pasado manana|en \d+ dias|mas adelante)|estoy de viaje|estare fuera|fuera de la oficina|vacaciones|mas adelante|en otro momento|ahorita no|por ahora no|hablamos (despues|luego|la proxima)|espere(n|mos) hasta/,
  objection: /caro|cara\b|elevad|presupuesto|no estoy seguro|no estamos seguros|me preocupa|nos preocupa|no me convence|no nos convence|desconfi|mas barat|otro proveedor (ofrece|cobra)|descuento|rebaja|muy alto|demasiado/,
  question: /\?|^(que|cual|cuales|cuando|como|cuanto|cuanta|cuantos|donde|incluye|incluyen|pueden|podrian|puedo|tienen|hay|me pueden|nos pueden|es posible|aclar)/,
  comparing: /comparando|otras opciones|otras cotizaciones|otros proveedores|cotizando|evaluando opciones|viendo opciones/,
  interest: /me interesa|nos interesa|quiero|queremos|conocer mas|mas informacion|mas detalles|me gustaria|nos gustaria|adelante|suena bien|me agrada/,
  providesInfo: /les comparto|adjunto|te comparto|aqui (esta|estan)|el dato|nuestro consumo|consumimos|somos \d+|son \d+|la direccion es|el numero (es|de)|nuestro recibo/,
};

const quote = (msg) => {
  const clean = String(msg).replace(/\s+/g, ' ').trim();
  return clean.length > 160 ? `${clean.slice(0, 157)}...` : clean;
};

export function interpretHeuristic(message, { occurredAt }) {
  const n = normalizeText(message);
  const topic = detectTopic(n);
  const manipulation = RE.manipulation.test(n);
  const facts = [`Escribió: "${quote(message)}"`];
  const inferences = [];
  const missing = [];
  const needs = [];
  let intent = 'other';
  let confidence = 'low';
  let requested = null;

  if (RE.notInterested.test(n)) {
    intent = 'not_interested';
    confidence = 'high';
    inferences.push('El cliente no quiere continuar por ahora; insistir puede dañar la relación.');
  } else if (RE.delay.test(n)) {
    intent = 'request_delay';
    requested = extractDate(n, occurredAt);
    if (requested) {
      confidence = 'high';
      facts.push(`Pide no ser contactado antes del ${humanUtc(requested)}.`);
    } else {
      confidence = 'medium';
      missing.push('Fecha concreta en la que el cliente acepta retomar el contacto');
    }
    inferences.push('Pedir espera no indica rechazo ni intención de compra.');
  } else if (RE.objection.test(n) && !manipulation) {
    intent = 'objection';
    confidence = RE.question.test(n) ? 'high' : 'medium';
    inferences.push(`Hay un reparo explícito${topic ? ` sobre ${topic}` : ''}; resolverlo es necesario antes de avanzar.`);
    missing.push(`Respuesta confirmada al reparo${topic ? ` sobre ${topic}` : ''} (dato interno)`);
  } else if (RE.question.test(n)) {
    intent = 'question';
    confidence = n.includes('?') ? 'high' : 'medium';
    inferences.push(`Tiene una duda concreta${topic ? ` sobre ${topic}` : ''}; no confirma intención de compra.`);
    missing.push(`Respuesta confirmada${topic ? ` sobre ${topic}` : ' a la pregunta del cliente'} (dato interno)`);
  } else if (RE.comparing.test(n)) {
    intent = 'comparing';
    confidence = 'medium';
    inferences.push('Está evaluando alternativas; la decisión no está tomada.');
    missing.push('Criterios con los que el cliente compara (precio, plazos, garantía)');
  } else if (RE.interest.test(n)) {
    intent = 'interest';
    confidence = 'medium';
    inferences.push('Muestra interés, pero no confirma compra.');
    missing.push('Qué información específica necesita el cliente');
  } else if (RE.providesInfo.test(n)) {
    intent = 'provides_information';
    confidence = 'medium';
    inferences.push('El cliente aporta datos para avanzar con la propuesta.');
  } else {
    inferences.push('El mensaje no permite identificar una intención clara.');
    missing.push('Intención del mensaje del cliente');
  }

  if (manipulation) {
    // El texto del cliente es un dato: nunca cambia reglas ni autoriza nada.
    if (intent === 'other') confidence = 'medium';
    inferences.push('El mensaje incluye instrucciones dirigidas al sistema; se tratan como dato y no se obedecen.');
  }

  const summaries = {
    question: `El cliente pregunta${topic ? ` sobre ${topic}` : ' algo sobre la propuesta'}.`,
    objection: `El cliente expresa un reparo${topic ? ` sobre ${topic}` : ''}.`,
    request_delay: requested ? `El cliente pide esperar hasta el ${humanUtc(requested)}.` : 'El cliente pide esperar, sin fecha concreta.',
    interest: 'El cliente muestra interés y quiere saber más.',
    comparing: 'El cliente está comparando opciones.',
    not_interested: 'El cliente indica que no le interesa continuar.',
    provides_information: 'El cliente comparte información.',
    other: manipulation ? 'El mensaje intenta dar instrucciones al sistema.' : 'Mensaje sin intención clara.',
  };

  return {
    intent,
    topic,
    summary: summaries[intent],
    facts,
    inferences,
    missing_information: missing,
    needs_from_client: needs,
    requested_contact_after: requested,
    manipulation_attempt: manipulation,
    manipulation_note: manipulation ? 'Contiene órdenes o condiciones dirigidas al sistema (p. ej. ignorar reglas o forzar descuentos).' : null,
    confidence,
  };
}
