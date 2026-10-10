// npm run ai:check — comprueba la conexión con la IA SIN mostrar la clave.
//
//   1. Configuración que leyó de backend/.env
//   2. Modelos disponibles para tu clave
//   3. Primera prueba del plan: interpretar "¿El precio incluye la instalación?"
//   4. El asistente propone el siguiente paso para una cotización ficticia
//
// Usa datos inventados en memoria: no toca tu base de datos ni le escribe a ningún cliente.

import { config } from '../config.js';
import { activeProvider, providerStatus } from '../ai/providers.js';
import { interpretMessage } from '../ai/interpreter.js';
import { buildCaseState } from '../domain/state.js';
import { createMemoryStorage } from '../storage/memory.js';
import { createEngine } from '../services/engine.js';
import { createPortal } from '../portal/service.js';
import { createAssistant } from '../services/assistant.js';

const QUESTION = '¿El precio incluye la instalación?';
const ok = (t) => console.log(`  ✔ ${t}`);
const bad = (t) => console.log(`  ✖ ${t}`);
const info = (t) => console.log(`    ${t}`);
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;
const host = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

function hint(message = '') {
  if (/clave/i.test(message)) info('→ Copia otra vez la clave en backend/.env, sin comillas ni espacios, y vuelve a correr npm run ai:check.');
  else if (/404|no encontró el modelo/i.test(message)) info('→ Usa uno de los modelos de la lista en GEMINI_MODEL (por ejemplo gemini-3.5-flash-lite).');
  else if (/429|límite de uso|pausa/i.test(message)) info('→ Espera un minuto. Si se repite, revisa tus límites en Google AI Studio o prueba GEMINI_MODEL=gemini-3.5-flash-lite.');
  else if (/tiempo máximo/i.test(message)) info('→ Corre npm run ai:diagnose: mide qué parte tarda (no muestra la clave) y dice qué ajustar.');
  else if (/conectar|network/i.test(message)) info('→ Revisa tu conexión a internet.');
}

function describeConfig() {
  const ai = config.ai;
  console.log(`  AI_PROVIDER=${ai.provider}`);
  if (ai.provider === 'gemini') {
    info(`modelo: ${ai.gemini.model} · servidor: ${host(ai.gemini.baseUrl)} · razonamiento: ${ai.gemini.reasoningEffort}`);
    info(`GEMINI_API_KEY: ${ai.gemini.apiKey ? `configurada (${ai.gemini.apiKey.length} caracteres; no se muestra)` : 'FALTA'}`);
  } else if (ai.provider === 'openai') {
    info(`modelo: ${ai.openai.model || 'FALTA OPENAI_MODEL'} · servidor: ${host(ai.openai.baseUrl)}`);
    info(`OPENAI_API_KEY: ${ai.openai.apiKey ? 'configurada (no se muestra)' : 'vacía'}`);
  } else if (ai.provider === 'anthropic') {
    info(`modelo: ${ai.anthropic.model} · ANTHROPIC_API_KEY: ${ai.anthropic.apiKey ? 'configurada (no se muestra)' : 'FALTA'}`);
  }
  info(`asistente: ASSISTANT_AUTOPILOT=${config.assistant.autopilot}`);
}

async function checkModels(provider) {
  console.log('\n2) Modelos disponibles para tu clave');
  if (!provider.listModels) {
    info('Este proveedor no permite listar modelos; se omite.');
    return;
  }
  try {
    const models = await provider.listModels();
    if (models.includes(provider.model)) {
      ok(`${provider.model} está disponible.`);
    } else {
      bad(`${provider.model} no aparece en la lista de tu clave.`);
      const similar = models.filter((m) => /gemini/.test(m) && /flash|pro/.test(m) && !/tts|image|live|embedding|audio/.test(m)).slice(0, 12);
      if (similar.length) info(`Modelos de texto disponibles: ${similar.join(', ')}`);
    }
  } catch (err) {
    bad(`No se pudo listar los modelos: ${err.message}`);
    hint(err.message);
  }
}

async function checkInterpretation(provider) {
  console.log(`\n3) Interpretación de prueba: "${QUESTION}"`);
  const at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const events = [
    { event_id: 'PRUEBA-e1', case_id: 'PRUEBA', event_type: 'case.opened', occurred_at: at, data: { status: 'open', proposal_amount_mxn: 150000 } },
    { event_id: 'PRUEBA-e2', case_id: 'PRUEBA', event_type: 'message.received', occurred_at: at, data: { message: QUESTION } },
  ];
  const started = Date.now();
  const it = await interpretMessage({ state: buildCaseState('PRUEBA', events), message: QUESTION, eventId: 'PRUEBA-e2', occurredAt: at, provider });
  if (it.source === 'heuristic') {
    bad('Se usó el clasificador de respaldo, no la IA.');
    info(it.fallback_reason ?? '');
    hint(it.fallback_reason ?? '');
    return false;
  }
  ok(`Respondió ${it.source} (${it.model}) en ${secs(Date.now() - started)}.`);
  info(`intención: ${it.intent} · tema: ${it.topic ?? '—'} · certeza: ${it.confidence}`);
  info(`resumen: ${it.summary}`);
  return true;
}

async function checkAssistant(provider) {
  console.log('\n4) El asistente propone el siguiente paso (cotización ficticia en memoria)');
  let now = Date.now();
  const storage = createMemoryStorage();
  const engine = createEngine({ storage, provider, clock: () => now });
  const portal = createPortal({ engine, storage });
  const assistant = createAssistant({ engine, storage, portal, provider, mode: 'off', logger: { log() {}, error() {} } });
  const customer = await portal.createCustomer({ name: 'Comercio de prueba', contact_name: 'Ana Prueba' });
  const quote = await portal.submitRequest(customer.customer_id, {
    contact_name: 'Ana Prueba', city: 'Saltillo', segment: 'Comercio', email: 'ana@example.com', contact_channel: 'email',
    monthly_bill_mxn: 8000, bill_period: 'bimonthly', roof: 'Azotea de concreto', goal: 'Bajar el recibo de luz de mi tienda.', contact_allowed: true,
  });
  now += 3600000;
  await portal.sendProposal(quote.case_id, { package_id: 'PKG-COMERCIO-10', title: 'Sistema solar para tu tienda', amount_mxn: 150000, notes: 'Incluye instalación estándar.' });
  now += 3600000;
  await portal.sendMessage(customer.customer_id, quote.case_id, QUESTION);
  now += 60000;
  const run = await assistant.runForCase(quote.case_id);
  const p = run.proposal;
  const v = run.validation;
  if (run.source === 'plantilla') {
    bad('La propuesta salió de la plantilla, no de la IA.');
    info(p.fallback_reason ?? p.note ?? '');
    hint(p.fallback_reason ?? '');
    return false;
  }
  ok(`Propuesta de ${run.source} (${run.model}) en ${secs(p.latency_ms)}.`);
  info(`resumen: ${p.summary}`);
  info(`necesidad del cliente: ${p.customer_need}`);
  info(`acción autorizada: ${v.authorized.action} (${v.authorized.timing})${v.agrees_with_engine ? ' · la IA coincide con el motor de reglas' : ` · la IA sugería ${p.proposed_action}`}`);
  info(`borrador: ${v.draft ? `"${v.draft.text_for_client}"` : '—'}`);
  info(`validaciones: ${v.checks.filter((c) => c.ok).length}/${v.checks.length} correctas${v.checks.some((c) => !c.ok) ? ` · pendientes: ${v.checks.filter((c) => !c.ok).map((c) => c.message).join(' | ')}` : ''}`);
  info(`revisión humana: ${v.requires_human_review ? `sí (${v.human_review_reasons.join(' ')})` : 'no hace falta'}`);
  return true;
}

async function main() {
  console.log('Nexo Solar · verificación de la IA (la clave nunca se muestra)\n');
  console.log('1) Configuración leída de backend/.env');
  describeConfig();
  const provider = activeProvider();
  if (!provider) {
    bad(providerStatus().note);
    info('Para usar Gemini, en backend/.env:');
    info('  AI_PROVIDER=gemini');
    info('  GEMINI_API_KEY=tu_clave        (Google AI Studio → Get API key)');
    info('  GEMINI_MODEL=gemini-3.8-flash');
    process.exitCode = 1;
    return;
  }
  await checkModels(provider);
  const interpreted = await checkInterpretation(provider);
  if (!interpreted) {
    console.log('\n4) Se omite la prueba del asistente hasta que la interpretación funcione.');
    process.exitCode = 1;
    return;
  }
  const assisted = await checkAssistant(provider);
  console.log(assisted
    ? `\nListo: ${provider.name} está conectado y el asistente funciona. Reinicia el backend (npm run dev:backend) para usarlo en la consola.`
    : '\nLa conexión funciona, pero el asistente cayó a la plantilla. Revisa el mensaje de arriba.');
  if (!assisted) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`\nError inesperado: ${err.message}`);
  process.exitCode = 1;
});
