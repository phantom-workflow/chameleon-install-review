import {SUPPORT_PLAYBOOK_PROFILE, SUPPORT_PLAYBOOK_VERSION, playbookForWorker} from './support-playbook.js';

const PROVIDERS = new Set(['disabled', 'ollama', 'openclaw']);
const WORKER_DISPOSITIONS = new Set(['AUTO_REPLY', 'WAITING_CUSTOMER', 'HUMAN_WORK', 'APPROVAL_REQUIRED']);
const MAX_CONTEXT_CHARS = 4200;
const MAX_DRAFT_CHARS = 350;
const DEFAULT_MODEL = 'qwen3:8b';
const DEFAULT_TIMEOUT_MS = 12000;
const MAX_TOKEN_CHARS = 512;
export const OPENCLAW_SUPPORT_REASON_PATH = '/v1/support/reason';
const OPENCLAW_FORBIDDEN = Object.freeze([
  'chatwoot_reply', 'conversation_pause', 'conversation_resume', 'woo_mutation',
  'refund', 'replace', 'reship', 'label', 'sms', 'email', 'unrestricted_tools'
]);

function text(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function bounded(value, max) {
  return text(value).slice(0, max);
}

function safeErrorCode(error) {
  return bounded(error?.code || (error?.status ? `AGENT_HTTP_${error.status}` : 'AGENT_UNAVAILABLE'), 80);
}

function safeErrorMessage(error) {
  return bounded(error?.message || error, 240) || 'Support intelligence backend was unavailable.';
}

function privateHost(hostname) {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
  const octets = hostname.split('.').map(Number);
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return false;
  const [a, b] = octets;
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

function allowlistedHostsFrom(value) {
  return text(value).split(',').map(item => item.trim().toLowerCase()).filter(item => {
    if (!item || /[*\/:@\s]/.test(item)) return false;
    return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(item);
  });
}

function endpointFrom(value, {allowlistedHosts = []} = {}) {
  const raw = text(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    const hostname = url.hostname.toLowerCase();
    if (privateHost(hostname)) return url.href.replace(/\/$/, '');
    if (url.protocol !== 'https:') return null;
    if (!allowlistedHosts.includes(hostname)) return null;
    return url.href.replace(/\/$/, '');
  } catch {
    return null;
  }
}

function timeoutFrom(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? Math.max(1000, Math.min(parsed, 60000)) : DEFAULT_TIMEOUT_MS;
}

function modelFrom(value) {
  const model = text(value, DEFAULT_MODEL);
  return /^[A-Za-z0-9._:-]{1,80}$/.test(model) ? model : DEFAULT_MODEL;
}

function tokenFrom(value) {
  const token = text(value);
  return token && token.length <= MAX_TOKEN_CHARS ? token : null;
}

function configFrom(environment) {
  const requestedProvider = text(environment.CHAMELEON_SUPPORT_AGENT_PROVIDER || environment.CHAMELEON_AGENT_PROVIDER, 'disabled').toLowerCase();
  const expiresAtRaw = text(environment.CHAMELEON_SUPPORT_AGENT_EXPIRES_AT);
  const expiresAtMs = expiresAtRaw ? Date.parse(expiresAtRaw) : null;
  const windowExpired = Boolean(expiresAtRaw) && (!Number.isFinite(expiresAtMs) || Date.now() >= expiresAtMs);
  const allowedHosts = requestedProvider === 'openclaw' ? allowlistedHostsFrom(environment.CHAMELEON_SUPPORT_AGENT_ALLOWED_HOSTS) : [];
  return {
    provider: !windowExpired && PROVIDERS.has(requestedProvider) ? requestedProvider : 'disabled',
    requestedProvider,
    windowExpired,
    expiresAt: Number.isFinite(expiresAtMs) ? new Date(expiresAtMs).toISOString() : null,
    allowedHosts,
    endpoint: endpointFrom(environment.CHAMELEON_SUPPORT_AGENT_BASE_URL || environment.CHAMELEON_AGENT_BASE_URL, {allowlistedHosts: allowedHosts}),
    token: tokenFrom(environment.CHAMELEON_SUPPORT_AGENT_TOKEN || environment.CHAMELEON_AGENT_TOKEN),
    model: modelFrom(environment.CHAMELEON_SUPPORT_AGENT_MODEL || environment.CHAMELEON_AGENT_MODEL),
    timeoutMs: timeoutFrom(environment.CHAMELEON_SUPPORT_AGENT_TIMEOUT_MS || environment.CHAMELEON_AGENT_TIMEOUT_MS)
  };
}

export function resolveSupportAgentEndpoint(environment = process.env) {
  const config = configFrom(environment);
  return {
    provider: config.provider,
    requested_provider: config.requestedProvider,
    endpoint: config.endpoint,
    endpoint_configured: Boolean(config.endpoint),
    token_configured: Boolean(config.token),
    allowed_host_count: config.allowedHosts.length,
    execution: 'NO_EXECUTION'
  };
}

function unavailable(config, code, message, latencyMs = 0) {
  return {
    status: 'UNAVAILABLE', provider: config.provider, model: config.provider === 'ollama' ? config.model : null,
    latency_ms: latencyMs, advisory: true, authorization: false, recommendation: null,
    error: {code, message}
  };
}

function disabled(config) {
  return {status: 'DISABLED', provider: config.provider, model: null, latency_ms: 0, advisory: true, authorization: false, recommendation: null};
}

function parseRecommendation(content) {
  let parsed = content;
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const source = text(content);
    if (!source) return null;
    try { parsed = JSON.parse(source); } catch {
      const match = source.match(/\{[\s\S]*\}/);
      if (!match) return null;
      try { parsed = JSON.parse(match[0]); } catch { return null; }
    }
  }
  if (parsed?.decision && typeof parsed.decision === 'object') parsed = parsed.decision;
  else if (parsed?.recommendation && typeof parsed.recommendation === 'object') parsed = parsed.recommendation;
  const aliases = {AUTO_RESOLVE: 'AUTO_REPLY', STAFF_REVIEW: 'HUMAN_WORK', OWNER_REVIEW: 'APPROVAL_REQUIRED'};
  const disposition = aliases[text(parsed?.disposition).toUpperCase()] || text(parsed?.disposition).toUpperCase();
  if (!WORKER_DISPOSITIONS.has(disposition)) return null;
  const confidence = Number(parsed?.confidence);
  const missingInformation = Array.isArray(parsed?.missing_information)
    ? parsed.missing_information.map(item => bounded(item, 300)).filter(Boolean).slice(0, 3)
    : (text(parsed?.missing_information) ? bounded(parsed.missing_information, 300) : null);
  const recommendation = {
    disposition, classification: bounded(parsed?.classification || 'UNSPECIFIED', 80),
    reason: bounded(parsed?.reason || parsed?.escalation_reason || 'No agent reason supplied.', 300),
    draft: bounded(parsed?.draft || parsed?.proposed_customer_response, MAX_DRAFT_CHARS),
    missing_information: missingInformation,
    proposed_action: bounded(parsed?.proposed_action, 400) || null,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(confidence, 1)) : null
  };
  if (!recommendation.classification || !recommendation.reason || !recommendation.draft) return null;
  return recommendation;
}

function promptFor(context) {
  return [
    'You are a bounded customer-support decision worker. Chameleon owns the case workflow and execution rails.',
    `Playbook: ${JSON.stringify(playbookForWorker())}`,
    'Return JSON only: {"classification":"...","disposition":"AUTO_REPLY|WAITING_CUSTOMER|HUMAN_WORK|APPROVAL_REQUIRED","reason":"...","confidence":0.0,"draft":"...","missing_information":"... or null","proposed_action":"... or null"}.',
    'FAILED_AUTOMATION is Chameleon-owned and must not be returned by a healthy worker.',
    'Choose the disposition from supplied facts. For a verified, unambiguous order status, use AUTO_REPLY even when tracking is absent. Use WAITING_CUSTOMER only when the customer can provide the missing fact or evidence. For refunds, replacements, reships, credits, payment disputes, or address changes, choose APPROVAL_REQUIRED when the likely action and required context are supplied; do not claim execution. A damaged item does not inherently require Human Work: ask for missing evidence when appropriate, or prepare a remedy for approval when supported. For dosing, reconstitution, human-use, or other compliance questions, choose AUTO_REPLY with a concise approved refusal/boundary response; never provide medical, dosing, or human-use instructions.',
    'Keep every field concise. Do not expose chain-of-thought, repeat context, invent facts, claim execution, or include provider instructions.',
    `Chameleon context: ${JSON.stringify(context).slice(0, MAX_CONTEXT_CHARS)}`
  ].join('\n');
}

export function openClawReasoningRequest(context) {
  return {
    playbook_version: text(context?.playbook?.version, SUPPORT_PLAYBOOK_VERSION),
    profile: text(context?.playbook?.profile, SUPPORT_PLAYBOOK_PROFILE),
    customer_message: bounded(context?.message, MAX_CONTEXT_CHARS),
    verified_context: {
      customer: context?.customer || {resolved: false},
      order: context?.order || {found: false},
      tracking: context?.tracking || null
    },
    history_summary: context?.history_summary ? bounded(context.history_summary, 800) : null,
    approved_support_knowledge: context?.approved_knowledge || null,
    constraints: {reasoning_only: true, execution: 'NO_EXECUTION', forbidden: [...OPENCLAW_FORBIDDEN]}
  };
}

async function invokeOpenClaw(config, context, fetchImpl) {
  if (!config.endpoint) return unavailable(config, 'AGENT_ENDPOINT_INVALID', 'OpenClaw support endpoint is missing or not private.');
  if (!config.token) return unavailable(config, 'AGENT_TOKEN_MISSING', 'OpenClaw support token is not configured.');
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(`${config.endpoint}${OPENCLAW_SUPPORT_REASON_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${config.token}`
      },
      body: JSON.stringify(openClawReasoningRequest(context)),
      signal: controller.signal
    });
    if (!response.ok) throw Object.assign(new Error('Support intelligence backend returned an HTTP error.'), {status: response.status});
    let payload;
    try { payload = await response.json(); } catch {
      return unavailable(config, 'AGENT_RESPONSE_INVALID', 'Support intelligence backend did not return the required bounded JSON recommendation.', Date.now() - started);
    }
    const recommendation = parseRecommendation(payload);
    if (!recommendation) return unavailable(config, 'AGENT_RESPONSE_INVALID', 'Support intelligence backend did not return the required bounded JSON recommendation.', Date.now() - started);
    return {status: 'READY', provider: config.provider, model: null, latency_ms: Date.now() - started, advisory: true, authorization: false, recommendation};
  } catch (error) {
    const code = error?.name === 'AbortError' ? 'AGENT_TIMEOUT' : safeErrorCode(error);
    return unavailable(config, code, error?.name === 'AbortError' ? 'Support intelligence backend exceeded its bounded timeout.' : safeErrorMessage(error), Date.now() - started);
  } finally {
    clearTimeout(timer);
  }
}

async function invokeOllama(config, context, fetchImpl) {
  if (!config.endpoint) return unavailable(config, 'AGENT_ENDPOINT_INVALID', 'LAB Ollama endpoint is missing or not private.');
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetchImpl(`${config.endpoint}/api/chat`, {
      method: 'POST',
      headers: {'content-type': 'application/json', accept: 'application/json'},
      body: JSON.stringify({
        model: config.model,
        messages: [
          {role: 'system', content: 'Return one JSON object. The parent Chameleon policy is authoritative; do not authorize or execute anything.'},
          {role: 'user', content: promptFor(context)}
        ],
        stream: false,
        think: false,
        format: 'json',
        options: {temperature: 0, num_predict: 320}
      }),
      signal: controller.signal
    });
    if (!response.ok) throw Object.assign(new Error('LAB agent backend returned an HTTP error.'), {status: response.status});
    const payload = await response.json();
    const recommendation = parseRecommendation(payload?.message?.content || payload?.response);
    if (!recommendation) return unavailable(config, 'AGENT_RESPONSE_INVALID', 'LAB agent backend did not return the required bounded JSON recommendation.', Date.now() - started);
    return {status: 'READY', provider: config.provider, model: config.model, latency_ms: Date.now() - started, advisory: true, authorization: false, recommendation};
  } catch (error) {
    const code = error?.name === 'AbortError' ? 'AGENT_TIMEOUT' : safeErrorCode(error);
    return unavailable(config, code, error?.name === 'AbortError' ? 'LAB agent backend exceeded its bounded timeout.' : safeErrorMessage(error), Date.now() - started);
  } finally {
    clearTimeout(timer);
  }
}

export function createSupportAgentAdapter({environment = process.env, fetchImpl = globalThis.fetch} = {}) {
  const config = configFrom(environment);
  return Object.freeze({
    provider: config.provider,
    model: config.provider === 'ollama' ? config.model : null,
    enabled: config.provider !== 'disabled',
    runtime() {
      return {
        provider: config.provider,
        requested_provider: config.requestedProvider,
        model: config.provider === 'ollama' ? config.model : null,
        enabled: config.provider !== 'disabled',
        window_expired: config.windowExpired,
        expires_at: config.expiresAt,
        playbook_version: SUPPORT_PLAYBOOK_VERSION,
        profile: SUPPORT_PLAYBOOK_PROFILE,
        advisory: true,
        authorization: false,
        execution: 'NO_EXECUTION',
        endpoint_configured: Boolean(config.endpoint),
        token_configured: Boolean(config.token),
        allowed_host_count: config.allowedHosts.length
      };
    },
    async analyze(context) {
      if (config.provider === 'disabled') return disabled(config);
      if (config.provider === 'openclaw') return invokeOpenClaw(config, context, fetchImpl);
      return invokeOllama(config, context, fetchImpl);
    }
  });
}
