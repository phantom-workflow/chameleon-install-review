import http from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import { pool, query, transaction } from './db.js';
import { classifyMessage, normalizePhone } from './domain.js';
import { runMigrations } from './migrate.js';
import { createDisabledTwentyAdapter, createTwentyAdapter } from './twenty-adapter.js';
import { createSyntheticDemo } from './demo.js';
import { ingestWooOrderEvents, syncCheckoutOrders } from './checkout-sync.js';
import { ingestSupportEvent, determineProductOutcome } from './support-processor.js';
import { enqueueTwentyProjection, projectionStats, recentProjectionAttempts, startTwentyProjectionWorker } from './twenty-projection.js';
import { currentPolicy, policyHistory, policyMetrics, policyRules, PRESETS } from './support-policy.js';
import { twilioSmsIngressConfig, validateTwilioSmsWebhook } from './twilio-sms-ingress.js';
import { authorizeChatwootShadowRequest, CHATWOOT_SHADOW_ROUTE, supportIngressConfig } from './chatwoot-support-ingress.js';
import { ingestChatwootSupportEvent } from './chatwoot-support-pipeline.js';
import { supportKnowledgeCatalog } from './support-knowledge.js';
import { createSupportAgentAdapter } from './support-agent-adapter.js';
import {
  authenticateCredentials,
  authenticateRequest,
  bearerToken,
  createSession,
  createUser,
  findUserById,
  listUsers,
  publicUser,
  revokeSessionToken,
  touchLogin,
  updateUser
} from './auth.js';
import { assertRuntimeConfiguration, twentyProjectionEnabled } from './runtime-config.js';
import { createWooShadowWorker } from './woo-shadow.js';

const runtimeConfig = assertRuntimeConfiguration();
const port = Number(process.env.PORT || 8080);
const appEnv = runtimeConfig.environment;
const twentyEnabled = twentyProjectionEnabled();
const runtime = Object.freeze({
  git_sha: String(process.env.APP_GIT_SHA || 'unknown'),
  build_id: String(process.env.APP_BUILD_ID || process.env.APP_GIT_SHA || 'unknown'),
  build_timestamp: String(process.env.APP_BUILD_TIMESTAMP || 'unknown'),
  environment: appEnv,
  api_version: 'v2',
  twenty_projection: twentyEnabled ? 'enabled' : 'disabled'
});
const adapter = twentyEnabled
  ? createTwentyAdapter({
    baseUrl: process.env.TWENTY_BASE_URL,
    apiKey: process.env.TWENTY_API_KEY,
    syntheticOnly: process.env.SYNTHETIC_ONLY !== 'false'
  })
  : createDisabledTwentyAdapter();
const syntheticDemo = createSyntheticDemo({adapter, appEnv});
const twilioIngress = twilioSmsIngressConfig();
const supportIngress = supportIngressConfig();
const supportAgent = createSupportAgentAdapter();

const APPROVERS = new Set(['Stuart', 'Cory']);
const TERMINAL = new Set(['RESOLVED', 'CLOSED']);

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-chameleon-control-plane': 'v2'});
  res.end(payload);
}

function principalFrom(req) {
  return req.chameleonPrincipal || null;
}

function userFrom(req) {
  const principal = principalFrom(req);
  if (principal) return principal.name || principal.username || principal.id;
  const role = String(req.headers['x-chameleon-role'] || 'CSR').toUpperCase();
  return String(req.headers['x-chameleon-user'] || (role === 'OWNER' ? 'Stuart' : role));
}

function roleFrom(req) {
  const principal = principalFrom(req);
  if (principal) {
    if (principal.role === 'ADMIN') return 'OWNER';
    if (['MANAGER', 'STAFF'].includes(principal.role)) return 'OPERATIONS';
    return 'CSR';
  }
  return String(req.headers['x-chameleon-role'] || 'CSR').toUpperCase();
}

function denied(res, message = 'permission denied') {
  return json(res, 403, {error: {code: 'FORBIDDEN', message}});
}

function canRead(role, resource) {
  if (role === 'OWNER' || role === 'OPERATIONS') return ['cases', 'customers', 'orders', 'approvals', 'audit', 'job_health'].includes(resource);
  if (role === 'CSR') return ['cases', 'customers', 'orders'].includes(resource);
  if (role === 'FULFILLMENT') return ['cases', 'customers', 'orders', 'job_health'].includes(resource);
  return false;
}

function canWriteCase(req, role) {
  const principal = principalFrom(req);
  if (principal?.role === 'READ_ONLY') return false;
  return ['OWNER', 'OPERATIONS', 'CSR'].includes(role);
}

function canApprove(req) {
  const principal = principalFrom(req);
  if (principal?.authenticated === true) return principal.role === 'ADMIN';
  return roleFrom(req) === 'OWNER' && APPROVERS.has(userFrom(req));
}

function canReadOwnerApprovals(req) {
  // Approval visibility is separate from ordinary case read. Authenticated
  // principals derive this capability from the durable session role; legacy
  // headers remain available only to explicit synthetic LAB fixtures.
  return canApprove(req);
}

function redactCaseRow(row, req) {
  if (canReadOwnerApprovals(req)) return row;
  const {approval_status, approval_id, approved_by, decided_at, decision_reason, ...safe} = row;
  return safe;
}

function syntheticPrincipal(req) {
  if (appEnv === 'production' || String(req.headers['x-chameleon-synthetic'] || '').toLowerCase() !== 'true') return null;
  const legacyRole = String(req.headers['x-chameleon-role'] || 'CSR').toUpperCase();
  const role = legacyRole === 'OWNER' ? 'ADMIN' : legacyRole === 'OPERATIONS' ? 'MANAGER' : 'STAFF';
  return {
    id: `synthetic:${String(req.headers['x-chameleon-user'] || role)}`,
    name: String(req.headers['x-chameleon-user'] || (legacyRole === 'OWNER' ? 'Stuart' : legacyRole)),
    username: null,
    role,
    user_type: 'AGENT',
    active: true,
    authenticated: false,
    synthetic: true
  };
}

function unauthorized(res) {
  return json(res, 401, {error: {code: 'UNAUTHENTICATED', message: 'authentication required'}});
}

function adminOnly(req, res) {
  const principal = principalFrom(req);
  if (!principal?.authenticated) {
    unauthorized(res);
    return false;
  }
  if (principal.role !== 'ADMIN') {
    denied(res, 'administrator role required');
    return false;
  }
  return true;
}

async function recordAccessAudit(principal, action, resourceId, before, after) {
  await query(`INSERT INTO audit_records(id, actor_type, actor_id, actor_role, action, resource_type, resource_id, policy_decision, before_summary, after_summary, created_at)
    VALUES ($1,'HUMAN',$2,$3,$4,'user',$5,'ALLOW_AUTHENTICATED_ADMIN',$6,$7,now())`, [crypto.randomUUID(), principal.id, principal.role, action, resourceId, before || {}, after || {}]);
}

async function readRawBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readBody(req) {
  return JSON.parse((await readRawBody(req)) || '{}');
}

async function ingestSyntheticSupport(input) {
  if (input.source && String(input.source).toLowerCase() !== 'synthetic') {
    throw Object.assign(new Error('support ingress is synthetic-only in LAB'), {status: 403, code: 'SYNTHETIC_ONLY'});
  }
  return ingestSupportEvent({adapter, input: {...input, source: 'synthetic'}});
}

async function ingestChatwootSupport(payload, sourceAuth = {verified: true, method: 'lab-synthetic-proxy'}) {
  return ingestChatwootSupportEvent({
    payload,
    sourceAuth,
    adapter,
    supportAgent,
    mode: supportIngress.mode
  });
}

function providerPayload(input) {
  return {
    providerEventId: String(input.MessageSid || input.message_sid || ''),
    from: normalizePhone(input.From || input.from),
    body: String(input.Body || input.body || ''),
    occurredAt: input.Timestamp || input.timestamp ? new Date(input.Timestamp || input.timestamp) : new Date()
  };
}

function hashPayload(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function ensureJobHealth() {
  const now = new Date();
  const rows = [
    ['twilio-ingestion', 60, now, {source: 'synthetic-only heartbeat'}],
    ['customer-reference-sync', 300, new Date(now.getTime() - 400000), {source: 'Twenty reference probe'}],
    ['approval-reconciler', 60, new Date(now.getTime() - 3600000), {source: 'no external executor configured'}]
  ];
  for (const [name, cadence, lastSeen, evidence] of rows) {
    await query(`INSERT INTO job_health(id, job_name, expected_cadence_seconds, last_seen_at, evidence, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (job_name) DO UPDATE SET last_seen_at=EXCLUDED.last_seen_at, evidence=EXCLUDED.evidence, updated_at=EXCLUDED.updated_at`, [crypto.randomUUID(), name, cadence, lastSeen, evidence, now]);
  }
}

async function recordWooCatchupHealth(input) {
  if (appEnv === 'production' || String(input?.job_name || '') !== 'woo-lab-checkout-catchup') {
    throw Object.assign(new Error('LAB Woo catch-up health is not available'), {status: 403, code: 'SYNTHETIC_ONLY'});
  }
  const status = String(input?.status || '').toUpperCase();
  if (!['OK', 'ERROR'].includes(status)) {
    throw Object.assign(new Error('health status must be OK or ERROR'), {status: 400, code: 'INVALID_HEALTH_STATUS'});
  }
  const cadence = Number(input?.expected_cadence_seconds);
  if (!Number.isInteger(cadence) || cadence < 10 || cadence > 300) {
    throw Object.assign(new Error('expected cadence must be 10-300 seconds'), {status: 400, code: 'INVALID_HEALTH_CADENCE'});
  }
  const now = new Date();
  const evidence = {
    source: 'woo-lab-automatic-catchup',
    status,
    detail: String(input?.detail || (status === 'OK' ? 'poll accepted' : 'poll failed')).slice(0, 160),
    execution: 'NO_EXECUTION'
  };
  await query(`INSERT INTO job_health(id, job_name, expected_cadence_seconds, last_seen_at, evidence, updated_at)
    VALUES ($1,$2,$3,$4,$5,$4)
    ON CONFLICT (job_name) DO UPDATE SET expected_cadence_seconds=EXCLUDED.expected_cadence_seconds,
      last_seen_at=EXCLUDED.last_seen_at, evidence=EXCLUDED.evidence, updated_at=EXCLUDED.updated_at`, [
    crypto.randomUUID(), 'woo-lab-checkout-catchup', cadence, now, evidence
  ]);
  return {status: 'recorded', job_name: 'woo-lab-checkout-catchup', observed_at: now.toISOString(), evidence};
}
function sourceCustomerRecord(row) {
  const provenance = row.provenance || {};
  return {
    id: row.id,
    customerId: row.id,
    name: row.display_name_safe || 'Unresolved Customer',
    ...(provenance.email ? {email: {primaryEmail: provenance.email}} : {}),
    ...(provenance.phone ? {phone: {primaryPhoneNumber: provenance.phone}} : {}),
    status: 'ACTIVE'
  };
}

async function findSourceCustomer(id) {
  const result = await query(`SELECT id, display_name_safe, provenance
    FROM customer_references
    WHERE id::text=$1 OR external_customer_id=$1
    ORDER BY CASE WHEN id::text=$1 THEN 0 ELSE 1 END
    LIMIT 1`, [String(id)]);
  return result.rows[0] || null;
}

async function resolveCustomerRead(id) {
  const source = await findSourceCustomer(id);
  const sourceId = source?.id ? String(source.id) : null;
  let projected = null;
  let projectionLookupFailed = false;
  try {
    projected = await adapter.findCustomer(sourceId || id);
  } catch (error) {
    if (!source) throw error;
    projectionLookupFailed = true;
  }
  if (projected) {
    return {
      customer: projected,
      sourceId: projected.customerId || sourceId || String(id),
      projectionAvailable: true,
      projectionLookupFailed: false
    };
  }
  if (source) {
    return {
      customer: sourceCustomerRecord(source),
      sourceId,
      projectionAvailable: false,
      projectionLookupFailed
    };
  }
  return {customer: null, sourceId: sourceId || String(id), projectionAvailable: false, projectionLookupFailed};
}

function customerProjectionStatus(resolved) {
  if (resolved.projectionAvailable) return {available: true, status: 'AVAILABLE'};
  return {
    available: false,
    status: resolved.projectionLookupFailed ? 'ERROR' : 'UNAVAILABLE',
    reason: resolved.projectionLookupFailed
      ? 'Twenty lookup failed; Chameleon source data returned.'
      : 'No matching Twenty Customer projection; Chameleon source data returned.'
  };
}


async function resolveTwentyReferences(provider) {
  const customer = await adapter.findByField('customers', 'phone.primaryPhoneNumber', provider.from);
  if (!customer) throw Object.assign(new Error('synthetic customer identity unresolved'), {status: 422});
  // V2 must not depend on the retained V1 Twenty Order object. The lab order
  // is a source-faithful WooCommerce reference fixture resolved by identity.
  const order = customer.name === 'Sarah Test' && customer.email?.primaryEmail === 'sarah.test@example.test' ? {
    id: '9b1d4a8f-0d7f-4b7c-9b41-9f3a7e8d1001',
    orderNumber: 'TEST-ORDER-10001',
    fulfillmentStatus: 'DELIVERED',
    source: 'woocommerce-fixture'
  } : null;
  return {customer, order};
}

async function resolveProjectedCaseLinks(rows) {
  const links = new Map();
  for (const row of rows) {
    try {
      const projected = await adapter.findByField('cases', 'caseNumber', row.case_number);
      links.set(row.case_number, projected
        ? {id: projected.id, status: 'AVAILABLE', reason: 'projected case found'}
        : {id: null, status: 'UNAVAILABLE', reason: 'no matching Twenty Case projection'});
    } catch {
      links.set(row.case_number, {id: null, status: 'ERROR', reason: 'Twenty Case lookup failed'});
    }
  }
  return links;
}

async function joinCases(where = '', params = [], includeTwentyId = false) {
  const result = await query(`SELECT c.*, cr.display_name_safe AS customer_name, orf.order_number, orf.source AS order_source,
      a.queue_name, a.assignee_name,
      ap.status AS approval_status, ap.id AS approval_id, ap.approved_by, ap.decided_at, ap.decision_reason,
      hd.decision AS latest_human_decision, hd.reason AS human_decision_reason,
      hd.requested_information AS requested_information, hd.created_at AS human_decision_at,
      EXTRACT(EPOCH FROM (now() - c.created_at))::bigint AS age_seconds
    FROM cases c
    LEFT JOIN customer_references cr ON cr.id = c.customer_id
    LEFT JOIN order_references orf ON orf.id = c.order_id
    LEFT JOIN LATERAL (SELECT queue_name, assignee_name FROM assignments WHERE case_id = c.id AND released_at IS NULL ORDER BY assigned_at DESC LIMIT 1) a ON true
    LEFT JOIN LATERAL (SELECT id, status, approved_by, decided_at, decision_reason FROM approvals WHERE case_id = c.id ORDER BY created_at DESC LIMIT 1) ap ON true
    LEFT JOIN LATERAL (SELECT decision, reason, requested_information, created_at FROM human_work_decisions WHERE case_id = c.id ORDER BY created_at DESC LIMIT 1) hd ON true
    ${where} ORDER BY CASE c.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END, c.created_at`, params);
  const projectedByNumber = includeTwentyId ? await resolveProjectedCaseLinks(result.rows) : null;
  return result.rows.map(row => ({
    ...row,
    product_outcome: determineProductOutcome(row),
    age: `${Math.max(0, Math.floor(Number(row.age_seconds || 0) / 3600))}h`,
    age_seconds: Number(row.age_seconds || 0),
    owner: row.assignee_name || row.owner_scope,
    why_is_this_here: row.why_here,
    evidence: row.evidence || {},
    proposed_side_effect: row.proposed_side_effect || 'NO_EXECUTION',
    human_work_status: row.requires_human && !['RESOLVED', 'CLOSED'].includes(row.status)
      ? (row.human_work_status || 'NEW')
      : 'RESOLVED',
    human_decision: {
      required: Boolean(row.human_decision_required),
      status: row.human_decision_status || (row.human_decision_required ? 'PENDING' : 'NOT_REQUIRED'),
      latest: row.latest_human_decision || null,
      reason: row.human_decision_reason || null,
      requested_information: row.requested_information || null,
      recorded_at: row.human_decision_at || null,
      proposed_action: row.proposed_side_effect || 'NO_EXECUTION'
    },
    ...(projectedByNumber ? {
      twenty_id: projectedByNumber.get(row.case_number)?.id || null,
      twenty_link_status: projectedByNumber.get(row.case_number)?.status || 'UNAVAILABLE',
      twenty_link_reason: projectedByNumber.get(row.case_number)?.reason || 'no matching Twenty Case projection'
    } : {})
  }));
}

function parseAgentRecommendation(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function casePacket(row, communications = [], orderContext = null, agentRecommendation = null, relevantHistory = []) {
  const evidence = row.evidence || {};
  const policy = evidence.policy || {};
  const order = orderContext || evidence.order_context || null;
  const outcome = determineProductOutcome(row);
  const conversationSummary = communications.map(item => item.summary).filter(Boolean).join(' · ') || evidence.message || row.summary || 'Conversation summary unavailable.';
  const orderNum = order?.order_number || row.order_number;
  const orderStatus = order?.order_status || order?.status || 'unknown';
  const customerDisplayName = row.customer_name || 'Customer';
  const verifiedFacts = [
    `Customer identity: ${customerDisplayName} (${evidence.identity_resolution?.method || 'exact reference'})`,
    orderNum ? `Order #${orderNum}: status ${orderStatus} in Woo LAB` : 'Order context: No order reference attached',
    evidence.tracking_assessment ? `Tracking assessment: ${evidence.tracking_assessment.reason} (${evidence.tracking_assessment.state})` : null,
    evidence.channel ? `Channel: ${evidence.channel}` : null,
    'Containment: NO_EXECUTION verified in LAB'
  ].filter(Boolean);
  const knowledgeRecord = evidence.knowledge?.selected || row.evidence?.knowledge?.selected || {
    id: 'kb-support-core',
    title: 'Approved Customer Support Playbook',
    playbook: 'Standard containment and triage'
  };
  const whyStopped = row.why_here || row.human_work_waiting_reason || policy.reason || 'Containment boundary requires review before action.';
  const nextAction = row.recommended_action || 'Review the available evidence and record the next safe state.';
  const automationAttempt = evidence.customer_response
    ? `Automated response generated: "${evidence.customer_response}"`
    : (evidence.support_agent ? `Advisory agent evaluated: status=${evidence.support_agent.status}` : 'No autonomous action taken');
  const recommendation = agentRecommendation || policy.candidate_recommendation || null;
  const agentContract = evidence.support_agent ? {provider: evidence.support_agent.provider || null, model: evidence.support_agent.model || null, status: evidence.support_agent.status || null, playbook_version: evidence.playbook_version || policy.version || null, profile: evidence.profile || policy.profile || null, decision: recommendation?.disposition || null, escalation_reason: recommendation?.reason || evidence.support_agent.error_message || null, missing_information: recommendation?.missing_information || [], proposed_customer_response: recommendation?.draft || null, proposed_action: recommendation?.proposed_action || null} : null;
  return {
    customer_and_order: {
      customer: {id: row.customer_id, name: customerDisplayName},
      order: order ? {number: orderNum || null, status: orderStatus, source: order.source || row.order_source || null} : null,
      display: `${customerDisplayName} · ${orderNum ? '#' + orderNum : 'No order reference'}`
    },
    issue_summary: row.summary || evidence.message || 'Issue summary unavailable.',
    verified_facts: verifiedFacts,
    applicable_approved_policy_knowledge: {
      policy: {disposition: policy.disposition || policy.strategy || row.final_resolution_path || 'HUMAN_REVIEW', reason: policy.reason || row.why_here || 'Human review is required.', version: policy.version || 'support-routing-v2', hard_boundary: Boolean(policy.hard_boundary)},
      knowledge: knowledgeRecord
    },
    automation_result_attempt: {
      outcome,
      attempt: automationAttempt,
      status: outcome
    },
    why_it_stopped: whyStopped,
    recommended_next_action: nextAction,
    product_outcome: outcome,

    // legacy fields
    customer: {id: row.customer_id, name: customerDisplayName},
    order: order ? {number: orderNum || null, status: orderStatus, source: order.source || row.order_source || null} : null,
    issue: {type: row.case_type, summary: row.summary || evidence.message || 'Issue summary unavailable.'},
    conversation_summary: conversationSummary,
    order_tracking_context: order ? {order, tracking_assessment: evidence.tracking_assessment || null} : {order: null, tracking_assessment: evidence.tracking_assessment || null},
    ai_recommendation: {available: Boolean(recommendation), value: recommendation || 'No separate AI recommendation was recorded for this case.', source: recommendation ? (evidence.support_agent?.provider || (agentRecommendation ? 'support-worker' : 'policy_candidate_recommendation')) : 'not_recorded'},
    agent_contract: agentContract,
    proposed_action: {required: Boolean(row.human_decision_required), value: row.proposed_side_effect || 'No external action proposed.', execution: 'NO_EXECUTION'},
    policy: {disposition: policy.disposition || policy.strategy || row.final_resolution_path || 'HUMAN_REVIEW', reason: policy.reason || row.why_here || 'Human review is required.', version: policy.version || null, hard_boundary: Boolean(policy.hard_boundary)},
    evidence_available: verifiedFacts,
    missing_information: Array.isArray(evidence.missing_information) ? evidence.missing_information : [],
    relevant_history: relevantHistory,
    provenance: {source: row.source || 'chameleon-postgres', source_reference: row.source_reference || null, source_event_id: evidence.source_event_id || row.source_reference || null, operational_store: 'chameleon-postgres', order_source_of_truth: order?.source || 'woocommerce', execution: 'NO_EXECUTION'}
  };
}

async function humanWork() {
  const rows = await joinCases(`WHERE c.requires_human = true AND c.status NOT IN ('RESOLVED','CLOSED','WAITING_CUSTOMER') AND c.final_resolution_path <> 'WAITING_ON_CUSTOMER' AND COALESCE(c.human_work_status, 'NEW') <> 'WAITING' AND COALESCE(c.human_work_status, 'NEW') <> 'RESOLVED'`);
  return rows.map(row => ({
    ...row,
    human_work: {id: row.id, status: row.human_work_status || 'NEW', waiting_reason: row.human_work_waiting_reason || null},
    queue: 'HUMAN_WORK',
    presentation: 'Human Work'
  }));
}

async function humanWorkMetrics() {
  const result = await query(`SELECT
      count(*)::int AS total_support_interactions_evaluated,
      count(*) FILTER (WHERE c.requires_human = false AND c.status IN ('RESOLVED','CLOSED'))::int AS ai_resolved,
      count(*) FILTER (WHERE (c.status = 'WAITING_CUSTOMER' OR COALESCE(c.human_work_status, 'NEW') = 'WAITING' OR c.final_resolution_path = 'WAITING_ON_CUSTOMER') AND NOT (c.final_resolution_path IN ('AUTOMATION_FAILED','FAILED_AUTOMATION') OR COALESCE(c.evidence->'support_agent'->>'status','') = 'ERROR'))::int AS outcome_waiting_on_customer,
      count(*) FILTER (WHERE c.final_resolution_path IN ('AUTOMATION_FAILED','FAILED_AUTOMATION') OR COALESCE(c.evidence->'support_agent'->>'status','') = 'ERROR')::int AS outcome_failed_automation,
      count(*) FILTER (WHERE c.requires_human = true AND NOT (c.status = 'WAITING_CUSTOMER' OR COALESCE(c.human_work_status, 'NEW') = 'WAITING' OR c.final_resolution_path = 'WAITING_ON_CUSTOMER') AND NOT (c.final_resolution_path IN ('AUTOMATION_FAILED','FAILED_AUTOMATION') OR COALESCE(c.evidence->'support_agent'->>'status','') = 'ERROR'))::int AS outcome_needs_human,
      count(*) FILTER (WHERE c.requires_human = true)::int AS human_required,
      count(*) FILTER (WHERE c.requires_human = true AND COALESCE(c.human_work_status, 'NEW') = 'RESOLVED')::int AS human_completed,
      count(*) FILTER (WHERE c.requires_human = true AND COALESCE(c.human_work_status, 'NEW') = 'RESOLVED' AND c.resolved_at >= date_trunc('day', CURRENT_TIMESTAMP))::int AS resolved_today,
      count(*) FILTER (WHERE c.requires_human = true AND COALESCE(c.human_work_status, 'NEW') = 'WAITING')::int AS waiting,
      count(*) FILTER (WHERE c.requires_human = true AND c.status NOT IN ('RESOLVED','CLOSED') AND COALESCE(c.human_work_status, 'NEW') <> 'RESOLVED')::int AS open_human_work
    FROM support_events se
    JOIN cases c ON c.id = se.case_id`);
  const row = result.rows[0] || {};
  const total = Number(row.total_support_interactions_evaluated || 0);
  const resolvedWithoutHuman = Number(row.ai_resolved || 0);
  const humanRequired = Number(row.human_required || 0);
  const rate = value => total ? Number((Number(value || 0) / total).toFixed(4)) : 0;
  return {
    total_support_interactions_evaluated: total,
    ai_resolved: resolvedWithoutHuman,
    human_required: humanRequired,
    human_completed: Number(row.human_completed || 0),
    resolved_today: Number(row.resolved_today || 0),
    waiting: Number(row.waiting || 0),
    open_human_work: Number(row.open_human_work || 0),
    resolved_without_human: resolvedWithoutHuman,
    resolved_without_human_rate: rate(resolvedWithoutHuman),
    automation_rate: rate(resolvedWithoutHuman),
    human_required_rate: rate(humanRequired),
    product_outcomes: {
      resolved_automatically: resolvedWithoutHuman,
      waiting_on_customer: Number(row.outcome_waiting_on_customer || 0),
      needs_human: Number(row.outcome_needs_human || 0),
      failed_automation: Number(row.outcome_failed_automation || 0)
    },
    definitions: {
      total_support_interactions_evaluated: 'Stored support events joined to their Chameleon case.',
      resolved_without_human: 'AI-resolved interactions with no Human Work item, divided by total evaluated interactions.',
      human_required: 'Interactions whose Chameleon case requires a person; approval-required remains a policy classification within this count.',
      human_completed: 'Human-required cases whose Human Work state is RESOLVED.',
      resolved_today: 'Human-required cases resolved since the current LAB day began.',
      waiting: 'Human-required cases whose Human Work state is WAITING.',
      open_human_work: 'Human-required cases that are not terminal and whose Human Work state is not RESOLVED.',
      product_outcomes: 'Explicit breakdown of support interactions into: Resolved automatically, Waiting on customer, Needs Human, and Failed automation.'
    },
    source: 'chameleon-postgres',
    environment: 'LAB',
    execution: 'NO_EXECUTION'
  };
}

async function needsYou() {
  const rows = await joinCases(`WHERE c.status = 'WAITING_APPROVAL' AND c.owner_approval_required = true AND COALESCE(ap.status, 'PENDING') = 'PENDING'`);
  return rows.map(row => ({
    id: row.id,
    title: row.case_number || row.case_type,
    what_happened: row.summary || row.case_type,
    why_this_person_sees_it: row.why_here,
    owner: row.owner,
    age: row.age,
    due_state: row.due_at && new Date(row.due_at) < new Date() ? 'OVERDUE' : 'WITHIN_SLA',
    customer: row.customer_name,
    customer_id: row.customer_id,
    order: row.order_number,
    context: {case_type: row.case_type, priority: row.priority, source: row.source, source_reference: row.source_reference},
    evidence: row.evidence,
    recommended_action: row.recommended_action,
    proposed_side_effect: row.proposed_side_effect || 'NO_EXECUTION',
    approval_state: row.approval_status || (row.status === 'APPROVED_NO_EXECUTION' ? 'APPROVED_NO_EXECUTION' : 'NOT_REQUIRED'),
    status: row.status, approved_by: row.approved_by, decided_at: row.decided_at, decision_reason: row.decision_reason
  }));
}

async function caseTimeline(caseId) {
  const result = await query(`WITH target AS (SELECT order_id FROM cases WHERE id=$1)
    SELECT e.event_type, e.occurred_at, e.actor_type, e.source, e.source_id, e.provenance, 'operational_events' AS event_kind
      FROM operational_events e, target t
      WHERE e.case_id=$1 OR (t.order_id IS NOT NULL AND e.order_id=t.order_id)
    UNION ALL
    SELECT ce.event_type, ce.occurred_at, ce.actor_type, 'case_events', ce.id::text,
      jsonb_build_object('summary', ce.summary, 'case_id', ce.case_id), 'case_events'
      FROM case_events ce WHERE ce.case_id=$1
    UNION ALL
    SELECT 'CUSTOMER_MESSAGE_RECEIVED', m.occurred_at, 'CUSTOMER', m.source, m.external_message_id,
      jsonb_build_object('message', m.summary, 'channel', m.channel, 'communication_id', m.id), 'communications'
      FROM communication_references m LEFT JOIN support_events s ON s.source=m.source AND s.source_event_id=m.external_message_id
      WHERE COALESCE(m.case_id, s.case_id)=$1
    ORDER BY occurred_at, event_kind, source_id`, [caseId]);
  return result.rows.map(row => ({
    ...row,
    title: String(row.event_type || '').replaceAll('_', ' ').replace(/^./, value => value.toUpperCase()),
    summary: row.provenance?.summary || row.provenance?.message || row.event_type,
    source_of_truth: 'chameleon-postgres'
  }));
}

async function caseOrderContext(orderId) {
  if (!orderId) return null;
  const reference = await query(`SELECT o.*, cr.display_name_safe AS customer_name
    FROM order_references o JOIN customer_references cr ON cr.id=o.customer_reference_id
    WHERE o.id=$1`, [orderId]);
  if (!reference.rowCount) return null;
  const order = reference.rows[0];
  const items = await query(`SELECT sku, product_name, quantity, unit_price, line_total, source_line_item_id
    FROM demo_order_line_items WHERE order_id=$1 AND active=true ORDER BY created_at, source_line_item_id`, [orderId]);
  return {
    id: order.external_order_id,
    order_number: order.order_number,
    customer_id: order.customer_reference_id,
    customer_name: order.customer_name,
    amount: order.amount,
    currency: order.currency,
    order_status: order.order_status || order.fulfillment_status,
    fulfillment_state: order.fulfillment_state || order.fulfillment_status,
    payment_method_title: order.payment_method_title,
    billing_address: order.billing_address || {},
    shipping_address: order.shipping_address || {},
    same_as_billing: order.same_as_billing,
    tracking: order.tracking || [],
    refund_state: order.refund_state || 'NONE',
    refund_total: order.refund_total || 0,
    source: order.source,
    source_created_at: order.source_created_at,
    source_updated_at: order.source_updated_at,
    line_items: items.rows,
    source_of_truth: 'woocommerce',
    operational_store: 'chameleon-postgres',
    execution: 'NO_EXECUTION'
  };
}

async function caseDecisionContext(caseId, req) {
  const rows = await joinCases('WHERE c.id = $1', [caseId]);
  if (!rows[0]) return null;
  if (rows[0].owner_scope === 'OWNER' && !canReadOwnerApprovals(req)) return null;
  const [timeline, communications, auditRows, assignments, routingHistory, orderContext, agentActions, humanDecisions] = await Promise.all([
    caseTimeline(caseId),
    query('SELECT m.id, m.source, m.external_message_id, m.channel, m.direction, m.summary, m.occurred_at FROM communication_references m LEFT JOIN support_events s ON s.source=m.source AND s.source_event_id=m.external_message_id WHERE COALESCE(m.case_id, s.case_id)=$1 ORDER BY m.occurred_at', [caseId]),
    query('SELECT id, action, actor_type, actor_id, actor_role, policy_decision, before_summary, after_summary, correlation_id, created_at FROM audit_records WHERE resource_id=$1::text OR approval_id IN (SELECT id FROM approvals WHERE case_id=$2) ORDER BY created_at', [caseId, caseId]),
    query('SELECT queue_name, assignee_name, assigned_at, released_at, reason FROM assignments WHERE case_id=$1 ORDER BY assigned_at', [caseId]),
    query('SELECT strategy, queue_name, assignee_name, reason, handoff_number, created_at FROM routing_decisions WHERE case_id=$1 ORDER BY created_at', [caseId]),
    caseOrderContext(rows[0].order_id),
    query('SELECT recommendation FROM agent_actions WHERE case_id=$1 ORDER BY created_at DESC LIMIT 1', [caseId]),
    query('SELECT id, decision, actor_id, actor_role, proposed_action, policy_version, policy_disposition, reason, requested_information, execution, created_at FROM human_work_decisions WHERE case_id=$1 ORDER BY created_at DESC', [caseId])
  ]);
  const relevantHistory = timeline.map(item => ({event: item.title || item.event_type || 'Case event', summary: item.summary || 'Case event recorded.', occurred_at: item.occurred_at}));
  return {
    ...rows[0],
    communications: communications.rows,
    timeline,
    audit: auditRows.rows,
    assignments: assignments.rows,
    routing_history: routingHistory.rows,
    order_context: orderContext || rows[0].evidence?.order_context || null,
    human_work: {id: rows[0].id, status: rows[0].human_work_status || (rows[0].requires_human ? 'NEW' : 'RESOLVED'), waiting_reason: rows[0].human_work_waiting_reason || null},
    human_decision: {...(rows[0].human_decision || {}), records: humanDecisions.rows},
    case_packet: casePacket(rows[0], communications.rows, orderContext || rows[0].evidence?.order_context || null, parseAgentRecommendation(agentActions.rows[0]?.recommendation), relevantHistory),
    source_of_truth: 'chameleon-postgres',
    execution: 'NO_EXECUTION'
  };
}

async function recordAudit(client, {actorType, actorId, actorRole, action, resourceType, resourceId, policyDecision, approvalId = null, before = {}, after = {}, correlationId}) {
  await client.query(`INSERT INTO audit_records(id, actor_type, actor_id, actor_role, action, resource_type, resource_id, policy_decision, approval_id, before_summary, after_summary, correlation_id, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [crypto.randomUUID(), actorType, actorId, actorRole, action, resourceType, resourceId, policyDecision, approvalId, before, after, correlationId || null, new Date()]);
}

async function humanWorkAction(req, caseId, input) {
  const role = roleFrom(req);
  if (appEnv === 'production' || String(req.headers['x-chameleon-synthetic'] || '').toLowerCase() !== 'true') {
    throw Object.assign(new Error('Human Work actions are LAB-only'), {status: 403});
  }
  if (!canWriteCase(req, role)) throw Object.assign(new Error('case workflow action is not permitted'), {status: 403});
  const rawAction = String(input?.action || '').toUpperCase();
  const action = rawAction === 'ASK_CUSTOMER' ? 'REQUEST_MORE_INFORMATION' : rawAction;
  const decisionAction = ['APPROVE', 'REJECT', 'REQUEST_MORE_INFORMATION', 'EDIT'].includes(action);
  if (!['START_WORK', 'MARK_WAITING', 'RESOLVE', 'APPROVE', 'REJECT', 'REQUEST_MORE_INFORMATION', 'EDIT'].includes(action)) throw Object.assign(new Error('unsupported Human Work action'), {status: 400});
  const suppliedIdempotencyKey = String(input?.idempotency_key || req.headers['idempotency-key'] || `human-work:${action}:${userFrom(req)}`);
  const idempotencyKey = `${caseId}:${suppliedIdempotencyKey}`;
  const reason = String(input?.reason || '').trim() || null;
  const requestedInformation = String(input?.requested_information || input?.reason || '').trim() || null;
  return transaction(async client => {
    const prior = await client.query(`SELECT * FROM ${decisionAction ? 'human_work_decisions' : 'human_work_actions'} WHERE idempotency_key=$1`, [idempotencyKey]);
    if (prior.rowCount) return {status: 'accepted', idempotent: true, action: prior.rows[0], human_work_status: decisionAction ? (prior.rows[0].decision === 'REQUEST_MORE_INFORMATION' ? 'WAITING' : null) : prior.rows[0].after_status, human_decision_status: decisionAction ? ({APPROVE: 'APPROVED', REJECT: 'REJECTED', REQUEST_MORE_INFORMATION: 'MORE_INFORMATION_REQUESTED', EDIT: 'EDITED'}[prior.rows[0].decision]) : null, execution: 'NO_EXECUTION'};
    const result = await client.query('SELECT * FROM cases WHERE id=$1 FOR UPDATE', [caseId]);
    if (!result.rowCount) throw Object.assign(new Error('case not found'), {status: 404});
    const row = result.rows[0];
    const latestApproval = await client.query('SELECT * FROM approvals WHERE case_id=$1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE', [caseId]);
    const latestApprovalStatus = latestApproval.rows[0]?.status || null;
    if (!row.requires_human || ['RESOLVED', 'CLOSED'].includes(row.status)) throw Object.assign(new Error('case is not active Human Work'), {status: 409, code: 'HUMAN_WORK_NOT_ACTIVE'});
    const beforeStatus = row.human_work_status || 'NEW';
    if (beforeStatus === 'RESOLVED') throw Object.assign(new Error('Human Work is already resolved'), {status: 409, code: 'HUMAN_WORK_RESOLVED'});
    if (decisionAction) {
      if (!row.human_decision_required && !row.owner_approval_required) throw Object.assign(new Error('this case does not require a consequential Human Work decision'), {status: 409, code: 'HUMAN_DECISION_NOT_REQUIRED'});
      if (['APPROVE', 'REJECT', 'EDIT'].includes(action) && !reason) throw Object.assign(new Error('a decision reason is required'), {status: 400, code: 'DECISION_REASON_REQUIRED'});
      if (action === 'REQUEST_MORE_INFORMATION' && !requestedInformation) throw Object.assign(new Error('requested information is required'), {status: 400, code: 'REQUESTED_INFORMATION_REQUIRED'});
      if (row.owner_approval_required && ['APPROVE', 'REJECT'].includes(action) && !canApprove(req)) throw Object.assign(new Error('this policy requires an authorized owner decision'), {status: 403, code: 'OWNER_APPROVER_REQUIRED'});
      const latestDecision = await client.query('SELECT decision FROM human_work_decisions WHERE case_id=$1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE', [caseId]);
      if (latestDecision.rowCount && ['APPROVE', 'REJECT'].includes(latestDecision.rows[0].decision)) throw Object.assign(new Error('a final Human Work decision is already recorded'), {status: 409, code: 'HUMAN_DECISION_ALREADY_RECORDED'});
      if (row.owner_approval_required && ['APPROVE', 'REJECT'].includes(action)) {
        if (!latestApproval.rowCount) throw Object.assign(new Error('approval record not found for approval-required case'), {status: 409, code: 'APPROVAL_NOT_FOUND'});
        if (latestApprovalStatus !== 'PENDING') throw Object.assign(new Error('approval already has a recorded decision'), {status: 409, code: 'APPROVAL_ALREADY_DECIDED'});
      }
      const now = new Date();
      const decisionStatus = action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'REJECTED' : action === 'EDIT' ? 'EDITED' : 'MORE_INFORMATION_REQUESTED';
      const afterStatus = action === 'REQUEST_MORE_INFORMATION' ? 'WAITING' : beforeStatus;
      const nextCaseStatus = row.owner_approval_required && action === 'APPROVE'
        ? 'APPROVED_NO_EXECUTION'
        : row.owner_approval_required && action === 'REJECT'
          ? 'IN_PROGRESS'
          : row.status;
      let approvalId = null;
      if (row.owner_approval_required && ['APPROVE', 'REJECT'].includes(action)) {
        approvalId = latestApproval.rows[0].id;
        await client.query(`UPDATE approvals SET status=$1, approved_by=$2, approver_role='OWNER', decision_reason=$3, decided_at=$4 WHERE id=$5`, [action === 'APPROVE' ? 'APPROVED' : 'REJECTED', userFrom(req), reason, now, approvalId]);
      }
      await client.query(`UPDATE cases
        SET status=$1,
            human_work_status=$2,
            human_work_waiting_reason=$3,
            human_work_updated_at=$4,
            human_decision_status=$5,
            updated_at=$4
        WHERE id=$6`, [nextCaseStatus, afterStatus, action === 'REQUEST_MORE_INFORMATION' ? requestedInformation : row.human_work_waiting_reason, now, decisionStatus, caseId]);
      const saved = await client.query(`INSERT INTO human_work_decisions(id, case_id, idempotency_key, decision, actor_id, actor_role, proposed_action, policy_version, policy_disposition, reason, requested_information, execution, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'NO_EXECUTION',$12) RETURNING *`, [crypto.randomUUID(), caseId, idempotencyKey, action, userFrom(req), role, row.proposed_side_effect || 'NO_EXECUTION', row.evidence?.policy?.version || null, row.evidence?.policy?.disposition || row.evidence?.policy?.strategy || null, reason, action === 'REQUEST_MORE_INFORMATION' ? requestedInformation : null, now]);
      await client.query(`INSERT INTO case_events(id, case_id, event_type, summary, actor_type, occurred_at, created_at)
        VALUES ($1,$2,$3,$4,'HUMAN',$5,$5)`, [crypto.randomUUID(), caseId, `HUMAN_DECISION_${action}`, action === 'REQUEST_MORE_INFORMATION' ? `Human Work requested more information: ${requestedInformation}` : `Human Work ${action.toLowerCase()} recorded for the proposed action; NO_EXECUTION.`, now]);
      await recordAudit(client, {actorType: 'HUMAN', actorId: userFrom(req), actorRole: role, action: `HUMAN_DECISION_${action}`, resourceType: 'case', resourceId: caseId, policyDecision: row.owner_approval_required ? 'ALLOW_OWNER_APPROVER' : 'ALLOW_SYNTHETIC_ONLY', approvalId, before: {human_work_status: beforeStatus, human_decision_status: row.human_decision_status || 'PENDING'}, after: {decision: action, proposed_action: row.proposed_side_effect || 'NO_EXECUTION', reason, requested_information: action === 'REQUEST_MORE_INFORMATION' ? requestedInformation : null, human_work_status: afterStatus, human_decision_status: decisionStatus, execution: 'NO_EXECUTION'}, correlationId: idempotencyKey});
      return {status: 'accepted', idempotent: false, action: saved.rows[0], human_work_status: afterStatus, human_decision_status: decisionStatus, execution: 'NO_EXECUTION'};
    }
    if (action === 'RESOLVE' && row.owner_approval_required && row.status === 'WAITING_APPROVAL' && latestApprovalStatus === 'PENDING') {
      throw Object.assign(new Error('Resolve is blocked until the existing approval policy is satisfied'), {status: 409, code: 'APPROVAL_REQUIRED'});
    }
    if (action === 'RESOLVE' && row.human_decision_required && !['APPROVED', 'REJECTED'].includes(row.human_decision_status || 'PENDING') && !['APPROVED', 'REJECTED'].includes(latestApprovalStatus || 'PENDING')) {
      throw Object.assign(new Error('Resolve is blocked until a required Human Work decision is recorded'), {status: 409, code: 'HUMAN_DECISION_REQUIRED'});
    }
    const afterStatus = action === 'START_WORK'
      ? 'IN_PROGRESS'
      : action === 'MARK_WAITING'
        ? 'WAITING'
        : 'RESOLVED';
    const now = new Date();
    await client.query(`UPDATE cases
      SET human_work_status=$1,
          human_work_waiting_reason=$2,
          human_work_updated_at=$3,
          resolved_at=CASE WHEN $1='RESOLVED' THEN COALESCE(resolved_at, $3) ELSE resolved_at END,
          updated_at=$3
      WHERE id=$4`, [afterStatus, afterStatus === 'WAITING' ? reason : null, now, caseId]);
    const saved = await client.query(`INSERT INTO human_work_actions(id, case_id, idempotency_key, action, actor_id, actor_role, before_status, after_status, reason, execution, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'NO_EXECUTION',$10) RETURNING *`, [crypto.randomUUID(), caseId, idempotencyKey, action, userFrom(req), role, beforeStatus, afterStatus, reason, now]);
    await client.query(`INSERT INTO case_events(id, case_id, event_type, summary, actor_type, occurred_at, created_at)
      VALUES ($1,$2,$3,$4,'HUMAN',$5,$5)`, [crypto.randomUUID(), caseId, `HUMAN_WORK_${action}`, `Human Work moved from ${beforeStatus} to ${afterStatus}.${reason ? ` Reason: ${reason}` : ''}`, now]);
    await recordAudit(client, {actorType: 'HUMAN', actorId: userFrom(req), actorRole: role, action: `HUMAN_WORK_${action}`, resourceType: 'case', resourceId: caseId, policyDecision: 'ALLOW_SYNTHETIC_ONLY', before: {human_work_status: beforeStatus}, after: {human_work_status: afterStatus, reason, execution: 'NO_EXECUTION'}, correlationId: idempotencyKey});
    return {status: 'accepted', idempotent: false, action: saved.rows[0], human_work_status: afterStatus, execution: 'NO_EXECUTION'};
  });
}

async function checkoutSyncStatus(orderId) {
  const order = await query(`SELECT o.*, cr.display_name_safe AS customer_name
    FROM order_references o JOIN customer_references cr ON cr.id=o.customer_reference_id
    WHERE o.source='woocommerce-checkout-candidate' AND o.external_order_id=$1`, [String(orderId)]);
  if (!order.rowCount) return null;
  const reference = order.rows[0];
  const [items, events, projectedCustomer] = await Promise.all([
    query('SELECT * FROM demo_order_line_items WHERE order_id=$1 AND active=true ORDER BY created_at, source_line_item_id', [reference.id]),
    query('SELECT * FROM operational_events WHERE order_id=$1 ORDER BY occurred_at, ingested_at', [reference.id]),
    adapter.findByField('customers', 'customerId', reference.customer_reference_id).catch(() => null)
  ]);
  return {
    order: {
      id: reference.external_order_id,
      order_number: reference.order_number,
      amount: reference.amount,
      currency: reference.currency,
      status: reference.order_status || reference.fulfillment_status,
      payment_method: reference.payment_method,
      payment_method_title: reference.payment_method_title,
      billing_address: reference.billing_address,
      shipping_address: reference.shipping_address,
      same_as_billing: reference.same_as_billing,
      fulfillment_state: reference.fulfillment_state || reference.fulfillment_status,
      tracking: reference.tracking,
      refund_state: reference.refund_state || 'NONE',
      refund_total: reference.refund_total || 0,
      refunds: reference.refunds || [],
      source_event_id: reference.source_event_id,
      snapshot_hash: reference.snapshot_hash,
      source_created_at: reference.source_created_at
    },
    customer: {id: reference.customer_reference_id, name: reference.customer_name, customerId: reference.customer_reference_id, status: 'SOURCE_ACCEPTED'},
    twenty_projection: projectedCustomer ? {available: true, id: projectedCustomer.id, status: 'AVAILABLE'} : {available: false, status: 'UNAVAILABLE', reason: 'Chameleon source data remains available while Twenty projection is absent or unavailable.'},
    line_items: items.rows,
    line_item_count: items.rowCount,
    events: events.rows,
    event_count: events.rowCount,
    source_of_truth: 'woocommerce',
    operational_store: 'chameleon-postgres',
    crm_projection: 'twenty'
  };
}

async function operationalOrders(source = 'woocommerce-checkout-candidate') {
  const values = [];
  const where = source ? 'WHERE o.source=$1' : '';
  if (source) values.push(source);
  const result = await query(`SELECT o.*, cr.display_name_safe AS customer_name,
      COALESCE(json_agg(json_build_object(
        'sku', li.sku, 'product_name', li.product_name, 'quantity', li.quantity,
        'unit_price', li.unit_price, 'line_total', li.line_total,
        'source_line_item_id', li.source_line_item_id
      ) ORDER BY li.created_at) FILTER (WHERE li.id IS NOT NULL), '[]'::json) AS line_items
    FROM order_references o
    JOIN customer_references cr ON cr.id=o.customer_reference_id
    LEFT JOIN demo_order_line_items li ON li.order_id=o.id AND li.active=true
    ${where}
    GROUP BY o.id, cr.display_name_safe
    ORDER BY o.observed_at DESC`, values);
  return result.rows.map(row => ({
    id: row.external_order_id,
    order_number: row.order_number,
    customer_id: row.customer_reference_id,
    customer_name: row.customer_name,
    amount: row.amount,
    currency: row.currency,
    order_status: row.order_status || row.fulfillment_status,
    fulfillment_state: row.fulfillment_state || row.fulfillment_status,
    payment_method: row.payment_method,
    payment_method_title: row.payment_method_title,
    tracking: row.tracking,
    line_items: row.line_items,
    source: row.source,
    source_created_at: row.source_created_at,
    source_updated_at: row.source_updated_at,
    provenance: row.provenance,
    projection_status: 'CHAMELEON_ACCEPTED',
    source_of_truth: 'woocommerce',
    operational_store: 'chameleon-postgres',
    execution: 'NO_EXECUTION'
  }));
}

async function chatwootLabContacts(limit = 100) {
  const boundedLimit = Math.min(Math.max(Number(limit) || 100, 1), 100);
  const result = await query(`SELECT c.id, c.display_name_safe, c.external_customer_id, c.environment, c.source, c.provenance,
      COALESCE(json_agg(json_build_object(
        'order_id', o.id::text, 'order_reference', o.order_number, 'external_order_id', o.external_order_id,
        'source', o.source, 'status', COALESCE(o.fulfillment_state, o.order_status, o.fulfillment_status, 'UNKNOWN'),
        'amount', o.amount, 'currency', o.currency, 'tracking', o.tracking, 'observed_at', o.observed_at
      ) ORDER BY o.observed_at DESC) FILTER (WHERE o.id IS NOT NULL), '[]'::json) AS orders
    FROM customer_references c
    LEFT JOIN order_references o ON o.customer_reference_id=c.id
      AND o.source IN ('woocommerce-checkout-candidate','woocommerce-synthetic','woocommerce-fixture','woocommerce')
    WHERE c.environment='staging'
      AND COALESCE(c.provenance->>'execution','NO_EXECUTION')='NO_EXECUTION'
      AND (c.source IN ('woocommerce-checkout-candidate','woocommerce-synthetic','woocommerce-fixture','woocommerce')
        OR c.provenance->>'source_system'='woocommerce')
    GROUP BY c.id
    ORDER BY c.observed_at DESC
    LIMIT $1`, [boundedLimit]);
  return result.rows.map(row => ({
    id: String(row.id), customer_reference_id: String(row.id), customer_id: String(row.id),
    name: row.display_name_safe || 'Unresolved Customer', external_customer_id: row.external_customer_id,
    email: row.provenance?.email || '', phone: row.provenance?.phone || '', environment: row.environment,
    source: row.provenance?.source || row.source, orders: row.orders || [], fixture: false,
    note: 'Source-backed synthetic Woo LAB customer.'
  }));
}

async function ingest(req, input) {
  const provider = providerPayload(input);
  if (!provider.providerEventId || !provider.from || !provider.body) throw Object.assign(new Error('invalid synthetic message'), {status: 400});
  const {customer, order} = await resolveTwentyReferences(provider);
  const now = new Date();
  const caseType = classifyMessage(provider.body);
  return transaction(async client => {
    const receipt = await client.query(`INSERT INTO webhook_receipts(id, source, provider_event_id, payload_hash, status, details, received_at)
      VALUES ($1,'twilio',$2,$3,'RECEIVED',$4,$5) ON CONFLICT (source, provider_event_id) DO NOTHING RETURNING id`, [crypto.randomUUID(), provider.providerEventId, hashPayload(input), {synthetic: true}, now]);
    if (!receipt.rowCount) {
      const prior = await client.query('SELECT id FROM cases WHERE source = $1 AND source_reference = $2 LIMIT 1', ['twilio', provider.providerEventId]);
      return {status: 'replay', duplicate: true, provider_event_id: provider.providerEventId, case_id: prior.rows[0]?.id || null};
    }
    const customerReferenceId = customer.id;
    await client.query(`INSERT INTO customer_references(id, source, external_customer_id, display_name_safe, environment, provenance, observed_at)
      VALUES ($1,'twenty',$2,$3,'staging',$4,$5) ON CONFLICT (source, external_customer_id) DO UPDATE SET display_name_safe=EXCLUDED.display_name_safe, observed_at=EXCLUDED.observed_at`, [customerReferenceId, customer.id, customer.name || 'Synthetic Customer', {adapter: 'twenty-rest'}, now]);
    if (order) await client.query(`INSERT INTO order_references(id, source, external_order_id, order_number, customer_reference_id, fulfillment_status, provenance, observed_at)
      VALUES ($1,'woocommerce',$2,$3,$4,$5,$6,$7) ON CONFLICT (source, external_order_id) DO UPDATE SET order_number=EXCLUDED.order_number, observed_at=EXCLUDED.observed_at`, [order.id, order.id, order.orderNumber || order.name || 'Synthetic order', customerReferenceId, order.fulfillmentStatus || order.status || 'UNKNOWN', {adapter: 'twenty-reference-only'}, now]);
    const caseId = crypto.randomUUID();
    const approvalId = crypto.randomUUID();
    const caseNumber = `CASE-V2-${provider.providerEventId}`;
    const evidence = {message: provider.body, source: 'synthetic-twilio', provider_event_id: provider.providerEventId, customer_reference: customer.id, order_reference: order?.id || null};
    await client.query(`INSERT INTO communication_references(id, source, external_message_id, customer_reference_id, channel, direction, summary, occurred_at)
      VALUES ($1,'twilio',$2,$3,'SMS','INBOUND',$4,$5)`, [crypto.randomUUID(), provider.providerEventId, customerReferenceId, provider.body.slice(0, 240), provider.occurredAt]);
    await client.query(`INSERT INTO cases(id, customer_id, order_id, case_number, case_type, priority, status, owner_scope, requires_human, financial_action, fulfillment_action, source, source_reference, summary, why_here, recommended_action, proposed_side_effect, evidence, due_at, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,'HIGH','OPEN','CSR',true,'NONE','NONE','twilio',$6,$7,$8,$9,$10,$11,$12,$13,$13)`, [caseId, customer.id, order?.id || null, caseNumber, caseType, provider.providerEventId, provider.body.slice(0, 240), 'This is new inbound evidence of a customer exception and requires human review.', 'Review the broken-vial evidence and record a replacement decision.', 'Create a replacement shipment for the affected vial only if explicitly approved; no shipment will be created in V2.', evidence, new Date(now.getTime() + 48 * 3600000), now]);
    await client.query(`INSERT INTO assignments(id, case_id, queue_name, assignee_name, assigned_at, reason) VALUES ($1,$2,'CSR','CSR Queue',$3,'exception-routing')`, [crypto.randomUUID(), caseId, now]);
    await client.query(`INSERT INTO approvals(id, case_id, requested_by, action_type, status, proposed_side_effect, evidence, created_at)
      VALUES ($1,$2,'system:twilio','REPLACEMENT','PENDING',$3,$4,$5)`, [approvalId, caseId, 'Create a replacement shipment for the affected vial only; NO_EXECUTION.', evidence, now]);
    await client.query(`INSERT INTO idempotency_keys(id, scope, key_value, first_seen_at, resource_type, resource_id) VALUES ($1,'twilio',$2,$3,'case',$4)`, [crypto.randomUUID(), provider.providerEventId, now, caseId]);
    await client.query(`INSERT INTO operational_events(id, customer_id, order_id, case_id, event_type, source, source_id, actor_type, occurred_at, ingested_at, provenance, correlation_id, idempotency_key)
      VALUES ($1,$2,$3,$4,'CUSTOMER_MESSAGE_RECEIVED','twilio',$5,'CUSTOMER',$6,$7,$8,$9,$5),($10,$2,$3,$4,'CASE_CREATED','chameleon-operations',$4,'SYSTEM',$7,$7,$8,$9,$5)`, [crypto.randomUUID(), customer.id, order?.id || null, caseId, provider.providerEventId, provider.occurredAt, now, evidence, provider.providerEventId, crypto.randomUUID()]);
    await recordAudit(client, {actorType: 'SYSTEM', actorId: 'twilio', actorRole: 'SYNTHETIC', action: 'INGEST_ACCEPTED', resourceType: 'case', resourceId: caseId, policyDecision: 'ALLOW_SYNTHETIC_ONLY', after: {case_type: caseType, approval_id: approvalId, execution_status: 'NO_EXECUTION'}, correlationId: provider.providerEventId});
    return {status: 'accepted', duplicate: false, synthetic: true, provider_event_id: provider.providerEventId, customer_id: customer.id, order_id: order?.id || null, case_id: caseId, approval_id: approvalId, case_type: caseType, execution: {status: 'NO_EXECUTION'}};
  });
}

async function decideApproval(req, caseId, input) {
  if (!canApprove(req)) throw Object.assign(new Error('Stuart or Cory owner approval required'), {status: 403});
  const decision = String(input.decision || '').toUpperCase();
  if (!['APPROVED', 'REJECTED'].includes(decision)) throw Object.assign(new Error('decision must be APPROVED or REJECTED'), {status: 400});
  const decisionAction = String(input.decision_action || 'APPROVAL_INTENT').toUpperCase();
  if (!['APPROVAL_INTENT', 'RESHIP', 'REFUND', 'REPLY'].includes(decisionAction)) throw Object.assign(new Error('decision action must be RESHIP, REFUND, REPLY, or APPROVAL_INTENT'), {status: 400});
  const user = userFrom(req);
  return transaction(async client => {
    const result = await client.query('SELECT * FROM approvals WHERE case_id = $1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE', [caseId]);
    if (!result.rowCount) throw Object.assign(new Error('approval not found'), {status: 404});
    const approval = result.rows[0];
    if (approval.status !== 'PENDING') return {approval, execution: {status: 'NO_EXECUTION'}, idempotent: true};
    const nextCaseStatus = decision === 'APPROVED' ? 'APPROVED_NO_EXECUTION' : 'IN_PROGRESS';
    const reason = `${decisionAction !== 'APPROVAL_INTENT' ? `[${decisionAction}] ` : ''}${input.reason || 'Recorded by owner; no external execution configured.'}`;
    const updated = await client.query(`UPDATE approvals SET status=$1, approved_by=$2, approver_role='OWNER', decision_reason=$3, decided_at=$4 WHERE id=$5 RETURNING *`, [decision, user, reason, new Date(), approval.id]);
    await client.query('UPDATE cases SET status=$1, updated_at=$2 WHERE id=$3', [nextCaseStatus, new Date(), caseId]);
    const projection = await enqueueTwentyProjection(client, {entityType: 'case', entityId: caseId, source: 'chameleon-approval', sourceEventId: approval.id, payload: {decision, replay: true}});
    await client.query(`INSERT INTO operational_events(id, case_id, event_type, source, source_id, actor_type, occurred_at, ingested_at, provenance)
      VALUES ($1,$2,'APPROVAL_RECORDED','chameleon-operations',$3,'OWNER',$4,$4,$5)`, [crypto.randomUUID(), caseId, approval.id, new Date(), {decision, approver: user, execution: 'NO_EXECUTION'}]);
    await recordAudit(client, {actorType: 'HUMAN', actorId: user, actorRole: 'OWNER', action: 'APPROVAL_RECORDED', resourceType: 'case', resourceId: caseId, policyDecision: 'ALLOW_OWNER_APPROVER', approvalId: approval.id, before: {status: approval.status}, after: {decision, decision_action: decisionAction, case_status: nextCaseStatus, execution: 'NO_EXECUTION'}});
    return {approval: updated.rows[0], case_status: nextCaseStatus, decision_action: decisionAction, projection_status: projection.status, projection_job_id: projection.id, execution: {status: 'NO_EXECUTION', reason: 'Approval records intent only; no provider is configured'}, idempotent: false};
  });
}

function twilioSupportEvent(input) {
  return {
    source: 'synthetic',
    source_event_id: String(input.MessageSid || input.message_sid || ''),
    channel: 'sms',
    sender: {phone: input.From || input.from, external_participant_id: input.external_participant_id},
    message: input.Body || input.body,
    timestamp: input.Timestamp || input.timestamp,
    conversation_reference: input.conversation_reference || input.thread_reference,
    order_reference: input.order_reference || input.order_number || (String(input.From || input.from) === '+15550100001' ? 'TEST-ORDER-10001' : ''),
    order_source: input.order_source || input.metadata?.order_source,
    customer_reference_id: input.customer_reference_id || input.customer_id,
    routing_strategy: input.routing_strategy || input.metadata?.routing_strategy,
    metadata: {...(input.metadata || {}), adapter: 'twilio-synthetic'}
  };
}

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  if (req.method === 'POST' && url.pathname === '/api/v2/auth/login') {
    try {
      const input = await readBody(req);
      const user = await authenticateCredentials(input.username || input.email, input.password);
      if (!user) return json(res, 401, {error: {code: 'INVALID_CREDENTIALS', message: 'invalid username or password'}});
      const session = await createSession(user.id);
      await touchLogin(user.id);
      return json(res, 200, {user: publicUser(user), expires_at: session.expiresAt.toISOString(), session_token: session.token});
    } catch (error) {
      return json(res, error.status || 400, {error: {code: error.code || 'LOGIN_FAILED', message: error.message}});
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/v2/auth/me') {
    const user = await authenticateRequest(req);
    return user ? json(res, 200, {user: publicUser(user)}) : unauthorized(res);
  }
  if (req.method === 'POST' && url.pathname === '/api/v2/auth/logout') {
    await revokeSessionToken(bearerToken(req));
    return json(res, 200, {status: 'logged_out'});
  }
  if (req.method === 'GET' && url.pathname === '/api/v2/health') {
    try {
      await query('SELECT 1');
      if (twentyEnabled) await adapter.ping();
      return json(res, 200, {
        status: 'ok',
        backend: twentyEnabled ? 'chameleon-postgres+twenty' : 'chameleon-postgres',
        twenty_projection: twentyEnabled ? 'enabled' : 'disabled',
        control_plane: 'v2',
        runtime,
        execution: 'NO_EXECUTION'
      });
    } catch (error) { return json(res, 503, {status: 'degraded', error: {code: 'DEPENDENCY_UNAVAILABLE', message: error.message}}); }
  }
  if (req.method === 'GET' && url.pathname === '/api/v2/runtime') {
    return json(res, 200, {runtime, support_ingress: supportIngress, support_agent: supportAgent.runtime(), execution: 'NO_EXECUTION'});
  }
  if (req.method === 'POST' && url.pathname === CHATWOOT_SHADOW_ROUTE) {
    const authorized = authorizeChatwootShadowRequest({headers: req.headers});
    if (!authorized.ok) return json(res, authorized.status, {error: {code: authorized.code, message: authorized.message}, execution: 'NO_EXECUTION'});
    try { return json(res, 200, await ingestChatwootSupport(await readBody(req), authorized.sourceAuth)); }
    catch (error) { return json(res, error.status || 400, {error: {code: error.code || 'CHATWOOT_SHADOW_INGEST_REJECTED', message: error.message}, execution: 'NO_EXECUTION'}); }
  }
  if (req.method === 'POST' && url.pathname === '/api/v2/ingest/chatwoot') {
    if (appEnv === 'production' || String(req.headers['x-chameleon-synthetic'] || '').toLowerCase() !== 'true') return json(res, 403, {error: {code: 'SYNTHETIC_ONLY'}, execution: 'NO_EXECUTION'});
    try { return json(res, 200, await ingestChatwootSupport(await readBody(req))); }
    catch (error) { return json(res, error.status || 400, {error: {code: error.code || 'CHATWOOT_INGEST_REJECTED', message: error.message}, execution: 'NO_EXECUTION'}); }
  }
  if (req.method === 'GET' && url.pathname === '/api/v2/support/knowledge') {
    return json(res, 200, {items: supportKnowledgeCatalog(), source: 'chameleon-policy', mode: supportIngress.mode, execution: 'NO_EXECUTION'});
  }
  const authenticated = await authenticateRequest(req);
  const principal = authenticated
    ? {...publicUser(authenticated), authenticated: true, synthetic: false}
    : syntheticPrincipal(req);
  if (!principal) return unauthorized(res);
  req.chameleonPrincipal = principal;
  const role = roleFrom(req);
  if (req.method === 'GET' && url.pathname === '/api/v2/users') {
    if (!adminOnly(req, res)) return;
    return json(res, 200, {items: await listUsers()});
  }
  if (req.method === 'POST' && url.pathname === '/api/v2/users') {
    if (!adminOnly(req, res)) return;
    try {
      const created = await createUser(await readBody(req));
      const safe = publicUser(created);
      await recordAccessAudit(principal, 'USER_CREATED', safe.id, {}, {user: safe});
      return json(res, 201, {user: safe});
    } catch (error) {
      return json(res, error.status || 400, {error: {code: error.code || 'USER_CREATE_FAILED', message: error.message}});
    }
  }
  if (parts[0] === 'api' && parts[1] === 'v2' && parts[2] === 'users' && parts[3] && req.method === 'PATCH') {
    if (!adminOnly(req, res)) return;
    try {
      const before = publicUser(await findUserById(parts[3]));
      const updated = await updateUser(parts[3], await readBody(req));
      const safe = publicUser(updated);
      await recordAccessAudit(principal, 'USER_UPDATED', safe.id, {user: before}, {user: safe});
      return json(res, 200, {user: safe});
    } catch (error) {
      return json(res, error.status || 400, {error: {code: error.code || 'USER_UPDATE_FAILED', message: error.message}});
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/v2/support-policy') {
    if (!canRead(role, 'cases')) return denied(res);
    return json(res, 200, {current: await currentPolicy(query), history: await policyHistory(query), metrics: await policyMetrics(query), rules: policyRules(), synthetic: true, environment: 'LAB', execution: 'NO_EXECUTION'});
  }
  if (req.method === 'GET' && url.pathname === '/api/v2/support-policy/metrics') {
    if (!canRead(role, 'cases')) return denied(res);
    return json(res, 200, await policyMetrics(query));
  }
  if (req.method === 'POST' && url.pathname === '/api/v2/support-policy') {
    if (appEnv === 'production' || !['OWNER', 'OPERATIONS'].includes(role) || String(req.headers['x-chameleon-synthetic'] || '').toLowerCase() !== 'true') return denied(res, 'LAB-only policy changes require Owner or Operations synthetic access');
    try {
      const input = await readBody(req);
      if (input.rollback_to_version) {
        const target = await query('SELECT * FROM support_policy_versions WHERE policy_version=$1', [String(input.rollback_to_version)]);
        if (!target.rowCount) return json(res, 404, {error: {code: 'POLICY_VERSION_NOT_FOUND'}});
        const prior = await currentPolicy(query);
        await query('UPDATE support_policy_versions SET enabled=(policy_version=$1) ', [String(input.rollback_to_version)]);
        await query(`INSERT INTO audit_records (id, actor_type, actor_id, actor_role, action, resource_type, resource_id, policy_decision, before_summary, after_summary, correlation_id, created_at)
          VALUES ($1,'HUMAN',$2,$3,'SUPPORT_POLICY_ROLLBACK','support_policy',$4,'ALLOW_SYNTHETIC_ONLY',$5,$6,$7,now())`, [crypto.randomUUID(), userFrom(req), role, String(input.rollback_to_version), prior, {policy_version: input.rollback_to_version, rollback: true, execution: 'NO_EXECUTION'}, String(input.rollback_to_version)]);
        return json(res, 200, {status: 'rolled_back', current: await currentPolicy(query), synthetic: true, execution: 'NO_EXECUTION'});
      }
      const preset = String(input.preset || 'STANDARD').toUpperCase();
      if (!PRESETS.has(preset)) return json(res, 400, {error: {code: 'INVALID_PRESET'}});
      const prior = await currentPolicy(query);
      const version = `ai-support-policy-v1-${Date.now()}`;
      const changedBy = userFrom(req);
      await query(`INSERT INTO support_policy_versions (id, policy_version, preset, intent, disposition, conditions, hard_boundary, enabled, changed_by, previous_version, rollback_reference, rules)
        VALUES ($1,$2,$3,'ALL','STAFF_REVIEW',$4,false,true,$5,$6,$6,$7)`, [crypto.randomUUID(), version, preset, {source: 'LAB UI/API', request: input.reason || null}, changedBy, prior.policy_version || null, policyRules()]);
      await query('UPDATE support_policy_versions SET enabled=false WHERE policy_version <> $1', [version]);
      await query(`INSERT INTO audit_records (id, actor_type, actor_id, actor_role, action, resource_type, resource_id, policy_decision, before_summary, after_summary, correlation_id, created_at)
        VALUES ($1,'HUMAN',$2,$3,'SUPPORT_POLICY_CHANGED','support_policy',$4,'ALLOW_SYNTHETIC_ONLY',$5,$6,$7,now())`, [crypto.randomUUID(), changedBy, role, version, prior, {policy_version: version, preset, changed_by: changedBy, execution: 'NO_EXECUTION'}, version]);
      return json(res, 200, {status: 'updated', current: await currentPolicy(query), audit: {action: 'SUPPORT_POLICY_CHANGED', previous_version: prior.policy_version || null, new_version: version}, synthetic: true, execution: 'NO_EXECUTION'});
    } catch (error) { return json(res, 400, {error: {code: 'SUPPORT_POLICY_UPDATE_REJECTED', message: error.message}}); }
  }
  if (req.method === 'POST' && url.pathname === '/api/v2/ingest/woocommerce-checkout') {
    if (appEnv === 'production' || String(req.headers['x-chameleon-synthetic'] || '').toLowerCase() !== 'true') return json(res, 403, {error: {code: 'SYNTHETIC_ONLY'}});
    try { return json(res, 200, await syncCheckoutOrders(adapter, await readBody(req))); }
    catch (error) { return json(res, error.status || 400, {error: {code: error.code || 'CHECKOUT_SYNC_REJECTED', message: error.message}}); }
  }
  if (req.method === 'POST' && url.pathname === '/api/v2/ingest/woocommerce-order-events') {
    if (appEnv === 'production' || String(req.headers['x-chameleon-synthetic'] || '').toLowerCase() !== 'true') return json(res, 403, {error: {code: 'SYNTHETIC_ONLY'}});
    try { return json(res, 200, await ingestWooOrderEvents(adapter, await readBody(req))); }
    catch (error) { return json(res, error.status || 400, {error: {code: error.code || 'ORDER_EVENT_REJECTED', message: error.message}}); }
  }
  if (req.method === 'POST' && url.pathname === '/api/v2/internal/woo-catchup-health') {
    if (String(req.headers['x-chameleon-synthetic'] || '').toLowerCase() !== 'true') return json(res, 403, {error: {code: 'SYNTHETIC_ONLY'}});
    try { return json(res, 200, await recordWooCatchupHealth(await readBody(req))); }
    catch (error) { return json(res, error.status || 400, {error: {code: error.code || 'WOO_CATCHUP_HEALTH_REJECTED', message: error.message}}); }
  }
  if (req.method === 'POST' && url.pathname === '/api/v2/ingest/support') {
    if (appEnv === 'production' || String(req.headers['x-chameleon-synthetic'] || '').toLowerCase() !== 'true') return json(res, 403, {error: {code: 'SYNTHETIC_ONLY'}});
    try {
      return json(res, 200, await ingestSyntheticSupport(await readBody(req)));
    } catch (error) { return json(res, error.status || 400, {error: {code: error.code || 'SUPPORT_INGEST_REJECTED', message: error.message}}); }
  }
  if (req.method === 'POST' && url.pathname === '/api/v2/webhooks/twilio/sms') {
    const verified = validateTwilioSmsWebhook({
      headers: req.headers,
      rawBody: await readRawBody(req),
      config: twilioIngress,
      appEnv,
      syntheticOnly: process.env.SYNTHETIC_ONLY !== 'false'
    });
    if (!verified.ok) return json(res, verified.status, {error: verified.error, execution: 'NO_EXECUTION'});
    try {
      const accepted = await ingestSyntheticSupport(verified.input);
      return json(res, 200, {...accepted, transport: verified.receipt});
    } catch (error) {
      return json(res, error.status || 400, {error: {code: error.code || 'TWILIO_INGEST_REJECTED', message: error.message}, execution: 'NO_EXECUTION'});
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/v2/checkout-sync/status') {
    if (!canRead(role, 'customers')) return denied(res);
    const value = await checkoutSyncStatus(url.searchParams.get('order_id') || '');
    return value ? json(res, 200, value) : json(res, 404, {error: {code: 'NOT_FOUND'}});
  }
  if (req.method === 'GET' && url.pathname === '/api/v2/orders') {
    if (!canRead(role, 'orders')) return denied(res);
    const requestedSource = String(url.searchParams.get('source') || 'woocommerce-checkout-candidate');
    if (!['woocommerce-checkout-candidate', 'woocommerce-synthetic', 'woocommerce-fixture', 'woocommerce', 'woocommerce-all'].includes(requestedSource)) return json(res, 400, {error: {code: 'INVALID_SOURCE'}});
    const source = requestedSource === 'woocommerce-all' ? '' : requestedSource;
    return json(res, 200, {items: await operationalOrders(source), source_of_truth: 'woocommerce', operational_store: 'chameleon-postgres', synthetic: true, execution: 'NO_EXECUTION'});
  }
  if (req.method === 'GET' && url.pathname === '/api/v2/support/lab-contacts') {
    if (!canRead(role, 'customers')) return denied(res);
    return json(res, 200, {items: await chatwootLabContacts(url.searchParams.get('limit')), source: 'chameleon-postgres', source_of_truth: 'chameleon-postgres', operational_store: 'chameleon-postgres', synthetic: true, environment: 'LAB', execution: 'NO_EXECUTION'});
  }
  if (req.method === 'POST' && url.pathname === '/api/v2/ingest/twilio') {
    if (appEnv === 'production' || String(req.headers['x-chameleon-synthetic'] || '').toLowerCase() !== 'true' || String(req.headers['x-twilio-signature'] || '') !== 'synthetic-test') return json(res, 403, {error: {code: 'SYNTHETIC_ONLY'}});
    try { return json(res, 200, {...await ingestSupportEvent({adapter, input: twilioSupportEvent(await readBody(req))}), transport: 'twilio-adapter'}); } catch (error) { return json(res, error.status || 400, {error: {code: 'INGEST_REJECTED', message: error.message}}); }
  }
  if (req.method === 'POST' && url.pathname === '/api/v2/demo/checkout') {
    try { return json(res, 200, await syntheticDemo.checkout(req, await readBody(req))); } catch (error) { return json(res, error.status || 400, {error: {code: 'DEMO_CHECKOUT_REJECTED', message: error.message}}); }
  }
  if (req.method === 'POST' && url.pathname === '/api/v2/demo/fulfillment') {
    try { return json(res, 200, await syntheticDemo.fulfillment(req, await readBody(req))); } catch (error) { return json(res, error.status || 400, {error: {code: 'DEMO_FULFILLMENT_REJECTED', message: error.message}}); }
  }
  if (req.method === 'POST' && url.pathname === '/api/v2/demo/call') {
    try { return json(res, 200, await syntheticDemo.callRecord(req, await readBody(req))); } catch (error) { return json(res, error.status || 400, {error: {code: 'DEMO_CALL_REJECTED', message: error.message}}); }
  }
  if (req.method === 'POST' && url.pathname === '/api/v2/demo/chat') {
    try { return json(res, 200, await syntheticDemo.chatMessage(req, await readBody(req))); } catch (error) { return json(res, error.status || 400, {error: {code: 'DEMO_CHAT_REJECTED', message: error.message}}); }
  }
  if (req.method === 'POST' && url.pathname === '/api/v2/demo/damaged-case') {
    try { return json(res, 200, await syntheticDemo.damagedCase(req, await readBody(req))); } catch (error) { return json(res, error.status || 400, {error: {code: 'DEMO_CASE_REJECTED', message: error.message}}); }
  }
  if (req.method === 'POST' && url.pathname === '/api/v2/demo/csr-claim') {
    try { return json(res, 200, await syntheticDemo.csrClaim(req, await readBody(req))); } catch (error) { return json(res, error.status || 400, {error: {code: 'DEMO_CSR_CLAIM_REJECTED', message: error.message}}); }
  }
  if (req.method === 'POST' && url.pathname === '/api/v2/demo/csr-resolve') {
    try { return json(res, 200, await syntheticDemo.csrResolve(req, await readBody(req))); } catch (error) { return json(res, error.status || 400, {error: {code: 'DEMO_CSR_RESOLVE_REJECTED', message: error.message}}); }
  }
  if (req.method === 'POST' && url.pathname === '/api/v2/demo/processor-confirmation') {
    try { return json(res, 200, await syntheticDemo.processorConfirmation(req, await readBody(req))); } catch (error) { return json(res, error.status || 400, {error: {code: 'DEMO_PROCESSOR_REJECTED', message: error.message}}); }
  }
  if (req.method === 'POST' && url.pathname === '/api/v2/demo/reset') {
    try { return json(res, 200, await syntheticDemo.reset(req, await readBody(req))); } catch (error) { return json(res, error.status || 400, {error: {code: 'DEMO_RESET_REJECTED', message: error.message}}); }
  }
  if (req.method === 'POST' && url.pathname === '/api/v2/demo/curated-operations') {
    try { return json(res, 200, await syntheticDemo.curatedOperations(req, await readBody(req))); } catch (error) { return json(res, error.status || 400, {error: {code: 'DEMO_CURATED_OPERATIONS_REJECTED', message: error.message}}); }
  }
  if (req.method === 'POST' && url.pathname === '/api/v2/demo/job-health') {
    try { return json(res, 200, await syntheticDemo.resetJobHealth(req, await readBody(req))); } catch (error) { return json(res, error.status || 400, {error: {code: 'DEMO_HEALTH_REJECTED', message: error.message}}); }
  }
  if (req.method === 'GET' && url.pathname === '/api/v2/demo/state') {
    return json(res, 200, await syntheticDemo.state(Object.fromEntries(url.searchParams.entries())));
  }
  if (req.method === 'GET' && url.pathname === '/api/v2/needs-you') {
    if (!canReadOwnerApprovals(req)) return denied(res, 'owner approval visibility requires an authorized approver');
    return json(res, 200, {items: await needsYou(), generated_at: new Date().toISOString(), synthetic: true});
  }
  if (req.method === 'GET' && url.pathname === '/api/v2/human-work') {
    if (!canRead(role, 'cases')) return denied(res);
    const items = (await humanWork()).map(row => redactCaseRow(row, req));
    return json(res, 200, {items, count: items.length, queue: 'HUMAN_WORK', presentation: 'Human Work', generated_at: new Date().toISOString(), synthetic: true, environment: 'LAB', execution: 'NO_EXECUTION'});
  }
  if (req.method === 'GET' && url.pathname === '/api/v2/human-work/metrics') {
    if (!canRead(role, 'cases')) return denied(res);
    return json(res, 200, await humanWorkMetrics());
  }
  if (req.method === 'GET' && url.pathname === '/api/v2/cases') {
    if (!canRead(role, 'cases')) return denied(res);
    const rows = await joinCases('', [], url.searchParams.get('include_twenty_id') === 'true');
    return json(res, 200, {items: rows.map(row => redactCaseRow(row, req)), synthetic: true});
  }
  if (req.method === 'GET' && url.pathname === '/api/v2/approvals') {
    if (!canReadOwnerApprovals(req)) return denied(res, 'owner approval visibility requires an authorized approver');
    const result = await query(`SELECT a.*, c.case_number, c.case_type, c.customer_id FROM approvals a JOIN cases c ON c.id=a.case_id ORDER BY a.created_at DESC`);
    return json(res, 200, {items: result.rows, synthetic: true});
  }
  if (req.method === 'GET' && url.pathname === '/api/v2/audit') {
    if (!canReadOwnerApprovals(req)) return denied(res, 'owner approval audit visibility requires an authorized approver');
    const result = await query('SELECT id, actor_type, actor_id, actor_role, action, resource_type, resource_id, policy_decision, approval_id, before_summary, after_summary, correlation_id, created_at FROM audit_records ORDER BY created_at DESC LIMIT 100');
    return json(res, 200, {items: result.rows, synthetic: true});
  }
  if (req.method === 'GET' && url.pathname === '/api/v2/job-health') {
    if (!canRead(role, 'job_health')) return denied(res);
    const result = await query(`SELECT job_name, expected_cadence_seconds, last_seen_at, evidence,
      CASE WHEN COALESCE(evidence->>'status', '') = 'ERROR' THEN 'DOWN'
           WHEN COALESCE(evidence->>'status', '') IN ('DISABLED','IDLE') THEN COALESCE(evidence->>'status', '')
           WHEN EXTRACT(EPOCH FROM (now()-last_seen_at)) > expected_cadence_seconds*2 THEN 'DOWN'
           WHEN EXTRACT(EPOCH FROM (now()-last_seen_at)) > expected_cadence_seconds THEN 'LATE' ELSE 'UP' END AS state
      FROM job_health ORDER BY job_name`);
    return json(res, 200, {items: result.rows, synthetic: true});
  }
  if (req.method === 'GET' && url.pathname === '/api/v2/twenty/projection') {
    if (!canRead(role, 'job_health')) return denied(res);
    const [items, recentAttempts] = await Promise.all([projectionStats(), recentProjectionAttempts()]);
    return json(res, 200, {items, recent_attempts: recentAttempts, source_of_truth: 'chameleon-postgres', projection: 'twenty', execution: 'NO_EXECUTION'});
  }
  if (req.method === 'GET' && url.pathname === '/api/v2/customers') {
    if (!canRead(role, 'customers')) return denied(res);
    const rows = (await adapter.list('customers')).sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    return json(res, 200, {items: rows.map(row => adapter.customerView(row, role)), source: 'twenty', synthetic: true});
  }
  if (parts[0] === 'api' && parts[1] === 'v2' && parts[2] === 'customers' && parts[3] && parts[4] === 'support' && req.method === 'GET') {
    if (!canRead(role, 'customers')) return denied(res);
    const resolved = await resolveCustomerRead(parts[3]);
    if (!resolved.customer) return json(res, 404, {error: {code: 'NOT_FOUND'}});
    const sourceId = resolved.sourceId;
    const [supportEvents, routingHistory] = await Promise.all([
      query('SELECT id, source, source_event_id, channel, sender_identity, order_reference_id, message_body, conversation_reference, identity_match_method, case_id, occurred_at, received_at, metadata FROM support_events WHERE customer_reference_id=$1::uuid ORDER BY occurred_at, created_at', [sourceId]),
      query('SELECT rd.*, c.case_number, c.case_type, c.status AS case_status FROM routing_decisions rd JOIN cases c ON c.id=rd.case_id WHERE c.customer_id=$1::uuid ORDER BY rd.created_at', [sourceId])
    ]);
    return json(res, 200, {customer: adapter.customerView(resolved.customer, role), customer_reference_id: sourceId, twenty_projection: customerProjectionStatus(resolved), support_events: supportEvents.rows, routing_history: routingHistory.rows, synthetic: true, execution: 'NO_EXECUTION'});
  }
  if (parts[0] === 'api' && parts[1] === 'v2' && parts[2] === 'customers' && parts[3] && req.method === 'GET') {
    if (!canRead(role, 'customers')) return denied(res);
    const resolved = await resolveCustomerRead(parts[3]);
    if (!resolved.customer) return json(res, 404, {error: {code: 'NOT_FOUND'}});
    const sourceId = resolved.sourceId;
    const rows = await joinCases('WHERE c.customer_id = $1::uuid', [sourceId]);
    const refs = await query('SELECT * FROM communication_references WHERE customer_reference_id=$1::uuid ORDER BY occurred_at', [sourceId]);
    const [orders, calls, chat, events, auditRows] = await Promise.all([
      query(`SELECT o.*, COALESCE(json_agg(json_build_object('sku',li.sku,'product_name',li.product_name,'quantity',li.quantity,'unit_price',li.unit_price,'line_total',li.line_total,'active',li.active,'source_line_item_id',li.source_line_item_id) ORDER BY li.created_at) FILTER (WHERE li.id IS NOT NULL), '[]'::json) AS line_items FROM order_references o LEFT JOIN demo_order_line_items li ON li.order_id=o.id AND li.active=true WHERE o.customer_reference_id=$1::uuid GROUP BY o.id ORDER BY o.observed_at`, [sourceId]),
      query('SELECT * FROM call_references WHERE customer_reference_id=$1::uuid ORDER BY occurred_at', [sourceId]),
      query('SELECT * FROM chat_messages WHERE customer_reference_id=$1::uuid ORDER BY occurred_at', [sourceId]),
      query('SELECT * FROM operational_events WHERE customer_id=$1::uuid OR case_id IN (SELECT id FROM cases WHERE customer_id=$1::uuid) ORDER BY occurred_at', [sourceId]),
      query(`SELECT * FROM audit_records WHERE resource_id=$1 OR resource_id IN (SELECT id::text FROM order_references WHERE customer_reference_id=$1::uuid) OR resource_id IN (SELECT id::text FROM cases WHERE customer_id=$1::uuid) OR resource_id IN (SELECT id::text FROM call_references WHERE customer_reference_id=$1::uuid) OR resource_id IN (SELECT id::text FROM chat_messages WHERE customer_reference_id=$1::uuid) ORDER BY created_at`, [sourceId])
    ]);
    return json(res, 200, {customer: adapter.customerView(resolved.customer, role), customer_reference_id: sourceId, twenty_projection: customerProjectionStatus(resolved), cases: rows.map(row => redactCaseRow(row, req)), communications: refs.rows, orders: orders.rows, calls: calls.rows, chat: chat.rows, events: events.rows, audit: canReadOwnerApprovals(req) ? auditRows.rows : [], timeline: rows.map(item => ({event_type: 'CASE_CREATED', occurred_at: item.created_at, case_id: item.id, provenance: {source: item.source, reference: item.source_reference}})), synthetic: true, execution: 'NO_EXECUTION'});
  }
  if (parts[0] === 'api' && parts[1] === 'v2' && parts[2] === 'cases' && parts[3] === 'by-twenty-id' && parts[4] && req.method === 'GET') {
    if (!canRead(role, 'cases')) return denied(res);
    try {
      const projected = await adapter.get('cases', parts[4]);
      if (!projected?.caseNumber) return json(res, 404, {error: {code: 'NOT_FOUND'}});
      const rows = await joinCases('WHERE c.case_number = $1', [projected.caseNumber]);
      const context = rows[0] ? await caseDecisionContext(rows[0].id, req) : null;
      return context ? json(res, 200, context) : json(res, 404, {error: {code: 'NOT_FOUND'}});
    } catch (error) {
      return json(res, error.status === 404 ? 404 : 502, {error: {code: error.status === 404 ? 'NOT_FOUND' : 'PROJECTION_LOOKUP_FAILED', message: error.message}});
    }
  }
  if (parts[0] === 'api' && parts[1] === 'v2' && parts[2] === 'cases' && parts[3] && req.method === 'POST' && parts[4] === 'approve') {
    try { return json(res, 200, await decideApproval(req, parts[3], await readBody(req))); } catch (error) { return json(res, error.status || 400, {error: {code: error.status === 403 ? 'FORBIDDEN' : 'APPROVAL_REJECTED', message: error.message}}); }
  }
  if (parts[0] === 'api' && parts[1] === 'v2' && parts[2] === 'cases' && parts[3] && req.method === 'POST' && parts[4] === 'human-work') {
    try { return json(res, 200, await humanWorkAction(req, parts[3], await readBody(req))); }
    catch (error) { return json(res, error.status || 400, {error: {code: error.code || (error.status === 403 ? 'FORBIDDEN' : 'HUMAN_WORK_ACTION_REJECTED'), message: error.message}}); }
  }
  if (parts[0] === 'api' && parts[1] === 'v2' && parts[2] === 'cases' && parts[3] && req.method === 'GET') {
    if (!canRead(role, 'cases')) return denied(res);
    const context = await caseDecisionContext(parts[3], req);
    return context ? json(res, 200, context) : json(res, 404, {error: {code: 'NOT_FOUND'}});
  }
  return json(res, 404, {error: {code: 'NOT_FOUND'}});
}

await runMigrations();
await ensureJobHealth();
const stopTwentyProjectionWorker = twentyEnabled ? startTwentyProjectionWorker({adapter}) : () => {};
const wooShadow = createWooShadowWorker({adapter});
await wooShadow.initialize();
const stopWooShadowWorker = wooShadow.start();
const server = http.createServer((req, res) =>
  route(req, res).catch(error => json(res, 500, {error: {code: 'INTERNAL', message: error.message}}))
);
server.listen(port, '0.0.0.0', () => console.log(JSON.stringify({status: 'listening', port, control_plane: 'v2', environment: appEnv})));
process.on('SIGTERM', async () => { stopTwentyProjectionWorker(); stopWooShadowWorker(); server.close(); await pool.end(); });
