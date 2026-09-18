export const SUPPORT_PLAYBOOK_VERSION = 'support-standard-v1';
export const SUPPORT_PLAYBOOK_PROFILE = 'STANDARD';
export const SUPPORT_DISPOSITIONS = new Set(['AUTO_REPLY', 'WAITING_CUSTOMER', 'HUMAN_WORK', 'APPROVAL_REQUIRED', 'FAILED_AUTOMATION']);

// Chameleon owns this workflow contract. Providers consume it but cannot define
// execution authority, case state, approvals, audit, or the operator experience.
export const standardSupportPlaybook = Object.freeze({
  version: SUPPORT_PLAYBOOK_VERSION,
  profile: SUPPORT_PLAYBOOK_PROFILE,
  execution: 'NO_EXECUTION',
  worker_output: ['classification', 'disposition', 'reason', 'confidence', 'draft', 'missing_information', 'proposed_action'],
  authority: {
    worker: ['classification', 'disposition', 'draft', 'missing_information', 'proposed_action'],
    chameleon: ['identity', 'order_context', 'tracking_context', 'knowledge', 'case_state', 'human_work', 'approval', 'audit', 'idempotency', 'execution_rails']
  }
});

export function playbookForWorker() {
  return {
    version: standardSupportPlaybook.version,
    profile: standardSupportPlaybook.profile,
    disposition_rules: {
      AUTO_REPLY: 'Verified supplied context can fully answer the customer.',
      WAITING_CUSTOMER: 'The customer can provide the exact missing fact or evidence needed to continue.',
      HUMAN_WORK: 'Genuine human judgment or investigation remains after the supplied context was used.',
      APPROVAL_REQUIRED: 'The likely remedy is known but a consequential action needs approval.',
      FAILED_AUTOMATION: 'Reserved for a Chameleon-recorded worker or dependency failure.'
    },
    non_negotiables: ['Use only supplied Chameleon context.', 'Do not invent facts.', 'Do not claim an action occurred.', 'Do not execute or instruct provider actions.', 'Return compact JSON only.']
  };
}
