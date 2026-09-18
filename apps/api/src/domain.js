export const CASE_TYPES = Object.freeze([
  'DAMAGED_PRODUCT',
  'REFUND_REQUEST',
  'MISSING_SHIPMENT',
  'REORDER_REQUEST',
  'PRODUCT_QUESTION',
  'PAYMENT_ISSUE',
  'COMPLIANCE_QUESTION',
  'GENERAL_ESCALATION'
]);

export const ROLES = Object.freeze(['OWNER', 'OPERATIONS', 'CSR', 'FULFILLMENT', 'AGENT']);

export const ROLE_PERMISSIONS = Object.freeze({
  OWNER: ['customers:read', 'orders:read', 'orders:write', 'communications:read', 'cases:read', 'cases:write', 'timeline:read', 'inventory:read', 'fulfillment:read', 'financial:read', 'supplier:read', 'approvals:read', 'approvals:write', 'automation:read'],
  OPERATIONS: ['customers:read', 'orders:read', 'orders:write', 'cases:read', 'cases:write', 'timeline:read', 'inventory:read', 'fulfillment:read', 'automation:read'],
  CSR: ['customers:read', 'orders:read', 'communications:read', 'cases:read', 'cases:write', 'timeline:read'],
  FULFILLMENT: ['customers:read', 'orders:read', 'cases:read', 'cases:write', 'timeline:read', 'inventory:read', 'fulfillment:read'],
  AGENT: ['customers:read', 'orders:read', 'communications:read', 'cases:read', 'cases:write', 'timeline:read', 'automation:read']
});

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function normalizePhone(value) {
  const raw = String(value || '').trim();
  const digits = raw.replace(/[^0-9]/g, '');
  if (raw.startsWith('+') && digits.length >= 10) return '+' + digits;
  if (digits.length === 10) return '+1' + digits;
  return digits ? '+' + digits : '';
}

export function classifyMessage(text) {
  const value = String(text || '').toLowerCase();
  if (/broken|damaged|cracked|leak/.test(value)) return 'DAMAGED_PRODUCT';
  if (/refund|money back|charge back/.test(value)) return 'REFUND_REQUEST';
  if (/missing|where is my order|not arrived|late shipment/.test(value)) return 'MISSING_SHIPMENT';
  if (/same thing|reorder|order again/.test(value)) return 'REORDER_REQUEST';
  if (/how does|how do|what is|research|work/.test(value)) return 'PRODUCT_QUESTION';
  if (/payment|charged|checkout|card/.test(value)) return 'PAYMENT_ISSUE';
  if (/compliance|legal|medical|ruo/.test(value)) return 'COMPLIANCE_QUESTION';
  return 'GENERAL_ESCALATION';
}

export function permissionFor(role, resource, action = 'read') {
  const permission = resource + ':' + action;
  const permissions = ROLE_PERMISSIONS[role] || [];
  return permissions.includes(permission);
}

export function redactIdentifier(role, type, value) {
  if (role === 'OWNER') return value;
  const text = String(value || '');
  if (type === 'email') {
    const [local, domain] = text.split('@');
    return (local ? local.slice(0, 1) : '') + '***@' + (domain || 'redacted');
  }
  if (type === 'phone') return '***' + text.slice(-4);
  return '***';
}

export function readOnlySql(sql) {
  const normalized = String(sql || '').replace(/--.*$/gm, '').trim().toLowerCase();
  if (!normalized.startsWith('select') && !normalized.startsWith('with')) return false;
  return !/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/.test(normalized);
}
