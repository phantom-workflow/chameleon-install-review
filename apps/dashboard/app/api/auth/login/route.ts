import {NextResponse} from 'next/server';
import {apiRequest, setSessionCookie} from '../../../../lib/auth';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const response = await apiRequest('/api/v2/auth/login', '', {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({username: body?.username || body?.email || '', password: body?.password || ''})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.session_token || !payload.expires_at) {
    return NextResponse.json(payload, {status: response.status || 401});
  }
  const result = NextResponse.json({user: payload.user, expires_at: payload.expires_at});
  return setSessionCookie(result, payload.session_token, payload.expires_at);
}
