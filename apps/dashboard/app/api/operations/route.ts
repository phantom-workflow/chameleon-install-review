/* eslint-disable @typescript-eslint/no-explicit-any */
import {NextResponse} from 'next/server';
import {authContext, unauthorizedResponse} from '../../../lib/auth';
import {configuredUrl, dashboardRuntime} from '../../../lib/runtime';

const upstream = (process.env.CHAMELEON_API_BASE_URL || 'http://127.0.0.1:19200').replace(/\/$/, '');
const commandCenter = (process.env.CHAMELEON_COMMAND_CENTER_URL || 'http://127.0.0.1:19100').replace(/\/$/, '');

type ReadReference = {available: boolean; data?: any; error?: string; source: string};
type JobItem = {name: string; state: string; detail: string};

function deepLinks() {
  const referenceEnvironment = dashboardRuntime.environment === 'production' ? 'reference' : 'LAB';
  const twenty = configuredUrl('NEXT_PUBLIC_TWENTY_URL', 'http://127.0.0.1:19300');
  const woo = configuredUrl('NEXT_PUBLIC_WOO_URL', 'http://127.0.0.1:18082');
  const configuredChatwoot = process.env.NEXT_PUBLIC_CHATWOOT_URL || '';
  const chatwootIsLegacyOperations = configuredChatwoot.includes(':19210');
  const chatwoot = configuredChatwoot && !chatwootIsLegacyOperations ? configuredChatwoot : undefined;
  return [
    {key: 'TWENTY', label: twenty ? `Twenty deep records · ${referenceEnvironment}` : 'Twenty deep records · unavailable', href: twenty || undefined, status: twenty ? 'LAB_REFERENCE' : 'UNAVAILABLE', target: 'TWENTY', referenceOnly: true, reason: twenty ? 'CRM/deep-record reference; Chameleon remains operational authority.' : 'No supported Twenty destination is configured.'},
    {key: 'WOO', label: woo ? `Woo order context · ${referenceEnvironment}` : 'Woo order context · unavailable', href: woo || undefined, status: woo ? 'LAB_REFERENCE' : 'UNAVAILABLE', target: 'WOO', referenceOnly: true, reason: woo ? 'Commerce context is reference-only; no fulfillment action.' : 'No supported Woo destination is configured.'},
    {key: 'CHATWOOT', label: chatwoot ? 'Chatwoot conversation · LAB reference' : 'Chatwoot conversation · unavailable', href: chatwoot, status: chatwoot ? 'LAB_REFERENCE' : 'UNAVAILABLE', target: 'CHATWOOT', referenceOnly: true, reason: chatwoot ? 'Configured destination must remain read-only in LAB.' : 'No supported Chatwoot destination is configured. Legacy 19210 is an Operations reference, not Chatwoot.'}
  ];
}

async function read(path: string, token: string) {
  const response = await fetch(upstream + path, {
    headers: {accept: 'application/json', authorization: `Bearer ${token}`},
    cache: 'no-store'
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('Chameleon API returned HTTP ' + response.status);
  return body;
}

async function readOptional(base: string, path: string, token: string): Promise<ReadReference> {
  try {
    const response = await fetch(base + path, {
      headers: base === upstream ? {accept: 'application/json', authorization: `Bearer ${token}`} : {accept: 'application/json'},
      cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return {available: false, error: 'HTTP ' + response.status, source: base};
    return {available: true, data, source: base};
  } catch (error) {
    return {available: false, error: error instanceof Error ? error.message : 'unavailable', source: base};
  }
}

function jobStatus(jobHealth: any): JobItem[] {
  return (jobHealth?.items || []).map((item: any) => {
    const name = item.job_name || 'LAB job';
    const evidence = String(item.evidence?.source || '').toLowerCase();
    if (name === 'approval-reconciler' || evidence.includes('external executor configured')) return {name, state: 'DISABLED', detail: 'LAB only · no external executor configured'};
    if (name === 'twilio-ingestion' || evidence.includes('synthetic-only heartbeat')) return {name, state: 'NOT_CONNECTED', detail: 'LAB reference · no Twilio transport connected'};
    if (name === 'customer-reference-sync' || evidence.includes('twenty reference probe')) return {name, state: 'REFERENCE_ONLY', detail: 'LAB reference · no live sync worker connected'};
    return {name, state: item.state || 'UNKNOWN', detail: item.evidence?.source || 'No health evidence'};
  });
}

function isVisibleLabRecord(item: any) {
  const source = String(item?.source || item?.order_source || item?.evidence?.source || '').toLowerCase();
  const sourceOfTruth = String(item?.source_of_truth || '').toLowerCase();
  return source.includes('synthetic') || source.includes('woocommerce') || sourceOfTruth.includes('chameleon-postgres') || item?.evidence?.execution === 'NO_EXECUTION';
}

function cleanReferenceLabel(value: unknown) {
  const text = String(value ?? '');
  return text.replace(/^SYNTHETIC CUSTOMER\s*/i, 'Demo customer ').replace(/^SYNTHETIC CUSTOMER$/i, 'Demo customer').replace(/^SYN-ORDER-/i, 'Order ').replace(/^TEST PRODUCT A$/i, 'Recovery Essentials').replace(/^TEST PRODUCT B$/i, 'Daily Wellness Kit').replace(/^TEST PRODUCT C$/i, 'Travel Wellness Pack').replace(/^TEST PRODUCT D$/i, 'Education Support Kit').replace(/^SYNTHETIC PEPTIDE VIAL$/i, 'Recovery Essentials');
}

function cleanCommandReference(ref: ReadReference): ReadReference {
  if (!ref.available || !ref.data) return ref;
  const data = {...ref.data};
  if (Array.isArray(data.orders)) data.orders = data.orders.map((item: any) => ({...item, displayId: cleanReferenceLabel(item.id), displayCustomerName: cleanReferenceLabel(item.customerName), items: (item.items || []).map((line: any) => ({...line, name: cleanReferenceLabel(line.name)}))}));
  if (Array.isArray(data.groups)) data.groups = data.groups.map((item: any) => ({...item, displayProductName: cleanReferenceLabel(item.productName)}));
  if (Array.isArray(data.recommendations)) data.recommendations = data.recommendations.map((item: any) => ({...item, displayProductName: cleanReferenceLabel(item.productName)}));
  if (Array.isArray(data.tracking)) data.tracking = data.tracking.map((item: any) => ({...item, displayContents: cleanReferenceLabel(item.contents), displayPackageRef: 'LAB reference · ' + cleanReferenceLabel(item.packageRef)}));
  if (Array.isArray(data.sources)) data.sources = data.sources.map((item: any) => ({...item, label: cleanReferenceLabel(item.label)}));
  if (Array.isArray(data.rows)) data.rows = data.rows.map((item: any) => ({...item, label: cleanReferenceLabel(item.label), name: cleanReferenceLabel(item.name)}));
  if (Array.isArray(data.totals)) data.totals = data.totals.map((item: any) => ({...item, method: cleanReferenceLabel(item.method)}));
  if (Array.isArray(data.conversations)) data.conversations = data.conversations.map((item: any) => ({...item, contact: item.contact ? {...item.contact, name: cleanReferenceLabel(item.contact.name)} : item.contact}));
  return {...ref, data};
}

function buildRetentionReference(acquisition: ReadReference) {
  const summary = acquisition.available && acquisition.data?.summary ? acquisition.data.summary : null;
  const newCustomers = Number(summary?.newCustomers || 0);
  const returningCustomers = Number(summary?.returningCustomers || 0);
  return {
    available: acquisition.available,
    source: acquisition.source,
    referenceOnly: true,
    authoritative: false,
    derivedFrom: '/api/v2/customer-acquisition',
    summary: summary ? {
      newCustomers,
      returningCustomers,
      returningSharePct: newCustomers + returningCustomers ? Number(((returningCustomers / (newCustomers + returningCustomers)) * 100).toFixed(1)) : 0,
      newRevenue: Number(summary?.newRevenue || 0),
      returningRevenue: Number(summary?.returningRevenue || 0)
    } : {}
  };
}

function determineProductOutcome(item: any, routing: any, evidence: any): string {
  if (item.product_outcome) return item.product_outcome;
  const path = String(item.final_resolution_path || routing?.strategy || '').toUpperCase();
  const st = String(item.status || '').toUpperCase();
  const hwSt = String(item.human_work_status || item.human_work?.status || '').toUpperCase();
  const agentStatus = String(evidence?.support_agent?.status || '').toUpperCase();
  if (path === 'AUTOMATION_FAILED' || path === 'FAILED_AUTOMATION' || agentStatus === 'ERROR') return 'Failed automation';
  if (st === 'RESOLVED' && item.requires_human === false) return 'Resolved automatically';
  if (st === 'WAITING_CUSTOMER' || hwSt === 'WAITING' || path === 'WAITING_ON_CUSTOMER') return 'Waiting on customer';
  if (item.requires_human || path === 'HUMAN_REQUIRED') return 'Needs Human';
  return 'Needs Human';
}

function buildAutomationWork(items: any[], contexts: Map<string, any>) {
  return items.slice(0, 10).map(item => {
    const context = contexts.get(item.id) || {};
    const evidence = item.evidence || context.evidence || {};
    const communication = context.communications?.[0];
    const routing = context.routing_history?.at(-1);
    const productOutcome = determineProductOutcome(item, routing, evidence);
    const legacyOutcome = productOutcome === 'Resolved automatically' ? 'AI_AUTOMATED' : productOutcome === 'Failed automation' ? 'FAILED_AUTOMATION' : productOutcome === 'Waiting on customer' ? 'WAITING_ON_CUSTOMER' : 'HUMAN_REQUIRED';
    return {
      id: item.id,
      customer_name: item.customer_name,
      order_number: item.order_number,
      case_number: item.case_number,
      case_type: item.case_type,
      status: item.status,
      summary: item.summary,
      requires_human: item.requires_human,
      input: communication?.summary || evidence.message || item.summary || item.what_happened || 'Operational case received',
      inputSource: (communication?.source || evidence.source || item.source) === 'synthetic' ? 'Customer support intake' : (communication?.source || evidence.source || item.source || 'Chameleon read model'),
      handler: productOutcome === 'Resolved automatically' ? 'Handled by Chameleon policy using trusted evidence' : productOutcome === 'Failed automation' ? 'Automation failed; safely escalated to Human Work' : productOutcome === 'Waiting on customer' ? 'Waiting on customer response' : 'Human Work required by Chameleon policy',
      contextUsed: [item.customer_name ? 'customer identity' : null, item.order_number ? 'order reference' : null, evidence.source ? 'source evidence' : null, routing?.reason ? 'routing reason' : null].filter(Boolean),
      recommendation: evidence.customer_response || item.recommended_action || 'No recommendation recorded',
      proposedAction: item.proposed_side_effect || 'NO_EXECUTION',
      currentState: item.approval_status || item.status || 'OPEN',
      outcome: legacyOutcome,
      product_outcome: productOutcome,
      humanRequired: Boolean(item.requires_human),
      sourceOfTruth: 'chameleon-postgres',
      execution: 'NO_EXECUTION'
    };
  });
}

function buildSourceHealth(jobHealth: any, command: Record<string, ReadReference>, projection: any, openclawLab: ReadReference) {
  const openclawReady = openclawLab.available && openclawLab.data?.state === 'READY';
  return [
    {key: 'chameleon', label: 'Chameleon operational API', state: 'AVAILABLE', detail: 'Cases, assignments, approvals, audit and routing read models.', source: 'chameleon-postgres'},
    {key: 'command-center', label: 'Command Center commerce reference', state: command.home?.available ? 'FIXTURE' : 'UNAVAILABLE', detail: command.home?.available ? 'Existing V2 synthetic commerce, inventory and supplier projections.' : 'Existing Command Center reference is unavailable.', source: 'command-center-v2-replica'},
    {key: 'twenty', label: 'Twenty CRM projection', state: projection?.items?.some((item: any) => ['FAILED', 'DEAD'].includes(item.status)) ? 'RECONCILE' : 'AVAILABLE', detail: 'Deep CRM context only; failed work remains retryable and Chameleon remains operational authority.', source: 'chameleon-postgres'},
    {key: 'kai-openclaw', label: 'OpenClaw LAB Runtime', state: openclawReady ? 'AVAILABLE' : 'REFERENCE_ONLY', detail: openclawReady ? 'Runtime availability is ready; Chameleon remains the support classification and routing authority. No OpenClaw agent invocation is claimed.' : 'Imported/reference capability is visible; LAB runtime status is unavailable.', source: openclawReady ? 'openclaw-lab' : 'LAB reference inventory'}
  ];
}

const sections = new Set(['home', 'customer-operations', 'orders-checkout', 'fulfillment', 'inventory-suppliers', 'agents-automations', 'analytics']);
const emptyReference = (source: string): ReadReference => ({available: false, source, error: 'not requested for this section'});
const unavailableAnalyticsReference = (path: string, error: string): ReadReference => ({available: false, source: commandCenter + path, error});
const openclawLabBase = (process.env.OPENCLAW_LAB_STATUS_URL || 'http://127.0.0.1:18796').replace(/\/$/, '');

export async function GET(request: Request) {
  try {
    const auth = await authContext();
    if (!auth) return unauthorizedResponse();
    const requested = new URL(request.url).searchParams.get('section') || 'home';
    const section = sections.has(requested) ? requested : 'home';
    const canReadOwnerApprovals = auth.user.role === 'ADMIN';
    const canReadOperationalAttention = ['ADMIN', 'MANAGER', 'STAFF'].includes(auth.user.role);
    const casesRequested = ['home', 'customer-operations', 'fulfillment', 'agents-automations'].includes(section);
    const humanWorkRequested = ['home', 'customer-operations', 'fulfillment'].includes(section);
    const humanWorkMetricsRequested = ['home', 'customer-operations'].includes(section);
    const jobsRequested = canReadOperationalAttention && ['home', 'agents-automations'].includes(section);
    const projectionRequested = canReadOperationalAttention && ['home', 'agents-automations'].includes(section);
    const analyticsRequested = ['home', 'analytics'].includes(section);
    const runtimeRequested = ['home', 'analytics', 'agents-automations'].includes(section);
    const supportPolicyRequested = ['home', 'agents-automations'].includes(section);
    const homeRequested = ['home', 'analytics', 'orders-checkout', 'inventory-suppliers'].includes(section);
    const ordersRequested = ['orders-checkout', 'fulfillment'].includes(section);
    const inventoryRequested = section === 'inventory-suppliers';
    const supplierRequested = section === 'inventory-suppliers';
    const reviewsRequested = section === 'agents-automations' || analyticsRequested;
    const commandOrdersRequested = ordersRequested || analyticsRequested;
    const [cases, humanWork, humanWorkMetrics, operationalOrders, jobHealth, health, projection, commandHome, commandOrders, commandInventory, commandSupplier, commandReviews, commandPayments, commandAcquisition, commandHowFoundUs, commandAssociate, commandLanding, commandWeekday, commandRelease, commandProcessor, commandChat, commandSalesTrend, openclawLab, supportPolicy] = await Promise.all([
      casesRequested ? read('/api/v2/cases', auth.token) : Promise.resolve({items: []}),
      humanWorkRequested ? read('/api/v2/human-work', auth.token) : Promise.resolve({items: []}),
      humanWorkMetricsRequested ? read('/api/v2/human-work/metrics', auth.token) : Promise.resolve({}),
      ordersRequested ? read('/api/v2/orders?source=woocommerce-all', auth.token) : Promise.resolve({items: [], source_of_truth: 'woocommerce', operational_store: 'chameleon-postgres'}),
      jobsRequested ? read('/api/v2/job-health', auth.token) : Promise.resolve({items: [], synthetic: true}),
      readOptional(upstream, '/api/v2/health', auth.token),
      projectionRequested ? readOptional(upstream, '/api/v2/twenty/projection', auth.token) : Promise.resolve(emptyReference(upstream)),
      homeRequested ? readOptional(commandCenter, '/api/v2/home', auth.token) : Promise.resolve(emptyReference(commandCenter)),
      commandOrdersRequested ? readOptional(commandCenter, '/api/v2/orders', auth.token) : Promise.resolve(emptyReference(commandCenter)),
      inventoryRequested ? readOptional(commandCenter, '/api/v2/inventory', auth.token) : Promise.resolve(emptyReference(commandCenter)),
      supplierRequested ? readOptional(commandCenter, '/api/v2/supplier-ops', auth.token) : Promise.resolve(emptyReference(commandCenter)),
      reviewsRequested ? readOptional(commandCenter, '/api/v2/review-funnel', auth.token) : Promise.resolve(emptyReference(commandCenter)),
      analyticsRequested ? readOptional(commandCenter, '/api/v2/payment-methods?range=30d', auth.token) : Promise.resolve(emptyReference(commandCenter)),
      analyticsRequested ? readOptional(commandCenter, '/api/v2/customer-acquisition?range=30d', auth.token) : Promise.resolve(emptyReference(commandCenter)),
      analyticsRequested ? readOptional(commandCenter, '/api/v2/how-found-us?range=30d', auth.token) : Promise.resolve(emptyReference(commandCenter)),
      analyticsRequested ? readOptional(commandCenter, '/api/v2/associate-program', auth.token) : Promise.resolve(emptyReference(commandCenter)),
      analyticsRequested ? readOptional(commandCenter, '/api/v2/landing-conversions?days=30', auth.token) : Promise.resolve(emptyReference(commandCenter)),
      analyticsRequested ? readOptional(commandCenter, '/api/v2/weekday-sales', auth.token) : Promise.resolve(emptyReference(commandCenter)),
      analyticsRequested ? readOptional(commandCenter, '/api/v2/release-waitlist', auth.token) : Promise.resolve(emptyReference(commandCenter)),
      analyticsRequested ? readOptional(commandCenter, '/api/v2/processor-toggles', auth.token) : Promise.resolve(emptyReference(commandCenter)),
      analyticsRequested ? readOptional(commandCenter, '/api/v2/chatwoot/conversations?status=open', auth.token) : Promise.resolve(emptyReference(commandCenter)),
      analyticsRequested ? readOptional(commandCenter, '/api/v2/sales-trend?range=30d', auth.token) : Promise.resolve(emptyReference(commandCenter)),
      runtimeRequested ? readOptional(openclawLabBase, '/status', auth.token) : Promise.resolve(emptyReference(openclawLabBase)),
      supportPolicyRequested ? readOptional(upstream, '/api/v2/support-policy', auth.token) : Promise.resolve(emptyReference(upstream))
    ]);
    const jobItems: JobItem[] = jobStatus(jobHealth);
    const hasNonSyntheticFailure = jobItems.some(item => item.state === 'DOWN' && !item.detail.toLowerCase().includes('synthetic'));
    const hasLateJob = jobItems.some(item => item.state === 'LATE');
    const operationalAttention = !canReadOperationalAttention
      ? {state: 'LAB', label: 'Status scoped to operations', detail: 'Operational attention is available to Owner and Operations viewers only.', jobs: []}
      : jobHealth.synthetic
        ? {state: 'LAB', label: 'LAB boundary intact', detail: 'External executors are disabled; the read path is available and no provider action can run.', jobs: jobItems}
        : hasNonSyntheticFailure
          ? {state: 'ATTENTION', label: 'Operational attention needed', detail: 'One or more non-LAB jobs reported a failure.', jobs: jobItems}
          : hasLateJob
            ? {state: 'WATCH', label: 'Operational watch', detail: 'A read-model heartbeat is later than expected.', jobs: jobItems}
            : {state: 'CLEAR', label: 'Operational attention clear', detail: 'Read-model heartbeats are within the expected window.', jobs: jobItems};
    const allCases = (cases.items || []).filter(isVisibleLabRecord).sort((a: any, b: any) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    const visibleHumanWork = (humanWork.items || []).filter(isVisibleLabRecord).sort((a: any, b: any) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    const visibleOperationalOrders = (operationalOrders.items || []).filter(isVisibleLabRecord);
    const representativeCases = ['customer-operations', 'agents-automations'].includes(section) ? allCases.slice(0, 10) : [];
    const contextResults = await Promise.all(representativeCases.map((item: any) => readOptional(upstream, '/api/v2/cases/' + encodeURIComponent(item.id), auth.token)));
    const contextById = new Map<string, any>();
    representativeCases.forEach((item: any, index: number) => contextById.set(item.id, contextResults[index].available ? contextResults[index].data : null));
    const commandHomeRef = cleanCommandReference(commandHome);
    const commandOrdersRef = cleanCommandReference(commandOrders);
    const commandInventoryRef = cleanCommandReference(commandInventory);
    const commandSupplierRef = cleanCommandReference(commandSupplier);
    const commandPaymentsRef = cleanCommandReference(commandPayments);
    const commandAcquisitionRef = cleanCommandReference(commandAcquisition);
    const commandHowFoundUsRef = cleanCommandReference(commandHowFoundUs);
    const commandAssociateRef = cleanCommandReference(commandAssociate);
    const commandLandingRef = cleanCommandReference(commandLanding);
    const commandWeekdayRef = cleanCommandReference(commandWeekday);
    const commandReleaseRef = cleanCommandReference(commandRelease);
    const commandProcessorRef = cleanCommandReference(commandProcessor);
    const commandChatRef = cleanCommandReference(commandChat);
    const commandSalesTrendRef = cleanCommandReference(commandSalesTrend);
    const command = {home: commandHomeRef, orders: commandOrdersRef, inventory: commandInventoryRef, supplier: commandSupplierRef, payments: commandPaymentsRef, reviews: commandReviews, chat: commandChatRef};
    const trafficReference = unavailableAnalyticsReference('/api/cc-traffic-series', 'No source-backed traffic data is available; source not connected in LAB.');
    const realtimeReference = unavailableAnalyticsReference('/api/cc-ga4-realtime', 'No source-backed realtime data is available; source not connected in LAB.');
    const analytics = {source: 'command-center-v2-replica', authoritative: false, generatedAt: command.home.data?.generatedAt || null, salesTrend: commandSalesTrendRef, paymentMethods: command.payments, customerAcquisition: commandAcquisitionRef, retention: buildRetentionReference(commandAcquisitionRef), howFoundUs: commandHowFoundUsRef, associateProgram: commandAssociateRef, landingConversions: commandLandingRef, weekdaySales: commandWeekdayRef, releaseDemand: commandReleaseRef, processorState: commandProcessorRef, chatwoot: command.chat, traffic: trafficReference, realtime: realtimeReference};
    const sourceHealth = buildSourceHealth(jobHealth, command, projection.available ? projection.data : null, openclawLab);
    const supplierAlerts = commandSupplier.data?.alerts || [];
    const inventoryAlerts = commandHome.data?.inventoryAlerts || [];
    return NextResponse.json({
      contract: 'chameleon-operations-os.v1', requestedSection: section, lazyLoaded: section !== 'home', generatedAt: new Date().toISOString(), environment: dashboardRuntime.environment,
      viewer: {subject: auth.user.id, displayName: auth.user.name, role: auth.user.role, identitySource: 'AUTHENTICATED_SESSION', capabilities: {readOperationsHome: true, readHumanWork: true, readRoutineCaseContext: true, readConsequentialDecisionContext: canReadOwnerApprovals, decideConsequentialIntent: canReadOwnerApprovals}},
      humanWork: visibleHumanWork, humanWorkMetrics, operationalAttention,
      orders: {items: visibleOperationalOrders, source: operationalOrders.source_of_truth || 'woocommerce', operationalStore: operationalOrders.operational_store || 'chameleon-postgres', execution: 'NO_EXECUTION'},
      monitoring: {sourceHealth, jobHealth: jobItems, conditions: [...jobItems.map(item => ({label: item.name, state: item.state, detail: item.detail, source: 'chameleon-postgres'})), ...inventoryAlerts.map((item: any) => ({label: cleanReferenceLabel(item.label), state: 'REFERENCE', detail: 'Low-stock reference alert from the existing Command Center fixture.', source: 'command-center-v2-replica'})), ...supplierAlerts.map((item: any) => ({label: cleanReferenceLabel(item.category || 'Supplier alert'), state: 'REFERENCE', detail: cleanReferenceLabel(item.message), source: 'command-center-v2-replica'}))], projection: projection.available ? projection.data : {items: [], unavailable: true}},
      commandCenter: {environment: dashboardRuntime.environment, source: 'command-center-v2-replica', readOnly: true, home: command.home, orders: command.orders, inventory: command.inventory, supplierOps: command.supplier, paymentMethods: command.payments, reviewFunnel: command.reviews, chatwootReference: command.chat, analytics, processorState: commandProcessorRef, checkout: {status: visibleOperationalOrders.length ? 'SOURCE_BACKED' : 'NO_CURRENT_ORDERS', detail: 'Woo order context is reference-only; no payment or fulfillment mutation is connected.'}},
      customerOperations: {cases: visibleHumanWork.slice(0, 12), automationWork: buildAutomationWork(representativeCases, contextById)},
      fulfillment: {cases: visibleHumanWork.slice(0, 12), orders: visibleOperationalOrders, source: 'Woo LAB truth + Chameleon operational cases'},
      agents: {runtime: {name: 'OpenClaw LAB Runtime', state: openclawLab.available && openclawLab.data?.state === 'READY' ? 'AVAILABLE' : 'REFERENCE_ONLY', detail: openclawLab.available && openclawLab.data?.state === 'READY' ? 'Runtime availability is live for synthetic support smoke tests; Chameleon produces classification and routing, while external channels and execution remain denied. No OpenClaw agent invocation is claimed.' : 'Imported/reference capability is visible; start the curated LAB runtime to make runtime status live. No agent execution is claimed.', source: openclawLab.available ? 'openclaw-lab' : 'LAB source inventory'}, supportPolicy, work: buildAutomationWork(representativeCases, contextById), reviewFunnel: command.reviews, jobHealth: jobItems, projectionAttempts: projection.available ? projection.data?.recent_attempts || [] : [], execution: 'NO_EXECUTION'},
      links: deepLinks(), source: 'chameleon-postgres + command-center-v2-replica', synthetic: dashboardRuntime.environment !== 'production', execution: 'NO_EXECUTION',
      runtime: health.available ? health.data?.runtime || null : null,
      warnings: ['Identity is derived from the authenticated Chameleon session.', 'Secondary domain data loads only when its section is opened.', 'Command Center commerce, inventory, supplier and analytics values are LAB reference fixtures; unavailable sources are shown explicitly.', ...(openclawLab.available ? [] : ['OpenClaw LAB runtime status is unavailable; no agent execution is claimed.'])],
      apiStatus: {chameleon: health, commandCenter: command.home}
    });
  } catch (error) {
    return NextResponse.json({error: 'Operations read path unavailable', detail: error instanceof Error ? error.message : 'unknown error'}, {status: 502});
  }
}
