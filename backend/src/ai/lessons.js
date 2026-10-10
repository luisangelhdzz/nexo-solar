// Lección de una cotización cerrada: una o dos oraciones accionables.
// Con IA, el modelo la redacta a partir del ANÁLISIS ESTRUCTURADO (nunca de los mensajes crudos
// del cliente, para que una instrucción escondida en un mensaje no se cuele como "lección").
// Sin IA, o si la respuesta no sirve, se usa una plantilla.

import { templateLesson } from '../domain/outcome.js';

const LESSON_SYSTEM = `Eres analista comercial de Nexo Solar (empresa ficticia de paneles solares).
Recibes el análisis estructurado de una cotización ya cerrada: si se compró o se perdió y qué factores pesaron.
Escribe UNA lección breve y accionable (máximo 2 oraciones, en español) para el equipo y para interpretar mejor a futuros clientes.
Reglas: no inventes datos; no propongas descuentos no aprobados ni contactar a quien pidió no ser contactado; no repitas el folio.`;

const LESSON_SCHEMA = {
  type: 'object',
  properties: {
    lesson: { type: 'string', description: 'Lección accionable, máximo 2 oraciones.' },
    tags: { type: 'array', items: { type: 'string' }, description: 'Temas: dudas, precio, tiempos, presión, revisión, etc.' },
  },
  required: ['lesson', 'tags'],
  additionalProperties: false,
};

function analysisForPrompt(a) {
  return JSON.stringify({
    resultado: a.outcome === 'won' ? 'compra' : 'perdida',
    horas_para_decidir: a.decision_hours,
    etapas: a.path,
    metricas: a.metrics,
    factores: a.factors.map((f) => ({ factor: f.label, efecto: f.direction === 'positive' ? 'a favor' : 'en contra', detalle: f.detail })),
  }, null, 2);
}

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

export async function generateLesson(analysis, provider) {
  const fallback = (reason = null) => ({ lesson: templateLesson(analysis), tags: analysis.factors.map((f) => f.id), source: 'reglas', model: null, fallback_reason: reason });
  if (!provider?.structured) return fallback();
  try {
    const { output, model } = await provider.structured({
      system: LESSON_SYSTEM,
      user: `Análisis de la cotización cerrada:\n${analysisForPrompt(analysis)}\n\nRegistra la lección.`,
      schema: LESSON_SCHEMA,
      toolName: 'registrar_leccion',
      toolDescription: 'Registra la lección aprendida de la cotización cerrada.',
    });
    const lesson = clean(output?.lesson);
    if (lesson.length < 15 || lesson.length > 400) throw new Error('Lección vacía o demasiado larga');
    const tags = Array.isArray(output?.tags) ? output.tags.filter((t) => typeof t === 'string').slice(0, 6) : [];
    return { lesson, tags, source: 'ia', model, fallback_reason: null };
  } catch (err) {
    return fallback(`Falló la IA (${err.message}); se usó la plantilla.`);
  }
}
