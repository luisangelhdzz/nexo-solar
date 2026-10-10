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
