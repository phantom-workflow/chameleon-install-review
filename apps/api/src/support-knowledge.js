const KNOWLEDGE = [
  {id: 'order-status-v1', domain: 'ORDER_STATUS_REQUEST', status: 'APPROVED', source: 'chameleon-policy', version: 'v1', playbook: 'verified-order-status', fact: 'Use only the current verified order status and tracking assessment supplied by Chameleon.'},
  {id: 'shipping-policy-v1', domain: 'SHIPPING_QUESTION', status: 'APPROVED', source: 'chameleon-policy', version: 'v1', playbook: 'ordinary-shipping', fact: 'Ordinary shipping questions may be answered only from approved policy and verified order context.'},
  {id: 'product-facts-v1', domain: 'PRODUCT_QUESTION', status: 'APPROVED', source: 'chameleon-policy', version: 'v1', playbook: 'approved-product-facts', fact: 'Approved factual product information must remain research-use-only and cannot provide human-use guidance.'},
  {id: 'payment-faq-v1', domain: 'PAYMENT_ISSUE', status: 'APPROVED', source: 'chameleon-policy', version: 'v1', playbook: 'payment-faq-no-transaction', fact: 'Payment explanations may not perform, promise, or imply a transaction.'},
  {id: 'stale-stock-reference-v0', domain: 'STOCK_RESTOCK', status: 'STALE', source: 'reference-only', version: 'v0', playbook: 'none', fact: 'Reference-only stock statement; never use as authority.'}
];

export function selectSupportKnowledge({caseType, message}) {
  const requested = caseType === 'ORDER_STATUS_REQUEST' && /tracking/i.test(String(message || '')) ? 'ORDER_STATUS_REQUEST' : caseType;
  const candidates = KNOWLEDGE.filter(item => item.domain === requested);
  const approved = candidates.find(item => item.status === 'APPROVED');
  if (!approved) return {status: 'UNAVAILABLE', selected: null, rejected: candidates.map(item => ({id: item.id, status: item.status, source: item.source})), reason: candidates.length ? 'Only stale or unapproved knowledge matched.' : 'No approved knowledge matched.'};
  return {status: 'APPROVED', selected: approved, rejected: candidates.filter(item => item.id !== approved).map(item => ({id: item.id, status: item.status, source: item.source})), reason: 'Approved knowledge selected.'};
}

export function supportKnowledgeCatalog() {
  return KNOWLEDGE.map(({id, domain, status, source, version, playbook}) => ({id, domain, status, source, version, playbook}));
}
