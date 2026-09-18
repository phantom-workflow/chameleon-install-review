import crypto from 'node:crypto';
import { transaction } from './db.js';
import { enqueueTwentyProjection } from './twenty-projection.js';

export const SOURCE = 'woocommerce-checkout-candidate';

function text(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function uuidFor(scope, value) {
  const hex = crypto.createHash('sha256').update(`${scope}:${value}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

function hashSnapshot(value) {
  return crypto.createHash('sha256').update(stable(value)).digest('hex');
}

function asDate(value, fallback = new Date()) {
  const parsed = value ? new Date(value) : fallback;
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function safeAddress(value = {}) {
  return {
    first_name: text(value.first_name),
    last_name: text(value.last_name),
    address_1: text(value.address_1),
    address_2: text(value.address_2),
    city: text(value.city),
    state: text(value.state),
    postcode: text(value.postcode),
    country: text(value.country)
  };
}

function sameAddress(billing, shipping) {
  return ['first_name', 'last_name', 'address_1', 'address_2', 'city', 'state', 'postcode', 'country']
    .every(key => text(billing?.[key]) === text(shipping?.[key]));
}

function safeTracking(value) {
  if (value == null) return null;
  if (Array.isArray(value)) return value;
  if (typeof value === 'object' && Object.keys(value).length === 0) return null;
  return [value];
}

function safeRefunds(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
  return [];
}

function refundState(order, refunds) {
  const explicit = text(order.refund_state);
  if (explicit) return explicit;
  if (refunds.length && ['refunded', 'cancelled'].includes(text(order.status).toLowerCase())) return 'REFUNDED';
  return refunds.length ? 'PARTIALLY_REFUNDED' : 'NONE';
}

function customerInput(order) {
  const billing = order.billing || {};
  const externalId = text(order.customer_id, 'guest');
  const email = text(billing.email).toLowerCase();
  const phone = text(billing.phone);
  const name = text(`${billing.first_name || ''} ${billing.last_name || ''}`, 'Unresolved Customer');
  const identityKey = email || phone || `${externalId}:${name}`;
  return {
    name: name || 'Unresolved Customer',
    email,
    phone,
    customerId: `woocommerce-checkout-candidate-${uuidFor('customer', identityKey).slice(0, 8)}`,
    externalCustomerId: externalId
  };
}

function normalizedItems(order) {
  return (Array.isArray(order.line_items) ? order.line_items : [])
    .map(item => ({
      id: text(item.id),
      product_id: text(item.product_id),
      sku: text(item.sku),
      name: text(item.name, 'WooCommerce item'),
      quantity: Math.max(1, Math.trunc(number(item.quantity, 1))),
      unit_price: number(item.unit_price),
      total: number(item.total)
    }))
    .filter(item => item.id);
}

function normalizedOrder(order) {
  const billing = safeAddress(order.billing);
  const shipping = safeAddress(order.shipping);
  const items = normalizedItems(order);
  const refunds = safeRefunds(order.refunds);
  const wooStatus = text(order.status, 'unknown').toLowerCase();
  const fulfillmentState = text(order.fulfillment_state || order.fulfillment_status || order.status, 'unknown');
  return {
    status: text(order.status, 'unknown'),
    total: number(order.total),
    currency: text(order.currency, 'USD'),
    payment_method: text(order.payment_method),
    payment_method_title: text(order.payment_method_title),
    billing,
    shipping,
    same_as_billing: typeof order.same_as_billing === 'boolean' ? order.same_as_billing : sameAddress(billing, shipping),
    fulfillment_state: fulfillmentState.toLowerCase() === 'completed' || wooStatus === 'completed' ? 'DELIVERED' : fulfillmentState,
    tracking: safeTracking(order.tracking),
    refund_state: refundState(order, refunds),
    refund_total: number(order.refund_total),
    refunds,
    line_items: items
  };
}

function eventIdFor(event, order, snapshotHash) {
  return text(event.source_event_id || event.provider_event_id) || `order:${text(order.id)}:snapshot:${snapshotHash}`;
}

function canonicalEvent(event, transport = 'canonical') {
  const order = event.order || event.payload?.order || event.data?.order;
  if (!order) throw new Error('WooCommerce order event must include order data');
  const snapshot = normalizedOrder(order);
  const snapshotHash = hashSnapshot(snapshot);
  return {
    order,
    normalized: snapshot,
    snapshot_hash: snapshotHash,
    source_event_id: eventIdFor(event, order, snapshotHash),
    event_type: text(event.event_type, 'ORDER_SNAPSHOT').toUpperCase(),
    occurred_at: asDate(event.occurred_at || order.updated || order.created),
    transport,
    metadata: event.metadata || {}
  };
}

function customerIdentity(input) {
  return input.email || input.phone || `${input.externalCustomerId}:${input.name}`;
}

async function ensureCustomerReference(client, input, now) {
  const identity = customerIdentity(input);
  const id = uuidFor('customer-reference', `${SOURCE}:${identity}`);
  const result = await client.query(`INSERT INTO customer_references(id, source, external_customer_id, display_name_safe, environment, provenance, observed_at)
    VALUES ($1,$2,$3,$4,'staging',$5,$6)
    ON CONFLICT (source, external_customer_id) DO UPDATE SET display_name_safe=EXCLUDED.display_name_safe, provenance=EXCLUDED.provenance, observed_at=EXCLUDED.observed_at
    RETURNING id, (xmax = 0) AS created`, [
    id,
    SOURCE,
    identity,
    input.name || 'Unresolved Customer',
    {source_system: 'woocommerce', source: SOURCE, woocommerce_customer_id: input.externalCustomerId, email: input.email || null, phone: input.phone || null, execution: 'NO_EXECUTION'},
    now
  ]);
  return {id: result.rows[0].id, name: input.name || 'Unresolved Customer', created: result.rows[0].created};
}

function expectedCustomerReferenceId(input) {
  return uuidFor('customer-reference', `${SOURCE}:${customerIdentity(input)}`);
}

function rejection(code, message, status = 409) {
  return {code, message, status};
}

function previousSnapshot(reference, items) {
  if (!reference) return null;
  return {
    status: reference.order_status || reference.fulfillment_status || 'unknown',
    total: number(reference.amount),
    currency: text(reference.currency, 'USD'),
    payment_method: text(reference.payment_method),
    payment_method_title: text(reference.payment_method_title),
    billing: reference.billing_address || {},
    shipping: reference.shipping_address || {},
    same_as_billing: reference.same_as_billing,
    fulfillment_state: text(reference.fulfillment_state || reference.fulfillment_status, 'unknown'),
    tracking: reference.tracking || null,
    refund_state: text(reference.refund_state, 'NONE'),
    refund_total: number(reference.refund_total),
    refunds: reference.refunds || [],
    line_items: items.filter(item => item.active !== false).map(item => ({
      id: text(item.source_line_item_id),
      product_id: text(item.source_product_id),
      sku: text(item.sku),
      name: text(item.product_name),
      quantity: Number(item.quantity),
      unit_price: number(item.unit_price),
      total: number(item.line_total)
    }))
  };
}

function changedFields(before, after) {
  if (!before) return [];
  const changes = [];
  for (const field of ['status', 'total', 'currency', 'payment_method', 'payment_method_title']) {
    if (stable(before[field]) !== stable(after[field])) changes.push(field);
  }
  if (stable(before.billing) !== stable(after.billing) || stable(before.shipping) !== stable(after.shipping) || before.same_as_billing !== after.same_as_billing) changes.push('address');
  if (stable(before.line_items) !== stable(after.line_items)) changes.push('line_items');
  if (stable(before.fulfillment_state) !== stable(after.fulfillment_state) || stable(before.tracking) !== stable(after.tracking)) changes.push('fulfillment');
  if (stable(before.refund_state) !== stable(after.refund_state) || stable(before.refund_total) !== stable(after.refund_total) || stable(before.refunds) !== stable(after.refunds)) changes.push('refund');
  return changes;
}

function lifecycleTypes(event, before, after, changes) {
  if (!before) return ['ORDER_CREATED'];
  const explicit = event.event_type !== 'ORDER_SNAPSHOT' ? event.event_type : '';
  const types = [];
  if (changes.includes('status')) types.push(after.status.toLowerCase() === 'cancelled' ? 'ORDER_CANCELLED' : 'ORDER_STATUS_CHANGED');
  if (changes.includes('address')) types.push('ORDER_ADDRESS_CHANGED');
  if (changes.includes('line_items')) types.push('ORDER_LINE_ITEMS_CHANGED');
  if (changes.includes('fulfillment') && (!changes.includes('status') || stable(before?.tracking) !== stable(after.tracking) || after.fulfillment_state !== after.status)) types.push('ORDER_FULFILLMENT_UPDATED');
  if (changes.includes('refund')) types.push('ORDER_REFUND_UPDATED');
  if (!types.length && changes.length) types.push('ORDER_UPDATED');
  if (explicit && explicit !== 'ORDER_SNAPSHOT' && !types.includes(explicit)) types.push(explicit);
  return types;
}

async function syncOne(adapter, rawEvent) {
  const event = canonicalEvent(rawEvent, rawEvent.transport || 'canonical');
  const externalOrderId = text(event.order.id);
  if (!externalOrderId) throw new Error('WooCommerce order id is required');
  const input = customerInput(event.order);
  const now = new Date();
  const sourceCreatedAt = asDate(event.order.created, event.occurred_at);
  const sourceUpdatedAt = asDate(event.order.updated, event.occurred_at);
  const orderId = uuidFor('order', externalOrderId);
  const idempotencyKey = `${SOURCE}:event:${event.source_event_id}`;

  const receiptDetails = {
    external_order_id: externalOrderId,
    snapshot_hash: event.snapshot_hash,
    source_updated_at: sourceUpdatedAt.toISOString(),
    transport: event.transport,
    execution: 'NO_EXECUTION'
  };

  const result = await transaction(async client => {
    const existingReceipt = await client.query('SELECT status, details FROM ingestion_receipts WHERE source=$1 AND provider_event_id=$2 FOR UPDATE', [SOURCE, event.source_event_id]);
    if (existingReceipt.rowCount) {
      const priorDetails = existingReceipt.rows[0].details || {};
      if (priorDetails.external_order_id && (priorDetails.external_order_id !== externalOrderId || priorDetails.snapshot_hash !== event.snapshot_hash)) {
        await client.query(`UPDATE ingestion_receipts SET details=details || $3::jsonb
          WHERE source=$1 AND provider_event_id=$2`, [SOURCE, event.source_event_id, JSON.stringify({last_conflict: {...receiptDetails, observed_at: now.toISOString()}})]);
        return {rejection: rejection('WOO_EVENT_ID_CONFLICT', `Woo source event ${event.source_event_id} was already bound to a different order snapshot`)};
      }
      const prior = await client.query('SELECT id, customer_reference_id FROM order_references WHERE source=$1 AND external_order_id=$2', [SOURCE, externalOrderId]);
      const customerId = prior.rows[0]?.customer_reference_id || expectedCustomerReferenceId(input);
      await enqueueTwentyProjection(client, {entityType: 'customer', entityId: customerId, source: SOURCE, sourceEventId: event.source_event_id, payload: {external_order_id: externalOrderId, replay: true}});
      const projection = await enqueueTwentyProjection(client, {entityType: 'order', entityId: orderId, source: SOURCE, sourceEventId: event.source_event_id, payload: {external_order_id: externalOrderId, replay: true}});
      return {order_id: externalOrderId, customer_id: customerId, duplicate: true, event_id: event.source_event_id, event_types: [], line_item_count: event.normalized.line_items.length, source: SOURCE, projection_status: projection.status, projection_job_id: projection.id};
    }

    await client.query(`INSERT INTO ingestion_receipts(id, source, provider_event_id, status, details, received_at)
      VALUES ($1,$2,$3,'RECEIVED',$4,$5)`, [crypto.randomUUID(), SOURCE, event.source_event_id, receiptDetails, now]);

    const priorOrder = await client.query('SELECT * FROM order_references WHERE source=$1 AND external_order_id=$2 FOR UPDATE', [SOURCE, externalOrderId]);
    const reference = priorOrder.rows[0] || null;
    const expectedCustomerId = expectedCustomerReferenceId(input);
    if (reference && reference.customer_reference_id !== expectedCustomerId) {
      await client.query(`UPDATE ingestion_receipts SET status='REJECTED', details=details || $3::jsonb
        WHERE source=$1 AND provider_event_id=$2`, [SOURCE, event.source_event_id, JSON.stringify({rejection: {code: 'WOO_ORDER_IDENTITY_CONFLICT', existing_customer_id: reference.customer_reference_id, incoming_customer_id: expectedCustomerId}})]);
      return {rejection: rejection('WOO_ORDER_IDENTITY_CONFLICT', `Woo order ${externalOrderId} is already bound to a different customer identity`)};
    }

    const idempotency = await client.query(`INSERT INTO idempotency_keys(id, scope, key_value, first_seen_at, resource_type, resource_id)
      VALUES ($1,$2,$3,$4,'order',$5) ON CONFLICT (scope, key_value) DO NOTHING RETURNING id`, [
      uuidFor('idempotency', idempotencyKey), SOURCE, idempotencyKey, now, orderId
    ]);
    if (!idempotency.rowCount) {
      const bound = await client.query('SELECT resource_id FROM idempotency_keys WHERE scope=$1 AND key_value=$2', [SOURCE, idempotencyKey]);
      if (bound.rows[0]?.resource_id && bound.rows[0].resource_id !== orderId) {
        await client.query(`UPDATE ingestion_receipts SET status='REJECTED', details=details || $3::jsonb
          WHERE source=$1 AND provider_event_id=$2`, [SOURCE, event.source_event_id, JSON.stringify({rejection: {code: 'WOO_EVENT_ID_CONFLICT', existing_order_id: bound.rows[0].resource_id}})]);
        return {rejection: rejection('WOO_EVENT_ID_CONFLICT', `Woo source event ${event.source_event_id} is bound to a different order`)};
      }
      await client.query("UPDATE ingestion_receipts SET status='ACCEPTED_DUPLICATE' WHERE source=$1 AND provider_event_id=$2", [SOURCE, event.source_event_id]);
      await enqueueTwentyProjection(client, {entityType: 'customer', entityId: reference?.customer_reference_id || expectedCustomerId, source: SOURCE, sourceEventId: event.source_event_id, payload: {external_order_id: externalOrderId, replay: true}});
      const projection = await enqueueTwentyProjection(client, {entityType: 'order', entityId: orderId, source: SOURCE, sourceEventId: event.source_event_id, payload: {external_order_id: externalOrderId}});
      return {order_id: externalOrderId, customer_id: reference?.customer_reference_id || expectedCustomerId, duplicate: true, event_id: event.source_event_id, event_types: [], line_item_count: event.normalized.line_items.length, source: SOURCE, projection_status: projection.status, projection_job_id: projection.id};
    }

    if (reference?.source_updated_at && sourceUpdatedAt < new Date(reference.source_updated_at)) {
      const provenance = {...receiptDetails, ignored_reason: 'Incoming Woo snapshot is older than the authoritative stored snapshot', authoritative_source_updated_at: reference.source_updated_at};
      await client.query(`INSERT INTO operational_events(
          id, customer_id, order_id, event_type, source, source_id, actor_type, occurred_at, ingested_at, provenance, correlation_id, idempotency_key
        ) VALUES ($1,$2,$3,'ORDER_SOURCE_STALE_IGNORED',$4,$5,'SYSTEM',$6,$7,$8,$9,$10)
        ON CONFLICT (source, source_id, event_type) DO NOTHING`, [
        uuidFor('event', `${event.source_event_id}:ORDER_SOURCE_STALE_IGNORED`), reference.customer_reference_id, orderId, SOURCE,
        event.source_event_id, event.occurred_at, now, provenance, externalOrderId, idempotencyKey
      ]);
      await client.query("UPDATE ingestion_receipts SET status='IGNORED_STALE', details=details || $3::jsonb WHERE source=$1 AND provider_event_id=$2", [SOURCE, event.source_event_id, JSON.stringify({authoritative_source_updated_at: reference.source_updated_at})]);
      return {order_id: externalOrderId, customer_id: reference.customer_reference_id, duplicate: false, ignored: true, stale: true, event_id: event.source_event_id, event_types: ['ORDER_SOURCE_STALE_IGNORED'], line_item_count: event.normalized.line_items.length, source: SOURCE, projection_status: 'NOT_REQUIRED', projection_job_id: null};
    }

    const customer = await ensureCustomerReference(client, input, now);
    await enqueueTwentyProjection(client, {entityType: 'customer', entityId: customer.id, source: SOURCE, sourceEventId: event.source_event_id, payload: {external_order_id: externalOrderId}});
    const priorItems = reference ? (await client.query('SELECT * FROM demo_order_line_items WHERE order_id=$1 ORDER BY source_line_item_id', [reference.id])).rows : [];
    const before = previousSnapshot(reference, priorItems);
    const after = event.normalized;
    const changes = changedFields(before, after);
    const eventTypes = lifecycleTypes(event, before, after, changes);
    const observedAt = now;
    const provenance = {
      source_system: 'woocommerce',
      bridge: SOURCE,
      transport: event.transport,
      source_event_id: event.source_event_id,
      snapshot_hash: event.snapshot_hash,
      woo_order_id: externalOrderId,
      woo_customer_id: input.externalCustomerId,
      changed_fields: changes,
      before: before || null,
      after,
      metadata: event.metadata,
      candidate_only: true,
      execution: 'NO_EXECUTION',
      summary: eventTypes.length ? eventTypes.join(', ') : 'No lifecycle field changes'
    };
    const values = [
      orderId, SOURCE, externalOrderId, text(event.order.order_number, externalOrderId), customer.id,
      after.fulfillment_state, after.total, after.currency, after.payment_method, after.payment_method_title,
      after.status, after.billing, after.shipping, after.same_as_billing, after.fulfillment_state,
      after.tracking == null ? null : JSON.stringify(after.tracking), after.refund_state, after.refund_total, JSON.stringify(after.refunds), after.status.toLowerCase() === 'cancelled' ? event.occurred_at : null,
      event.source_event_id, event.snapshot_hash, sourceCreatedAt, sourceUpdatedAt, provenance, observedAt, eventTypes.length ? event.occurred_at : (reference?.last_lifecycle_event_at || null)
    ];
    if (reference) {
      await client.query(`UPDATE order_references SET
        source=$2, external_order_id=$3, order_number=$4, customer_reference_id=$5, fulfillment_status=$6, amount=$7, currency=$8,
        payment_method=$9, payment_method_title=$10, order_status=$11, billing_address=$12, shipping_address=$13,
        same_as_billing=$14, fulfillment_state=$15, tracking=$16, refund_state=$17, refund_total=$18, refunds=$19,
        cancelled_at=$20, source_event_id=$21, snapshot_hash=$22, source_created_at=$23, source_updated_at=$24,
        provenance=$25, observed_at=$26, last_lifecycle_event_at=$27 WHERE id=$1`, values);
    } else {
      await client.query(`INSERT INTO order_references(
        id, source, external_order_id, order_number, customer_reference_id, fulfillment_status, amount, currency,
        payment_method, payment_method_title, order_status, billing_address, shipping_address, same_as_billing,
        fulfillment_state, tracking, refund_state, refund_total, refunds, cancelled_at, source_event_id, snapshot_hash,
        source_created_at, source_updated_at, provenance, observed_at, last_lifecycle_event_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`, values);
    }

    const incomingIds = new Set(event.normalized.line_items.map(item => item.id));
    for (const item of event.normalized.line_items) {
      await client.query(`INSERT INTO demo_order_line_items(
          id, order_id, source_line_item_id, source_product_id, sku, product_name, quantity, unit_price, line_total, active, source_updated_at, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$11)
        ON CONFLICT (order_id, source_line_item_id) DO UPDATE SET
          source_product_id=EXCLUDED.source_product_id, sku=EXCLUDED.sku, product_name=EXCLUDED.product_name,
          quantity=EXCLUDED.quantity, unit_price=EXCLUDED.unit_price, line_total=EXCLUDED.line_total,
          active=true, source_updated_at=EXCLUDED.source_updated_at`, [
        uuidFor('line-item', `${externalOrderId}:${item.id}`), orderId, item.id, item.product_id, item.sku,
        item.name, item.quantity, item.unit_price, item.total, sourceUpdatedAt, sourceCreatedAt
      ]);
    }
    for (const item of priorItems) {
      if (!incomingIds.has(text(item.source_line_item_id))) await client.query('UPDATE demo_order_line_items SET active=false, source_updated_at=$1 WHERE id=$2', [sourceUpdatedAt, item.id]);
    }

    for (const eventType of eventTypes) {
      await client.query(`INSERT INTO operational_events(
          id, customer_id, order_id, event_type, source, source_id, actor_type, occurred_at, ingested_at, provenance, correlation_id, idempotency_key
        ) VALUES ($1,$2,$3,$4,$5,$6,'SYSTEM',$7,$8,$9,$10,$11)
        ON CONFLICT (source, source_id, event_type) DO NOTHING`, [
        uuidFor('event', `${event.source_event_id}:${eventType}`), customer.id, orderId, eventType, SOURCE,
        event.source_event_id, event.occurred_at, now, provenance, externalOrderId, idempotencyKey
      ]);
    }

    const projection = await enqueueTwentyProjection(client, {entityType: 'order', entityId: orderId, source: SOURCE, sourceEventId: event.source_event_id, payload: {external_order_id: externalOrderId, customer_id: customer.id}});
    await client.query("UPDATE ingestion_receipts SET status='ACCEPTED', details=details || $3::jsonb WHERE source=$1 AND provider_event_id=$2", [SOURCE, event.source_event_id, JSON.stringify({customer_id: customer.id, order_id: orderId, event_types: eventTypes})]);

    return {
      order_id: externalOrderId,
      customer_id: customer.id,
      customer_created: customer.created,
      duplicate: false,
      event_id: event.source_event_id,
      event_types: eventTypes,
      changed_fields: changes,
      line_item_count: event.normalized.line_items.length,
      total: after.total,
      payment_method: after.payment_method,
      payment_method_title: after.payment_method_title,
      source: SOURCE,
      projection_status: projection.status,
      projection_job_id: projection.id
    };
  });
  if (result.rejection) throw Object.assign(new Error(result.rejection.message), {code: result.rejection.code, status: result.rejection.status});
  return result;
}

export async function processWooOrderEvents(adapter, input) {
  if (input?.source !== SOURCE) throw Object.assign(new Error('checkout candidate source marker required'), {status: 403});
  const events = Array.isArray(input.events) ? input.events : [];
  const results = [];
  for (const event of events) results.push(await syncOne(adapter, event));
  return {status: 'accepted', source: SOURCE, transport: input.transport || 'canonical', event_count: results.length, results, execution: 'NO_EXECUTION'};
}

export async function syncCheckoutOrders(adapter, input) {
  const orders = Array.isArray(input?.orders) ? input.orders : [];
  const events = orders.map(order => ({order, event_type: 'ORDER_SNAPSHOT', transport: 'pull-import', metadata: {pull: true, source: SOURCE}}));
  return processWooOrderEvents(adapter, {source: input?.source, transport: 'pull-import', events});
}

export async function ingestWooOrderEvents(adapter, input) {
  return processWooOrderEvents(adapter, {...input, transport: input?.transport || 'canonical'});
}
