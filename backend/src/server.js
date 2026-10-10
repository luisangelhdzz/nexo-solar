import { config } from './config.js';
import { createStorage } from './storage/index.js';
import { createEngine } from './services/engine.js';
import { createApp } from './app.js';
import { providerStatus } from './ai/providers.js';
import { seedDemo } from './portal/seed.js';

const storage = await createStorage().catch((e) => {
  console.error('No se pudo conectar a PostgreSQL:', e.message);
  console.error('Revisa DATABASE_URL (y DATABASE_SSL=true si la base está en la nube) o déjala vacía para usar memoria.');
  process.exit(1);
});

const engine = createEngine({ storage, policy: config.policy });

if (config.seedDemo) {
  const r = await seedDemo({ engine, storage });
  console.log(r.seeded ? `Datos de demostración cargados: ${r.customers} clientes, ${r.events} eventos.` : `Datos de demostración: ${r.reason}`);
}

const app = createApp(engine, { adminPassword: config.adminPassword });

app.listen(config.port, () => {
  const ai = providerStatus();
  console.log(`Nexo Solar en http://localhost:${config.port}  (consola: /   portal del cliente: /portal)`);
  console.log(`Almacenamiento: ${storage.kind === 'postgres' ? 'PostgreSQL' : 'memoria (se borra al reiniciar)'}`);
  console.log(`Interpretación: ${ai.mode === 'ai' ? `${ai.provider} (${ai.model})` : ai.note}`);
  console.log(`Consola protegida con contraseña: ${config.adminPassword ? 'sí' : 'no (define ADMIN_PASSWORD al desplegar)'}`);
  console.log(`Envío de comprobantes por n8n: ${config.n8n.webhookUrl ? 'configurado' : 'no configurado'}`);
});
