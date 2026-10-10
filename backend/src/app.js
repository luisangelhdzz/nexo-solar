import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { createApiRouter, apiErrorHandler } from './routes/api.js';
import { createPortal } from './portal/service.js';
import { createAssistant } from './services/assistant.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIST = path.resolve(__dirname, '../../frontend/dist');

// `assistant`: opciones del asistente (proveedor, modo…), útiles en pruebas. El trabajo en segundo
// plano del asistente solo arranca con app.locals.assistant.start() (lo hace server.js).
// `sendEmail` / `sendInvoice`: entrega de correos al cliente (por omisión, el webhook de n8n). Útiles en pruebas.
export function createApp(engine, { adminPassword = '', sendEmail, sendInvoice, assistant: assistantOptions = {} } = {}) {
  const app = express();
  app.set('trust proxy', 1); // detrás del proxy de Render u otra nube
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.text({ type: ['text/plain', 'application/x-ndjson', 'application/jsonl'], limit: '5mb' }));

  const storage = engine.storage;
  const hooks = {};
  const portal = createPortal({
    engine,
    storage,
    ...(sendEmail ? { sendEmail } : {}),
    ...(sendInvoice ? { sendInvoice } : {}),
    onActivity: (caseId, origin) => hooks.onActivity?.(caseId, origin),
  });
  const assistant = createAssistant({ engine, storage, portal, ...assistantOptions });
  hooks.onActivity = assistant.onActivity;
  app.locals.assistant = assistant;
  app.locals.portal = portal;
  app.use('/api', createApiRouter(engine, { portal, storage, adminPassword, assistant }));
  app.use('/api', apiErrorHandler);

  // Si el frontend ya se compiló (npm run build), el backend lo sirve en el mismo puerto:
  // la consola en / y el portal del cliente en /portal.
  if (fs.existsSync(path.join(FRONTEND_DIST, 'index.html'))) {
    app.use(express.static(FRONTEND_DIST));
    app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(FRONTEND_DIST, 'index.html')));
  }
  return app;
}
