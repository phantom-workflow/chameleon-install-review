import {apiRequest, authContext, forwardJson, unauthorizedResponse} from '../../../../lib/auth';

export async function PATCH(request: Request, {params}: {params: Promise<{userId: string}>}) {
  const context = await authContext();
  if (!context) return unauthorizedResponse();
  const {userId} = await params;
  const body = await request.json().catch(() => ({}));
  return forwardJson(await apiRequest('/api/v2/users/' + encodeURIComponent(userId), context.token, {
    method: 'PATCH',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(body)
  }));
}
