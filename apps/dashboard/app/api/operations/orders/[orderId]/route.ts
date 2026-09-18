import {NextResponse} from 'next/server';
import {apiRequest, authContext, unauthorizedResponse} from '../../../../../lib/auth';

export async function GET(_request: Request, context: {params: Promise<{orderId: string}>}) {
  const auth = await authContext();
  if (!auth) return unauthorizedResponse();
  try {
    const {orderId} = await context.params;
    const response = await apiRequest('/api/v2/checkout-sync/status?order_id=' + encodeURIComponent(orderId), auth.token);
    const body = await response.json().catch(() => ({}));
    return NextResponse.json(body, {status: response.status});
  } catch (error) {
    return NextResponse.json({error: 'Order context read path unavailable', detail: error instanceof Error ? error.message : 'unknown error'}, {status: 502});
  }
}
