import { activeProvider } from './providers.js';
import { interpretHeuristic, normalizeText } from './heuristic.js';
import { sanitizeInterpretation } from './schema.js';
import { buildCaseContext, buildUserPrompt } from './prompt.js';

// Interpreta un mensaje con la IA configurada; si falla, usa el clasificador de respaldo.
// El resultado siempre trae `source` para mostrar en la interfaz qué lo produjo.
export async function interpretMessage({ state, message, eventId, occurredAt, provider = activeProvider(), lessons = [] }) {
  const fallback = (reason) => ({
    ...interpretHeuristic(message, { occurredAt }),
    source: 'heuristic',
    model: 'patrones-es-v1',
    fallback_reason: reason,
  });

  if (!provider) return fallback(null);

  try {
    const userPrompt = buildUserPrompt({
      caseContext: buildCaseContext(state, eventId),
      message,
      occurredAt,
      lessons,
    });
    const { output, model } = await provider.call(userPrompt);
    const clean = sanitizeInterpretation(output);

    // Doble seguro: si el clasificador de patrones detecta instrucciones al sistema,
    // se marca aunque el modelo no lo haya hecho.
    const local = interpretHeuristic(message, { occurredAt });
    if (local.manipulation_attempt && !clean.manipulation_attempt) {
      clean.manipulation_attempt = true;
      clean.manipulation_note = local.manipulation_note;
    }
    return { ...clean, source: provider.name, model, fallback_reason: null, lessons_used: lessons.length };
  } catch (err) {
    return fallback(`Falló la IA (${err.message}); se usó el clasificador de respaldo.`);
  }
}

// Interpreta todos los mensajes del caso, reutilizando las interpretaciones guardadas.
// La caché evita llamadas repetidas al modelo y hace la evaluación reproducible.
export async function interpretCase(state, storage, provider = activeProvider(), { lessons = [] } = {}) {
  const sourceKey = provider ? `${provider.name}:${provider.model}` : 'heuristic:patrones-es-v1';
  const result = {};
  for (const m of state.messages) {
    const cacheKey = `${m.event_id}|${sourceKey}|${hashText(normalizeText(m.message))}`;
    let interp = storage ? await storage.getInterpretation(cacheKey) : null;
    if (!interp) {
      interp = await interpretMessage({ state, message: m.message, eventId: m.event_id, occurredAt: m.at, provider, lessons });
      // No guardamos en caché los respaldos por error: se reintenta la IA en la siguiente evaluación.
      if (storage && !interp.fallback_reason) await storage.saveInterpretation(cacheKey, m.event_id, interp);
    }
    result[m.event_id] = interp;
  }
  return result;
}

function hashText(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
