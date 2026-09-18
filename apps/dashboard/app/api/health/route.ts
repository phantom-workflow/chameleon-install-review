import {NextResponse} from 'next/server';
import {assertDashboardRuntime, dashboardRuntime} from '../../../lib/runtime';

export const dynamic = 'force-dynamic';

export function GET() {
  try {
    assertDashboardRuntime();
    return NextResponse.json({status: 'ok', service: 'chameleon-operations-dashboard', runtime: dashboardRuntime, execution: 'NO_EXECUTION'}, {headers: {'cache-control': 'no-store'}});
  } catch (error) {
    return NextResponse.json({status: 'degraded', error: {code: 'RUNTIME_CONFIGURATION_INVALID', message: error instanceof Error ? error.message : 'runtime configuration invalid'}}, {status: 503, headers: {'cache-control': 'no-store'}});
  }
}
