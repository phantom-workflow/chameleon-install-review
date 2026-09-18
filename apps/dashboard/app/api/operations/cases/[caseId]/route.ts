import {NextResponse} from 'next/server';
import crypto from 'node:crypto';
import {apiRequest, authContext, unauthorizedResponse} from '../../../../../lib/auth';

export async function GET(_request: Request, context: {params: Promise<{caseId: string}>}) {
  const auth = await authContext();
  if (!auth) return unauthorizedResponse();
  try {
    const {caseId} = await context.params;
    const response = await apiRequest('/api/v2/cases/' + encodeURIComponent(caseId), auth.token);
    const body = await response.json().catch(() => ({}));
    return NextResponse.json(body, {status: response.status});
  } catch (error) {
    return NextResponse.json({error: 'Case context read path unavailable', detail: error instanceof Error ? error.message : 'unknown error'}, {status: 502});
  }
}

export async function POST(request: Request, context: {params: Promise<{caseId: string}>}) {
  if (String(process.env.APP_ENV || 'staging').toLowerCase() === 'production') {
    return NextResponse.json({error: {code: 'SYNTHETIC_ONLY', message: 'Human Work actions are LAB-only.'}}, {status: 403});
  }
  const auth = await authContext();
  if (!auth) return unauthorizedResponse();
  try {
    const {caseId} = await context.params;
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || '').toUpperCase();
    if (!['START_WORK', 'MARK_WAITING', 'RESOLVE', 'APPROVE', 'REJECT', 'REQUEST_MORE_INFORMATION'].includes(action)) {
      return NextResponse.json({error: {code: 'INVALID_HUMAN_WORK_ACTION', message: 'Action must be a Human Work state or decision action.'}}, {status: 400});
    }
    const idempotencyKey = String(body?.idempotency_key || crypto.randomUUID());
    const response = await apiRequest('/api/v2/cases/' + encodeURIComponent(caseId) + '/human-work', auth.token, {
      method: 'POST',
      headers: {'content-type': 'application/json', 'x-chameleon-synthetic': 'true', 'idempotency-key': idempotencyKey},
      body: JSON.stringify({action, reason: body?.reason || null, requested_information: body?.requested_information || null, idempotency_key: idempotencyKey})
    });
    const payload = await response.json().catch(() => ({}));
    return NextResponse.json(payload, {status: response.status});
  } catch (error) {
    return NextResponse.json({error: {code: 'HUMAN_WORK_ACTION_UNAVAILABLE', message: error instanceof Error ? error.message : 'unknown error'}}, {status: 502});
  }
}
