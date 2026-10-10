// npm run ai:diagnose — mide qué tan rápido responde Gemini la propuesta del asistente.
//
// Hace la misma consulta que el asistente (una cotización ficticia en memoria) de 3 formas y
// muestra cuándo llega el primer texto, cuándo el JSON está completo y si el modelo siguió
// escribiendo después. No muestra la clave ni toca tu base de datos.

import { config } from '../config.js';
import { activeProvider, streamCompletion } from '../ai/providers.js';
import { sanitizeProposal } from '../ai/assistant.js';
import { createMemoryStorage } from '../storage/memory.js';
import { createEngine } from '../services/engine.js';
import { createPortal } from '../portal/service.js';
import { createAssistant } from '../services/assistant.js';

const LIMIT_MS = 90000;
const secs = (ms) => (ms === null || ms === undefined ? '—' : `${(ms / 1000).toFixed(1)} s`);
const fmt = (n) => Number(n).toLocaleString('es-MX');
const ENDING = {
  stop: 'normal',
  length: 'se quedó sin espacio',
  siguio_escribiendo: 'seguía escribiendo; se cortó 8 s después del JSON',
  demasiado_largo: 'escribió de más; se cortó',
  respuesta_completa: 'normal (sin streaming)',
  fin: 'normal',
};

// Arma exactamente la consulta del asistente, sin llamar a la IA (el "proveedor" solo la captura).
async function captureAssistantPrompt() {
  let captured = null;
  const capture = { name: 'captura', model: '-', structured: async (args) => { captured = args; throw new Error('captura'); } };
  let now = Date.now();
  const storage = createMemoryStorage();
  const engine = createEngine({ storage, provider: null, clock: () => now });
  const portal = createPortal({ engine, storage });
  const assistant = createAssistant({ engine, storage, portal, provider: capture, mode: 'off', logger: { log() {}, error() {} } });
  const customer = await portal.createCustomer({ name: 'Comercio de prueba', contact_name: 'Ana Prueba' });
  const quote = await portal.submitRequest(customer.customer_id, {
    contact_name: 'Ana Prueba', city: 'Saltillo', segment: 'Comercio', email: 'ana@example.com', contact_channel: 'email',
    monthly_bill_mxn: 8000, bill_period: 'bimonthly', roof: 'Azotea de concreto', goal: 'Bajar el recibo de luz de mi tienda.', contact_allowed: true,
  });
  now += 3600000;
  await portal.sendProposal(quote.case_id, { package_id: 'PKG-COMERCIO-10', title: 'Sistema solar para tu tienda', amount_mxn: 150000, notes: 'Incluye instalación estándar.' });
  now += 3600000;
  await portal.sendMessage(customer.customer_id, quote.case_id, '¿El precio incluye la instalación?');
  now += 60000;
  await assistant.runForCase(quote.case_id);
  return { ...captured, eventIds: new Set((await storage.getCaseEvents(quote.case_id)).map((e) => e.event_id)) };
}

async function runVariant(client, title, body, prompt) {
  console.log(`\n${title}`);
  const started = Date.now();
  try {
    const r = await streamCompletion({
      fetchImpl: client.fetchImpl, url: client.url, headers: client.headers, body, timeoutMs: LIMIT_MS,
      label: 'Gemini', stopAtJson: false, extraAfterJsonMs: 8000, maxChars: 200000,
    });
    const t = r.timings;
    const after = r.chars_after_json > 0 ? `sí, ${fmt(r.chars_after_json)} caracteres más (${JSON.stringify(r.content.slice(-40))})` : 'no';
    console.log(`  primer texto: ${secs(t.first_ms)} · JSON completo: ${secs(t.json_ms)} · ${fmt(r.content.length)} caracteres · terminó: ${ENDING[r.stop_reason === 'fin' ? r.finish ?? 'fin' : r.stop_reason] ?? r.finish ?? r.stop_reason} · total ${secs(t.end_ms)}`);
    console.log(`  ¿siguió escribiendo después del JSON?: ${after}`);
    let valid = 'no llegó un JSON completo';
    if (r.json !== undefined) {
      try {
        const p = sanitizeProposal(r.json, { eventIds: prompt.eventIds, knowledgeIds: new Set() });
        valid = `sí (acción ${p.proposed_action}${p.draft_message ? ', con borrador' : ''})`;
      } catch (err) {
        valid = `no (${err.message})`;
      }
    } else if (r.content) {
      console.log(`  inicio de la respuesta: ${JSON.stringify(r.content.slice(0, 160))}`);
    }
    console.log(`  ¿propuesta válida?: ${valid}`);
    return { ok: r.json !== undefined, ...t, after: r.chars_after_json };
  } catch (err) {
    console.log(`  ✖ ${err.message} (después de ${secs(Date.now() - started)})`);
    return { ok: false, first_ms: null, json_ms: null, end_ms: Date.now() - started, after: 0, error: err.message };
  }
}

async function main() {
  console.log('Nexo Solar · diagnóstico de velocidad del asistente (la clave nunca se muestra)');
  const provider = activeProvider();
  if (!provider?.client?.buildBody) {
    console.log('\n✖ El diagnóstico es para Gemini (o APIs compatibles con OpenAI). Revisa AI_PROVIDER y la clave con npm run ai:check.');
    process.exitCode = 1;
    return;
  }
  const { client } = provider;
  console.log(`Modelo: ${provider.model} · razonamiento: ${config.ai.gemini.reasoningEffort} · tiempo máximo del asistente: ${secs(config.assistant.timeoutMs)}`);
  console.log(`Cada prueba espera hasta ${secs(LIMIT_MS)}; las tres juntas pueden tardar unos minutos.`);
  const prompt = await captureAssistantPrompt();
  console.log(`Consulta del asistente: ${fmt(prompt.system.length + prompt.user.length)} caracteres (≈ ${fmt(Math.round((prompt.system.length + prompt.user.length) / 3.6))} tokens).`);

  const strictBody = client.buildBody({ system: prompt.system, user: prompt.user, schema: prompt.schema, toolName: 'proponer_siguiente_paso' });
  strictBody.response_format = { type: 'json_schema', json_schema: { name: 'proponer_siguiente_paso', schema: prompt.schema, strict: true } };
  const simpleBody = { ...strictBody, response_format: { type: 'json_object' } };

  const a = await runVariant(client, 'Prueba A · JSON con esquema (como lo pide la app)', strictBody, prompt);
  const b = await runVariant(client, 'Prueba B · la misma consulta otra vez (¿la primera fue más lenta?)', strictBody, prompt);
  const c = await runVariant(client, 'Prueba C · JSON simple, sin esquema (GEMINI_STRICT_SCHEMA=false)', simpleBody, prompt);

  console.log('\nConclusión:');
  const limit = config.assistant.timeoutMs;
  const inTime = (x) => x.ok && x.json_ms <= limit;
  if (a.after > 20 || b.after > 20) console.log('  · Gemini terminaba el JSON y seguía escribiendo. El backend ahora corta en cuanto el JSON está completo.');
  if (inTime(a) || inTime(b)) {
    console.log(`  ✔ Con el esquema, la propuesta llega en ${secs(Math.min(...[a, b].filter(inTime).map((x) => x.json_ms)))}: dentro del límite de ${secs(limit)}. Vuelve a correr npm run ai:check.`);
  } else if (inTime(c)) {
    console.log('  ✔ Con JSON simple sí llega a tiempo. Agrega esta línea en backend/.env y vuelve a correr npm run ai:check:');
    console.log('      GEMINI_STRICT_SCHEMA=false');
  } else if ([a, b, c].every((x) => x.first_ms === null || x.first_ms > limit / 2)) {
    console.log('  ✖ Gemini tarda mucho en empezar a responder (está razonando o el servicio va lento). Prueba en backend/.env:');
    console.log('      GEMINI_MODEL=gemini-3.5-flash-lite');
    console.log('    o sube el límite con ASSISTANT_TIMEOUT_MS=90000.');
  } else {
    console.log('  ✖ No llegó a tiempo en ninguna prueba. Pásame este resultado completo (no incluye tu clave).');
  }
  if (a.ok && b.ok && b.json_ms < a.json_ms * 0.6) console.log('  · La primera llamada fue bastante más lenta que la segunda; las siguientes deberían ser rápidas.');
}

main().catch((err) => {
  console.error(`\nError inesperado: ${err.message}`);
  process.exitCode = 1;
});
