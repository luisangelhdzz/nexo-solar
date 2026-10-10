import { energyAnalysis } from '../domain/energy.js';
// Las cifras y hechos provienen del registro y de fórmulas, no de la respuesta del modelo.
export function analystBrief({ state, detail }) {
  const energy = energyAnalysis(state.request || {});
  const questions = state.messages.filter(m => /[¿?]/.test(m.message));
  const repeated = questions.length >= 4 && state.status !== 'closed';
  return {
    energy,
    questions_count: questions.length,
    purchases_recorded: detail.customer?.purchases ?? 0,
    commercial_signal: repeated ? 'Preguntas recurrentes sin compra confirmada en este caso. No demuestra que el cliente nunca vaya a comprar.' : 'Las preguntas y las vistas no confirman una compra.',
    questions_for_client: energy.missing_information.slice(0, 6),
    checks_for_team: ['Revisar recibo y periodo; distinguir pesos, kW y kWh.', 'Confirmar superficie útil, sombras, orientación y condiciones de instalación.', 'Validar tarifa y consumo antes de elegir equipos, estimar ahorro o publicar precio.'],
    hypotheses: repeated ? ['Podría necesitar más claridad o estar comparando alternativas; debe confirmarse con el cliente.'] : [],
    next_steps: repeated ? ['Responder la duda pendiente con información aprobada.', 'Preguntar qué punto necesita resolver para decidir, sin presionar ni cerrar el caso como perdido.'] : ['Completar los datos faltantes y revisar viabilidad técnica con el analista.'],
    assessment: repeated ? 'Reunir las dudas en una respuesta clara y confirmar el obstáculo real para avanzar.' : 'Preparar la cotización con consumo reportado y revisión técnica; no inferir consumo desde el tamaño del inmueble.',
  };
}
