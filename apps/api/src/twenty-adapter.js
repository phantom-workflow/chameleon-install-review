import crypto from 'node:crypto';

const ROLE_PERMISSIONS = {
  OWNER: new Set(['customers', 'orders', 'cases', 'communications', 'timeline', 'financial', 'fulfillment', 'settings']),
  OPERATIONS: new Set(['customers', 'orders', 'cases', 'communications', 'timeline', 'financial', 'fulfillment']),
  CSR: new Set(['customers', 'orders', 'cases', 'communications', 'timeline']),
  FULFILLMENT: new Set(['customers', 'orders', 'cases', 'timeline', 'fulfillment']),
  AGENT: new Set(['customers', 'orders', 'cases', 'communications', 'timeline']),
};

function roleFrom(req) {
  return String(req.headers['x-chameleon-role'] || 'CSR').toUpperCase();
}

function allowed(req, resource, action = 'read') {
  const role = roleFrom(req);
  if (action === 'approve' || action === 'settings') return role === 'OWNER';
  if (action === 'write') return role === 'OWNER' || role === 'OPERATIONS' || (resource === 'fulfillment' && role === 'FULFILLMENT');
  return ROLE_PERMISSIONS[role]?.has(resource) || false;
}

function redact(role, type, value) {
  if (role === 'OWNER' || value == null) return value;
  const text = String(value);
  if (type === 'email') {
    const [local, domain] = text.split('@');
    return local && domain ? `${local.slice(0, 1)}***@${domain}` : '***';
  }
  if (type === 'phone') return text.length > 4 ? `${'*'.repeat(Math.max(0, text.length - 4))}${text.slice(-4)}` : '***';
  return text;
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return null;
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

function phoneValue(value) {
  return value?.primaryPhoneNumber ? normalizePhone(value.primaryPhoneNumber) : null;
}
function fullName(value) {
  if (value && typeof value === 'object') return [value.firstName, value.lastName].filter(Boolean).join(' ').trim();
  return String(value || '').trim();
}


function customerView(row, role) {
  return {
    id: row.id,
    display_name: fullName(row.name) || 'Unresolved Customer',
    email: redact(role, 'email', row.email?.primaryEmail),
    phone: redact(role, 'phone', phoneValue(row.phone)),
    status: row.status || 'ACTIVE',
    lifetime_value: role === 'OWNER' ? (row.lifetimeValue || null) : undefined,
    identifiers: [
      row.email?.primaryEmail ? {source: 'twenty', type: 'email', verified: false, value: redact(role, 'email', row.email.primaryEmail)} : null,
      phoneValue(row.phone) ? {source: 'twenty', type: 'phone', verified: false, value: redact(role, 'phone', phoneValue(row.phone))} : null,
      row.customerId ? {source: 'twenty', type: 'customer_id', verified: true, value: row.customerId} : null,
    ].filter(Boolean),
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function operationName(prefix, object) {
  const singular = object.endsWith('ies') ? object.slice(0, -3) + 'y' : object.endsWith('s') ? object.slice(0, -1) : object;
  return prefix + singular[0].toUpperCase() + singular.slice(1);
}

export function createDisabledTwentyAdapter() {
  const disabled = async () => {
    throw Object.assign(new Error('Twenty projection is disabled'), {status: 503, code: 'TWENTY_PROJECTION_DISABLED'});
  };
  return {
    projectionEnabled: false,
    syntheticOnly: true,
    ping: async () => true,
    list: async () => [],
    findByField: async () => null,
    findCustomer: async () => null,
    get: async () => null,
    create: disabled,
    update: disabled,
    upsertCustomer: disabled,
    customer360: async () => null,
    ingestTwilio: disabled,
    snapshot: async () => ({
      customers: [],
      orders: [],
      communications: [],
      cases: [],
      ownerAttention: {open_cases: 0, pending_approvals: 0, high_priority: 0},
      csrQueue: [],
      fulfillmentQueue: []
    }),
    customerView: (row) => row,
    allowed: () => false,
    roleFrom
  };
}

export function createTwentyAdapter({baseUrl, apiKey, syntheticOnly = true}) {
  const base = String(baseUrl).replace(/\/$/, '');
  const headers = {'authorization': `Bearer ${apiKey}`, 'content-type': 'application/json'};
  const memoryReceipts = new Set();

  async function request(path, options = {}) {
    const response = await fetch(`${base}${path}`, { ...options, headers: {...headers, ...(options.headers || {})} });
    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); } catch { payload = {error: {code: 'TWENTY_INVALID_JSON'}}; }
    if (!response.ok) {
      const message = payload?.messages?.join('; ') || payload?.message || payload?.error || `Twenty request failed (${response.status})`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function ping() {
    await request('/healthz');
    return true;
  }

  function filterEquals(field, value) {
    return `${field}[eq]:${JSON.stringify(String(value))}`;
  }

  async function list(object, {filter, limit = 60} = {}) {
    const records = [];
    let cursor = null;
    for (let page = 0; page < 100; page += 1) {
      const params = new URLSearchParams({limit: String(Math.min(60, Math.max(1, limit)))});
      if (filter) params.set('filter', filter);
      if (cursor) params.set('starting_after', cursor);
      const payload = await request(`/rest/${object}?${params.toString()}`);
      records.push(...(payload.data?.[object] || []));
      if (!payload.pageInfo?.hasNextPage || !payload.pageInfo?.endCursor) break;
      cursor = payload.pageInfo.endCursor;
    }
    return records;
  }

  async function findByField(object, field, value) {
    const params = new URLSearchParams({limit: '1', filter: filterEquals(field, value)});
    const payload = await request(`/rest/${object}?${params.toString()}`);
    return payload.data?.[object]?.[0] || null;
  }

  async function findCustomer(id) {
    const value = String(id || '').trim();
    if (!value) return null;
    const byReference = await findByField('customers', 'customerId', value);
    if (byReference) return byReference;
    try {
      return await get('customers', value);
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  async function get(object, id) {
    const payload = await request(`/rest/${object}/${encodeURIComponent(id)}`);
    return payload.data?.[operationName('get', object)] || payload.data?.[object.slice(0, -1)] || payload.data?.[object] || null;
  }

  async function create(object, record) {
    const payload = await request(`/rest/${object}`, {method: 'POST', body: JSON.stringify(record)});
    return payload.data?.[operationName('create', object)] || payload.data?.[object.slice(0, -1)] || payload.data?.[object] || null;
  }

  async function update(object, id, record) {
    const payload = await request(`/rest/${object}/${encodeURIComponent(id)}`, {method: 'PATCH', body: JSON.stringify(record)});
    return payload.data?.[operationName('update', object)] || payload.data?.[object.slice(0, -1)] || payload.data?.[object] || null;
  }

  async function upsertCustomer(input) {
    const email = String(input.email || '').trim().toLowerCase();
    const phone = normalizePhone(input.phone);
    const existing = (input.customerId && await findByField('customers', 'customerId', input.customerId))
      || (email && await findByField('customers', 'email.primaryEmail', email))
      || (phone && await findByField('customers', 'phone.primaryPhoneNumber', phone));
    const record = {
      name: fullName(input.name) || 'Unresolved Customer',
      customerId: String(input.customerId || '').trim() || undefined,
      email: email ? {primaryEmail: email} : undefined,
      phone: phone ? {primaryPhoneNumber: phone} : undefined,
      status: 'ACTIVE'
    };
    if (existing) {
      const customer = await update('customers', existing.id, record);
      return {customer: customer || existing, created: false};
    }
    return {customer: await create('customers', record), created: true};
  }

  async function customer360(id, role) {
    const customer = await findCustomer(id);
    if (!customer) return null;
    const customerReferenceId = customer.customerId || String(id);
    const [orders, cases, communications] = await Promise.all([
      list('orders', {filter: filterEquals('customerId', customerReferenceId)}),
      list('cases', {filter: filterEquals('customerId', customerReferenceId)}),
      list('communications', {filter: filterEquals('customerId', customerReferenceId)})
    ]);
    const customerOrders = orders.filter(item => item.customerId === customerReferenceId);
    const customerCases = cases.filter(item => item.customerId === customerReferenceId);
    const customerComms = communications.filter(item => item.customerId === customerReferenceId);
    const timeline = [
      ...customerOrders.map(item => ({event_type: item.status === 'DELIVERED' ? 'ORDER_DELIVERED' : 'ORDER_UPDATED', source: 'twenty', source_id: item.id, occurred_at: item.orderedAt || item.updatedAt, order_id: item.id, case_id: null, provenance: {object: 'order', record_id: item.id}})),
      ...customerComms.map(item => ({event_type: 'CUSTOMER_MESSAGE_RECEIVED', source: 'twenty', source_id: item.id, occurred_at: item.receivedAt || item.createdAt, order_id: null, case_id: item.caseId || null, provenance: {object: 'communication', record_id: item.id}})),
      ...customerCases.map(item => ({event_type: 'CASE_CREATED', source: 'twenty', source_id: item.id, occurred_at: item.createdAt, order_id: item.orderId || null, case_id: item.id, provenance: {object: 'case', record_id: item.id}})),
    ].sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));
    return {customer: customerView(customer, role), orders: customerOrders, communications: customerComms, cases: customerCases, timeline};
  }

  async function ingestTwilio(payload) {
    const providerEventId = String(payload.MessageSid || payload.message_sid || '');
    const from = normalizePhone(payload.From || payload.from);
    const message = String(payload.Body || payload.body || '');
    if (!providerEventId || !from || !message) throw new Error('invalid synthetic Twilio payload');
    if (memoryReceipts.has(providerEventId)) return {status: 'replay', duplicate: true, provider_event_id: providerEventId};
    if (await findByField('communications', 'externalId', providerEventId)) {
      memoryReceipts.add(providerEventId);
      return {status: 'replay', duplicate: true, provider_event_id: providerEventId};
    }
    let customer = await findByField('customers', 'phone.primaryPhoneNumber', from);
    if (!customer) customer = await create('customers', {name: 'Unresolved Customer', customerId: `twilio-${providerEventId}`, phone: {primaryPhoneNumber: from}, status: 'ACTIVE'});
    const lower = message.toLowerCase();
    const caseType = lower.includes('refund') ? 'REFUND_REQUEST' : lower.includes('broken') || lower.includes('damaged') ? 'DAMAGED_PRODUCT' : lower.includes('again') || lower.includes('reorder') ? 'REORDER_REQUEST' : 'GENERAL_ESCALATION';
    const createdCase = await create('cases', {name: `Case ${providerEventId}`, caseNumber: `CASE-${providerEventId}`, caseType, status: caseType === 'REFUND_REQUEST' ? 'WAITING_APPROVAL' : 'OPEN', priority: caseType === 'DAMAGED_PRODUCT' ? 'HIGH' : 'NORMAL', summary: message.slice(0, 240), customerId: customer.id, slaDueAt: new Date(Date.now() + 48 * 3600 * 1000).toISOString()});
    const communication = await create('communications', {name: `Inbound ${providerEventId}`, channel: 'SMS', direction: 'INBOUND', externalId: providerEventId, body: message, receivedAt: payload.Timestamp || payload.timestamp || new Date().toISOString(), messageStatus: 'RECEIVED', customerId: customer.id, caseId: createdCase.id});
    memoryReceipts.add(providerEventId);
    return {status: 'accepted', duplicate: false, customer_id: customer.id, communication_id: communication.id, case_id: createdCase.id, case_type: caseType, order_id: null, synthetic: true};
  }

  async function snapshot(role) {
    const [customers, orders, cases, communications] = await Promise.all([list('customers'), list('orders'), list('cases'), list('communications')]);
    const openCases = cases.filter(item => !['RESOLVED', 'CLOSED'].includes(item.status));
    const customerById = new Map(customers.map(item => [item.id, item]));
    const orderById = new Map(orders.map(item => [item.id, item]));
    const enrichCase = item => ({...item, display_name: customerById.get(item.customerId)?.name || 'Unresolved Customer', order_number: orderById.get(item.orderId)?.orderNumber || null, requires_human: true, financial_action: item.caseType === 'REFUND_REQUEST' ? 'PENDING_APPROVAL' : 'NONE', fulfillment_action: ['MISSING_SHIPMENT', 'DAMAGED_PRODUCT', 'REORDER_REQUEST'].includes(item.caseType) ? 'PENDING_REVIEW' : 'NONE', case_type: item.caseType, owner_scope: 'CSR'});
    return {
      customers: customers.map(item => customerView(item, role)),
      orders,
      communications,
      cases: cases.map(enrichCase),
      ownerAttention: {open_cases: openCases.length, pending_approvals: cases.filter(item => item.status === 'WAITING_APPROVAL').length, high_priority: openCases.filter(item => ['HIGH', 'URGENT'].includes(item.priority)).length},
      csrQueue: openCases.filter(item => item.status !== 'WAITING_APPROVAL').map(enrichCase),
      fulfillmentQueue: openCases.filter(item => ['MISSING_SHIPMENT', 'DAMAGED_PRODUCT', 'REORDER_REQUEST'].includes(item.caseType)).map(enrichCase),
    };
  }

  return {allowed, roleFrom, customerView, customer360, ingestTwilio, list, findByField, findCustomer, get, create, update, upsertCustomer, snapshot, ping, syntheticOnly, projectionEnabled: true};
}
