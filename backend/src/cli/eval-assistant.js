// npm run ai:eval — mide al asistente con casos separados de los ejemplos (src/ai/evaluacion.js).
//
//   npm run ai:eval                 usa la IA configurada en backend/.env
//   npm run ai:eval -- --sin-ia     usa solo plantillas (punto de comparación)
//   npm run ai:eval -- --pausa=5    espera 5 s entre casos (si tu cuota es baja)
//
// Todo pasa en memoria con datos inventados: no toca tu base de datos ni le escribe a ningún cliente.

import { activeProvider } from '../ai/providers.js';
import { CASOS, runEvaluation } from '../ai/evaluacion.js';

const args = process.argv.slice(2);
const sinIA = args.includes('--sin-ia');
const pausaArg = args.find((a) => a.startsWith('--pausa='));
const pauseMs = pausaArg ? Math.max(0, Number(pausaArg.split('=')[1]) || 0) * 1000 : 2000;

const provider = sinIA ? null : activeProvider();
console.log(`Evaluación del asistente con ${provider ? `${provider.name} (${provider.model})` : 'plantillas, sin IA'} · ${CASOS.length} casos separados de los ejemplos\n`);

let fallbacks = 0;
const results = await runEvaluation({
  provider,
  pauseMs: provider ? pauseMs : 0,
  onCase: ({ caso, run, seconds, checks }) => {
    const passed = checks.filter((c) => c.ok).length;
    if (provider && run.source === 'plantilla') fallbacks += 1;
    const mark = passed === checks.length ? '✔' : '✖';
    console.log(`${mark} ${caso.id} · ${caso.situacion} (${run.source}, ${seconds.toFixed(1)} s) ${passed}/${checks.length}`);
    for (const c of checks.filter((x) => !x.ok)) console.log(`    ✖ ${c.que} → ${c.obtenido || 'no'}`);
    if (run.proposal.fallback_reason) console.log(`    · ${run.proposal.fallback_reason}`);
  },
});

const all = results.flatMap((r) => r.checks);
const passed = all.filter((c) => c.ok).length;
const complete = results.filter((r) => r.checks.every((c) => c.ok)).length;
console.log(`\nResultado: ${passed}/${all.length} comprobaciones (${Math.round((passed / all.length) * 100)}%) · ${complete}/${results.length} casos completos`);
if (fallbacks) console.log(`Aviso: ${fallbacks} caso(s) usaron la plantilla porque falló la IA. Vuelve a correr más tarde o con --pausa=10.`);
