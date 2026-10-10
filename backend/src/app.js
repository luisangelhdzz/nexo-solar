import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { createApiRouter, apiErrorHandler } from './routes/api.js';
import { createPortal } from './portal/service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIST = path.resolve(__dirname, '../../frontend/dist');

export function createApp(engine, { adminPassword = '', sendInvoice } = {}) {
  const app = express();
  app.set('trust proxy', 1); // detrás del proxy de Render u otra nube
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.text({ type: ['text/plain', 'application/x-ndjson', 'application/jsonl'], limit: '5mb' }));

  const storage = engine.storage;
  const portal = createPortal({ engine, storage, ...(sendInvoice ? { sendInvoice } : {}) });
  app.use('/api', createApiRouter(engine, { portal, storage, adminPassword }));
  app.use('/api', apiErrorHandler);

  // Si el frontend ya se compiló (npm run build), el backend lo sirve en el mismo puerto:
  // la consola en / y el portal del cliente en /portal.
  if (fs.existsSync(path.join(FRONTEND_DIST, 'index.html'))) {
    app.use(express.static(FRONTEND_DIST));
    app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(FRONTEND_DIST, 'index.html')));
  }
  return app;
}
