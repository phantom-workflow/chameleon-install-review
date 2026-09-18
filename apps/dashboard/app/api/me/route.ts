import {NextResponse} from 'next/server';
import {authContext, clearSessionCookie, unauthorizedResponse} from '../../../lib/auth';

export async function GET() {
  const context = await authContext();
  if (!context) return clearSessionCookie(unauthorizedResponse());
  return NextResponse.json({user: context.user});
}
