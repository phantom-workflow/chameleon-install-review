import {NextResponse} from 'next/server';
import {apiRequest, authContext, unauthorizedResponse} from '../../../../lib/auth';

export async function POST(request: Request) {
  const auth = await authContext();
  if (!auth) return unauthorizedResponse();
  if (!['ADMIN', 'MANAGER'].includes(auth.user.role)) return NextResponse.json({error: 'LAB policy changes require Admin or Manager role'}, {status: 403});
  const body = await request.json().catch(() => ({}));
  const response = await apiRequest('/api/v2/support-policy', auth.token, {method: 'POST', headers: {'content-type': 'application/json', 'x-chameleon-synthetic': 'true'}, body: JSON.stringify(body)});
  return NextResponse.json(await response.json().catch(() => ({})), {status: response.status});
}
