import { config } from '../config.js';
import { createMemoryStorage } from './memory.js';
import { createPostgresStorage } from './postgres.js';

// Con DATABASE_URL usa PostgreSQL; sin ella, memoria (se pierde al reiniciar).
export async function createStorage(databaseUrl = config.databaseUrl) {
  const storage = databaseUrl ? createPostgresStorage(databaseUrl) : createMemoryStorage();
  await storage.init();
  return storage;
}
