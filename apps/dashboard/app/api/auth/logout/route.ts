import {NextResponse} from 'next/server';
import {apiRequest, clearSessionCookie, sessionToken} from '../../../../lib/auth';

export async function POST() {
  const token = await sessionToken();
  if (token) await apiRequest('/api/v2/auth/logout', token, {method: 'POST'}).catch(() => undefined);
  return clearSessionCookie(NextResponse.json({status: 'logged_out'}));
}
