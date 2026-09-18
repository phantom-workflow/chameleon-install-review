export const POLICY_VERSION = 'support-standard-v1';
export const DISPOSITIONS = new Set(['AUTO_RESOLVE', 'NO_REPLY', 'STAFF_REVIEW', 'OWNER_REVIEW', 'APPROVAL_REQUIRED']);
export const PRESETS = new Set(['CONSERVATIVE', 'STANDARD', 'HIGH']);

const hardBoundary = /medical|human use|dosing|dose|reconstitution|reconstitute|mixing|ratio|amount|compliance|privacy|security|legal|threat/i;
const moneyOrMutation = /refund|money back|charge back|replacement|replace|address change|modify order|cancel|payment|charged|checkout|card/i;

export function authorizeSupportPolicy({message, caseType, identity, order, candidateRecommendation}) {
  const value = String(message || '');
  const recommendation = String(candidateRecommendation || '').toUpperCase();
  const protectedAction = moneyOrMutation.test(value) || ['REFUND_REQUEST', 'PAYMENT_ISSUE'].includes(caseType);
  const protectedContent = hardBoundary.test(value) || caseType === 'COMPLIANCE_QUESTION';
  return {
    policy_version: POLICY_VERSION,
    intent: protectedAction ? 'PROTECTED_ACTION' : (protectedContent ? 'PROTECTED_CONTENT' : 'STANDARD_SUPPORT'),
    disposition: recommendation || null,
    hard_boundary: protectedAction || protectedContent,
    execution_authority: 'NO_EXECUTION',
    execution_requires_approval: protectedAction,
    reason: protectedAction ? 'Any consequential action remains approval-only and NO_EXECUTION.' : (protectedContent ? 'Approved boundary response may be drafted; execution remains NO_EXECUTION.' : 'The support worker owns the support disposition from the supplied Chameleon case packet.'),
    recommendation
  };
}

export function policyRules() {
  return {version: POLICY_VERSION, presets: [...PRESETS], dispositions: [...DISPOSITIONS], hard_boundaries: ['MEDICAL_HUMAN_USE_DOSING_RECONSTITUTION', 'COMPLIANCE', 'PRIVACY_SECURITY_LEGAL_THREAT'], execution: 'NO_EXECUTION'};
}

export async function currentPolicy(query) {
  const result = await query('SELECT * FROM support_policy_versions WHERE enabled=true ORDER BY changed_at DESC LIMIT 1');
  const row = result.rows[0];
  return row ? {...row, rules: row.rules || policyRules(), execution: 'NO_EXECUTION', environment: 'LAB'} : {policy_version: POLICY_VERSION, preset: 'STANDARD', rules: policyRules(), execution: 'NO_EXECUTION', environment: 'LAB'};
}

export async function policyHistory(query) {
  const result = await query('SELECT policy_version, preset, intent, disposition, conditions, hard_boundary, enabled, changed_by, changed_at, previous_version, rollback_reference FROM support_policy_versions ORDER BY changed_at DESC');
  return result.rows;
}

export async function policyMetrics(query) {
  const result = await query(`SELECT
    count(*)::int AS conversations_evaluated,
    count(*) FILTER (WHERE status IN ('RESOLVED','CLOSED'))::int AS ai_auto_resolved,
    count(*) FILTER (WHERE owner_scope='CSR' AND requires_human=true AND status NOT IN ('RESOLVED','CLOSED'))::int AS staff_handoffs,
    count(*) FILTER (WHERE owner_scope='OWNER' OR status='WAITING_APPROVAL')::int AS owner_or_protected_handoffs,
    count(*) FILTER (WHERE status='WAITING_APPROVAL')::int AS approval_required,
    count(*) FILTER (WHERE requires_human=false)::int AS automation_count
    FROM cases WHERE source='synthetic'`);
  const row = result.rows[0] || {};
  const total = Number(row.conversations_evaluated || 0);
  return {...row, automation_rate: total ? Number((Number(row.automation_count || 0) / total).toFixed(4)) : 0, handoff_rate: total ? Number((Number(row.staff_handoffs || 0) / total).toFixed(4)) : 0, source: 'chameleon-postgres', synthetic: true, execution: 'NO_EXECUTION'};
}
