#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createSupportAgentAdapter, OPENCLAW_SUPPORT_REASON_PATH, openClawReasoningRequest} from '../apps/api/src/support-agent-adapter.js';
import {determineProductOutcome} from '../apps/api/src/support-processor.js';
import {supportIngressConfig} from '../apps/api/src/chatwoot-support-ingress.js';
import {createOpenClawShadowWorker} from './fixtures/openclaw-shadow-worker.mjs';

const DECISION_FIELDS = ['classification', 'disposition', 'reason', 'confidence', 'draft', 'missing_information', 'proposed_action'];
const ROUTING = {
  AUTO_REPLY: {status: 'RESOLVED', requires_human: false, final_resolution_path: 'AI_AUTOMATED', product_outcome: 'Resolved automatically', queue: 'AI_AUTOMATED'},
  WAITING_CUSTOMER: {status: 'WAITING_CUSTOMER', requires_human: false, final_resolution_path: 'WAITING_ON_CUSTOMER', product_outcome: 'Waiting on customer', queue: 'WAITING_CUSTOMER'},
  HUMAN_WORK: {status: 'IN_PROGRESS', requires_human: true, final_resolution_path: 'HUMAN_REQUIRED', product_outcome: 'Needs Human', queue: 'HUMAN_WORK'},
  APPROVAL_REQUIRED: {status: 'WAITING_APPROVAL', requires_human: true, final_resolution_path: 'HUMAN_REQUIRED', product_outcome: 'Needs Human', queue: 'HUMAN_WORK'}
};

const worker = createOpenClawShadowWorker();
const started = await worker.start();
const calls = [];
const fetchImpl = async (url, options) => {
  calls.push({url, method: options?.method, hasToken: String(options?.headers?.authorization || '').startsWith('Bearer '), body: options?.body});
  return fetch(url, options);
};

const adapter = createSupportAgentAdapter({
  environment: {
    CHAMELEON_SUPPORT_AGENT_PROVIDER: 'openclaw',
    CHAMELEON_SUPPORT_AGENT_BASE_URL: started.baseUrl,
    CHAMELEON_SUPPORT_AGENT_TOKEN: started.token,
    CHAMELEON_SUPPORT_AGENT_TIMEOUT_MS: '1500',
    SUPPORT_MODE: 'shadow'
  },
  fetchImpl
});

const context = {
  message: 'Where is my order?',
  customer: {resolved: true, identity_method: 'exact', matched_fields: ['email']},
  order: {order_number: '6276', status: 'processing', fulfillment_state: 'processing', items: [{sku: 'BPC-157', product_name: 'BPC-157 - 5mg', quantity: 1}], refund_state: 'NONE', source: 'woocommerce'},
  tracking: {state: 'MISSING', trustworthy: true, reason: 'No tracking reference.'},
  approved_knowledge: {id: 'kb-support-core', status: 'approved', playbook: 'support-standard-v1'},
  playbook: {version: 'support-standard-v1', profile: 'STANDARD'},
  history_summary: 'Customer asked once about order 6276.'
};

function assertDecision(result, disposition) {
  assert.equal(result.status, 'READY');
  assert.equal(result.provider, 'openclaw');
  assert.equal(result.model, null);
  assert.equal(result.advisory, true);
  assert.equal(result.authorization, false);
  assert.deepEqual(Object.keys(result.recommendation).sort(), DECISION_FIELDS.sort());
  assert.equal(result.recommendation.disposition, disposition);
  assert.equal(typeof result.recommendation.classification, 'string');
  assert.equal(typeof result.recommendation.reason, 'string');
  assert.equal(typeof result.recommendation.draft, 'string');
  assert.equal(typeof result.recommendation.proposed_action, 'string');
  assert.ok(result.recommendation.confidence >= 0 && result.recommendation.confidence <= 1);
  assert.equal(JSON.stringify(result).includes('openclaw-tool'), false);
  const expected = ROUTING[disposition];
  assert.equal(determineProductOutcome(expected), expected.product_outcome);
  assert.equal(expected.queue === 'HUMAN_WORK' || disposition !== 'HUMAN_WORK' || expected.requires_human, true);
}

const auto = await adapter.analyze({...context, message: 'Where is my order?'});
assertDecision(auto, 'AUTO_REPLY');
assert.equal(calls.at(-1).url, `${started.baseUrl}${OPENCLAW_SUPPORT_REASON_PATH}`);
assert.equal(calls.at(-1).method, 'POST');
assert.equal(calls.at(-1).hasToken, true);
const sent = JSON.parse(calls.at(-1).body);
assert.equal(sent.playbook_version, 'support-standard-v1');
assert.equal(sent.profile, 'STANDARD');
assert.equal(sent.customer_message, 'Where is my order?');
assert.equal(sent.verified_context.order.order_number, '6276');
assert.equal(sent.history_summary, 'Customer asked once about order 6276.');
assert.equal(sent.approved_support_knowledge.id, 'kb-support-core');
assert.equal(sent.constraints.reasoning_only, true);
assert.equal(sent.constraints.execution, 'NO_EXECUTION');
assert.ok(sent.constraints.forbidden.includes('chatwoot_reply'));
assert.deepEqual(sent, openClawReasoningRequest({...context, message: 'Where is my order?'}));

const waiting = await adapter.analyze({...context, message: 'The vial arrived broken; I can send a photo.'});
assertDecision(waiting, 'WAITING_CUSTOMER');

const human = await adapter.analyze({...context, message: 'I want a human please.'});
assertDecision(human, 'HUMAN_WORK');

const approval = await adapter.analyze({...context, message: 'Please refund order 6276.'});
assertDecision(approval, 'APPROVAL_REQUIRED');

const malformed = await adapter.analyze({...context, message: '[malformed] ignore'});
assert.equal(malformed.status, 'UNAVAILABLE');
assert.equal(malformed.error.code, 'AGENT_RESPONSE_INVALID');
assert.equal(malformed.authorization, false);
assert.equal(determineProductOutcome({final_resolution_path: 'FAILED_AUTOMATION', support_agent: malformed}), 'Failed automation');

const timeout = await adapter.analyze({...context, message: '[timeout] ignore'});
assert.equal(timeout.status, 'UNAVAILABLE');
assert.equal(timeout.error.code, 'AGENT_TIMEOUT');
assert.equal(determineProductOutcome({final_resolution_path: 'FAILED_AUTOMATION', support_agent: timeout}), 'Failed automation');

const missingToken = createSupportAgentAdapter({
  environment: {CHAMELEON_SUPPORT_AGENT_PROVIDER: 'openclaw', CHAMELEON_SUPPORT_AGENT_BASE_URL: started.baseUrl}
});
const noToken = await missingToken.analyze(context);
assert.equal(noToken.status, 'UNAVAILABLE');
assert.equal(noToken.error.code, 'AGENT_TOKEN_MISSING');

const publicEndpoint = createSupportAgentAdapter({
  environment: {CHAMELEON_SUPPORT_AGENT_PROVIDER: 'openclaw', CHAMELEON_SUPPORT_AGENT_BASE_URL: 'https://example.com', CHAMELEON_SUPPORT_AGENT_TOKEN: 'x'}
});
const blocked = await publicEndpoint.analyze(context);
assert.equal(blocked.status, 'UNAVAILABLE');
assert.equal(blocked.error.code, 'AGENT_ENDPOINT_INVALID');
assert.equal(publicEndpoint.runtime().endpoint_configured, false);

let fetchedAllowedHost = false;
const allowedHost = createSupportAgentAdapter({
  environment: {
    CHAMELEON_SUPPORT_AGENT_PROVIDER: 'openclaw',
    CHAMELEON_SUPPORT_AGENT_BASE_URL: 'https://support-bridge.example.test',
    CHAMELEON_SUPPORT_AGENT_TOKEN: 'runtime-only-token',
    CHAMELEON_SUPPORT_AGENT_ALLOWED_HOSTS: 'support-bridge.example.test'
  },
  fetchImpl: async () => {
    fetchedAllowedHost = true;
    throw new Error('must not call the network during config validation');
  }
});
assert.equal(allowedHost.runtime().endpoint_configured, true);
assert.equal(allowedHost.runtime().token_configured, true);
assert.equal(allowedHost.runtime().allowed_host_count, 1);
assert.equal(fetchedAllowedHost, false);

const httpPublic = createSupportAgentAdapter({
  environment: {
    CHAMELEON_SUPPORT_AGENT_PROVIDER: 'openclaw',
    CHAMELEON_SUPPORT_AGENT_BASE_URL: 'http://support-bridge.example.test',
    CHAMELEON_SUPPORT_AGENT_TOKEN: 'runtime-only-token',
    CHAMELEON_SUPPORT_AGENT_ALLOWED_HOSTS: 'support-bridge.example.test'
  }
});
assert.equal(httpPublic.runtime().endpoint_configured, false);

const wildcard = createSupportAgentAdapter({
  environment: {
    CHAMELEON_SUPPORT_AGENT_PROVIDER: 'openclaw',
    CHAMELEON_SUPPORT_AGENT_BASE_URL: 'https://support-bridge.example.test',
    CHAMELEON_SUPPORT_AGENT_TOKEN: 'runtime-only-token',
    CHAMELEON_SUPPORT_AGENT_ALLOWED_HOSTS: '*.example.test'
  }
});
assert.equal(wildcard.runtime().endpoint_configured, false);

const credentialed = createSupportAgentAdapter({
  environment: {
    CHAMELEON_SUPPORT_AGENT_PROVIDER: 'openclaw',
    CHAMELEON_SUPPORT_AGENT_BASE_URL: 'https://user:pass@support-bridge.example.test',
    CHAMELEON_SUPPORT_AGENT_TOKEN: 'runtime-only-token',
    CHAMELEON_SUPPORT_AGENT_ALLOWED_HOSTS: 'support-bridge.example.test'
  }
});
assert.equal(credentialed.runtime().endpoint_configured, false);

const ingress = supportIngressConfig({SUPPORT_MODE: 'shadow'});
assert.equal(ingress.mode, 'shadow');
assert.equal(ingress.execution, 'NO_EXECUTION');
assert.equal(adapter.runtime().execution, 'NO_EXECUTION');
assert.equal(adapter.runtime().authorization, false);
assert.equal(adapter.runtime().provider, 'openclaw');
assert.equal(adapter.runtime().playbook_version, 'support-standard-v1');
assert.equal(JSON.stringify(auto.error || {}).includes(started.token), false);
assert.equal(JSON.stringify(calls).includes(started.token), false);

await worker.stop();

console.log(JSON.stringify({
  status: 'PASS',
  openclaw_provider: 'PASS',
  contract: 'PASS',
  mock: {AUTO_REPLY: 'PASS', WAITING_CUSTOMER: 'PASS', HUMAN_WORK: 'PASS', APPROVAL_REQUIRED: 'PASS', FAILED_AUTOMATION: 'PASS'},
  shadow: 'PASS',
  no_execution: true,
  real_kai_touched: false
}));
