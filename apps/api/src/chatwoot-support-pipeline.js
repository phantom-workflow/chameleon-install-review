import {classifyMessage} from './domain.js';
import {ingestSupportEvent, prepareSupportContext, supportAgentContext} from './support-processor.js';
import {selectSupportKnowledge} from './support-knowledge.js';
import {normalizeChatwootEvent, sanitizeChatwootShadowPayload, supportMode} from './chatwoot-support-ingress.js';

export async function ingestChatwootSupportEvent({
  payload,
  sourceAuth,
  adapter,
  supportAgent,
  mode = supportMode()
}) {
  const safePayload = sanitizeChatwootShadowPayload(payload);
  const normalized = normalizeChatwootEvent(safePayload, {sourceAuth});
  const caseTypeHint = classifyMessage(normalized.message);
  const knowledge = selectSupportKnowledge({caseType: caseTypeHint, message: normalized.message});
  const preparedContext = await prepareSupportContext(normalized);
  let agent = await supportAgent.analyze(supportAgentContext({
    ...preparedContext,
    caseType: caseTypeHint,
    knowledge,
    message: normalized.message
  }));
  if (normalized.metadata?.simulate_agent_error || safePayload?.metadata?.simulate_agent_error || safePayload?.simulate_agent_error) {
    agent = {status: 'ERROR', provider: 'advisory-agent-lab', latency_ms: 12, error: {code: 'SIMULATED_AGENT_ERROR', message: 'Simulated agent automation failure'}, advisory: true, authorization: false};
  }
  normalized.metadata = {
    ...normalized.metadata,
    knowledge,
    playbook_version: 'support-standard-v1',
    profile: 'STANDARD',
    support_agent: {
      status: agent.status,
      provider: agent.provider,
      model: agent.model || null,
      latency_ms: agent.latency_ms,
      error_code: agent.error?.code || null,
      error_message: agent.error?.message || null,
      recommendation: agent.recommendation || null,
      advisory: true,
      authorization: false
    }
  };
  if (agent.status === 'UNAVAILABLE' || agent.status === 'ERROR') {
    normalized.routing_strategy = 'FAILED_AUTOMATION';
  }
  if (normalized.metadata?.waiting_on_customer || safePayload?.metadata?.waiting_on_customer || safePayload?.waiting_on_customer) {
    normalized.routing_strategy = 'WAITING_ON_CUSTOMER';
    normalized.metadata.waiting_on_customer = true;
  }
  preparedContext.event = {...preparedContext.event, metadata: normalized.metadata, routing_strategy: normalized.routing_strategy};
  const accepted = await ingestSupportEvent({adapter, input: normalized, preparedContext});
  return {
    ...accepted,
    support_mode: mode,
    knowledge,
    support_agent: normalized.metadata.support_agent,
    outbound: {status: 'disabled', execution: 'NO_EXECUTION'},
    source_auth: {
      verified: true,
      method: sourceAuth?.method || 'unknown',
      credential_id: sourceAuth?.credentialId || null
    },
    execution: 'NO_EXECUTION'
  };
}
