import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import UsersClient from './UsersClient';

export const dynamic = 'force-dynamic';

export default async function UsersSettingsPage() {
  const token = (await cookies()).get('chameleon_session')?.value;
  if (!token) redirect('/login?next=/settings/users');
  const upstream = (process.env.CHAMELEON_API_BASE_URL || 'http://127.0.0.1:19200').replace(/\/$/, '');
  const response = await fetch(upstream + '/api/v2/auth/me', {headers: {authorization: `Bearer ${token}`}, cache: 'no-store'}).catch(() => null);
  if (!response?.ok) redirect('/login?next=/settings/users');
  const payload = response?.ok ? await response.json().catch(() => ({})) : null;
  if (!payload?.user || payload.user.role !== 'ADMIN') redirect('/');
  return <UsersClient />;
}
