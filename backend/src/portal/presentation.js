// Escenarios ficticios y breves para presentar el flujo comercial completo.
const H = 3600000;
export function buildPresentation(now = new Date().toISOString()) {
  const at = (hours) => new Date(Date.parse(now) + hours * H).toISOString();
  const names = ['Abarrotes El Sol', 'Taller Horizonte', 'Hotel Sierra Clara', 'Clínica Buen Día', 'Panadería La Espiga', 'Ferretería Los Pinos'];
  const customers = names.map((name, i) => ({ customer_id: `CUS-DEMO-0${i + 1}`, name, contact_name: ['Rosa', 'Javier', 'Mariana', 'Paola', 'Tomás', 'Ernesto'][i], city: 'Saltillo', segment: 'Comercio', notes: 'Caso ficticio para presentación del hackathon.' }));
  const events = [];
  const add = (i, h, event_type, data) => {
    const case_id = `DEMO-0${i + 1}`;
    events.push({ event_id: `${case_id}-e${events.filter(e => e.case_id === case_id).length + 1}`, case_id, event_type, occurred_at: at(h), data });
  };
  for (let i = 0; i < 6; i++) {
    const c = customers[i];
    add(i, -48, 'case.opened', { status: 'open', proposal_status: 'pending', proposal_amount_mxn: null, customer_id: c.customer_id, request: {
      contact_name: c.contact_name, company: c.name, city: c.city, segment: c.segment,
      email: `demo${i + 1}@example.com`, phone: '', contact_channel: 'email', contact_allowed: true,
      bill_amount_mxn: i === 0 ? null : 8000, monthly_bill_mxn: i === 0 ? null : 4000,
      bill_period: 'bimonthly', roof: 'Por confirmar', goal: 'Reducir el gasto de electricidad del negocio.',
    } });
    if (i > 0) add(i, -24, 'proposal.sent', { package_id: 'PKG-COMERCIO-10', proposal_amount_mxn: 150000, title: 'Propuesta solar para el negocio', notes: 'Propuesta de demostración. La viabilidad técnica requiere revisión del equipo.' });
  }
  add(1, -2, 'proposal.viewed', { section: 'installation' });
  add(1, -1, 'message.received', { message: '¿Cuánto tarda la instalación? No podemos cerrar el taller más de dos días.' });
  add(2, -2, 'message.received', { message: 'Estoy de viaje. Por favor no me contacten hasta dentro de tres días.' });
  add(2, -1, 'constraint.updated', { contact_not_before: at(72) });
  add(3, -2, 'message.received', { message: 'Tengo una duda sobre el financiamiento, pero no autorizo que me contacten.' });
  add(3, -1, 'constraint.updated', { contact_allowed: false });
  add(4, -3, 'proposal.viewed', { section: 'price' });
  add(4, -2, 'message.received', { message: 'Acepto la propuesta. El ahorro esperado nos conviene.' });
  add(4, -1, 'case.closed', { status: 'accepted', reason: 'Ahorro esperado', notes: 'El cliente confirmó la compra con el equipo.', closed_by: 'team' });
  add(5, -3, 'proposal.viewed', { section: 'price' });
  add(5, -2, 'message.received', { message: 'No vamos a comprar. El precio supera nuestro presupuesto actual.' });
  add(5, -1, 'case.closed', { status: 'rejected', reason: 'Precio', notes: 'El cliente indicó que no cuenta con presupuesto suficiente.', closed_by: 'team' });
  return { customers, events: events.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)), now };
}

// Se agrega por separado: conserva los seis casos y cualquier solicitud del equipo.
export function buildQuestioningCase(now = new Date().toISOString()) {
  const customer = { customer_id: 'CUS-DEMO-07', name: 'Papelería Punto Claro', contact_name: 'Diego', city: 'Saltillo', segment: 'Comercio', notes: 'Caso ficticio: preguntas recurrentes, sin compra registrada. No implica rechazo.' };
  const events = [];
  const add = (h, event_type, data) => events.push({ event_id: `DEMO-07-e${events.length + 1}`, case_id: 'DEMO-07', event_type, occurred_at: new Date(Date.parse(now) + h * H).toISOString(), data });
  add(-336, 'case.opened', { status: 'open', proposal_status: 'pending', proposal_amount_mxn: null, customer_id: customer.customer_id, request: { contact_name: 'Diego', email: 'demo7@example.com', city: 'Saltillo', segment: 'Comercio', contact_channel: 'email', contact_allowed: true, property_type: 'business', rooms: 3, bill_amount_mxn: 4800, monthly_bill_mxn: 2400, bill_period: 'bimonthly', bill_kwh: 900, billing_days: 60, tariff: '', roof: 'Azotea de concreto', goal: 'Reducir el gasto de electricidad. Tengo luces, dos computadoras y aire acondicionado.', appliances: [{ name: 'Computadora', quantity: 2, watts: 150, hours_per_day: 8, days_per_month: 26 }, { name: 'Lámpara LED', quantity: 12, watts: 15, hours_per_day: 10, days_per_month: 26 }, { name: 'Aire acondicionado', quantity: 1, watts: null, hours_per_day: 6, days_per_month: 26 }] } });
  add(-312, 'proposal.sent', { package_id: 'PKG-COMERCIO-10', proposal_amount_mxn: 150000, title: 'Propuesta de demostración para la papelería', notes: 'Ejemplo ficticio publicado por el equipo; la viabilidad y el alcance técnico requieren revisión.' });
  const pairs = [
    ['¿El precio incluye la instalación?', 'El precio publicado incluye IVA, equipos e instalación estándar.'],
    ['¿Qué garantía tienen los paneles?', 'Los paneles tienen 25 años de garantía de rendimiento y 12 años contra defectos de fabricación.'],
    ['¿Puedo solicitar financiamiento?', 'El financiamiento está sujeto a evaluación y aprobación; no se confirma automáticamente.'],
    ['¿Cuánto tarda la instalación?', 'El plazo particular se confirma con la revisión del sitio y la propuesta del equipo.'],
    ['¿Los paneles siguen funcionando si se va la luz?', 'El respaldo durante apagones requiere una solución compatible; no se promete respaldo con una instalación convencional.'],
    ['¿Me pueden explicar otra vez qué incluye el precio?', 'La propuesta publicada describe los equipos y la instalación estándar. Podemos revisar el alcance específico juntos.'],
  ];
  pairs.forEach(([message, response], i) => {
    const h = -288 + i * 48;
    add(h, 'message.received', { message });
    add(h + 1, 'action.executed', { action: 'contact', message: response, author: 'team' });
  });
  add(-1, 'message.received', { message: 'Todavía no decido comprar. ¿Qué información de mis aparatos y de mi recibo necesitan para confirmar si la propuesta sirve para mi negocio?' });
  return { customer, events };
}
