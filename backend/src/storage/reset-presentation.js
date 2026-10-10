// Reinicio explícito con respaldo SQL restaurable, verificado antes de borrar.
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { postgresConnectionOptions } from './ssl.js';
import { buildPresentation } from '../portal/presentation.js';
import { validateEvent } from '../domain/validation.js';

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

if (!process.argv.includes('--reset')) throw new Error('Requiere --reset. Pausa los backends antes: reemplaza los datos compartidos y guarda un respaldo local.');
if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL. Ejecuta desde backend con su .env configurado.');
const tables = ['ingest_batches', 'events', 'interpretations', 'decisions', 'settings', 'customers', 'invoices', 'notifications', 'lessons', 'assistant_runs', 'assistant_feedback'];
const quoted = tables.map(t => `public."${t}"`).join(', ');
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const dataset = buildPresentation();
for (const event of dataset.events) {
  const errors = validateEvent(event);
  if (errors.length) throw new Error(`${event.event_id}: ${errors.join('; ')}`);
}
const client = new pg.Client({ ...postgresConnectionOptions(process.env.DATABASE_URL), connectionTimeoutMillis: 10000 });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query("SET LOCAL lock_timeout = '15s'");
  await client.query(`LOCK TABLE ${quoted} IN ACCESS EXCLUSIVE MODE`);
  const schema = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  let sql = `-- Respaldo de datos Nexo Solar ${dataset.now}. Contiene información privada.\nBEGIN;\n${schema}\nTRUNCATE ${quoted} RESTART IDENTITY;\n`;
  const counts = {};
  for (const table of tables) {
    const { rows } = await client.query(`SELECT * FROM public."${table}" ${table === 'decisions' ? 'ORDER BY id' : ''}`);
    counts[table] = rows.length;
    for (const row of rows) sql += `INSERT INTO public."${table}" SELECT * FROM json_populate_record(NULL::public."${table}", ${literal(JSON.stringify(row))}::json);\n`;
  }
  for (const [table, column] of [['ingest_batches', 'id'], ['events', 'seq'], ['decisions', 'id'], ['invoices', 'id'], ['notifications', 'id'], ['assistant_runs', 'id'], ['assistant_feedback', 'id']]) {
    sql += `SELECT setval(pg_get_serial_sequence('public.${table}', '${column}'), COALESCE(MAX(${column}), 1), MAX(${column}) IS NOT NULL) FROM public.${table};\n`;
  }
  sql += 'COMMIT;\n';
  const backupDir = fileURLToPath(new URL('../../../backups/', import.meta.url));
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const backup = path.join(backupDir, `nexo-solar-${dataset.now.replaceAll(':', '-')}.sql`);
  fs.writeFileSync(backup, sql, { mode: 0o600, flag: 'wx' });
  const hash = createHash('sha256').update(sql).digest('hex');
  if (createHash('sha256').update(fs.readFileSync(backup)).digest('hex') !== hash) throw new Error('No se pudo verificar el respaldo. No se borró la base.');
  fs.writeFileSync(`${backup}.sha256`, `${hash}  ${path.basename(backup)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ backup, sha256: hash, previous_rows: counts }));
  // Sin CASCADE: si alguna tabla ajena depende de estas tablas, se aborta sin borrarla.
  await client.query(`TRUNCATE ${quoted} RESTART IDENTITY`);
  for (const c of dataset.customers) await client.query('INSERT INTO customers (customer_id,name,contact_name,city,segment,notes) VALUES ($1,$2,$3,$4,$5,$6)', [c.customer_id,c.name,c.contact_name,c.city,c.segment,c.notes]);
  for (const ev of dataset.events) await client.query('INSERT INTO events (event_id,case_id,event_type,occurred_at,data) VALUES ($1,$2,$3,$4,$5)', [ev.event_id,ev.case_id,ev.event_type,ev.occurred_at,JSON.stringify(ev.data)]);
  for (const [key, value] of Object.entries({ clock_mode: 'live', clock_offset_ms: 0, evaluation_at: dataset.now, learning_mode: 'auto' })) await client.query('INSERT INTO settings (key,value) VALUES ($1,$2)', [key,JSON.stringify(value)]);
  await client.query('COMMIT');
  console.log(JSON.stringify({ reset: true, customers: dataset.customers.length, cases: 6, events: dataset.events.length }));
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally { await client.end(); }
