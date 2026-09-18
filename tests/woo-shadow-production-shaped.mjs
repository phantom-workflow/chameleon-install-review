import assert from 'node:assert/strict';
import http from 'node:http';
import {runMigrations} from '../apps/api/src/migrate.js';
import {pool, query} from '../apps/api/src/db.js';
import {createWooShadowWorker, SHADOW_SOURCE} from '../apps/api/src/woo-shadow.js';

const runId = `shadow-${Date.now()}-${process.pid}`;
const sourceOrders = [1, 2].map(index => ({
  id: `${runId}-order-${index}`,
  number: `SHADOW-${index}`,
  status: index === 1 ? 'processing' : 'on-hold',
  total: index === 1 ? '42.00' : '18.00',
  currency: 'USD',
  date_created: '2026-09-16T19:00:00.000Z',
  date_modified: `2026-09-16T19:0${index}:00.000Z`,
  customer_id: String(index),
  billing: {first_name: 'Synthetic', last_name: `Shadow ${index}`, email: `shadow-${index}@example.test`, phone: `+1555030000${index}`},
  shipping: {first_name: 'Synthetic', last_name: `Shadow ${index}`, address_1: '1 Lab Way', city: 'Labville', state: 'CA', postcode: '90000', country: 'US'},
  payment_method: 'synthetic',
  payment_method_title: 'Synthetic payment (no charge)',
  line_items: [{id: String(index), product_id: 'lab-product', sku: 'LAB-SHADOW', name: 'Synthetic shadow item', quantity: 1, subtotal: index === 1 ? '42.00' : '18.00', total: index === 1 ? '42.00' : '18.00'}]
}));

const methods = [];
let outage = true;
const source = http.createServer((request, response) => {
  methods.push(request.method);
  if (request.method !== 'GET') {
    response.writeHead(405, {'content-type': 'application/json'});
    response.end(JSON.stringify({error: 'read-only fixture'}));
    return;
  }
  if (outage) {
    outage = false;
    response.writeHead(503, {'content-type': 'application/json'});
    response.end(JSON.stringify({error: 'deterministic source outage'}));
    return;
  }
  response.writeHead(200, {'content-type': 'application/json', 'x-wp-totalpages': '1'});
  response.end(JSON.stringify(sourceOrders));
});

await runMigrations();
await query('DELETE FROM woo_shadow_runs WHERE source=$1', [SHADOW_SOURCE]);
await query('DELETE FROM woo_shadow_checkpoints WHERE source=$1', [SHADOW_SOURCE]);
await new Promise(resolve => source.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${source.address().port}`;
const environment = {APP_ENV: 'staging', SHADOW_WOO_ENABLED: 'true', SHADOW_WOO_BASE_URL: baseUrl, SHADOW_WOO_CONSUMER_KEY: 'synthetic-key', SHADOW_WOO_CONSUMER_SECRET: 'synthetic-secret', SHADOW_WOO_OVERLAP_SECONDS: '300', SHADOW_WOO_POLL_SECONDS: '10'};
const adapter = {};
const firstWorker = createWooShadowWorker({adapter, environment});
const secondWorker = createWooShadowWorker({adapter, environment});

try {
  await firstWorker.initialize();
  const outageResult = await firstWorker.pollOnce();
  assert.equal(outageResult.status, 'ERROR');
  const failedCheckpoint = (await query('SELECT status, upper_bound, next_page FROM woo_shadow_checkpoints WHERE source=$1', [SHADOW_SOURCE])).rows[0];
  assert.equal(failedCheckpoint.status, 'ERROR');
  assert.ok(failedCheckpoint.upper_bound);
  assert.equal(failedCheckpoint.next_page, 1);

  await secondWorker.initialize();
  const recoveryResult = await secondWorker.pollOnce();
  assert.equal(recoveryResult.status, 'SUCCEEDED');
  assert.equal(recoveryResult.records_seen, 2);
  assert.equal(recoveryResult.records_accepted, 2);
  const replayResult = await secondWorker.pollOnce();
  assert.equal(replayResult.status, 'SUCCEEDED');
  assert.equal(replayResult.records_duplicate, 2);

  const orders = (await query('SELECT count(*)::int AS count FROM order_references WHERE source=$1 AND external_order_id LIKE $2', ['woocommerce-checkout-candidate', `${runId}%`])).rows[0].count;
  const receipts = (await query('SELECT count(*)::int AS count FROM ingestion_receipts WHERE source=$1 AND provider_event_id LIKE $2', ['woocommerce-checkout-candidate', `woo-shadow:%${runId}%`])).rows[0].count;
  const checkpoint = (await query('SELECT status, watermark, upper_bound, next_page, records_seen, records_accepted FROM woo_shadow_checkpoints WHERE source=$1', [SHADOW_SOURCE])).rows[0];
  const job = (await query('SELECT state, evidence FROM (SELECT CASE WHEN evidence->>\'status\'=\'ERROR\' THEN \'DOWN\' ELSE \'UP\' END AS state, evidence FROM job_health WHERE job_name=$1) health', ['woo-read-only-shadow'])).rows[0];
  assert.equal(orders, 2);
  assert.equal(receipts, 2);
  assert.equal(checkpoint.status, 'UP');
  assert.equal(checkpoint.upper_bound, null);
  assert.equal(checkpoint.next_page, 1);
  assert.equal(Number(checkpoint.records_seen), 4);
  assert.equal(Number(checkpoint.records_accepted), 2);
  assert.equal(job.state, 'UP');
  assert.deepEqual([...new Set(methods)], ['GET']);

  console.log(JSON.stringify({status: 'PASS', source: SHADOW_SOURCE, outage: 'visible', restart_catchup: 'PASS', orders, durable_receipts: receipts, replay_duplicates: replayResult.records_duplicate, checkpoint_status: checkpoint.status, request_methods: [...new Set(methods)], execution: 'NO_EXECUTION'}));
} finally {
  await new Promise(resolve => source.close(resolve));
  await query('DELETE FROM demo_order_line_items WHERE order_id IN (SELECT id FROM order_references WHERE source=$1 AND external_order_id LIKE $2)', ['woocommerce-checkout-candidate', `${runId}%`]);
  await query('DELETE FROM order_references WHERE source=$1 AND external_order_id LIKE $2', ['woocommerce-checkout-candidate', `${runId}%`]);
  await query('DELETE FROM customer_references WHERE source=$1 AND external_customer_id = ANY($2::text[])', ['woocommerce-checkout-candidate', sourceOrders.map(order => order.billing.email)]);
  await query('DELETE FROM ingestion_receipts WHERE source=$1 AND provider_event_id LIKE $2', ['woocommerce-checkout-candidate', `woo-shadow:%${runId}%`]);
  await query('DELETE FROM idempotency_keys WHERE scope=$1 AND key_value LIKE $2', ['woocommerce-checkout-candidate', `woocommerce-checkout-candidate:event:woo-shadow:${runId}%`]);
  await query('DELETE FROM operational_events WHERE source=$1 AND source_id LIKE $2', ['woocommerce-checkout-candidate', `woo-shadow:%${runId}%`]);
  await query('DELETE FROM twenty_projection_jobs WHERE source=$1 AND source_event_id LIKE $2', ['woocommerce-checkout-candidate', `woo-shadow:%${runId}%`]);
  await query('DELETE FROM woo_shadow_runs WHERE source=$1', [SHADOW_SOURCE]);
  await query('DELETE FROM woo_shadow_checkpoints WHERE source=$1', [SHADOW_SOURCE]);
  await pool.end();
}
