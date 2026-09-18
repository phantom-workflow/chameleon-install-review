import crypto from 'node:crypto';
import { query, transaction } from './db.js';

const MAX_ATTEMPTS = 10;
// Keep fresh synthetic journeys out of an accumulated outage backlog while
// preserving dependency ordering inside both the recent and older queues.
const RECENT_JOB_WINDOW = '5 minutes';
// The installed Twenty LAB surface enforces a 100 request/minute budget. One
// projection at a time prevents a recovered outage backlog from becoming a
// retry storm (a projection can require multiple Twenty reads/writes).
const CLAIM_LIMIT = 1;
let providerCooldownUntil = 0;

function text(value, fallback = '') { return String(value ?? fallback).trim(); }
function dependencyPending(entityType, entityId) {
  const error = new Error(`Twenty ${entityType} projection pending: ${entityId}`);
  error.code = 'PROJECTION_DEPENDENCY_PENDING';
  return error;
}
function idFor(entityType, entityId, sourceEventId) {
  const hex = crypto.createHash('sha256').update(`${entityType}:${entityId}:${sourceEventId}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

export async function enqueueTwentyProjection(client, {entityType, entityId, source, sourceEventId, payload = {}}) {
  const result = await client.query(`INSERT INTO twenty_projection_jobs
    (id, entity_type, entity_id, source, source_event_id, payload)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (entity_type, entity_id, source_event_id) DO UPDATE SET
      payload=EXCLUDED.payload, updated_at=now(),
      status=CASE WHEN twenty_projection_jobs.status IN ('FAILED','DEAD') THEN 'PENDING' ELSE twenty_projection_jobs.status END,
      next_attempt_at=CASE WHEN twenty_projection_jobs.status IN ('FAILED','DEAD') THEN now() ELSE twenty_projection_jobs.next_attempt_at END
    RETURNING id, status`, [idFor(entityType, entityId, sourceEventId), entityType, entityId, source, sourceEventId, payload]);
  return result.rows[0];
}

export async function requeueTwentyProjection(entityType, entityId) {
  await query(`UPDATE twenty_projection_jobs SET status='PENDING', next_attempt_at=now(), updated_at=now()
    WHERE entity_type=$1 AND entity_id=$2 AND status IN ('FAILED','DEAD')`, [entityType, entityId]);
}

async function findProjectedCustomer(adapter, customerReferenceId) {
  return adapter.findByField('customers', 'customerId', customerReferenceId);
}

async function findProjectedOrder(adapter, row) {
  return (row.external_order_id && await adapter.findByField('orders', 'externalOrderId', row.external_order_id))
    || (row.order_number && await adapter.findByField('orders', 'orderNumber', row.order_number));
}

async function findProjectedCase(adapter, caseNumber) {
  return caseNumber ? adapter.findByField('cases', 'caseNumber', caseNumber) : null;
}

async function projectCustomer(adapter, job) {
  const row = (await query('SELECT * FROM customer_references WHERE id=$1', [job.entity_id])).rows[0];
  if (!row) throw new Error(`customer source row not found: ${job.entity_id}`);
  const existing = await findProjectedCustomer(adapter, row.id);
  const provenance = row.provenance || {};
  const record = {name: row.display_name_safe || 'Unresolved Customer', customerId: row.id, status: 'ACTIVE', ...(provenance.email ? {email: {primaryEmail: provenance.email}} : {}), ...(provenance.phone ? {phone: {primaryPhoneNumber: provenance.phone}} : {})};
  if (existing) return adapter.update('customers', existing.id, record);
  return adapter.create('customers', record);
}

async function projectOrder(adapter, job) {
  const row = (await query(`SELECT o.*, c.display_name_safe AS customer_name
    FROM order_references o LEFT JOIN customer_references c ON c.id=o.customer_reference_id WHERE o.id=$1`, [job.entity_id])).rows[0];
  if (!row) throw new Error(`order source row not found: ${job.entity_id}`);
  const existingCustomer = await findProjectedCustomer(adapter, row.customer_reference_id);
  if (!existingCustomer) throw dependencyPending('customer', row.customer_reference_id);
  const existing = await findProjectedOrder(adapter, row);
  const record = {name: `Order ${row.order_number}`, orderNumber: row.order_number, externalOrderId: row.external_order_id, status: row.order_status || row.fulfillment_status || 'UNKNOWN', fulfillmentState: row.fulfillment_state || row.fulfillment_status || undefined, refundState: row.refund_state || 'NONE', total: row.amount == null ? undefined : {amountMicros: Math.round(Number(row.amount) * 1000000), currencyCode: row.currency || 'USD'}, orderedAt: row.source_created_at || row.observed_at, customerId: existingCustomer.id};
  if (existing) return adapter.update('orders', existing.id, record);
  return adapter.create('orders', record);
}

async function projectCase(adapter, job) {
  const row = (await query(`SELECT c.*, cr.display_name_safe AS customer_name, o.order_number,
      a.queue_name, a.assignee_name, ap.status AS approval_status
    FROM cases c LEFT JOIN customer_references cr ON cr.id=c.customer_id
      LEFT JOIN order_references o ON o.id=c.order_id
      LEFT JOIN LATERAL (SELECT queue_name, assignee_name FROM assignments WHERE case_id=c.id ORDER BY assigned_at DESC LIMIT 1) a ON true
      LEFT JOIN LATERAL (SELECT status FROM approvals WHERE case_id=c.id ORDER BY created_at DESC LIMIT 1) ap ON true
    WHERE c.id=$1`, [job.entity_id])).rows[0];
  if (!row) throw new Error(`case source row not found: ${job.entity_id}`);
  const customer = await findProjectedCustomer(adapter, row.customer_id);
  if (!customer) throw dependencyPending('customer', row.customer_id);
  const existing = await findProjectedCase(adapter, row.case_number);
  const linkedOrder = row.order_id ? await findProjectedOrder(adapter, row) : null;
  if (row.order_id && !linkedOrder) throw dependencyPending('order', row.order_id);
  // Keep to fields proven on the installed v2.37.5 metadata surface.
  const record = {name: row.case_number, caseNumber: row.case_number, caseType: row.case_type, status: row.status, priority: row.priority, summary: row.summary || row.why_here || '', ownerScope: row.owner_scope || 'CSR', sourceReference: row.source_reference || undefined, approvalStatus: row.approval_status || (row.owner_approval_required ? 'PENDING' : 'NOT_REQUIRED'), proposedSideEffect: row.proposed_side_effect || 'NO_EXECUTION', noExecution: true, customerId: customer.id, slaDueAt: row.due_at || undefined, ...(linkedOrder ? {orderId: linkedOrder.id} : {})};
  if (existing) return adapter.update('cases', existing.id, record);
  return adapter.create('cases', record);
}

async function projectCommunication(adapter, job) {
  const row = (await query(`SELECT m.*, COALESCE(m.case_id, c.case_id) AS case_id, sc.case_number FROM communication_references m
    LEFT JOIN support_events c ON c.source=m.source AND c.source_event_id=m.external_message_id
    LEFT JOIN cases sc ON sc.id=COALESCE(m.case_id, c.case_id)
    WHERE m.id=$1`, [job.entity_id])).rows[0];
  if (!row) throw new Error(`communication source row not found: ${job.entity_id}`);
  const customer = await findProjectedCustomer(adapter, row.customer_reference_id);
  if (!customer) throw dependencyPending('customer', row.customer_reference_id);
  const existing = await adapter.findByField('communications', 'externalId', row.external_message_id);
  const linkedCase = row.case_id ? await findProjectedCase(adapter, row.case_number) : null;
  if (row.case_id && !linkedCase) throw dependencyPending('case', row.case_id);
  const record = {name: `Inbound ${row.external_message_id}`, source: row.source, channel: row.channel, direction: row.direction, externalId: row.external_message_id, body: row.summary || '', receivedAt: row.occurred_at, messageStatus: 'RECEIVED', customerId: customer.id, ...(linkedCase ? {caseId: linkedCase.id} : {})};
  if (existing) return adapter.update('communications', existing.id, record);
  return adapter.create('communications', record);
}

async function project(adapter, job) {
  if (job.entity_type === 'customer') return projectCustomer(adapter, job);
  if (job.entity_type === 'order') return projectOrder(adapter, job);
  if (job.entity_type === 'case') return projectCase(adapter, job);
  if (job.entity_type === 'communication') return projectCommunication(adapter, job);
  throw new Error(`unsupported projection entity: ${job.entity_type}`);
}

async function claimJobs(limit = CLAIM_LIMIT) {
  return transaction(async client => {
    const result = await client.query(`WITH picked AS (
      SELECT id FROM twenty_projection_jobs
      WHERE status IN ('PENDING','FAILED') AND next_attempt_at <= now()
      ORDER BY CASE WHEN created_at >= now() - $2::interval THEN 0 ELSE 1 END,
        CASE entity_type WHEN 'customer' THEN 0 WHEN 'order' THEN 1 WHEN 'case' THEN 2 ELSE 3 END,
        CASE WHEN created_at >= now() - $2::interval THEN created_at END DESC,
        created_at FOR UPDATE SKIP LOCKED LIMIT $1
    ) UPDATE twenty_projection_jobs j SET status='PROCESSING', attempts=j.attempts+1, updated_at=now()
      FROM picked WHERE j.id=picked.id RETURNING j.*`, [limit, RECENT_JOB_WINDOW]);
    return result.rows;
  });
}

async function finish(job, status, error = null, minimumDelayMs = 0) {
  const next = new Date(Date.now() + Math.max(minimumDelayMs, Math.min(300000, 1000 * (2 ** Math.min(job.attempts, 8)))));
  const errorText = error ? text(error.message).slice(0, 1000) : null;
  await transaction(async client => {
    await client.query(`UPDATE twenty_projection_jobs SET status=$2, last_error=$3,
      next_attempt_at=CASE WHEN $2='SUCCEEDED' THEN now() ELSE $4 END, updated_at=now() WHERE id=$1`, [job.id, status, errorText, next]);
    await client.query(`INSERT INTO twenty_projection_attempts(
        id, job_id, entity_type, entity_id, source, source_event_id, attempt_number, outcome, error, occurred_at
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
      ON CONFLICT (job_id, attempt_number) DO UPDATE SET outcome=EXCLUDED.outcome, error=EXCLUDED.error, occurred_at=EXCLUDED.occurred_at`, [
      crypto.randomUUID(), job.id, job.entity_type, job.entity_id, job.source, job.source_event_id, job.attempts, status, errorText
    ]);
  });
}

async function deferDependency(job) {
  await query(`UPDATE twenty_projection_jobs SET status='PENDING', attempts=GREATEST(attempts-1, 0),
    last_error=NULL, next_attempt_at=now()+interval '1 second', updated_at=now() WHERE id=$1`, [job.id]);
}

export async function processTwentyProjectionJobs({adapter, limit = CLAIM_LIMIT} = {}) {
  if (Date.now() < providerCooldownUntil) return {claimed: 0, succeeded: 0, failed: 0, cooldown: true};
  const jobs = await claimJobs(limit);
  let succeeded = 0; let failed = 0;
  for (const job of jobs) {
    try { await project(adapter, job); await finish(job, 'SUCCEEDED'); succeeded += 1; }
    catch (error) {
      if (error.code === 'PROJECTION_DEPENDENCY_PENDING') {
        await deferDependency(job);
        continue;
      }
      const rateLimited = /limit reached|rate limit|http 429/i.test(text(error.message));
      if (rateLimited) providerCooldownUntil = Date.now() + 60000;
      await finish(job, job.attempts >= MAX_ATTEMPTS ? 'DEAD' : 'FAILED', error, rateLimited ? 60000 : 0);
      failed += 1;
    }
  }
  return {claimed: jobs.length, succeeded, failed};
}

export async function projectionStats() {
  const result = await query(`SELECT status, count(*)::int AS count, max(updated_at) AS last_updated
    FROM twenty_projection_jobs GROUP BY status ORDER BY status`);
  return result.rows;
}

export async function recentProjectionAttempts(limit = 50) {
  const result = await query(`SELECT id, job_id, entity_type, entity_id, source, source_event_id,
      attempt_number, outcome, error, occurred_at
    FROM twenty_projection_attempts ORDER BY occurred_at DESC LIMIT $1`, [Math.max(1, Math.min(Number(limit) || 50, 200))]);
  return result.rows;
}

export async function recoverInterruptedProjectionJobs() {
  return transaction(async client => {
    const recovered = await client.query(`UPDATE twenty_projection_jobs SET
        status='FAILED', last_error='Projection worker restarted before the prior attempt completed',
        next_attempt_at=now(), updated_at=now()
      WHERE status='PROCESSING' RETURNING *`);
    for (const job of recovered.rows) {
      await client.query(`INSERT INTO twenty_projection_attempts(
          id, job_id, entity_type, entity_id, source, source_event_id, attempt_number, outcome, error, occurred_at
        ) VALUES($1,$2,$3,$4,$5,$6,$7,'INTERRUPTED',$8,now())
        ON CONFLICT (job_id, attempt_number) DO NOTHING`, [
        crypto.randomUUID(), job.id, job.entity_type, job.entity_id, job.source, job.source_event_id, job.attempts,
        'Projection worker restarted before the prior attempt completed'
      ]);
    }
    return recovered.rowCount;
  });
}

export function startTwentyProjectionWorker({adapter, intervalMs = 2000} = {}) {
  let stopped = false;
  let recovered = false;
  const tick = async () => {
    if (stopped) return;
    try {
      if (!recovered) { await recoverInterruptedProjectionJobs(); recovered = true; }
      await processTwentyProjectionJobs({adapter});
    } catch (error) { console.error(JSON.stringify({component: 'twenty-projection-worker', error: text(error.message)})); }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();
  return () => { stopped = true; clearInterval(timer); };
}
