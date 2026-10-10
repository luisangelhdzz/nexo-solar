import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEnergyInput, energyAnalysis } from '../src/domain/energy.js';
import { setup, REQUEST, fakeProvider } from './assistant-helpers.js';
import { buildQuestioningCase } from '../src/portal/presentation.js';
import { analystBrief } from '../src/ai/analyst.js';
import { buildCaseState } from '../src/domain/state.js';

test('Consumo: normaliza periodos y calcula inventarios completos sin inferir desde cuartos o pesos', () => {
  const input = normalizeEnergyInput({ bill_kwh: 600, billing_days: 60, property_type: 'home', rooms: 4, tariff: '1', appliances: [{name:'Computadora',quantity:2,watts:100,hours_per_day:5,days_per_month:20}] });
  const e = energyAnalysis(input);
  assert.equal(e.daily_kwh,10); assert.equal(e.normalized_kwh_30_days,300);
  assert.equal(e.inventory_estimated_kwh_month,20); assert.equal(e.tariff,'1');
  assert.equal(energyAnalysis({rooms:10,monthly_bill_mxn:8000}).reported_kwh,null);
  assert.equal(energyAnalysis({...input, appliances:[...input.appliances,{name:'Aire',quantity:1,watts:null,hours_per_day:6,days_per_month:26}]}).inventory_estimated_kwh_month,null);
});
test('Consumo: rechaza valores inválidos y admite uso cero', () => {
  for (const input of [{bill_kwh:-2},{billing_days:0},{rooms:1.5},{property_type:'other'},{appliances:[{name:'Aire',hours_per_day:25}]}]) assert.throws(()=>normalizeEnergyInput(input));
  const input = normalizeEnergyInput({appliances:[{name:'TV',quantity:1,watts:100,hours_per_day:0,days_per_month:20}]});
  assert.equal(energyAnalysis(input).inventory_estimated_kwh_month,0);
});
test('Consulta interna: conserva consumo registrado y no envía mensajes incluso en modo automático', async () => {
  const provider = fakeProvider(() => ({analyst_analysis:{assessment:'Consumo: 9999 kWh. Instalar 25 paneles.',hypotheses:[],questions_for_client:[],checks_for_team:[],next_steps:[]}}));
  const s = await setup({provider,mode:'auto', request:{...REQUEST,bill_kwh:600,billing_days:60}});
  const before = (await s.engine.getCase(s.caseId)).events.length;
  const run = await s.assistant.runForCase(s.caseId,{analysisQuestion:'¿Qué consumo y datos faltantes debemos revisar?'});
  assert.equal(run.result.executed,'analisis_interno');
  assert.equal((await s.engine.getCase(s.caseId)).events.length,before);
  assert.equal(run.proposal.analyst_brief.energy.normalized_kwh_30_days,300);
  assert.ok(run.proposal.analyst_brief.analysis_note);
  assert.ok(provider.calls[0].user.includes('¿Qué consumo'));
});
test('Preguntas recurrentes: mantiene venta pendiente y separa inventario incompleto del recibo', () => {
  const {customer,events} = buildQuestioningCase('2026-10-10T18:00:00.000Z');
  const state = buildCaseState('DEMO-07',events);
  const brief = analystBrief({state,detail:{customer}});
  assert.equal(state.status,'open'); assert.ok(brief.questions_count>=7);
  assert.equal(brief.energy.normalized_kwh_30_days,450);
  assert.equal(brief.energy.inventory_estimated_kwh_month,null);
  assert.ok(brief.commercial_signal.includes('No demuestra'));
});

test('Consulta energética: acepta el periodo normalizado y conserva la respuesta útil de la IA', async () => {
  const provider = fakeProvider(() => ({analyst_analysis:{assessment:'Consumo normalizado: 300 kWh en 30 días. Falta la tarifa.',hypotheses:[],questions_for_client:[],checks_for_team:[],next_steps:[]}}));
  const s = await setup({provider,request:{...REQUEST,bill_kwh:600,billing_days:60}});
  const run = await s.assistant.runForCase(s.caseId,{analysisQuestion:'¿Qué consumo normalizado tiene?'});
  assert.equal(run.proposal.analyst_brief.assessment,'Consumo normalizado: 300 kWh en 30 días. Falta la tarifa.');
  assert.equal(run.proposal.analyst_brief.analysis_note,undefined);
});
test('Solicitud con solo kWh: guarda los campos y pasa a revisión para cotizar', async () => {
  const s = await setup({request:{...REQUEST,monthly_bill_mxn:'',bill_kwh:600,billing_days:60,property_type:'home',rooms:4},sendProposal:false});
  const detail = await s.engine.getCase(s.caseId);
  assert.equal(detail.state.request.bill_kwh,600);
  assert.equal(detail.state.request.rooms,4);
  assert.equal(detail.current.recommendation.action,'escalate');
});
