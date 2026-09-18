import {apiRequest, authContext, forwardJson, unauthorizedResponse} from '../../../lib/auth';

export async function GET() {
  const context = await authContext();
  if (!context) return unauthorizedResponse();
  return forwardJson(await apiRequest('/api/v2/users', context.token));
}

export async function POST(request: Request) {
  const context = await authContext();
  if (!context) return unauthorizedResponse();
  const body = await request.json().catch(() => ({}));
  return forwardJson(await apiRequest('/api/v2/users', context.token, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(body)
  }));
}
