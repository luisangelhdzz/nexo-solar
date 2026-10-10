#!/usr/bin/env node
// Evaluación por línea de comandos (sin servidor ni base de datos).
//
// Uso:
//   npm run evaluate -- --manifest ../kit/manifest.json --events ../kit/events.jsonl --events ../kit/updates.jsonl --out ../recomendaciones.json
//
// Carga los archivos en orden, evalúa después de cada uno y muestra qué cambió.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { createMemoryStorage } from '../storage/memory.js';
import { createEngine } from '../services/engine.js';
import { providerStatus } from '../ai/providers.js';

function parseArgs(argv) {
  const args = { events: [], manifest: null, out: null, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--events') args.events.push(argv[++i]);
    else if (a === '--manifest') args.manifest = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--quiet') args.quiet = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.manifest || !args.events.length) {
  console.log('Uso: npm run evaluate -- --manifest <manifest.json> --events <events.jsonl> [--events <updates.jsonl>] [--out <salida.json>]');
  process.exit(args.help ? 0 : 1);
}

const storage = createMemoryStorage();
const engine = createEngine({ storage, policy: config.policy });
const log = (...m) => { if (!args.quiet) console.log(...m); };

const manifest = JSON.parse(fs.readFileSync(args.manifest, 'utf8'));
await engine.setManifest(manifest);
const ai = providerStatus();
log(`Hora de evaluación: ${manifest.evaluation_at}`);
log(`Interpretación: ${ai.mode === 'ai' ? `${ai.provider} (${ai.model})` : ai.note}\n`);

for (const file of args.events) {
  const res = await engine.ingest({ content: fs.readFileSync(file, 'utf8'), source: path.basename(file) });
  log(`== ${path.basename(file)}: aceptados ${res.accepted}, duplicados ignorados ${res.duplicates.length}, con error ${res.errors.length}`);
  for (const d of res.duplicates) log(`   duplicado ignorado: ${d.event_id} (línea ${d.line})`);
  for (const e of res.errors) log(`   línea ${e.line}: ${e.errors.join('; ')}`);
  for (const r of res.evaluated) {
    const when = r.scheduled_for ? ` @ ${r.scheduled_for}` : '';
    const changed = r.changes.length && r.changes.some((c) => c.before !== null) ? `   (cambió: ${r.changes.map((c) => c.field).join(', ')})` : '';
    log(`   ${r.case_id}: ${r.action} / ${r.timing}${when}${changed}`);
  }
  log('');
}

const recs = await engine.exportRecommendations();
const json = JSON.stringify(recs, null, 2);
if (args.out) {
  fs.writeFileSync(args.out, `${json}\n`);
  log(`Recomendaciones guardadas en ${args.out}`);
} else {
  console.log(json);
}
