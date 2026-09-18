import {NextResponse} from 'next/server';
import {apiRequest, authContext, unauthorizedResponse} from '../../../../../../../lib/auth';

const appEnv = String(process.env.APP_ENV || 'staging').toLowerCase();

export async function POST(request: Request, {params}: {params: Promise<{caseId: string}>}) {
  const auth = await authContext();
  if (!auth) return unauthorizedResponse();
  if (appEnv === 'production' || auth.user.role !== 'ADMIN') {
    return NextResponse.json({error: {code: 'OWNER_APPROVER_REQUIRED', message: 'This server-side LAB instance is not an authorized owner approver.'}}, {status: 403});
  }
  const {caseId} = await params;
  const body = await request.json().catch(() => ({}));
  const decision = String(body?.decision || '').toUpperCase();
  const decisionAction = String(body?.decision_action || 'APPROVAL_INTENT').toUpperCase();
  const reason = String(body?.reason || '').trim();
  if (!['APPROVED', 'REJECTED'].includes(decision)) return NextResponse.json({error: {code: 'INVALID_DECISION', message: 'Decision must be APPROVED or REJECTED.'}}, {status: 400});
  if (!['APPROVAL_INTENT', 'RESHIP', 'REFUND', 'REPLY'].includes(decisionAction)) return NextResponse.json({error: {code: 'INVALID_DECISION_ACTION', message: 'Decision action must be Reship, Refund, Reply, or approval intent.'}}, {status: 400});
  if (reason.length < 8) return NextResponse.json({error: {code: 'DECISION_REASON_REQUIRED', message: 'A decision reason of at least 8 characters is required.'}}, {status: 400});
  const response = await apiRequest('/api/v2/cases/' + encodeURIComponent(caseId) + '/approve', auth.token, {
    method: 'POST',
    headers: {'content-type': 'application/json', 'x-chameleon-synthetic': 'true'},
    body: JSON.stringify({decision, decision_action: decisionAction, reason})
  });
  const payload = await response.json().catch(() => ({}));
  return NextResponse.json(payload, {status: response.status});
}
