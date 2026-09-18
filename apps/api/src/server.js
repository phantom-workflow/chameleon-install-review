import http from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import { query, pool, transaction } from './db.js';
import { normalizeEmail, normalizePhone, classifyMessage, permissionFor, redactIdentifier } from './domain.js';
import { runMigrations } from './migrate.js';
import { createTwentyAdapter } from './twenty-adapter.js';

const port = Number(process.env.PORT || 8080);
const appEnv = process.env.APP_ENV || 'development';
const twentyAdapter = process.env.TWENTY_BASE_URL && process.env.TWENTY_API_KEY
  ? createTwentyAdapter({baseUrl: process.env.TWENTY_BASE_URL, apiKey: process.env.TWENTY_API_KEY, syntheticOnly: process.env.SYNTHETIC_ONLY !== 'false'})
  : null;

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload)});
  res.end(payload);
}

function roleFrom(req) {
  return String(req.headers['x-chameleon-role'] || (appEnv === 'development' ? 'OWNER' : 'CSR')).toUpperCase();
}

function allowed(req, resource, action = 'read') {
  return permissionFor(roleFrom(req), resource, action);
}

function deny(res) {
  json(res, 403, {error: {code: 'FORBIDDEN', message: 'permission denied'}});
}

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('request body too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function customerView(row, identifiers, role) {
  return {
    id: row.id,
    display_name: row.display_name,
    email: role === 'OWNER' ? row.email : redactIdentifier(role, 'email', row.email),
    phone: role === 'OWNER' ? row.phone : redactIdentifier(role, 'phone', row.phone),
    status: row.status,
    lifetime_value: role === 'OWNER' ? row.lifetime_value : undefined,
    identifiers: identifiers.map(item => ({source: item.source, type: item.identifier_type, verified: item.verified, value: redactIdentifier(role, item.identifier_type, item.normalized_value)})),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function getCustomer360(id, role) {
  const customer = await query('SELECT * FROM customers WHERE id = $1', [id]);
  if (!customer.rowCount) return null;
  const identifiers = await query('SELECT source, identifier_type, normalized_value, verified FROM customer_identifiers WHERE customer_id = $1 ORDER BY source, identifier_type', [id]);
  const orders = await query('SELECT id, order_number, source, amount, currency, payment_status, fulfillment_status, tracking_number, source_created_at, source_updated_at FROM orders WHERE customer_id = $1 ORDER BY source_created_at NULLS LAST', [id]);
  const communications = await query('SELECT id, source, channel, external_id, direction, summary, occurred_at, source_observed_at FROM communications WHERE customer_id = $1 ORDER BY occurred_at NULLS LAST', [id]);
  const cases = await query('SELECT id, order_id, case_type, priority, status, owner_scope, requires_human, financial_action, fulfillment_action, resolution, created_at, updated_at FROM cases WHERE customer_id = $1 ORDER BY created_at', [id]);
  const timeline = await query('SELECT event_type, source, source_id, actor_type, occurred_at, order_id, case_id, provenance FROM operational_events WHERE customer_id = $1 UNION ALL SELECT ce.event_type, \'case\', ce.id::text, ce.actor_type, ce.occurred_at, c.order_id, ce.case_id, jsonb_build_object(\'case_id\', ce.case_id) FROM case_events ce JOIN cases c ON c.id = ce.case_id WHERE c.customer_id = $1 ORDER BY occurred_at', [id]);
  return {customer: customerView(customer.rows[0], identifiers.rows, role), orders: orders.rows, communications: communications.rows, cases: cases.rows, timeline: timeline.rows};
}

async function resolveCustomer(client, input) {
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const matches = [];
  if (email) {
    const result = await client.query('SELECT customer_id FROM customer_identifiers WHERE identifier_type = $1 AND normalized_value = $2 AND verified = true', ['email', email]);
    matches.push(...result.rows.map(row => row.customer_id));
  }
  if (phone) {
    const result = await client.query('SELECT customer_id FROM customer_identifiers WHERE identifier_type = $1 AND normalized_value = $2 AND verified = true', ['phone', phone]);
    matches.push(...result.rows.map(row => row.customer_id));
  }
  if (input.external_id) {
    const result = await client.query('SELECT customer_id FROM customer_identifiers WHERE source = $1 AND identifier_type = $2 AND normalized_value = $3', [input.source || 'unknown', input.identifier_type || 'external_id', String(input.external_id)]);
    matches.push(...result.rows.map(row => row.customer_id));
  }
  const unique = [...new Set(matches)];
  if (unique.length > 1) return {conflict: true, customer_id: null};
  if (unique.length === 1) return {conflict: false, customer_id: unique[0]};
  const customerId = crypto.randomUUID();
  const now = new Date();
  await client.query('INSERT INTO customers(id, display_name, email, phone, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$5)', [customerId, input.display_name || 'Unresolved Customer', email || null, phone || null, now]);
  if (email) await client.query('INSERT INTO customer_identifiers(id, customer_id, source, identifier_type, normalized_value, verified, provenance, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING', [crypto.randomUUID(), customerId, input.source || 'unknown', 'email', email, Boolean(input.verified_email), JSON.stringify({method: 'ingestion'}), now]);
  if (phone) await client.query('INSERT INTO customer_identifiers(id, customer_id, source, identifier_type, normalized_value, verified, provenance, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING', [crypto.randomUUID(), customerId, input.source || 'unknown', 'phone', phone, Boolean(input.verified_phone), JSON.stringify({method: 'ingestion'}), now]);
  return {conflict: false, customer_id: customerId};
}

function twilioPayload(input) {
  return {
    provider_event_id: String(input.MessageSid || input.message_sid || ''),
    from: normalizePhone(input.From || input.from),
    to: normalizePhone(input.To || input.to),
    body: String(input.Body || input.body || ''),
    occurred_at: input.Timestamp || input.timestamp ? new Date(input.Timestamp || input.timestamp) : new Date()
  };
}

function verifySynthetic(req) {
  return appEnv !== 'production' && String(req.headers['x-chameleon-synthetic'] || '').toLowerCase() === 'true' && String(req.headers['x-twilio-signature'] || '') === 'synthetic-test';
}

async function ingestTwilio(req, payload) {
  const twilio = twilioPayload(payload);
  if (!twilio.provider_event_id || !twilio.from || !twilio.body) throw new Error('invalid synthetic Twilio payload');
  return transaction(async client => {
    const receipt = await client.query('INSERT INTO ingestion_receipts(id, source, provider_event_id, status, details, received_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (source, provider_event_id) DO NOTHING RETURNING id', [crypto.randomUUID(), 'twilio', twilio.provider_event_id, 'RECEIVED', JSON.stringify({synthetic: true}), new Date()]);
    if (!receipt.rowCount) return {status: 'replay', duplicate: true, provider_event_id: twilio.provider_event_id};
    const identity = await resolveCustomer(client, {source: 'twilio', phone: twilio.from, verified_phone: true});
    if (identity.conflict) throw new Error('identity conflict requires manual review');
    const orderResult = await client.query('SELECT id, order_number FROM orders WHERE customer_id = $1 ORDER BY source_created_at DESC NULLS LAST LIMIT 1', [identity.customer_id]);
    const order = orderResult.rows[0] || null;
    const communicationId = crypto.randomUUID();
    await client.query('INSERT INTO communications(id, customer_id, source, channel, external_id, direction, content_reference, summary, occurred_at, source_observed_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)', [communicationId, identity.customer_id, 'twilio', 'SMS', twilio.provider_event_id, 'INBOUND', 'provider://twilio/' + twilio.provider_event_id, twilio.body.slice(0, 240), twilio.occurred_at, new Date()]);
    await client.query('INSERT INTO operational_events(id, customer_id, order_id, event_type, source, source_id, actor_type, occurred_at, ingested_at, provenance) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [crypto.randomUUID(), identity.customer_id, order?.id || null, 'CUSTOMER_MESSAGE_RECEIVED', 'twilio', twilio.provider_event_id, 'CUSTOMER', twilio.occurred_at, new Date(), JSON.stringify({channel: 'SMS', synthetic: true})]);
    const caseType = classifyMessage(twilio.body);
    const caseId = crypto.randomUUID();
    const caseStatus = caseType === 'REFUND_REQUEST' ? 'WAITING_APPROVAL' : 'OPEN';
    await client.query('INSERT INTO cases(id, customer_id, order_id, case_type, priority, status, owner_scope, requires_human, financial_action, fulfillment_action, source, source_reference, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9,$10,$11,$12,$13)', [caseId, identity.customer_id, order?.id || null, caseType, caseType === 'DAMAGED_PRODUCT' ? 'HIGH' : 'NORMAL', caseStatus, 'CSR', caseType === 'REFUND_REQUEST' ? 'PENDING_APPROVAL' : 'NONE', 'NONE', 'twilio', twilio.provider_event_id, new Date(), new Date()]);
    await client.query('INSERT INTO case_events(id, case_id, event_type, summary, actor_type, occurred_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$6)', [crypto.randomUUID(), caseId, 'CASE_CREATED', caseType + ' case created from synthetic Twilio message', 'SYSTEM', new Date()]);
    await client.query('UPDATE ingestion_receipts SET status = $1, details = $2 WHERE source = $3 AND provider_event_id = $4', ['ACCEPTED', JSON.stringify({customer_id: identity.customer_id, communication_id: communicationId, case_id: caseId, case_type: caseType}), 'twilio', twilio.provider_event_id]);
    await client.query('INSERT INTO audit_events(id, actor_type, actor_id, action, resource_type, resource_id, outcome, metadata, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [crypto.randomUUID(), 'SYSTEM', 'twilio', 'INGEST', 'communication', communicationId, 'ACCEPTED', JSON.stringify({synthetic: true, case_id: caseId}), new Date()]);
    return {status: 'accepted', duplicate: false, customer_id: identity.customer_id, order_id: order?.id || null, communication_id: communicationId, case_id: caseId, case_type: caseType};
  });
}

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  if (req.method === 'GET' && url.pathname === '/api/v1/health') {
    try { await query('SELECT 1'); return json(res, 200, {status: 'ok', service: 'chameleon-operations-api', environment: appEnv, database: 'ok'}); }
    catch { return json(res, 503, {status: 'degraded', database: 'unavailable'}); }
  }
  if (req.method === 'POST' && url.pathname === '/api/v1/ingest/twilio') {
    if (!verifySynthetic(req)) return json(res, 403, {error: {code: 'SYNTHETIC_ONLY', message: 'development synthetic Twilio ingestion required'}});
    try { return json(res, 200, await ingestTwilio(req, await body(req))); }
    catch (error) { return json(res, 400, {error: {code: 'INGEST_REJECTED', message: error.message}}); }
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/customers') {
    if (!allowed(req, 'customers')) return deny(res);
    const limit = Math.min(Number(url.searchParams.get('limit') || 50), 100);
    const q = String(url.searchParams.get('q') || '');
    const result = await query('SELECT id, display_name, email, phone, status, created_at, updated_at FROM customers WHERE display_name ILIKE $1 OR email ILIKE $1 ORDER BY created_at LIMIT $2', ['%' + q + '%', limit]);
    return json(res, 200, {items: result.rows.map(row => customerView(row, [], roleFrom(req))), limit});
  }
  if (parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'customers' && parts[3]) {
    const id = parts[3];
    if (!allowed(req, 'customers')) return deny(res);
    const resource = parts[4];
    if (!resource) {
      const value = await getCustomer360(id, roleFrom(req));
      return value ? json(res, 200, value) : json(res, 404, {error: {code: 'NOT_FOUND'}});
    }
    if (resource === 'orders' && req.method === 'GET') {
      if (!allowed(req, 'orders')) return deny(res);
      const result = await query('SELECT * FROM orders WHERE customer_id = $1 ORDER BY source_created_at NULLS LAST', [id]);
      return json(res, 200, {items: result.rows});
    }
    if (resource === 'timeline' && req.method === 'GET') {
      if (!allowed(req, 'timeline')) return deny(res);
      const value = await getCustomer360(id, roleFrom(req));
      return value ? json(res, 200, {items: value.timeline}) : json(res, 404, {error: {code: 'NOT_FOUND'}});
    }
    if (resource === 'cases' && req.method === 'GET') {
      if (!allowed(req, 'cases')) return deny(res);
      const result = await query('SELECT * FROM cases WHERE customer_id = $1 ORDER BY created_at', [id]);
      return json(res, 200, {items: result.rows});
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/cases') {
    if (!allowed(req, 'cases')) return deny(res);
    const result = await query('SELECT * FROM cases ORDER BY created_at DESC');
    return json(res, 200, {items: result.rows});
  }
  if (req.method === 'GET' && parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'cases' && parts[3]) {
    if (!allowed(req, 'cases')) return deny(res);
    const result = await query('SELECT * FROM cases WHERE id = $1', [parts[3]]);
    return result.rowCount ? json(res, 200, result.rows[0]) : json(res, 404, {error: {code: 'NOT_FOUND'}});
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/read-models/owner-attention') {
    if (!allowed(req, 'financial')) return deny(res);
    const result = await query("SELECT count(*) FILTER (WHERE status IN ('OPEN','IN_PROGRESS')) AS open_cases, count(*) FILTER (WHERE status = 'WAITING_APPROVAL') AS pending_approvals, count(*) FILTER (WHERE priority IN ('HIGH','URGENT') AND status NOT IN ('RESOLVED','CLOSED')) AS high_priority FROM cases");
    return json(res, 200, result.rows[0]);
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/read-models/csr-queue') {
    if (!allowed(req, 'cases')) return deny(res);
    const result = await query("SELECT c.id, c.case_type, c.priority, c.status, c.owner_scope, c.requires_human, c.created_at, cu.display_name, o.order_number FROM cases c JOIN customers cu ON cu.id = c.customer_id LEFT JOIN orders o ON o.id = c.order_id WHERE c.owner_scope = 'CSR' AND c.status NOT IN ('RESOLVED','CLOSED') ORDER BY c.priority DESC, c.created_at");
    return json(res, 200, {items: result.rows});
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/read-models/fulfillment-queue') {
    if (!allowed(req, 'fulfillment')) return deny(res);
    const result = await query("SELECT c.id, c.case_type, c.priority, c.status, c.created_at, o.order_number FROM cases c LEFT JOIN orders o ON o.id = c.order_id WHERE c.case_type IN ('MISSING_SHIPMENT','DAMAGED_PRODUCT','REORDER_REQUEST') AND c.status NOT IN ('RESOLVED','CLOSED') ORDER BY c.created_at");
    return json(res, 200, {items: result.rows});
  }
  return json(res, 404, {error: {code: 'NOT_FOUND'}});
}

function twentyDeny(res) {
  return json(res, 403, {error: {code: 'FORBIDDEN', message: 'permission denied'}});
}

function phoneValueForTwenty(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return null;
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

async function routeTwenty(req, res, adapter) {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  const role = adapter.roleFrom(req);

  if (req.method === 'GET' && url.pathname === '/api/v1/health') {
    try {
      await adapter.ping();
      return json(res, 200, {status: 'ok', service: 'chameleon-operations-api', environment: appEnv, backend: 'twenty'});
    } catch (error) {
      return json(res, 503, {status: 'degraded', backend: 'twenty', error: {code: 'TWENTY_UNAVAILABLE', message: error.message}});
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/v1/ingest/twilio') {
    if (!adapter.syntheticOnly || String(req.headers['x-chameleon-synthetic'] || '').toLowerCase() !== 'true' || String(req.headers['x-twilio-signature'] || '') !== 'synthetic-test') {
      return json(res, 403, {error: {code: 'SYNTHETIC_ONLY', message: 'development synthetic Twilio ingestion required'}});
    }
    try {
      return json(res, 200, await adapter.ingestTwilio(await body(req)));
    } catch (error) {
      return json(res, error.status || 400, {error: {code: 'INGEST_REJECTED', message: error.message}});
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/v1/customers') {
    if (!adapter.allowed(req, 'customers')) return twentyDeny(res);
    const limit = Math.min(Number(url.searchParams.get('limit') || 50), 100);
    const q = String(url.searchParams.get('q') || '').toLowerCase();
    const rows = await adapter.list('customers');
    const items = rows.filter(item => !q || String(item.name || '').toLowerCase().includes(q) || String(item.customerId || '').toLowerCase().includes(q) || String(item.email?.primaryEmail || '').toLowerCase().includes(q)).slice(0, limit).map(item => adapter.customerView(item, role));
    return json(res, 200, {items, limit});
  }

  if (parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'customers' && parts[3]) {
    const id = parts[3];
    if (!adapter.allowed(req, 'customers')) return twentyDeny(res);
    const resource = parts[4];
    if (!resource && req.method === 'GET') {
      const value = await adapter.customer360(id, role);
      return value ? json(res, 200, value) : json(res, 404, {error: {code: 'NOT_FOUND'}});
    }
    if (resource === 'orders' && req.method === 'GET') {
      if (!adapter.allowed(req, 'orders')) return twentyDeny(res);
      const items = await adapter.list('orders', {filter: `customerId[eq]:${JSON.stringify(id)}`});
      return json(res, 200, {items});
    }
    if (resource === 'timeline' && req.method === 'GET') {
      if (!adapter.allowed(req, 'timeline')) return twentyDeny(res);
      const value = await adapter.customer360(id, role);
      return value ? json(res, 200, {items: value.timeline}) : json(res, 404, {error: {code: 'NOT_FOUND'}});
    }
    if (resource === 'cases' && req.method === 'GET') {
      if (!adapter.allowed(req, 'cases')) return twentyDeny(res);
      const items = await adapter.list('cases', {filter: `customerId[eq]:${JSON.stringify(id)}`});
      return json(res, 200, {items});
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/v1/cases') {
    if (!adapter.allowed(req, 'cases')) return twentyDeny(res);
    const snapshot = await adapter.snapshot(role);
    return json(res, 200, {items: snapshot.cases});
  }

  if (req.method === 'GET' && url.pathname === '/api/v1/read-models/owner-attention') {
    if (!adapter.allowed(req, 'financial')) return twentyDeny(res);
    return json(res, 200, (await adapter.snapshot(role)).ownerAttention);
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/read-models/csr-queue') {
    if (!adapter.allowed(req, 'cases')) return twentyDeny(res);
    return json(res, 200, {items: (await adapter.snapshot(role)).csrQueue});
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/read-models/fulfillment-queue') {
    if (!adapter.allowed(req, 'fulfillment')) return twentyDeny(res);
    return json(res, 200, {items: (await adapter.snapshot(role)).fulfillmentQueue});
  }

  if (parts[0] === 'api' && parts[1] === 'v1' && parts[2] === 'cases' && parts[3]) {
    const id = parts[3];
    if (!adapter.allowed(req, 'cases')) return twentyDeny(res);
    if (req.method === 'GET' && !parts[4]) {
      const item = await adapter.get('cases', id);
      return item ? json(res, 200, item) : json(res, 404, {error: {code: 'NOT_FOUND'}});
    }
    if (req.method === 'POST' && parts[4] === 'approve-refund') {
      if (!adapter.allowed(req, 'financial', 'approve')) return twentyDeny(res);
      const item = await adapter.update('cases', id, {status: 'APPROVED_NO_EXECUTION'});
      return json(res, 200, {case: item, execution: {status: 'DISABLED', reason: 'synthetic sandbox; no refund provider configured'}});
    }
    if (req.method === 'POST' && parts[4] === 'resolve') {
      if (!adapter.allowed(req, 'cases', 'write')) return twentyDeny(res);
      const item = await adapter.update('cases', id, {status: 'RESOLVED'});
      return json(res, 200, {case: item});
    }
    if (req.method === 'POST' && parts[4] === 'fulfillment-review') {
      if (!adapter.allowed(req, 'fulfillment', 'write')) return twentyDeny(res);
      const item = await adapter.update('cases', id, {status: 'FULFILLMENT_REVIEW'});
      return json(res, 200, {case: item, execution: {status: 'DISABLED', reason: 'synthetic sandbox; no fulfillment provider configured'}});
    }
  }

  return json(res, 404, {error: {code: 'NOT_FOUND'}});
}

if (!twentyAdapter) await runMigrations();
const server = http.createServer((req, res) => (twentyAdapter ? routeTwenty(req, res, twentyAdapter) : route(req, res)).catch(error => json(res, error.status || 500, {error: {code: 'INTERNAL', message: error.message}})));
server.listen(port, '0.0.0.0', () => console.log(JSON.stringify({status: 'listening', port, environment: appEnv})));
process.on('SIGTERM', async () => { server.close(); await pool.end(); });
