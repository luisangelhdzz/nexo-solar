import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = fileURLToPath(new URL('../../', import.meta.url));

// Se limita la confianza a esta conexión; no se cambia el almacén del sistema.
export function postgresConnectionOptions(databaseUrl, env = process.env) {
  const url = new URL(databaseUrl);
  const mode = url.searchParams.get('sslmode');
  const caFile = env.DATABASE_SSL_CA_FILE || url.searchParams.get('sslrootcert');
  const enabled = env.DATABASE_SSL === 'true' || Boolean(caFile) || (mode && mode !== 'disable');
  if (!enabled) return { connectionString: databaseUrl };

  const ssl = { rejectUnauthorized: true };
  if (caFile) ssl.ca = fs.readFileSync(path.resolve(backendDir, caFile), 'utf8');
  // pg puede reemplazar el objeto SSL con los parámetros de la URL.
  // Se normaliza aquí para conservar siempre la validación de certificado y hostname.
  for (const key of ['sslmode', 'sslrootcert', 'ssl']) url.searchParams.delete(key);
  return { connectionString: url.toString(), ssl };
}
