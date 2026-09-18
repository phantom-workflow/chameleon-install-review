import crypto from 'node:crypto';
import { query, transaction } from './db.js';
import { normalizePhone } from './domain.js';
import { enqueueTwentyProjection } from './twenty-projection.js';
import { ingestSupportEvent } from './support-processor.js';

const DEFAULT_ORDER = 'TEST-ORDER-10001';
const DEFAULT_CUSTOMER = {name: 'Sarah Test', email: 'sarah.test@example.test', phone: '+15550100001'};

const CURATED_OPERATIONS = [
  {order: 'DEMO-OPS-001', name: 'Avery Chen', email: 'avery.chen@example.test', phone: '+15550200001', item: 'Recovery Essentials', sku: 'LAB-DEMO-RECOVERY', message: 'Where is my order? Please share the latest status.', strategy: 'AUTO_RESOLVABLE'},
  {order: 'DEMO-OPS-002', name: 'Morgan Lee', email: 'morgan.lee@example.test', phone: '+15550200002', item: 'Daily Wellness Kit', sku: 'LAB-DEMO-DAILY', message: 'What is included in my order?', strategy: 'AUTO_RESOLVABLE'},
  {order: 'DEMO-OPS-003', name: 'Riley Park', email: 'riley.park@example.test', phone: '+15550200003', item: 'Travel Wellness Pack', sku: 'LAB-DEMO-TRAVEL', message: 'Can you confirm the status of this order?', strategy: 'AUTO_RESOLVABLE'},
  {order: 'DEMO-OPS-004', name: 'Jamie Ortiz', email: 'jamie.ortiz@example.test', phone: '+15550200004', item: 'Recovery Essentials', sku: 'LAB-DEMO-RECOVERY', message: 'I need to update the delivery address.', strategy: 'DIRECT_CSR'},
  {order: 'DEMO-OPS-005', name: 'Quinn Baker', email: 'quinn.baker@example.test', phone: '+15550200005', item: 'Daily Wellness Kit', sku: 'LAB-DEMO-DAILY', message: 'The shipment is late and I need help.', strategy: 'DIRECT_CSR'},
  {order: 'DEMO-OPS-006', name: 'Casey Nguyen', email: 'casey.nguyen@example.test', phone: '+15550200006', item: 'Education Support Kit', sku: 'LAB-DEMO-EDU', message: 'Please review this order and help me.', strategy: 'AI_TRIAGE_TO_CSR'},
  {order: 'DEMO-OPS-007', name: 'Drew Wilson', email: 'drew.wilson@example.test', phone: '+15550200007', item: 'Travel Wellness Pack', sku: 'LAB-DEMO-TRAVEL', message: 'I have a question about a refund for this order.', strategy: 'DIRECT_CSR'},
  {order: 'DEMO-OPS-008', name: 'Taylor Brooks', email: 'taylor.brooks@example.test', phone: '+15550200008', item: 'Recovery Essentials', sku: 'LAB-DEMO-RECOVERY', message: 'One item arrived damaged and I need a replacement.', strategy: 'CSR_TO_APPROVAL'},
  {order: 'DEMO-OPS-009', name: 'Jordan Davis', email: 'jordan.davis@example.test', phone: '+15550200009', item: 'Education Support Kit', sku: 'LAB-DEMO-EDU', message: 'Please review a safety question about this order.', strategy: 'OWNER_APPROVAL'},
  {order: 'DEMO-OPS-010', name: 'Alex Rivera', email: 'alex.rivera@example.test', phone: '+15550200010', item: 'Daily Wellness Kit', sku: 'LAB-DEMO-DAILY', message: 'The shipment has not arrived yet.', strategy: 'DIRECT_CSR'}
];

function syntheticGuard(req, appEnv) {
  if (appEnv === 'production' || String(req.headers['x-chameleon-synthetic'] || '').toLowerCase() !== 'true') {
    throw Object.assign(new Error('synthetic demo endpoints require the lab marker'), {status: 403});
  }
}

function safeText(value, fallback, max = 240) {
  const text = String(value ?? fallback ?? '').trim();
  return text.slice(0, max);
}

function normalizeOrderNumber(value) {
  const candidate = safeText(value, DEFAULT_ORDER, 64).toUpperCase();
  return /^(?:TEST|DEMO)-[A-Z0-9-]{1,55}$/.test(candidate) ? candidate : DEFAULT_ORDER;
}

function hashId(value) {
  const hex = crypto.createHash('sha256').update(value).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

async function audit(client, action, resourceType, resourceId, after, correlationId) {
  await client.query(`INSERT INTO audit_records(id, actor_type, actor_id, actor_role, action, resource_type, resource_id, policy_decision, before_summary, after_summary, correlation_id, created_at)
    VALUES ($1,'SYSTEM','synthetic-demo','SYNTHETIC',$2,$3,$4,'ALLOW_SYNTHETIC_ONLY','{}'::jsonb,$5,$6,now())`, [crypto.randomUUID(), action, resourceType, resourceId, after, correlationId || null]);
}

function customerReferenceId(input) {
  const customerInput = {...DEFAULT_CUSTOMER, ...(input || {})};
  const email = safeText(customerInput.email, DEFAULT_CUSTOMER.email, 180).toLowerCase();
  return {id: hashId(`synthetic-demo:${email}`), input: customerInput, email, phone: normalizePhone(customerInput.phone || DEFAULT_CUSTOMER.phone)};
}

function address(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    first_name: safeText(source.first_name, '', 80), last_name: safeText(source.last_name, '', 80),
    address_1: safeText(source.address_1, '1 Synthetic Way', 160), address_2: safeText(source.address_2, '', 160),
    city: safeText(source.city, 'Labville', 80), state: safeText(source.state, 'CA', 40),
    postcode: safeText(source.postcode, '90000', 20), country: safeText(source.country, 'US', 4).toUpperCase()
  };
}

async function ensureCustomerReference(client, customer, now) {
  await client.query(`INSERT INTO customer_references(id, source, external_customer_id, display_name_safe, environment, provenance, observed_at)
    VALUES ($1,'woocommerce-synthetic',$2,$3,'staging',$4,$5)
    ON CONFLICT (source, external_customer_id) DO UPDATE SET display_name_safe=EXCLUDED.display_name_safe, provenance=EXCLUDED.provenance, observed_at=EXCLUDED.observed_at`, [customer.id, customer.email, safeText(customer.input.name, DEFAULT_CUSTOMER.name), {source_system: 'woocommerce-synthetic', scenario: 'synthetic-demo', email: customer.email, phone: customer.phone, execution: 'NO_EXECUTION'}, now]);
}

async function checkout(req, input, {appEnv}) {
  syntheticGuard(req, appEnv);
  const orderNumber = normalizeOrderNumber(input.order_number);
  const items = Array.isArray(input.items) && input.items.length ? input.items : [{sku: 'SYN-VIAL-01', name: 'Synthetic Peptide Vial', quantity: 2, unit_price: 42}];
  const customer = customerReferenceId(input.customer || {});
  const billingAddress = address(input.billing_address || input.customer?.billing_address);
  const shippingAddress = address(input.shipping_address || input.customer?.shipping_address || billingAddress);
  const total = items.reduce((sum, item) => sum + Math.max(1, Number(item.quantity || 1)) * Math.max(0, Number(item.unit_price || 0)), 0);
  const now = new Date();
  return transaction(async client => {
    const prior = await client.query(`SELECT * FROM order_references WHERE source='woocommerce-synthetic' AND order_number=$1 LIMIT 1`, [orderNumber]);
    if (prior.rowCount) {
      if (prior.rows[0].customer_reference_id !== customer.id) throw Object.assign(new Error('synthetic order is owned by another customer'), {status: 409});
      return {status: 'replay', duplicate: true, synthetic: true, order: prior.rows[0], customer_reference_id: customer.id, execution: 'NO_EXECUTION'};
    }
    await ensureCustomerReference(client, customer, now);
    const orderId = crypto.randomUUID();
    await client.query(`INSERT INTO order_references(
      id, source, external_order_id, order_number, customer_reference_id, fulfillment_status, amount, currency,
      payment_method, payment_method_title, order_status, billing_address, shipping_address, same_as_billing,
      fulfillment_state, tracking, refund_state, refund_total, refunds, source_created_at, source_updated_at, provenance, observed_at
    ) VALUES ($1,'woocommerce-synthetic',$2,$3,$4,'PROCESSING',$5,'USD','synthetic','Synthetic payment (no charge)','processing',$6,$7,$8,'PROCESSING',$9,'NONE',0,'[]'::jsonb,$10,$10,$11,$10)`, [orderId, `woo-${orderNumber}`, orderNumber, customer.id, total, billingAddress, shippingAddress, JSON.stringify(billingAddress) === JSON.stringify(shippingAddress), {carrier: 'SYNTHETIC-CARRIER', reference: `SYNTH-TRACK-${orderNumber.slice(-5)}`}, now, {connector_contract: 'woocommerce', synthetic: true, payment: 'NO_PAYMENT', execution: 'NO_EXECUTION'}]);
    await enqueueTwentyProjection(client, {entityType: 'customer', entityId: customer.id, source: 'woocommerce-synthetic', sourceEventId: `customer:${customer.email}`, payload: {scenario: 'synthetic-demo'}});
    await enqueueTwentyProjection(client, {entityType: 'order', entityId: orderId, source: 'woocommerce-synthetic', sourceEventId: `checkout:${orderNumber}`, payload: {scenario: 'synthetic-demo'}});
    for (const [index, item] of items.entries()) {
      const quantity = Math.max(1, Number(item.quantity || 1));
      const unitPrice = Math.max(0, Number(item.unit_price || 0));
      await client.query(`INSERT INTO demo_order_line_items(id, order_id, source_line_item_id, sku, product_name, quantity, unit_price, line_total, active, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9)`, [crypto.randomUUID(), orderId, `SYN-${index + 1}`, safeText(item.sku, 'SYN-ITEM', 64), safeText(item.name, 'Synthetic item', 160), quantity, unitPrice, quantity * unitPrice, now]);
    }
    await client.query(`INSERT INTO fulfillment_references(id, order_id, status, carrier, tracking_reference, occurred_at, provenance) VALUES ($1,$2,'PROCESSING','SYNTHETIC-CARRIER',$3,$4,$5)`, [crypto.randomUUID(), orderId, `SYNTH-TRACK-${orderNumber.slice(-5)}`, now, {synthetic: true, external_call: 'BLOCKED'}]);
    await client.query(`INSERT INTO operational_events(id, customer_id, order_id, event_type, source, source_id, actor_type, occurred_at, ingested_at, provenance, correlation_id)
      VALUES ($1,$2,$3,'ORDER_CREATED','woocommerce-synthetic',$4,'CUSTOMER',$5,$5,$6,$4)`, [crypto.randomUUID(), customer.id, orderId, orderNumber, now, {synthetic: true, payment: 'NO_PAYMENT', execution: 'NO_EXECUTION'}]);
    await audit(client, 'SYNTHETIC_CHECKOUT_ACCEPTED', 'order', orderId, {order_number: orderNumber, customer_reference_id: customer.id, payment: 'NO_PAYMENT', execution: 'NO_EXECUTION'}, orderNumber);
    return {status: 'accepted', duplicate: false, synthetic: true, customer_reference_id: customer.id, order: {id: orderId, order_number: orderNumber}, execution: 'NO_EXECUTION'};
  });
}

async function fulfillment(req, input, {appEnv}) {
  syntheticGuard(req, appEnv);
  const orderNumber = normalizeOrderNumber(input.order_number);
  const status = String(input.status || '').toUpperCase();
  if (!['PICKED','SHIPPED','IN_TRANSIT','DELIVERED'].includes(status)) throw Object.assign(new Error('invalid synthetic fulfillment status'), {status: 400});
  return transaction(async client => {
    const order = await client.query(`SELECT * FROM order_references WHERE order_number=$1 AND source='woocommerce-synthetic'`, [orderNumber]);
    if (!order.rowCount) throw Object.assign(new Error('synthetic order not found'), {status: 404});
    const current = await client.query('SELECT * FROM fulfillment_references WHERE order_id=$1 AND status=$2', [order.rows[0].id, status]);
    if (current.rowCount) return {status: 'replay', duplicate: true, fulfillment: current.rows[0], execution: 'NO_EXECUTION'};
    const now = new Date();
    const tracking = `SYNTH-TRACK-${orderNumber.slice(-5)}`;
    const created = await client.query(`INSERT INTO fulfillment_references(id, order_id, status, carrier, tracking_reference, occurred_at, provenance) VALUES ($1,$2,$3,'SYNTHETIC-CARRIER',$4,$5,$6) RETURNING *`, [crypto.randomUUID(), order.rows[0].id, status, tracking, now, {synthetic: true, provider_calls: 'BLOCKED'}]);
    await client.query(`UPDATE order_references SET fulfillment_status=$1::text, fulfillment_state=$1::text, tracking=jsonb_build_array(jsonb_build_object('tracking_number',$2::text,'carrier','SYNTHETIC-CARRIER','status',$1::text,'updated_at',$3::timestamptz)), observed_at=$3::timestamptz, source_updated_at=$3::timestamptz WHERE id=$4::uuid`, [status, tracking, now, order.rows[0].id]);
    await client.query(`INSERT INTO operational_events(id, customer_id, order_id, event_type, source, source_id, actor_type, occurred_at, ingested_at, provenance, correlation_id) VALUES ($1,$2,$3,$4,'woocommerce-synthetic',$5,'SYSTEM',$6,$6,$7,$5)`, [crypto.randomUUID(), order.rows[0].customer_reference_id, order.rows[0].id, `ORDER_${status}`, orderNumber, now, {synthetic: true, execution: 'NO_EXECUTION'}]);
    await audit(client, 'SYNTHETIC_FULFILLMENT_RECORDED', 'order', order.rows[0].id, {status, carrier: 'SYNTHETIC-CARRIER', execution: 'NO_EXECUTION'}, orderNumber);
    return {status: 'accepted', duplicate: false, fulfillment: created.rows[0], execution: 'NO_EXECUTION'};
  });
}

async function callRecord(req, input, {appEnv}) {
  syntheticGuard(req, appEnv);
  const orderNumber = normalizeOrderNumber(input.order_number);
  const externalId = safeText(input.call_id, `demo-call-${orderNumber}`, 120);
  const summary = safeText(input.summary, 'Synthetic inbound call: customer asked for order status.', 240);
  return transaction(async client => {
    const order = await client.query(`SELECT * FROM order_references WHERE order_number=$1 AND source='woocommerce-synthetic'`, [orderNumber]);
    if (!order.rowCount) throw Object.assign(new Error('synthetic order not found'), {status: 404});
    const prior = await client.query('SELECT * FROM call_references WHERE external_call_id=$1', [externalId]);
    if (prior.rowCount) return {status: 'replay', duplicate: true, call: prior.rows[0], execution: 'NO_EXECUTION'};
    const now = new Date();
    const created = await client.query(`INSERT INTO call_references(id, customer_reference_id, order_id, external_call_id, direction, summary, occurred_at, provenance) VALUES ($1,$2,$3,$4,'INBOUND',$5,$6,$7) RETURNING *`, [crypto.randomUUID(), order.rows[0].customer_reference_id, order.rows[0].id, externalId, summary, now, {source: 'synthetic-call-log'}]);
    await client.query(`INSERT INTO operational_events(id, customer_id, order_id, event_type, source, source_id, actor_type, occurred_at, ingested_at, provenance) VALUES ($1,$2,$3,'PHONE_CALL_RECORDED','synthetic-call-log',$4,'CUSTOMER',$5,$5,$6)`, [crypto.randomUUID(), order.rows[0].customer_reference_id, order.rows[0].id, externalId, now, {synthetic: true, execution: 'NO_EXECUTION'}]);
    await audit(client, 'SYNTHETIC_CALL_RECORDED', 'call', created.rows[0].id, {channel: 'PHONE', execution: 'NO_EXECUTION'}, externalId);
    return {status: 'accepted', duplicate: false, call: created.rows[0], execution: 'NO_EXECUTION'};
  });
}

async function chatMessage(req, input, {appEnv}) {
  syntheticGuard(req, appEnv);
  const orderNumber = normalizeOrderNumber(input.order_number);
  const externalId = safeText(input.message_id, `demo-chat-${crypto.randomUUID()}`, 120);
  const body = safeText(input.body, 'I need help with this order.', 500);
  const direction = String(input.direction || 'INBOUND').toUpperCase() === 'OUTBOUND' ? 'OUTBOUND' : 'INBOUND';
  const order = await query(`SELECT * FROM order_references WHERE order_number=$1 AND source='woocommerce-synthetic'`, [orderNumber]);
  if (!order.rowCount) throw Object.assign(new Error('synthetic order not found'), {status: 404});
  const support = await ingestSupportEvent({adapter: null, input: {
    source: 'synthetic', source_event_id: externalId, channel: 'chat', customer_reference_id: order.rows[0].customer_reference_id, order_source: 'woocommerce-synthetic',
    order_reference: orderNumber, message: body, routing_strategy: input.routing_strategy, sender: {external_participant_id: `lab-customer:${order.rows[0].customer_reference_id}`},
    metadata: {demo: true, case_number: safeText(input.case_number, `CASE-DEMO-${orderNumber}`, 120), transport: 'lab-storefront'}
  }});
  const message = await transaction(async client => {
    const prior = await client.query('SELECT * FROM chat_messages WHERE external_message_id=$1', [externalId]);
    if (prior.rowCount) return prior.rows[0];
    const now = new Date();
    const created = await client.query(`INSERT INTO chat_messages(id, customer_reference_id, order_id, external_message_id, direction, body, occurred_at, provenance) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [hashId('chat:' + externalId), order.rows[0].customer_reference_id, order.rows[0].id, externalId, direction, body, now, {source: 'synthetic-storefront-chat', adapter: 'normalized-support-ingestion', execution: 'NO_EXECUTION'}]);
    await audit(client, 'SYNTHETIC_CHAT_RECORDED', 'chat_message', created.rows[0].id, {direction, execution: 'NO_EXECUTION'}, externalId);
    return created.rows[0];
  });
  let simulatedAgentResponse = null;
  if (!support.duplicate && direction === 'INBOUND' && support.routing?.strategy === 'AUTO_RESOLVABLE' && support.customer_response) {
    const agentMessageId = `${externalId}-kai`;
    simulatedAgentResponse = await transaction(async client => {
      const prior = await client.query('SELECT * FROM chat_messages WHERE external_message_id=$1', [agentMessageId]);
      if (prior.rowCount) return prior.rows[0];
      const now = new Date();
      const response = await client.query(`INSERT INTO chat_messages(id, customer_reference_id, order_id, external_message_id, direction, body, occurred_at, provenance)
        VALUES ($1,$2,$3,$4,'OUTBOUND',$5,$6,$7) RETURNING *`, [hashId('chat:' + agentMessageId), order.rows[0].customer_reference_id, order.rows[0].id, agentMessageId, support.customer_response, now, {source: 'synthetic-storefront-chat', adapter: 'simulated-kai-agent', agent: 'Kai — Simulated LAB Agent', simulated: true, context_source: 'woocommerce-synthetic', execution: 'NO_EXECUTION'}]);
      await audit(client, 'SIMULATED_AGENT_RESPONSE_RECORDED', 'chat_message', response.rows[0].id, {agent: 'Kai — Simulated LAB Agent', source: 'woocommerce-synthetic', execution: 'NO_EXECUTION'}, externalId);
      return response.rows[0];
    });
  }
  return {...support, message, simulated_agent_response: simulatedAgentResponse, execution: 'NO_EXECUTION'};
}

async function damagedCase(req, input, {appEnv}) {
  syntheticGuard(req, appEnv);
  const orderNumber = normalizeOrderNumber(input.order_number);
  const message = safeText(input.message, 'One synthetic vial arrived damaged.', 240);
  const order = await query(`SELECT customer_reference_id FROM order_references WHERE order_number=$1 AND source='woocommerce-synthetic'`, [orderNumber]);
  if (!order.rowCount) throw Object.assign(new Error('synthetic order not found'), {status: 404});
  const result = await ingestSupportEvent({adapter: null, input: {
    source: 'synthetic', source_event_id: safeText(input.message_id, `${orderNumber}-customer-message`, 120), channel: 'chat', customer_reference_id: order.rows[0].customer_reference_id, order_source: 'woocommerce-synthetic',
    order_reference: orderNumber, message, routing_strategy: input.routing_strategy, sender: {external_participant_id: `lab-customer:${order.rows[0].customer_reference_id}`},
    metadata: {demo: true, case_number: safeText(input.case_number, `CASE-DEMO-${orderNumber}`, 120), transport: 'lab-storefront'}
  }});
  return {...result, status: result.status === 'replay' ? 'accepted' : result.status, execution: 'NO_EXECUTION'};
}

async function csrClaim(req, input, {appEnv}) {
  syntheticGuard(req, appEnv);
  const orderNumber = normalizeOrderNumber(input.order_number);
  return transaction(async client => {
    const result = await client.query(`SELECT c.* FROM cases c JOIN order_references o ON o.id=c.order_id
      WHERE o.order_number=$1 AND o.source='woocommerce-synthetic' ORDER BY c.created_at DESC LIMIT 1 FOR UPDATE`, [orderNumber]);
    if (!result.rowCount) throw Object.assign(new Error('synthetic case not found'), {status: 404});
    const item = result.rows[0];
    if (item.owner_approval_required || item.status === 'WAITING_APPROVAL') throw Object.assign(new Error('owner approval cases cannot be claimed by CSR'), {status: 409});
    const active = await client.query('SELECT * FROM assignments WHERE case_id=$1 AND released_at IS NULL ORDER BY assigned_at DESC LIMIT 1', [item.id]);
    if (active.rows[0]?.assignee_name === 'CSR Lab') return {status: 'replay', duplicate: true, case_id: item.id, assignment: active.rows[0], execution: 'NO_EXECUTION'};
    const now = new Date();
    await client.query('UPDATE assignments SET released_at=$1 WHERE case_id=$2 AND released_at IS NULL', [now, item.id]);
    const assignment = await client.query(`INSERT INTO assignments(id, case_id, queue_name, assignee_name, assigned_at, reason)
      VALUES ($1,$2,'CSR','CSR Lab',$3,'LAB operator claimed the case for review.') RETURNING *`, [crypto.randomUUID(), item.id, now]);
    await client.query('UPDATE cases SET assigned_at=$1, updated_at=$1, csr_handled=true WHERE id=$2', [now, item.id]);
    await client.query(`INSERT INTO case_events(id, case_id, event_type, summary, actor_type, occurred_at, created_at)
      VALUES ($1,$2,'CASE_CLAIMED','CSR Lab claimed this case for LAB review.','CSR',$3,$3)`, [crypto.randomUUID(), item.id, now]);
    await client.query(`INSERT INTO operational_events(id, case_id, event_type, source, source_id, actor_type, occurred_at, ingested_at, provenance)
      VALUES ($1,$2,'CASE_CLAIMED','chameleon-operations',$3,'CSR',$4,$4,$5)`, [crypto.randomUUID(), item.id, item.id, now, {actor: 'CSR Lab', execution: 'NO_EXECUTION'}]);
    await audit(client, 'LAB_CSR_CASE_CLAIMED', 'case', item.id, {assignee: 'CSR Lab', execution: 'NO_EXECUTION'}, item.id);
    return {status: 'accepted', duplicate: false, case_id: item.id, assignment: assignment.rows[0], execution: 'NO_EXECUTION'};
  });
}

async function csrResolve(req, input, {appEnv}) {
  syntheticGuard(req, appEnv);
  const orderNumber = normalizeOrderNumber(input.order_number);
  return transaction(async client => {
    const result = await client.query(`SELECT c.* FROM cases c JOIN order_references o ON o.id=c.order_id
      WHERE o.order_number=$1 AND o.source='woocommerce-synthetic' ORDER BY c.created_at DESC LIMIT 1 FOR UPDATE`, [orderNumber]);
    if (!result.rowCount) throw Object.assign(new Error('synthetic case not found'), {status: 404});
    const item = result.rows[0];
    if (item.owner_approval_required || item.status === 'WAITING_APPROVAL') throw Object.assign(new Error('owner approval cases require the owner decision lane'), {status: 409});
    if (item.status === 'RESOLVED') return {status: 'replay', duplicate: true, case_id: item.id, case_status: item.status, execution: 'NO_EXECUTION'};
    const now = new Date();
    const updated = await client.query(`UPDATE cases SET status='RESOLVED', resolved_at=$1, updated_at=$1,
      final_resolution_path='CSR_RESOLVED', csr_handled=true WHERE id=$2 RETURNING *`, [now, item.id]);
    await client.query(`INSERT INTO case_events(id, case_id, event_type, summary, actor_type, occurred_at, created_at)
      VALUES ($1,$2,'CASE_RESOLVED','CSR Lab recorded a LAB-only resolution; no provider action occurred.','CSR',$3,$3)`, [crypto.randomUUID(), item.id, now]);
    await client.query(`INSERT INTO operational_events(id, case_id, event_type, source, source_id, actor_type, occurred_at, ingested_at, provenance)
      VALUES ($1,$2,'CASE_RESOLVED','chameleon-operations',$3,'CSR',$4,$4,$5)`, [crypto.randomUUID(), item.id, item.id, now, {actor: 'CSR Lab', execution: 'NO_EXECUTION'}]);
    await audit(client, 'LAB_CSR_CASE_RESOLVED', 'case', item.id, {resolution: safeText(input.resolution, 'LAB-only CSR resolution recorded.', 240), execution: 'NO_EXECUTION'}, item.id);
    const projection = await enqueueTwentyProjection(client, {entityType: 'case', entityId: item.id, source: 'chameleon-operations', sourceEventId: `csr-resolve:${item.id}`, payload: {resolution: 'CSR_RESOLVED'}});
    return {status: 'accepted', duplicate: false, case_id: item.id, case_status: updated.rows[0].status, projection_status: projection.status, execution: 'NO_EXECUTION'};
  });
}

async function processorConfirmation(req, input, {appEnv}) {
  syntheticGuard(req, appEnv);
  const orderNumber = normalizeOrderNumber(input.order_number);
  const externalId = safeText(input.event_id, `demo-processor-${orderNumber}`, 120);
  return transaction(async client => {
    const order = await client.query(`SELECT * FROM order_references WHERE order_number=$1 AND source='woocommerce-synthetic'`, [orderNumber]);
    if (!order.rowCount) throw Object.assign(new Error('synthetic order not found'), {status: 404});
    const prior = await client.query('SELECT * FROM processor_events WHERE external_event_id=$1', [externalId]);
    if (prior.rowCount) return {status: 'replay', duplicate: true, processor_event: prior.rows[0], execution: 'NO_EXECUTION'};
    const now = new Date();
    const event = await client.query(`INSERT INTO processor_events(id, order_id, external_event_id, status, summary, occurred_at, provenance) VALUES ($1,$2,$3,'SIMULATED_ONLY','Synthetic processor confirmation; no payment was made.', $4,$5) RETURNING *`, [crypto.randomUUID(), order.rows[0].id, externalId, now, {synthetic: true, payment: 'NO_PAYMENT', provider_call: 'BLOCKED'}]);
    await audit(client, 'SYNTHETIC_PROCESSOR_EVENT_RECORDED', 'processor_event', event.rows[0].id, {status: 'SIMULATED_ONLY', execution: 'NO_EXECUTION'}, externalId);
    return {status: 'accepted', duplicate: false, processor_event: event.rows[0], execution: 'NO_EXECUTION'};
  });
}
async function reset(req, input, {appEnv}) {
  syntheticGuard(req, appEnv);
  const demoOrderNumber = normalizeOrderNumber(input.order_number);
  return transaction(async client => {
    const order = await client.query(`SELECT id FROM order_references WHERE order_number=$1 AND source='woocommerce-synthetic'`, [demoOrderNumber]);
    if (!order.rowCount) return {status: 'reset', duplicate: true, order_number: demoOrderNumber, removed: {}, execution: 'NO_EXECUTION'};
    const orderId = order.rows[0].id;
    await client.query(`DELETE FROM twenty_projection_jobs WHERE (entity_type='customer' AND entity_id=(SELECT customer_reference_id FROM order_references WHERE id=$1)) OR (entity_type='order' AND entity_id=$1) OR (entity_type='case' AND entity_id IN (SELECT id FROM cases WHERE order_id=$1)) OR (entity_type='communication' AND entity_id IN (SELECT id FROM communication_references WHERE external_message_id IN (SELECT external_message_id FROM chat_messages WHERE order_id=$1 UNION SELECT source_event_id FROM support_events WHERE order_reference_id=$1)))`, [orderId]);
    const supportCommunications = await client.query("DELETE FROM communication_references WHERE source='synthetic' AND external_message_id IN (SELECT source_event_id FROM support_events WHERE order_reference_id=$1) RETURNING id", [orderId]);
    const supportEvents = await client.query('DELETE FROM support_events WHERE order_reference_id=$1 RETURNING id', [orderId]);
    const audit = await client.query(`DELETE FROM audit_records
      WHERE resource_id=$1::text OR correlation_id=$2
         OR resource_id IN (SELECT id::text FROM call_references WHERE order_id=$3::uuid)
         OR resource_id IN (SELECT id::text FROM chat_messages WHERE order_id=$3::uuid)
         OR resource_id IN (SELECT id::text FROM cases WHERE order_id=$3::uuid)
         OR resource_id IN (SELECT id::text FROM processor_events WHERE order_id=$3::uuid)
      RETURNING id`, [orderId, demoOrderNumber, orderId]);
    const events = await client.query('DELETE FROM operational_events WHERE order_id=$1 RETURNING id', [orderId]);
    const approvals = await client.query('DELETE FROM approvals WHERE case_id IN (SELECT id FROM cases WHERE order_id=$1) RETURNING id', [orderId]);
    const assignments = await client.query('DELETE FROM assignments WHERE case_id IN (SELECT id FROM cases WHERE order_id=$1) RETURNING id', [orderId]);
    await client.query('UPDATE communication_references SET case_id=NULL WHERE case_id IN (SELECT id FROM cases WHERE order_id=$1)', [orderId]);
    const removedCases = await client.query('DELETE FROM cases WHERE order_id=$1 RETURNING id', [orderId]);
    const communications = await client.query(`DELETE FROM communication_references
      WHERE source='synthetic-storefront' AND external_message_id IN (SELECT external_message_id FROM chat_messages WHERE order_id=$1)
      RETURNING id`, [orderId]);
    const chat = await client.query('DELETE FROM chat_messages WHERE order_id=$1 RETURNING id', [orderId]);
    const calls = await client.query('DELETE FROM call_references WHERE order_id=$1 RETURNING id', [orderId]);
    const processor = await client.query('DELETE FROM processor_events WHERE order_id=$1 RETURNING id', [orderId]);
    const fulfillment = await client.query('DELETE FROM fulfillment_references WHERE order_id=$1 RETURNING id', [orderId]);
    const items = await client.query('DELETE FROM demo_order_line_items WHERE order_id=$1 RETURNING id', [orderId]);
    await client.query('DELETE FROM order_references WHERE id=$1', [orderId]);
    return {status: 'reset', duplicate: false, order_number: demoOrderNumber, removed: {
      order: 1, items: items.rowCount, fulfillment: fulfillment.rowCount, calls: calls.rowCount,
      chat: chat.rowCount, communications: communications.rowCount, cases: removedCases.rowCount,
      approvals: approvals.rowCount, assignments: assignments.rowCount, events: events.rowCount,
      audit: audit.rowCount, processor_events: processor.rowCount, support_events: supportEvents.rowCount, normalized_communications: supportCommunications.rowCount
    }, execution: 'NO_EXECUTION'};
  });
}

async function resetJobHealth(req, input, {appEnv}) {
  syntheticGuard(req, appEnv);
  const now = Date.now();
  const fixture = [
    ['twilio-ingestion', 0, 'UP'],
    ['customer-reference-sync', 90, 'LATE'],
    ['approval-reconciler', 180, 'DOWN']
  ];
  return transaction(async client => {
    for (const [jobName, ageSeconds, expectedState] of fixture) {
      await client.query(`INSERT INTO job_health(id, job_name, expected_cadence_seconds, last_seen_at, evidence, updated_at)
        VALUES ($1,$2,60,$3,$4,$5)
        ON CONFLICT (job_name) DO UPDATE SET expected_cadence_seconds=EXCLUDED.expected_cadence_seconds,
          last_seen_at=EXCLUDED.last_seen_at, evidence=EXCLUDED.evidence, updated_at=EXCLUDED.updated_at`, [
        crypto.randomUUID(), jobName, new Date(now - ageSeconds * 1000),
        {source: 'synthetic-test-fixture', fixture: 'customer-ops-v2-regression', expected_state: expectedState}, new Date(now)
      ]);
    }
    return {
      status: 'reset',
      fixture: 'customer-ops-v2-regression',
      states: Object.fromEntries(fixture.map(([, , expectedState]) => [expectedState, true])),
      synthetic: true,
      execution: 'NO_EXECUTION'
    };
  });
}

async function curatedOperations(req, input, {appEnv}) {
  syntheticGuard(req, appEnv);
  const shouldReset = input.reset === true;
  if (shouldReset) {
    for (const scenario of CURATED_OPERATIONS) await reset(req, {order_number: scenario.order}, {appEnv});
  }
  for (const scenario of CURATED_OPERATIONS) {
    await checkout(req, {
      order_number: scenario.order,
      customer: {name: scenario.name, email: scenario.email, phone: scenario.phone},
      billing_address: {address_1: '100 Market Way', city: 'Northstar', state: 'NV', postcode: '99999', country: 'US'},
      shipping_address: {address_1: '100 Market Way', city: 'Northstar', state: 'NV', postcode: '99999', country: 'US'},
      items: [{sku: scenario.sku, name: scenario.item, quantity: 1, unit_price: 42}]
    }, {appEnv});
    for (const status of ['PICKED', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED']) await fulfillment(req, {order_number: scenario.order, status}, {appEnv});
    await chatMessage(req, {order_number: scenario.order, message_id: `${scenario.order}-support-001`, case_number: `CASE-${scenario.order}`, routing_strategy: scenario.strategy, body: scenario.message}, {appEnv});
  }
  const [orders, cases, approvals] = await Promise.all([
    query("SELECT count(*)::int AS count FROM order_references WHERE source='woocommerce-synthetic' AND order_number LIKE 'DEMO-OPS-%'"),
    query("SELECT c.status, count(*)::int AS count FROM cases c JOIN order_references o ON o.id=c.order_id WHERE o.order_number LIKE 'DEMO-OPS-%' GROUP BY c.status ORDER BY c.status"),
    query("SELECT count(*)::int AS count FROM approvals a JOIN cases c ON c.id=a.case_id JOIN order_references o ON o.id=c.order_id WHERE o.order_number LIKE 'DEMO-OPS-%' AND a.status='PENDING'")
  ]);
  return {
    status: 'accepted', reset: shouldReset, replay_safe: true, dataset: 'curated-operations-v1',
    counts: {orders: orders.rows[0]?.count || 0, cases: cases.rows.reduce((sum, item) => sum + Number(item.count || 0), 0), pendingApprovals: approvals.rows[0]?.count || 0, byStatus: Object.fromEntries(cases.rows.map(item => [item.status, Number(item.count || 0)]))},
    orders: CURATED_OPERATIONS.map(({order, name, strategy}) => ({order, customer: name, strategy})),
    synthetic: true, execution: 'NO_EXECUTION'
  };
}


async function state(input) {
  const demoOrderNumber = normalizeOrderNumber(input.order_number);
  const order = await query(`SELECT o.*, cr.display_name_safe AS customer_name FROM order_references o JOIN customer_references cr ON cr.id=o.customer_reference_id WHERE o.order_number=$1 AND o.source='woocommerce-synthetic'`, [demoOrderNumber]);
  if (!order.rowCount) return {order: null, order_number: demoOrderNumber, synthetic: true, execution: 'NO_EXECUTION'};
  const orderId = order.rows[0].id;
  const [items, fulfillment, calls, chat, processor, cases, events, auditRows] = await Promise.all([
    query('SELECT * FROM demo_order_line_items WHERE order_id=$1 ORDER BY created_at', [orderId]), query('SELECT * FROM fulfillment_references WHERE order_id=$1 ORDER BY occurred_at', [orderId]), query('SELECT * FROM call_references WHERE order_id=$1 ORDER BY occurred_at', [orderId]), query('SELECT * FROM chat_messages WHERE order_id=$1 ORDER BY occurred_at', [orderId]), query('SELECT * FROM processor_events WHERE order_id=$1 ORDER BY occurred_at', [orderId]), query('SELECT * FROM cases WHERE order_id=$1 ORDER BY created_at', [orderId]), query('SELECT * FROM operational_events WHERE order_id=$1 ORDER BY occurred_at', [orderId]), query("SELECT * FROM audit_records WHERE resource_id=$1::text OR correlation_id=$2 OR resource_id IN (SELECT id::text FROM call_references WHERE order_id=$3::uuid) OR resource_id IN (SELECT id::text FROM chat_messages WHERE order_id=$3::uuid) OR resource_id IN (SELECT id::text FROM cases WHERE order_id=$3::uuid) OR resource_id IN (SELECT id::text FROM processor_events WHERE order_id=$3::uuid) OR correlation_id IN (SELECT external_call_id FROM call_references WHERE order_id=$3::uuid) OR correlation_id IN (SELECT external_message_id FROM chat_messages WHERE order_id=$3::uuid) OR correlation_id IN (SELECT external_event_id FROM processor_events WHERE order_id=$3::uuid) ORDER BY created_at", [orderId, demoOrderNumber, orderId])
  ]);
  return {order: order.rows[0], items: items.rows, fulfillment: fulfillment.rows, calls: calls.rows, chat: chat.rows, processor_events: processor.rows, cases: cases.rows, events: events.rows, audit: auditRows.rows, synthetic: true, execution: 'NO_EXECUTION'};
}

export function createSyntheticDemo({adapter, appEnv}) {
  return {checkout: (req, input) => checkout(req, input, {appEnv}), fulfillment: (req, input) => fulfillment(req, input, {appEnv}), callRecord: (req, input) => callRecord(req, input, {appEnv}), chatMessage: (req, input) => chatMessage(req, input, {appEnv}), damagedCase: (req, input) => damagedCase(req, input, {appEnv}), csrClaim: (req, input) => csrClaim(req, input, {appEnv}), csrResolve: (req, input) => csrResolve(req, input, {appEnv}), processorConfirmation: (req, input) => processorConfirmation(req, input, {appEnv}), reset: (req, input) => reset(req, input, {appEnv}), resetJobHealth: (req, input) => resetJobHealth(req, input, {appEnv}), curatedOperations: (req, input) => curatedOperations(req, input, {appEnv}), state};
}
