import crypto from 'node:crypto';

const MESSAGE_TYPES = new Set(['incoming', 'inbound']);
const MODES = new Set(['shadow', 'authoritative']);
const MIN_BRIDGE_TOKEN_CHARS = 16;
const MAX_BRIDGE_TOKEN_CHARS = 512;
export const CHATWOOT_SHADOW_ROUTE = '/api/v2/ingest/chatwoot-shadow';
export const CHATWOOT_SHADOW_SOURCE_AUTH = Object.freeze({
  verified: true,
  method: 'mac-bridge-token',
  credentialId: 'chatwoot-shadow-bridge'
});

function text(value, fallback = '') { return String(value ?? fallback).trim(); }
function enabledFlag(value) { return text(value).toLowerCase() === 'true'; }

function bridgeTokenFrom(value) {
  const token = text(value);
  return token.length >= MIN_BRIDGE_TOKEN_CHARS && token.length <= MAX_BRIDGE_TOKEN_CHARS ? token : '';
}

function bearerFromHeaders(headers = {}) {
  const header = text(headers.authorization || headers.Authorization);
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : '';
}

function tokensEqual(provided, expected) {
  if (!provided || !expected) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}
function identifier(value, label) {
  const normalized = text(value);
  if (!normalized || normalized.length > 160) throw Object.assign(new Error(`${label} is required`), {status: 400, code: 'CHATWOOT_EVENT_INVALID'});
  return normalized;
}
function timestamp(value) {
  const parsed = new Date(value || Date.now());
  if (Number.isNaN(parsed.getTime())) throw Object.assign(new Error('message timestamp is invalid'), {status: 400, code: 'CHATWOOT_EVENT_INVALID'});
  return parsed.toISOString();
}
function readPath(payload, ...paths) {
  for (const path of paths) {
    let current = payload;
    for (const key of path) current = current?.[key];
    if (current !== undefined && current !== null && current !== '') return current;
  }
  return undefined;
}

export function supportMode(environment = process.env) {
  const mode = text(environment.SUPPORT_MODE, 'shadow').toLowerCase();
  return MODES.has(mode) ? mode : 'shadow';
}

export function chatwootShadowConfig(environment = process.env) {
  return {
    enabled: enabledFlag(environment.CHAMELEON_CHATWOOT_SHADOW_ENABLED),
    mode: supportMode(environment),
    token: bridgeTokenFrom(environment.CHAMELEON_CHATWOOT_BRIDGE_TOKEN),
    route: CHATWOOT_SHADOW_ROUTE,
    execution: 'NO_EXECUTION',
    outbound: 'disabled'
  };
}

export function supportIngressConfig(environment = process.env) {
  const shadow = chatwootShadowConfig(environment);
  return {
    mode: shadow.mode,
    proxyCredentialConfigured: Boolean(text(environment.CHAMELEON_CHATWOOT_PROXY_CREDENTIAL)),
    productionVerificationRequired: true,
    execution: 'NO_EXECUTION',
    shadow_ingress: {
      enabled: shadow.enabled,
      token_configured: Boolean(shadow.token),
      route: shadow.route,
      outbound: shadow.outbound,
      source_auth_method: CHATWOOT_SHADOW_SOURCE_AUTH.method
    }
  };
}

export function authorizeChatwootShadowRequest({headers = {}, environment = process.env} = {}) {
  const config = chatwootShadowConfig(environment);
  if (config.mode !== 'shadow') {
    return {ok: false, status: 403, code: 'CHATWOOT_SHADOW_REQUIRES_SHADOW_MODE', message: 'Chatwoot shadow ingress requires SUPPORT_MODE=shadow'};
  }
  if (!config.enabled) {
    return {ok: false, status: 403, code: 'CHATWOOT_SHADOW_DISABLED', message: 'Chatwoot shadow ingress is disabled'};
  }
  if (!config.token) {
    return {ok: false, status: 403, code: 'CHATWOOT_SHADOW_TOKEN_MISSING', message: 'Chatwoot bridge token is not configured'};
  }
  if (!tokensEqual(bearerFromHeaders(headers), config.token)) {
    return {ok: false, status: 401, code: 'CHATWOOT_BRIDGE_UNAUTHENTICATED', message: 'Chatwoot bridge authentication failed'};
  }
  return {ok: true, sourceAuth: CHATWOOT_SHADOW_SOURCE_AUTH};
}

export function sanitizeChatwootShadowPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const {sourceAuth, source_auth, ...safe} = payload;
  return safe;
}

export function normalizeChatwootEvent(payload, {sourceAuth = {}, receivedAt = new Date()} = {}) {
  if (!payload || typeof payload !== 'object') throw Object.assign(new Error('Chatwoot payload must be an object'), {status: 400, code: 'CHATWOOT_EVENT_INVALID'});
  if (sourceAuth.verified !== true) throw Object.assign(new Error('Chatwoot source authentication was not verified'), {status: 401, code: 'CHATWOOT_SOURCE_UNAUTHENTICATED'});
  const accountId = identifier(readPath(payload, ['account', 'id'], ['account_id']), 'account id');
  const inboxId = identifier(readPath(payload, ['inbox', 'id'], ['inbox_id']), 'inbox id');
  const conversationId = identifier(readPath(payload, ['conversation', 'id'], ['conversation_id']), 'conversation id');
  const messageId = identifier(readPath(payload, ['message', 'id'], ['id'], ['message_id']), 'message id');
  const messageType = text(readPath(payload, ['message', 'message_type'], ['message_type'], ['message', 'type']), 'incoming').toLowerCase();
  if (!MESSAGE_TYPES.has(messageType)) throw Object.assign(new Error('only inbound customer messages are accepted'), {status: 202, code: 'CHATWOOT_EVENT_IGNORED'});
  const body = text(readPath(payload, ['message', 'content'], ['content'], ['message', 'body']));
  if (!body || body.length > 4000) throw Object.assign(new Error('message body is required and bounded'), {status: 400, code: 'CHATWOOT_EVENT_INVALID'});
  const sender = readPath(payload, ['sender'], ['contact'], ['conversation', 'meta', 'sender']) || {};
  const contactId = identifier(readPath(payload, ['contact', 'id'], ['sender', 'id'], ['conversation', 'meta', 'sender', 'id']), 'contact id');
  const occurredAt = timestamp(readPath(payload, ['message', 'created_at'], ['created_at'], ['timestamp']));
  const sourceEventId = `chatwoot:${accountId}:message:${messageId}`;
  const sourceIdentity = `chatwoot:${accountId}:contact:${contactId}`;
  const hold = readPath(payload, ['hold'], ['proxy_state', 'hold'], ['conversation', 'hold']) || null;
  const provenance = {
    provider: 'chatwoot', account_id: accountId, inbox_id: inboxId,
    conversation_id: conversationId, message_id: messageId,
    source_auth: {verified: true, method: text(sourceAuth.method, 'unknown'), credential_id: text(sourceAuth.credentialId) || null},
    received_at: new Date(receivedAt).toISOString(), execution: 'NO_EXECUTION'
  };
  return {
    source: 'chatwoot', source_event_id: sourceEventId, idempotency_key: sourceEventId,
    channel: 'chat', conversation_reference: `chatwoot:${accountId}:conversation:${conversationId}`,
    sender: {name: text(sender.name), email: text(sender.email), phone: text(sender.phone_number || sender.phone), external_participant_id: sourceIdentity},
    message: body, occurred_at: occurredAt,
    order_reference: text(readPath(payload, ['order_reference'], ['metadata', 'order_reference'])),
    order_source: text(readPath(payload, ['order_source'], ['metadata', 'order_source'])),
    metadata: {customer_support_v1: true, ...(payload.metadata || {}), chatwoot: {account_id: accountId, inbox_id: inboxId, conversation_id: conversationId, message_id: messageId, contact_id: contactId, message_type: messageType, hold_state: hold}, source_auth: provenance.source_auth, source_provenance: provenance, receipt_hash: crypto.createHash('sha256').update(JSON.stringify({sourceEventId, accountId, inboxId, conversationId, messageId, body, occurredAt})).digest('hex'), execution: 'NO_EXECUTION'}
  };
}
