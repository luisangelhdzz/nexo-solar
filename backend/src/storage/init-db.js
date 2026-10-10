// Crea las tablas en PostgreSQL: npm run db:init
import { config } from '../config.js';
import { createPostgresStorage } from './postgres.js';

if (!config.databaseUrl) {
  console.error('Falta DATABASE_URL en backend/.env');
  process.exit(1);
}
const storage = createPostgresStorage(config.databaseUrl);
try {
  await storage.init();
  console.log('Tablas listas en', config.databaseUrl.replace(/:[^:@/]+@/, ':****@'));
} catch (e) {
  console.error('No se pudo inicializar la base de datos:', e.message);
  process.exitCode = 1;
} finally {
  await storage.close();
}
