import {cookies} from 'next/headers';
import {NextResponse} from 'next/server';

export const SESSION_COOKIE = 'chameleon_session';
const upstream = (process.env.CHAMELEON_API_BASE_URL || 'http://127.0.0.1:19200').replace(/\/$/, '');

export type AuthUser = {
  id: string;
  name: string;
  username: string;
  email?: string | null;
  user_type: 'HUMAN' | 'AGENT';
  role: 'ADMIN' | 'MANAGER' | 'STAFF' | 'READ_ONLY';
  active: boolean;
  created_at: string;
  updated_at: string;
  last_login_at?: string | null;
};

export async function sessionToken() {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value || '';
}

export function apiHeaders(token: string, initHeaders?: HeadersInit) {
  const headers = new Headers(initHeaders);
  headers.set('accept', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  return headers;
}

export async function apiRequest(path: string, token: string, init: RequestInit = {}) {
  return fetch(upstream + path, {...init, headers: apiHeaders(token, init.headers), cache: 'no-store'});
}

export async function authContext(): Promise<{token: string; user: AuthUser} | null> {
  const token = await sessionToken();
  if (!token) return null;
  const response = await apiRequest('/api/v2/auth/me', token);
  if (!response.ok) return null;
  const payload = await response.json().catch(() => ({}));
  return payload.user ? {token, user: payload.user as AuthUser} : null;
}

export function unauthorizedResponse() {
  return NextResponse.json({error: {code: 'UNAUTHENTICATED', message: 'authentication required'}}, {status: 401});
}

export function setSessionCookie(response: NextResponse, token: string, expiresAt: string) {
  const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  response.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: String(process.env.APP_ENV || '').toLowerCase() === 'production',
    path: '/',
    maxAge
  });
  return response;
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set({name: SESSION_COOKIE, value: '', httpOnly: true, sameSite: 'lax', secure: String(process.env.APP_ENV || '').toLowerCase() === 'production', path: '/', maxAge: 0});
  return response;
}

export function forwardJson(response: Response) {
  return response.json().catch(() => ({})).then(payload => NextResponse.json(payload, {status: response.status}));
}
