// Clientes HTTP mínimos para los modelos de lenguaje (sin SDK, usando fetch de Node).
import { config } from '../config.js';
import { INTERPRETATION_JSON_SCHEMA } from './schema.js';
import { SYSTEM_PROMPT } from './prompt.js';

async function withTimeout(promiseFactory, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await promiseFactory(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

// Claude (Anthropic Messages API). Se fuerza el uso de una herramienta para obtener JSON estructurado.
async function anthropicStructured({ system, user, schema, toolName, toolDescription }) {
  const { apiKey, model } = config.ai.anthropic;
  const body = {
    model,
    max_tokens: 800,
    temperature: 0,
    system,
    tools: [{ name: toolName, description: toolDescription, input_schema: schema }],
    tool_choice: { type: 'tool', name: toolName },
    messages: [{ role: 'user', content: user }],
  };
  const res = await withTimeout(
    (signal) =>
      fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      }),
    config.ai.timeoutMs,
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic respondió ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const block = (data.content || []).find((b) => b.type === 'tool_use' && b.name === toolName);
  if (!block) throw new Error('El modelo no devolvió la herramienta esperada');
  return { output: block.input, model };
}

// Cualquier API compatible con OpenAI Chat Completions (OpenAI, Gemini, Groq, Ollama...).
async function openaiStructured({ system, user, schema }) {
  const { apiKey, model, baseUrl } = config.ai.openai;
  const body = {
    model,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: `${system}\n\nResponde SOLO con un objeto JSON que cumpla este esquema:\n${JSON.stringify(schema)}` },
      { role: 'user', content: user },
    ],
  };
  const res = await withTimeout(
    (signal) =>
      fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey || 'no-key'}` },
        body: JSON.stringify(body),
      }),
    config.ai.timeoutMs,
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`El proveedor respondió ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Respuesta vacía del modelo');
  const jsonText = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  return { output: JSON.parse(jsonText), model };
}

function build(name, model, structured) {
  return {
    name,
    model,
    structured,
    // Interpretación de un mensaje del cliente.
    call: (userPrompt) => structured({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      schema: INTERPRETATION_JSON_SCHEMA,
      toolName: 'registrar_interpretacion',
      toolDescription: 'Registra la interpretación estructurada del mensaje del cliente.',
    }),
  };
}

// Devuelve el proveedor activo según la configuración, o null si se usa el respaldo.
export function activeProvider() {
  const p = config.ai.provider;
  if (p === 'anthropic' && config.ai.anthropic.apiKey) return build('anthropic', config.ai.anthropic.model, anthropicStructured);
  if (p === 'openai' && config.ai.openai.model) return build('openai', config.ai.openai.model, openaiStructured);
  return null;
}

export function providerStatus() {
  const p = activeProvider();
  if (p) return { provider: p.name, model: p.model, mode: 'ai' };
  const requested = config.ai.provider;
  let note = 'Usando el clasificador de respaldo (sin IA externa).';
  if (requested === 'anthropic') note = 'AI_PROVIDER=anthropic pero falta ANTHROPIC_API_KEY; se usa el clasificador de respaldo.';
  if (requested === 'openai') note = 'AI_PROVIDER=openai pero falta OPENAI_MODEL; se usa el clasificador de respaldo.';
  return { provider: 'heuristic', model: 'patrones-es-v1', mode: 'fallback', note };
}
