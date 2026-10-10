// Cliente del API del backend.
const PASS_KEY = 'nexo-admin-password';
const CUSTOMER_KEY = 'nexo-portal-customer';
const ACCESS_KEY = 'nexo-portal-access';

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* almacenamiento no disponible */ }
}

export const adminPassword = {
  get: () => safeGet(PASS_KEY),
  set: (v) => safeSet(PASS_KEY, v),
};
export const portalCustomer = {
  get: () => safeGet(CUSTOMER_KEY),
  set: (v) => safeSet(CUSTOMER_KEY, v),
};

export const portalAccess = {
  get: () => { try { return sessionStorage.getItem(ACCESS_KEY); } catch { return null; } },
  set: (value) => { try { if (value) sessionStorage.setItem(ACCESS_KEY, value); else sessionStorage.removeItem(ACCESS_KEY); } catch {} },
};

async function request(method, url, body, { contentType = 'application/json', headers = {} } = {}) {
  const pass = adminPassword.get();
  const res = await fetch(`/api${url}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': contentType }),
      ...(pass ? { 'x-admin-password': pass } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : contentType === 'application/json' ? JSON.stringify(body) : body,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const err = new Error(data?.error || `Error ${res.status}`);
    err.code = data?.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  auth: () => request('GET', '/auth'),
  status: () => request('GET', '/status'),
  summary: () => request('GET', '/summary'),
  insights: () => request('GET', '/insights'),
  setLearning: (mode) => request('PUT', '/settings/learning', { mode }),
  cases: () => request('GET', '/cases'),
  proposalOptions: () => request('GET', '/proposal-options'),
  sendProposal: (id, body) => request('POST', `/cases/${encodeURIComponent(id)}/proposal`, body),
  reply: (id, body) => request('POST', `/cases/${encodeURIComponent(id)}/reply`, body),
  assistantStatus: () => request('GET', '/assistant/status'),
  assistant: (id) => request('GET', `/cases/${encodeURIComponent(id)}/assistant`),
  runAssistant: (id, analysisQuestion = '') => request('POST', `/cases/${encodeURIComponent(id)}/assistant`, { analysis_question: analysisQuestion }),
  caseDetail: (id) => request('GET', `/cases/${encodeURIComponent(id)}`),
  customers: () => request('GET', '/customers'),
  customer: (id) => request('GET', `/customers/${encodeURIComponent(id)}`),
  updateCustomer: (id, patch) => request('PATCH', `/customers/${encodeURIComponent(id)}`, patch),
  manifest: (obj) => request('POST', '/manifest', obj),
  setEvaluationAt: (iso) => request('PUT', '/settings/evaluation-at', { evaluation_at: iso }),
  setClock: (body) => request('PUT', '/settings/clock', body),
  advanceClock: (hours) => request('POST', '/settings/clock/advance', { hours }),
  uploadEvents: (content, source) => request('POST', '/events', { content, source }),
  evaluate: (caseIds) => request('POST', '/evaluate', caseIds ? { case_ids: caseIds } : {}),
  portalLink: (id) => request('POST', `/cases/${encodeURIComponent(id)}/portal-link`, {}),
  closeCase: (id, data) => request('POST', `/cases/${encodeURIComponent(id)}/close`, data),
  addEvent: (id, event) => request('POST', `/cases/${encodeURIComponent(id)}/events`, event),
  exportJson: () => request('GET', '/export'),
  loadKitFile: (file) => request('POST', `/demo/kit/${file}`, {}),
  seedDemo: () => request('POST', '/demo/seed', {}),
  reset: () => request('POST', '/reset', {}),
};

// API pública del portal del cliente.
const asCustomer = () => ({ headers: portalAccess.get() ? { 'x-portal-access': portalAccess.get() } : {} });
export const portalApi = {
  catalog: () => request('GET', '/portal/catalog'),
  customers: () => request('GET', '/portal/customers'),
  createCustomer: async (body) => {
    const customer = await request('POST', '/portal/customers', body);
    portalAccess.set(customer.access_token);
    return customer;
  },
  me: (cid) => request('GET', '/portal/me', undefined, asCustomer(cid)),
  submitRequest: (cid, body) => request('POST', '/portal/requests', body, asCustomer(cid)),
  requestQuote: (cid, packageId) => request('POST', '/portal/quotes', { package_id: packageId }, asCustomer(cid)),
  viewSection: (cid, caseId, section) => request('POST', `/portal/quotes/${caseId}/view`, { section }, asCustomer(cid)),
  sendMessage: (cid, caseId, message) => request('POST', `/portal/quotes/${caseId}/messages`, { message }, asCustomer(cid)),
  contact: (cid, caseId, body) => request('POST', `/portal/quotes/${caseId}/contact`, body, asCustomer(cid)),
  accept: (cid, caseId) => request('POST', `/portal/quotes/${caseId}/accept`, {}, asCustomer(cid)),
  reject: (cid, caseId) => request('POST', `/portal/quotes/${caseId}/reject`, {}, asCustomer(cid)),
  invoice: (cid, caseId, email) => request('POST', `/portal/quotes/${caseId}/invoice`, { email }, asCustomer(cid)),
};
