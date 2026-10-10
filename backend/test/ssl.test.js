import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { postgresConnectionOptions } from '../src/storage/ssl.js';

const url = 'postgres://demo:example@db.example.com:5432/demo';

test('PostgreSQL local sin SSL conserva la conexión', () => {
  assert.deepEqual(postgresConnectionOptions(url, {}), { connectionString: url });
});

test('SSL verifica el servidor y conserva otros parámetros de la URL', () => {
  const options = postgresConnectionOptions(`${url}?sslmode=require&application_name=nexo`, { DATABASE_SSL: 'true' });
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(new URL(options.connectionString).searchParams.has('sslmode'), false);
  assert.equal(new URL(options.connectionString).searchParams.get('application_name'), 'nexo');
});

test('La CA configurada no es reemplazada por sslmode en la URL', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-ssl-'));
  try {
    const file = path.join(dir, 'ca.pem');
    fs.writeFileSync(file, 'test-ca');
    const options = postgresConnectionOptions(`${url}?sslmode=require`, { DATABASE_SSL: 'true', DATABASE_SSL_CA_FILE: file });
    assert.deepEqual(options.ssl, { rejectUnauthorized: true, ca: 'test-ca' });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Certificado ausente falla sin desactivar la verificación', () => {
  assert.throws(() => postgresConnectionOptions(url, { DATABASE_SSL_CA_FILE: '/missing-nexo-certificate.pem' }), { code: 'ENOENT' });
});
