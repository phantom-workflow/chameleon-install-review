import crypto from 'node:crypto';
import { query, transaction } from './db.js';
import { normalizeEmail, normalizePhone } from './domain.js';
import { enqueueTwentyProjection } from './twenty-projection.js';
import { authorizeSupportPolicy, POLICY_VERSION as AI_POLICY_VERSION } from './support-policy.js';
import {SUPPORT_PLAYBOOK_PROFILE, SUPPORT_PLAYBOOK_VERSION} from './support-playbook.js';

const POLICY_VERSION = 'support-routing-v2';
const CHANNELS = new Set(['chat', 'sms', 'email', 'voice', 'web', 'synthetic']);
const STRATEGIES = new Set(['AUTO_RESOLVABLE', 'AI_TRIAGE_TO_CSR', 'DIRECT_CSR', 'CSR_TO_APPROVAL', 'OWNER_APPROVAL', 'WAITING_ON_CUSTOMER', 'FAILED_AUTOMATION']);

export function determineProductOutcome({status, human_work_status, requires_human, final_resolution_path, evidence, support_agent} = {}) {
  const finalPath = String(final_resolution_path || '').toUpperCase();
  const st = String(status || '').toUpperCase();
  const hwSt = String(human_work_status || '').toUpperCase();
  const agentStatus = String(evidence?.support_agent?.status || support_agent?.status || '').toUpperCase();

  if (finalPath === 'AUTOMATION_FAILED' || finalPath === 'FAILED_AUTOMATION' || agentStatus === 'ERROR') {
    return 'Failed automation';
  }
  if (st === 'RESOLVED' && requires_human === false) {
    return 'Resolved automatically';
  }
  if (st === 'WAITING_CUSTOMER' || hwSt === 'WAITING' || finalPath === 'WAITING_ON_CUSTOMER') {
    return 'Waiting on customer';
  }
  if (requires_human || finalPath === 'HUMAN_REQUIRED') {
    return 'Needs Human';
  }
  return 'Needs Human';
}

function text(value, fallback = '') { return String(value ?? fallback).trim(); }
function asDate(value, fallback = new Date()) {
  const date = value ? new Date(value) : fallback;
  return Number.isNaN(date.getTime()) ? fallback : date;
}
function uuidFor(scope, value) {
  const hex = crypto.createHash('sha256').update(scope + ':' + value).digest('hex').slice(0, 32);
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-4' + hex.slice(13, 16) + '-8' + hex.slice(17, 20) + '-' + hex.slice(20);
}
function normalizeChannel(value) {
  const channel = text(value, 'synthetic').toLowerCase();
  if (!CHANNELS.has(channel)) throw Object.assign(new Error('unsupported support channel'), {status: 400});
  return channel;
}
function senderInput(event) {
  const sender = event.sender || event.sender_identity || {};
  return {
    name: text(sender.name || event.sender_name),
    email: normalizeEmail(sender.email || event.email),
    phone: normalizePhone(sender.phone || event.phone),
    external_participant_id: text(sender.external_participant_id || sender.externalParticipantId || event.external_participant_id)
  };
}
function normalizeEvent(input) {
  if (!input || typeof input !== 'object') throw Object.assign(new Error('support event must be an object'), {status: 400});
  const source = text(input.source, 'synthetic').toLowerCase();
  const sourceEventId = text(input.source_event_id || input.sourceEventId || input.idempotency_key);
  const message = text(input.message || input.body);
  if (!source || !sourceEventId || !message) throw Object.assign(new Error('source, source_event_id, and message are required'), {status: 400});
  const channel = normalizeChannel(input.channel);
  const sender = senderInput(input);
  if (!sender.email && !sender.phone && !sender.external_participant_id && !input.customer_reference_id && !input.customer_id) {
    throw Object.assign(new Error('sender identity is required'), {status: 400});
  }
  return {
    source,
    source_event_id: sourceEventId,
    idempotency_key: text(input.idempotency_key, source + ':event:' + sourceEventId),
    channel,
    sender,
    customer_reference_id: text(input.customer_reference_id || input.customer_id),
    message,
    occurred_at: asDate(input.timestamp || input.occurred_at || input.occurredAt),
    conversation_reference: text(input.conversation_reference || input.thread_reference || input.thread_id),
    order_reference: text(input.order_reference || input.order_id || input.order_number),
    order_source: text(input.order_source || input.metadata?.order_source),
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
    routing_strategy: text(input.routing_strategy || input.metadata?.routing_strategy).toUpperCase()
  };
}
const ORDER_STATUS_PHRASES = [
  'where is my order', 'when do i get my order', 'when will my order arrive',
  "where's my package", 'has my order shipped', 'what is the eta on my order', 'can i get tracking'
];
function classify(message, recommendation = null) {
  const value = message.toLowerCase();
  if (/safety|compliance|legal|privacy|security|threat/.test(value)) return 'COMPLIANCE_QUESTION';
  if (/broken|damaged|cracked|leak|wrong item/.test(value)) return 'DAMAGED_PRODUCT';
  if (/refund|money back|charge back|cancelled|canceled|partial refund/.test(value)) return 'REFUND_REQUEST';
  if (ORDER_STATUS_PHRASES.some(phrase => value.includes(phrase)) || /order status|tracking|shipped|shipment status/.test(value)) return 'ORDER_STATUS_REQUEST';
  if (/missing|not arrived|late shipment|should have arrived|never showed up|never arrived|package.*(late|missing)|shipment.*(late|missing)/.test(value)) return 'MISSING_SHIPMENT';
  if (/same thing|reorder|order again/.test(value)) return 'REORDER_REQUEST';
  if (/how does|how do|what is|research|work/.test(value)) return 'PRODUCT_QUESTION';
  if (/payment|charged|checkout|card/.test(value)) return 'PAYMENT_ISSUE';
  const advisory = {ORDER_STATUS_REQUEST: 'ORDER_STATUS_REQUEST', ORDER_STATUS: 'ORDER_STATUS_REQUEST', TRACKING_REQUEST: 'ORDER_STATUS_REQUEST', SHIPPING_ETA: 'ORDER_STATUS_REQUEST', DAMAGED_PRODUCT: 'DAMAGED_PRODUCT', REFUND_REQUEST: 'REFUND_REQUEST', COMPLIANCE_QUESTION: 'COMPLIANCE_QUESTION', PAYMENT_ISSUE: 'PAYMENT_ISSUE'}[text(recommendation?.classification).toUpperCase().replace(/[ -]+/g, '_')];
  return advisory || 'GENERAL_ESCALATION';
}
async function resolveIdentity(event) {
  const values = [event.sender.email || null, event.sender.phone || null, event.sender.external_participant_id || null];
  const matches = await query(`SELECT id, display_name_safe, provenance FROM customer_references
    WHERE ($1::text IS NOT NULL AND provenance->>'email'=$1)
       OR ($2::text IS NOT NULL AND provenance->>'phone'=$2)
       OR ($3::text IS NOT NULL AND provenance->>'external_participant_id'=$3)
    ORDER BY observed_at DESC`, values);
  if (event.customer_reference_id) {
    const explicit = await query('SELECT id, display_name_safe, provenance FROM customer_references WHERE id=$1', [event.customer_reference_id]);
    if (!explicit.rowCount) throw Object.assign(new Error('explicit customer reference was not found'), {status: 422, code: 'IDENTITY_NOT_FOUND'});
    const row = explicit.rows[0];
    const conflictingMatch = matches.rows.find(item => item.id !== row.id);
    const conflictingField = ['email', 'phone', 'external_participant_id'].find(field => event.sender[field] && row.provenance?.[field] && event.sender[field] !== row.provenance[field]);
    if (conflictingMatch || conflictingField) throw Object.assign(new Error('explicit customer reference conflicts with the supplied sender identity'), {status: 409, code: 'IDENTITY_CONFLICT'});
    return {customer: {id: row.id, name: row.display_name_safe}, method: 'explicit_customer_reference', fields: ['customer_reference_id']};
  }
  const uniqueMatches = [...new Map(matches.rows.map(item => [item.id, item])).values()];
  if (uniqueMatches.length > 1) throw Object.assign(new Error('sender identity is ambiguous across multiple customer records'), {status: 409, code: 'IDENTITY_AMBIGUOUS'});
  if (uniqueMatches.length === 1) {
    const row = uniqueMatches[0];
    const fields = ['email', 'phone', 'external_participant_id'].filter(field => event.sender[field] && row.provenance?.[field] === event.sender[field]);
    return {customer: {id: row.id, name: row.display_name_safe}, method: `local_${fields.join('_')}_exact`, fields};
  }
  const identity = event.sender.email || event.sender.phone || event.sender.external_participant_id;
  const id = uuidFor('customer-reference', `support:${identity}`);
  return {customer: {id, name: event.sender.name || 'Unresolved Customer'}, method: 'local_identity_created', fields: [event.sender.email ? 'email' : event.sender.phone ? 'phone' : 'external_participant_id'], newIdentity: true};
}

async function ensureCustomerReference(client, identity, event, now) {
  const existing = await client.query('SELECT id FROM customer_references WHERE id=$1', [identity.customer.id]);
  if (existing.rowCount) return;
  const identityKey = event.sender.email || event.sender.phone || event.sender.external_participant_id;
  await client.query(`INSERT INTO customer_references(id, source, external_customer_id, display_name_safe, environment, provenance, observed_at)
    VALUES ($1,'support',$2,$3,'staging',$4,$5)`, [identity.customer.id, identityKey, identity.customer.name || 'Unresolved Customer', {
    source_system: 'support', email: event.sender.email || null, phone: event.sender.phone || null,
    external_participant_id: event.sender.external_participant_id || null, execution: 'NO_EXECUTION'
  }, now]);
}
async function resolveOrder(event, customer) {
  const allowedSources = new Set(['woocommerce-checkout-candidate', 'woocommerce-synthetic', 'woocommerce-fixture', 'woocommerce']);
  if (!event.order_reference && !event.metadata?.trusted_phone_order_context) return null;
  if (event.order_source && !allowedSources.has(event.order_source)) throw Object.assign(new Error('unsupported order source'), {status: 400, code: 'ORDER_SOURCE_UNSUPPORTED'});
  const sourceClause = event.order_source ? ' AND o.source = $2' : '';
  const referenceClause = `WHERE o.source IN ('woocommerce-checkout-candidate','woocommerce-synthetic','woocommerce-fixture','woocommerce')
      AND (o.external_order_id = $1 OR o.order_number = $1)${sourceClause}`;
  const trustedPhoneClause = `WHERE o.customer_reference_id = $1
      AND o.source IN ('woocommerce-checkout-candidate','woocommerce-synthetic','woocommerce-fixture','woocommerce')
      AND LOWER(COALESCE(o.order_status, o.fulfillment_status, '')) NOT IN ('cancelled','canceled','refunded')
      AND COALESCE(o.refund_state, 'NONE') = 'NONE'${event.order_source ? ' AND o.source = $2' : ''}`;
  const values = event.order_reference
    ? (event.order_source ? [event.order_reference, event.order_source] : [event.order_reference])
    : (event.order_source ? [customer.id, event.order_source] : [customer.id]);
  const result = await query(`SELECT o.*,
      COALESCE((SELECT json_agg(json_build_object(
        'sku', li.sku, 'product_name', li.product_name, 'quantity', li.quantity,
        'unit_price', li.unit_price, 'line_total', li.line_total
      ) ORDER BY li.created_at) FROM demo_order_line_items li WHERE li.order_id=o.id AND li.active=true), '[]'::json) AS line_items
    FROM order_references o
    ${event.order_reference ? referenceClause : trustedPhoneClause}
    ORDER BY CASE o.source WHEN 'woocommerce-checkout-candidate' THEN 0 WHEN 'woocommerce-synthetic' THEN 1 WHEN 'woocommerce' THEN 2 ELSE 3 END,
      o.observed_at DESC${event.order_reference ? '' : ' LIMIT 2'}`, values);
  if (!result.rowCount && event.order_reference) throw Object.assign(new Error('referenced Woo order not found in LAB'), {status: 422});
  if (result.rowCount > 1 && event.order_reference) throw Object.assign(new Error('referenced Woo order is ambiguous across multiple source records'), {status: 409, code: 'ORDER_REFERENCE_AMBIGUOUS'});
  if (!result.rowCount || (!event.order_reference && result.rowCount !== 1)) return null;
  const order = result.rows[0];
  if (order.customer_reference_id !== customer.id) throw Object.assign(new Error('referenced order conflicts with the resolved customer identity'), {status: 409, code: 'ORDER_IDENTITY_CONFLICT'});
  return {
    id: order.id,
    external_order_id: order.external_order_id,
    order_number: order.order_number,
    order_status: order.order_status || order.fulfillment_status,
    fulfillment_state: order.fulfillment_state || order.fulfillment_status,
    amount: order.amount,
    currency: order.currency,
    tracking: order.tracking || null,
    line_items: order.line_items || [],
    refund_state: order.refund_state || 'NONE',
    refund_total: order.refund_total || 0,
    refunds: order.refunds || [],
    source: order.source,
    source_updated_at: order.source_updated_at,
    observed_at: order.observed_at
  };
}
function trackingAssessment(order, occurredAt) {
  const entries = order?.tracking == null ? [] : Array.isArray(order.tracking) ? order.tracking : [order.tracking];
  if (!entries.length) return {state: 'MISSING', trustworthy: true, reason: 'Woo LAB has authoritative order status but no tracking reference.', observed_at: order?.source_updated_at || order?.observed_at || null};
  const normalized = entries.map(item => {
    const updated = item?.updated_at || item?.updatedAt || item?.last_updated_at || item?.lastUpdatedAt;
    const updatedAt = updated ? new Date(updated) : null;
    return {tracking_number: text(item?.tracking_number || item?.number), carrier: text(item?.carrier), status: text(item?.status), updated_at: updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt : null};
  });
  if (normalized.some(item => !item.tracking_number || !item.status || !item.updated_at)) return {state: 'INVALID', trustworthy: false, reason: 'Woo LAB tracking data is incomplete or malformed.', record_count: entries.length};
  const numbers = new Set(normalized.map(item => item.tracking_number));
  if (numbers.size > 1) return {state: 'CONFLICT', trustworthy: false, reason: 'Woo LAB contains conflicting tracking references.', record_count: entries.length, tracking_numbers: [...numbers]};
  const latest = normalized.sort((a, b) => b.updated_at - a.updated_at)[0];
  const ageMs = occurredAt.getTime() - latest.updated_at.getTime();
  if (ageMs > 48 * 3600000) return {state: 'STALE', trustworthy: false, reason: 'Woo LAB tracking evidence is older than the 48-hour routine-response threshold.', tracking_number: latest.tracking_number, status: latest.status, updated_at: latest.updated_at};
  return {state: 'VERIFIED_CURRENT', trustworthy: true, reason: 'Woo LAB tracking evidence is complete, unambiguous, and current.', tracking_number: latest.tracking_number, carrier: latest.carrier || null, status: latest.status, updated_at: latest.updated_at};
}
export async function prepareSupportContext(input) {
  const event = normalizeEvent(input);
  const identity = await resolveIdentity(event);
  const order = await resolveOrder(event, identity.customer);
  return {event, identity, order, assessment: order ? trackingAssessment(order, event.occurred_at) : null};
}
export function supportAgentContext({identity, order, assessment, caseType, knowledge, message}) {
  return {
    message,
    message_classification_hint: caseType,
    customer: {resolved: Boolean(identity?.customer), identity_method: identity?.method || 'unresolved', matched_fields: identity?.fields || []},
    order: order ? {order_number: order.order_number, status: order.order_status, fulfillment_state: order.fulfillment_state, items: (order.line_items || []).map(item => ({sku: item.sku, product_name: item.product_name, quantity: item.quantity})), refund_state: order.refund_state, source: order.source} : {found: false},
    tracking: assessment ? {state: assessment.state, trustworthy: assessment.trustworthy, reason: assessment.reason, carrier: assessment.carrier || null, status: assessment.status || null} : null,
    approved_knowledge: knowledge?.selected ? {id: knowledge.selected.id, status: knowledge.selected.status, playbook: knowledge.selected.playbook} : null,
    playbook: {version: SUPPORT_PLAYBOOK_VERSION, profile: SUPPORT_PLAYBOOK_PROFILE},
    constraints: {raw_pii: 'excluded', execution: 'NO_EXECUTION', policy_authority: 'chameleon_execution_rails'}
  };
}
function routineOrderResponse(order, assessment) {
  const orderNumber = order?.order_number || order?.external_order_id;
  const status = text(order?.fulfillment_state || order?.order_status, 'unknown').replaceAll('_', ' ').toLowerCase();
  const trackingText = assessment.state === 'VERIFIED_CURRENT'
    ? ` Tracking reference ${assessment.tracking_number} is recorded in Woo LAB; its latest recorded state is ${text(assessment.status, 'unknown').replaceAll('_', ' ').toLowerCase()} as of ${assessment.updated_at.toISOString()}.`
    : ' No tracking reference is recorded in Woo LAB; this response does not infer a carrier event.';
  return `Order ${orderNumber} is currently ${status} in Woo LAB.${trackingText}`;
}
function choosePolicy(event, caseType, order, assessment, versionedDecision = null, agentDecision = null) {
  const agentFailure = event.metadata?.simulate_failure || !agentDecision || ['ERROR', 'UNAVAILABLE', 'DISABLED'].includes(String(event.metadata?.support_agent?.status || '').toUpperCase());
  const disposition = agentFailure ? 'FAILED_AUTOMATION' : agentDecision.disposition;
  const base = {strategy: disposition, policy_version: SUPPORT_PLAYBOOK_VERSION, queue_name: 'HUMAN_WORK', assignee_name: 'Human Work', status: 'IN_PROGRESS', priority: 'NORMAL', requires_human: true, owner_approval_required: false, ai_triage: true, csr_handled: true, human_decision_required: false, reason: agentDecision?.reason || event.metadata?.support_agent?.error_message || versionedDecision?.reason || 'Support worker result unavailable.', recommended_action: agentDecision?.proposed_action || agentDecision?.draft || 'Review the bounded Chameleon case packet; no external action is enabled.', proposed_side_effect: 'NO_EXECUTION'};
  if (disposition === 'AUTO_REPLY') return {...base, queue_name: 'AI_AUTOMATED', assignee_name: 'Chameleon support worker', status: 'RESOLVED', priority: 'LOW', requires_human: false, csr_handled: false, recommended_action: agentDecision.draft, customer_response: agentDecision.draft, final_resolution_path: 'AI_AUTOMATED'};
  if (disposition === 'WAITING_CUSTOMER') return {...base, queue_name: 'WAITING_CUSTOMER', assignee_name: 'Customer response', status: 'WAITING_CUSTOMER', requires_human: false, csr_handled: false, human_work_status: 'NOT_REQUIRED', recommended_action: agentDecision.draft, customer_response: agentDecision.draft, final_resolution_path: 'WAITING_ON_CUSTOMER'};
  if (disposition === 'APPROVAL_REQUIRED') return {...base, strategy: 'APPROVAL_REQUIRED', status: 'WAITING_APPROVAL', priority: 'HIGH', owner_approval_required: true, human_decision_required: true, reason: agentDecision.reason, recommended_action: agentDecision.proposed_action || agentDecision.draft, proposed_side_effect: 'Approval intent only; no refund, replacement, shipment, message, or provider action executes in LAB.', final_resolution_path: 'HUMAN_REQUIRED'};
  if (disposition === 'HUMAN_WORK') return {...base, strategy: 'HUMAN_WORK', priority: 'HIGH', human_decision_required: true, reason: agentDecision.reason, recommended_action: agentDecision.proposed_action || agentDecision.draft, final_resolution_path: 'HUMAN_REQUIRED'};
  return {...base, strategy: 'FAILED_AUTOMATION', priority: 'HIGH', reason: event.metadata?.support_agent?.error_message || event.metadata?.support_agent?.error_code || 'Support worker did not return a valid decision.', recommended_action: 'Inspect the recorded worker failure and the available case packet; no customer or provider action was attempted.', final_resolution_path: 'FAILED_AUTOMATION'};
}
function orderSummary(order) {
  return order ? {order_number: order.order_number, status: order.order_status, fulfillment_state: order.fulfillment_state, amount: order.amount, currency: order.currency, tracking: order.tracking, line_items: order.line_items, refund_state: order.refund_state, refund_total: order.refund_total, refunds: order.refunds, source: order.source, source_updated_at: order.source_updated_at} : null;
}
async function recordAudit(client, action, resourceId, correlationId, after) {
  await client.query("INSERT INTO audit_records (id, actor_type, actor_id, actor_role, action, resource_type, resource_id, policy_decision, before_summary, after_summary, correlation_id, created_at) VALUES ($1,'SYSTEM','support-processor','SYNTHETIC',$2,'case',$3,'ALLOW_SYNTHETIC_ONLY','{}'::jsonb,$4,$5,$6)", [crypto.randomUUID(), action, resourceId, after, correlationId, new Date()]);
}
export async function ingestSupportEvent({adapter, input, preparedContext = null}) {
  const prepared = preparedContext || await prepareSupportContext(input);
  const {event, identity, order, assessment} = prepared;
  const agentRecommendation = event.metadata?.support_agent?.recommendation || null;
  const caseType = classify(event.message, agentRecommendation);
  const versionedDecision = authorizeSupportPolicy({message: event.message, caseType, identity, order: assessment ? {...order, tracking_state: assessment.state} : order, candidateRecommendation: agentRecommendation?.disposition});
  const policy = choosePolicy(event, caseType, order, assessment, versionedDecision, agentRecommendation);
  const now = new Date();
  const supportEventId = uuidFor('support-event', event.source + ':' + event.source_event_id);
  const caseId = uuidFor('support-case', event.source + ':' + event.source_event_id);
  const requestedCaseNumber = event.source === 'synthetic' && event.metadata?.demo === true ? text(event.metadata.case_number) : '';
  const caseNumber = /^CASE-[A-Z0-9-]{1,100}$/.test(requestedCaseNumber)
    ? requestedCaseNumber
    : 'CASE-SUPPORT-' + crypto.createHash('sha256').update(event.source + ':' + event.source_event_id).digest('hex').slice(0, 12).toUpperCase();
  const finalRouting = {queue: policy.queue_name, assignee: policy.assignee_name};
  const routingReason = policy.reason;
  const missingInformation = [
    order ? null : 'Order context is unavailable.',
    ...(Array.isArray(agentRecommendation?.missing_information) ? agentRecommendation.missing_information : (agentRecommendation?.missing_information ? [agentRecommendation.missing_information] : []))
  ].filter(Boolean);
  const humanWorkStatus = policy.requires_human
    ? (policy.human_work_status || (policy.status === 'WAITING_CUSTOMER' ? 'WAITING' : 'NEW'))
    : 'RESOLVED';
  const humanWorkWaitingReason = policy.human_work_waiting_reason || null;
  const productOutcome = determineProductOutcome({
    status: policy.status,
    human_work_status: humanWorkStatus,
    requires_human: policy.requires_human,
    final_resolution_path: policy.final_resolution_path,
    support_agent: event.metadata?.support_agent || null
  });
  const evidence = {
    message: event.message, source: event.source, channel: event.channel, source_event_id: event.source_event_id,
    conversation_reference: event.conversation_reference || null,
    identity_resolution: {method: identity.method, fields: identity.fields, customer_id: identity.customer.id},
    classification: {case_type: caseType},
    order_context: orderSummary(order),
    tracking_assessment: assessment,
    context_gathering: {source_of_truth: 'woocommerce', verified: Boolean(order), operational_store: 'chameleon-postgres'},
    playbook_version: SUPPORT_PLAYBOOK_VERSION, profile: SUPPORT_PLAYBOOK_PROFILE,
    policy: {version: SUPPORT_PLAYBOOK_VERSION, profile: SUPPORT_PLAYBOOK_PROFILE, strategy: policy.strategy, reason: policy.reason, disposition: agentRecommendation?.disposition || 'FAILED_AUTOMATION', hard_boundary: Boolean(versionedDecision?.hard_boundary), intent: versionedDecision?.intent || null, execution_authority: versionedDecision?.execution_authority || 'NO_EXECUTION'},
    missing_information: missingInformation,
    customer_response: policy.customer_response || null,
    knowledge: event.metadata?.knowledge || null,
    support_agent: event.metadata?.support_agent || null,
    agent_recommendation: agentRecommendation,
    product_outcome: productOutcome,
    execution: 'NO_EXECUTION'
  };
  const policyTrace = {version: SUPPORT_PLAYBOOK_VERSION, profile: SUPPORT_PLAYBOOK_PROFILE, strategy: policy.strategy, reason: routingReason, disposition: agentRecommendation?.disposition || 'FAILED_AUTOMATION', hard_boundary: Boolean(versionedDecision?.hard_boundary), intent: versionedDecision?.intent || null, execution_authority: versionedDecision?.execution_authority || 'NO_EXECUTION', agent_recommendation: agentRecommendation, agent_disposition: agentRecommendation?.disposition || 'FAILED_AUTOMATION'};
  evidence.policy = policyTrace;
  return transaction(async client => {
    await ensureCustomerReference(client, identity, event, now);
    const existing = await client.query('SELECT id, case_id FROM support_events WHERE source=$1 AND source_event_id=$2', [event.source, event.source_event_id]);
    if (existing.rowCount) {
      const caseProjection = await enqueueTwentyProjection(client, {entityType: 'case', entityId: existing.rows[0].case_id, source: event.source, sourceEventId: event.source_event_id, payload: {replay: true}});
      const communicationId = uuidFor('communication', event.source + ':' + event.source_event_id);
      const communicationProjection = await enqueueTwentyProjection(client, {entityType: 'communication', entityId: communicationId, source: event.source, sourceEventId: event.source_event_id, payload: {case_id: existing.rows[0].case_id, replay: true}});
      return {status: 'replay', duplicate: true, source: event.source, source_event_id: event.source_event_id, support_event_id: existing.rows[0].id, case_id: existing.rows[0].case_id, product_outcome: productOutcome, projection_status: {case: caseProjection.status, communication: communicationProjection.status}, projection_job_ids: {case: caseProjection.id, communication: communicationProjection.id}, execution: 'NO_EXECUTION'};
    }
    await client.query("INSERT INTO support_events (id, source, source_event_id, idempotency_key, channel, sender_identity, customer_reference_id, order_reference_id, message_body, conversation_reference, metadata, identity_match_method, case_id, occurred_at, received_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)", [supportEventId, event.source, event.source_event_id, event.idempotency_key, event.channel, event.sender, identity.customer.id, order?.id || null, event.message, event.conversation_reference || null, {...event.metadata, execution: 'NO_EXECUTION'}, identity.method, caseId, event.occurred_at, now]);
    const communicationId = uuidFor('communication', event.source + ':' + event.source_event_id);
    await client.query("INSERT INTO communication_references (id, source, external_message_id, customer_reference_id, channel, direction, summary, occurred_at) VALUES ($1,$2,$3,$4,$5,'INBOUND',$6,$7) ON CONFLICT (source, external_message_id) DO NOTHING", [communicationId, event.source, event.source_event_id, identity.customer.id, event.channel.toUpperCase(), event.message.slice(0, 240), event.occurred_at]);
    await client.query("INSERT INTO cases (id, customer_id, order_id, case_number, case_type, priority, status, owner_scope, requires_human, financial_action, fulfillment_action, source, source_reference, summary, why_here, recommended_action, proposed_side_effect, evidence, due_at, received_at, triaged_at, assigned_at, escalated_at, resolved_at, handoff_count, ai_handled_triage, csr_handled, owner_approval_required, final_resolution_path, human_decision_required, human_decision_status, human_work_status, human_work_waiting_reason, human_work_updated_at, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'NONE','NONE',$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$32,$32)", [caseId, identity.customer.id, order?.id || null, caseNumber, caseType, policy.priority, policy.status, policy.owner_approval_required ? 'OWNER' : 'CSR', policy.requires_human, event.source, event.source_event_id, event.message.slice(0, 240), policy.reason, policy.recommended_action, policy.proposed_side_effect, evidence, policy.status === 'WAITING_APPROVAL' ? new Date(now.getTime() + 48 * 3600000) : null, now, now, now, policy.owner_approval_required ? now : null, policy.status === 'RESOLVED' ? now : null, policy.strategy === 'CSR_TO_APPROVAL' ? 1 : 0, policy.ai_triage, policy.csr_handled, policy.owner_approval_required, policy.final_resolution_path || null, policy.human_decision_required, policy.human_decision_required ? 'PENDING' : 'NOT_REQUIRED', humanWorkStatus, humanWorkWaitingReason, now]);
    const firstAssignment = {queue: policy.queue_name, assignee: policy.assignee_name, reason: policy.reason};
    await client.query('INSERT INTO assignments(id, case_id, queue_name, assignee_name, assigned_at, reason) VALUES ($1,$2,$3,$4,$5,$6)', [crypto.randomUUID(), caseId, firstAssignment.queue, firstAssignment.assignee, now, firstAssignment.reason]);
    const routing = await client.query("INSERT INTO routing_decisions (id, case_id, support_event_id, decision_key, strategy, queue_name, assignee_name, reason, policy_version, ai_triage, csr_handled, owner_approval_required, handoff_number, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *", [crypto.randomUUID(), caseId, supportEventId, event.source + ':' + event.source_event_id, policy.strategy, finalRouting.queue, finalRouting.assignee, routingReason, policy.policy_version, policy.ai_triage, policy.csr_handled, policy.owner_approval_required, 1, now]);
    if (agentRecommendation) await client.query("INSERT INTO agent_actions (id, agent_name, case_id, action_type, recommendation, policy_decision, execution_status, created_at) VALUES ($1,$2,$3,$4,$5,'ALLOW_RECOMMENDATION_ONLY','NO_EXECUTION',$6)", [crypto.randomUUID(), (event.metadata?.support_agent?.provider || 'support-worker') + '-' + (event.metadata?.support_agent?.model || 'unidentified'), caseId, 'SUPPORT_DECISION', JSON.stringify(agentRecommendation), now]);
    let approval = null;
    if (policy.owner_approval_required) {
      const result = await client.query("INSERT INTO approvals (id, case_id, requested_by, action_type, status, proposed_side_effect, evidence, approver_role, created_at) VALUES ($1,$2,'support-processor','SUPPORT_REMEDY','PENDING',$3,$4,'OWNER',$5) RETURNING *", [crypto.randomUUID(), caseId, 'Record approval intent only; no refund, replacement, message, or provider action executes.', evidence, now]);
      approval = result.rows[0];
    }
    await client.query("INSERT INTO case_events(id, case_id, event_type, summary, actor_type, occurred_at, created_at) VALUES ($1,$2,'CASE_CREATED',$3,'SYSTEM',$4,$4),($5,$2,'CASE_TRIAGED',$6,'SYSTEM',$4,$4),($7,$2,'CASE_ASSIGNED',$8,'SYSTEM',$4,$4)", [crypto.randomUUID(), caseId, 'Support event classified as ' + caseType, now, crypto.randomUUID(), policy.reason, crypto.randomUUID(), policy.queue_name + ' / ' + policy.assignee_name]);
    if (policy.owner_approval_required) {
      await client.query("INSERT INTO case_events(id, case_id, event_type, summary, actor_type, occurred_at, created_at) VALUES ($1,$2,'CASE_ESCALATED',$3,'SYSTEM',$4,$4),($5,$2,'HUMAN_DECISION_REQUIRED',$6,'SYSTEM',$4,$4)", [crypto.randomUUID(), caseId, routingReason, now, crypto.randomUUID(), 'An authorized human decision is required; no external action executes.']);
    }
    await client.query("INSERT INTO operational_events (id, customer_id, order_id, case_id, event_type, source, source_id, actor_type, occurred_at, ingested_at, provenance, correlation_id, idempotency_key) VALUES ($1,$2,$3,$4,'CUSTOMER_MESSAGE_RECEIVED',$5,$6,'CUSTOMER',$7,$8,$9,$6,$10),($11,$2,$3,$4,'CASE_CREATED','chameleon-operations',$12,'SYSTEM',$8,$8,$9,$6,$10),($13,$2,$3,$4,'ROUTING_DECISION_RECORDED','chameleon-operations',$14,'SYSTEM',$8,$8,$15,$6,$10)", [crypto.randomUUID(), identity.customer.id, order?.id || null, caseId, event.source, event.source_event_id, event.occurred_at, now, evidence, event.idempotency_key, crypto.randomUUID(), caseNumber, crypto.randomUUID(), routing.rows[0].id, {...evidence, strategy: policy.strategy, initial_queue: policy.queue_name, initial_assignee: policy.assignee_name, queue: finalRouting.queue, assignee: finalRouting.assignee}]);
    await recordAudit(client, 'SUPPORT_EVENT_INGESTED', caseId, event.source_event_id, {case_type: caseType, customer_id: identity.customer.id, order_number: order?.order_number || null, execution: 'NO_EXECUTION'});
    if (['twilio-synthetic', 'twilio-sms-ingress'].includes(event.metadata.adapter)) {
      await recordAudit(client, 'INGEST_ACCEPTED', caseId, event.source_event_id, {
        case_type: caseType,
        transport: event.metadata.transport || 'twilio',
        provider_event_id: event.metadata.provider_event_id || event.source_event_id,
        signature_validated: Boolean(event.metadata.signature_validated),
        mms: event.metadata.mms || {present: false, downloaded: false},
        execution: 'NO_EXECUTION'
      });
    }
    await recordAudit(client, 'ROUTING_DECISION_RECORDED', caseId, event.source_event_id, {strategy: policy.strategy, initial_queue: policy.queue_name, initial_assignee: policy.assignee_name, queue: finalRouting.queue, assignee: finalRouting.assignee, reason: routingReason, execution: 'NO_EXECUTION'});
    if (approval) await recordAudit(client, 'APPROVAL_REQUESTED', caseId, event.source_event_id, {approval_id: approval.id, owner_approval_required: true, execution: 'NO_EXECUTION'});
    const caseProjection = await enqueueTwentyProjection(client, {entityType: 'case', entityId: caseId, source: event.source, sourceEventId: event.source_event_id, payload: {case_number: caseNumber, customer_id: identity.customer.id}});
    const communicationProjection = await enqueueTwentyProjection(client, {entityType: 'communication', entityId: communicationId, source: event.source, sourceEventId: event.source_event_id, payload: {case_id: caseId}});
    return {status: 'accepted', duplicate: false, source: event.source, source_event_id: event.source_event_id, support_event_id: supportEventId, customer_id: identity.customer.id, identity_match: {method: identity.method, fields: identity.fields}, order_id: order?.external_order_id || null, order_context: orderSummary(order), tracking_assessment: assessment, case_id: caseId, case_number: caseNumber, case_type: caseType, case_status: policy.status, product_outcome: productOutcome, customer_response: policy.customer_response || null, trace: {input: event.message, identity_lookup: {method: identity.method, customer_id: identity.customer.id}, classification: caseType, context: orderSummary(order), tracking_assessment: assessment, policy: policyTrace, response: policy.customer_response || null, outcome: policy.final_resolution_path, product_outcome: productOutcome}, routing: {strategy: policy.strategy, initial_queue: policy.queue_name, initial_assignee: policy.assignee_name, queue: finalRouting.queue, assignee: finalRouting.assignee, reason: routingReason}, approval_id: approval?.id || null, projection_status: {case: caseProjection.status, communication: communicationProjection.status}, projection_job_ids: {case: caseProjection.id, communication: communicationProjection.id}, execution: 'NO_EXECUTION'};
  });
}
