// Asistente comercial: la IA propone y el backend valida. Se prueba con un proveedor falso (sin red).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeProvider, setup } from './assistant-helpers.js';
import { buildKnowledge, approvedNumbers, findKnowledge } from '../src/ai/knowledge.js';
import { sanitizeProposal } from '../src/ai/assistant.js';
import { fillPlaceholders, unitNumbers } from '../src/ai/assistant-checks.js';

test('La IA propone, el validador acepta y el saludo se llena sin mandar el nombre al modelo', async () => {
  const t = await setup();
  await t.say('¿El precio incluye la instalación?');
  const run = await t.assistant.runForCase(t.caseId);
  assert.equal(run.source, 'gemini');
  assert.equal(run.validation.authorized.action, 'resolve_objection');
  assert.equal(run.validation.agrees_with_engine, true);
  assert.equal(run.validation.draft.sendable, true);
  assert.equal(run.validation.requires_human_review, false);
  assert.equal(run.status, 'draft');
  assert.match(run.validation.draft.text_for_client, /^Hola, Ana\. Sí: el precio/);
  // Privacidad: el modelo no recibe nombres, correo ni teléfono.
  const sent = `${t.provider.calls[0].system}\n${t.provider.calls[0].user}`;
  for (const secret of ['Ana', 'López', 'ana.lopez@example.com', '844 123 4567', 'Doña']) assert.equal(sent.includes(secret), false, secret);
  // Recibe el conocimiento aprobado y los ejemplos revisados.
  assert.match(t.provider.calls[0].system, /\[garantias\] Garantías/);
  assert.match(t.provider.calls[0].system, /EJEMPLOS REVISADOS/);
  assert.match(t.provider.calls[0].user, /Decisión vigente del motor de reglas/);
});

test('Si la IA sugiere otra acción, manda el motor de reglas y se pide revisión humana', async () => {
  const t = await setup({ provider: fakeProvider(() => ({ proposed_action: 'contact', timing: 'within_24h' })) });
  await t.say('¿El precio incluye la instalación?');
  const run = await t.assistant.runForCase(t.caseId);
  assert.equal(run.validation.authorized.action, 'resolve_objection');
  assert.equal(run.validation.agrees_with_engine, false);
  assert.equal(run.validation.requires_human_review, true);
  assert.equal(run.status, 'needs_review');
});

test('Un borrador con descuentos, cifras no aprobadas o enlaces no se puede enviar', async () => {
  const t = await setup({
    provider: fakeProvider(() => ({ draft_message: 'Hola, {nombre}. Te damos 10% de descuento y te queda en $99,000 con 30 años de garantía. Más info en www.ejemplo.com. Saludos.' })),
  });
  await t.say('¿Qué garantía tienen?');
  const run = await t.assistant.runForCase(t.caseId);
  const failed = run.validation.checks.filter((c) => !c.ok).map((c) => c.id);
  for (const id of ['draft_no_discount', 'draft_approved_numbers', 'draft_no_links']) assert.ok(failed.includes(id), id);
  assert.equal(run.validation.draft.sendable, false);
  assert.equal(run.status, 'needs_review');
});

test('Con el contacto prohibido no hay borrador enviable aunque la IA lo escriba', async () => {
  const t = await setup({ provider: fakeProvider(() => ({ draft_message: 'Hola, {nombre}. Con gusto te explico el financiamiento. Saludos, equipo Nexo Solar.' })) });
  await t.portal.setContactPreference(t.cid, t.caseId, { kind: 'no_contact' });
  await t.say('¿Qué opciones de financiamiento tienen?');
  const run = await t.assistant.runForCase(t.caseId);
  assert.equal(run.validation.authorized.action, 'escalate');
  assert.equal(run.validation.draft.sendable, false);
  assert.equal(run.status, 'needs_review');
});

test('Si el cliente pide descuento, se pide revisión humana aunque el borrador no ofrezca nada', async () => {
  const t = await setup();
  await t.say('¿Me pueden hacer un descuento del 15%?');
  const run = await t.assistant.runForCase(t.caseId);
  assert.equal(run.validation.requires_human_review, true);
  assert.ok(run.validation.human_review_reasons.some((r) => /descuento/.test(r)));
  assert.equal(run.status, 'needs_review');
});

test('Si la IA falla, responde la plantilla con el conocimiento aprobado', async () => {
  const t = await setup({ provider: fakeProvider(() => new Error('Gemini alcanzó su límite de uso (429)')) });
  await t.say('¿El precio incluye la instalación?');
  const run = await t.assistant.runForCase(t.caseId);
  assert.equal(run.source, 'plantilla');
  assert.match(run.proposal.fallback_reason, /Falló la IA .*429/);
  assert.match(run.validation.draft.text_for_client, /incluye IVA, equipos, la instalación estándar/);
  assert.equal(run.validation.draft.sendable, true);
});

test('Correcciones del equipo: se guardan sin nombres y se usan en la siguiente propuesta', async () => {
  const t = await setup();
  await t.say('¿El precio incluye la instalación?');
  const run = await t.assistant.runForCase(t.caseId);
  const final = 'Hola, Ana. ¡Sí! Tu precio incluye la instalación estándar, IVA y el trámite con CFE. Cualquier duda, aquí estamos. Saludos, equipo Nexo Solar.';
  await t.portal.reply(t.caseId, { message: final, action: 'resolve_objection' });
  const fb = await t.assistant.recordFeedback({ runId: run.id, caseId: t.caseId, finalMessage: final });
  assert.equal(fb.edited, true);
  assert.equal(fb.final_message.includes('Ana'), false);
  assert.match(fb.final_message, /^Hola, \{nombre\}/);
  assert.equal((await t.storage.getAssistantRun(run.id)).status, 'sent_by_team');
  t.advance(2);
  await t.say('¿Y el IVA está incluido?');
  await t.assistant.runForCase(t.caseId);
  const prompt = t.provider.calls.at(-1).user;
  assert.match(prompt, /CORRECCIONES RECIENTES DEL EQUIPO/);
  assert.match(prompt, /Tu precio incluye la instalación estándar/);
  assert.equal(prompt.includes('Ana'), false);
});

test('La propuesta del modelo se limpia: ids desconocidos fuera y acción inválida rechazada', () => {
  const p = sanitizeProposal({
    summary: ' Resumen ', customer_need: 'x', proposed_action: 'wait', timing: 'at_date', scheduled_for: 'mañana',
    explanation: 'e', evidence_event_ids: ['E1', 'INVENTADO'], knowledge_used: ['garantias', 'otro'], draft_message: '',
    missing_information: [], requires_human_review: false, human_review_reason: null, confidence: 'muy alta',
  }, { eventIds: new Set(['E1']), knowledgeIds: new Set(['garantias']) });
  assert.equal(p.timing, 'on_new_information');
  assert.equal(p.scheduled_for, null);
  assert.deepEqual(p.evidence_event_ids, ['E1']);
  assert.deepEqual(p.knowledge_used, ['garantias']);
  assert.equal(p.draft_message, null);
  assert.equal(p.confidence, 'low');
  assert.throws(() => sanitizeProposal({ proposed_action: 'dar_descuento' }), /Acción inválida/);
});

test('Conocimiento: catálogo, condiciones aprobadas y cifras permitidas', () => {
  const kb = buildKnowledge();
  assert.ok(kb.entries.some((e) => e.id === 'PKG-NEGOCIO-20' && /285,000 MXN/.test(e.texto)));
  assert.equal(findKnowledge(kb, '¿Cuántos años de garantía tienen?')[0].id, 'garantias');
  assert.equal(findKnowledge(kb, '¿Tienen financiamiento a meses?')[0].id, 'financiamiento');
  const ok = approvedNumbers(kb, ['165000']);
  for (const n of [25, 12, 10, 3, 150000, 150, 165000, 24, 80]) assert.ok(ok.has(n), String(n));
  assert.equal(ok.has(30), false);
  assert.deepEqual(unitNumbers('25 años, $150,000, 120 mil pesos, el 9 de octubre a las 15:00').map((x) => x.value), [25, 150000, 120000]);
  assert.equal(fillPlaceholders('Hola, {nombre}. Gracias.', { contactName: 'Rosa Elena Garza' }), 'Hola, Rosa. Gracias.');
  assert.equal(fillPlaceholders('Hola, {nombre}. Gracias.', {}), 'Hola. Gracias.');
});
