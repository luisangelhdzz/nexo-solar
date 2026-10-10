import { config } from '../config.js';
import { createStorage } from '../storage/index.js';
import { createEngine } from '../services/engine.js';
import { buildQuestioningCase } from '../portal/presentation.js';
if (!config.databaseUrl) throw new Error('Falta DATABASE_URL; no se agrega el caso en memoria.');
const storage = await createStorage();
try {
  if ((await storage.getCaseEvents('DEMO-07')).length) {
    console.log('DEMO-07 ya existe; no se duplicó ni modificó.');
  } else {
    const { customer, events } = buildQuestioningCase();
    const engine = createEngine({ storage, provider: null });
    await engine.setClock({ mode: 'live' });
    await storage.upsertCustomer(customer);
    const result = await engine.ingest({ content: events.map(e => JSON.stringify(e)).join('\n'), source: 'demo-preguntas-recurrentes' });
    if (result.errors.length || result.accepted !== events.length) throw new Error('No se cargaron todos los eventos; revisa el lote antes de reintentar.');
    console.log(JSON.stringify({ added: 'DEMO-07', events: result.accepted, preserved_existing_cases: true }));
  }
} finally { await storage.close(); }
