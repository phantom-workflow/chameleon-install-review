const production = String(process.env.APP_ENV || '').toLowerCase() === 'production';

export function configuredUrl(name: string, fallback = '') {
  const value = String(process.env[name] || '').trim();
  if (value) return value.replace(/\/$/, '');
  return production ? '' : fallback.replace(/\/$/, '');
}

export function assertDashboardRuntime(environment: NodeJS.ProcessEnv = process.env) {
  if (String(environment.APP_ENV || '').toLowerCase() !== 'production') return;
  const missing = ['CHAMELEON_API_BASE_URL', 'APP_GIT_SHA', 'APP_BUILD_ID', 'APP_BUILD_TIMESTAMP']
    .filter(name => !String(environment[name] || '').trim() || String(environment[name]).trim() === 'unknown');
  if (missing.length) throw new Error(`production dashboard runtime configuration is incomplete: ${missing.join(', ')}`);
}

export const dashboardRuntime = Object.freeze({
  environment: production ? 'production' : String(process.env.APP_ENV || 'staging'),
  git_sha: String(process.env.APP_GIT_SHA || 'unknown'),
  build_id: String(process.env.APP_BUILD_ID || process.env.APP_GIT_SHA || 'unknown'),
  build_timestamp: String(process.env.APP_BUILD_TIMESTAMP || 'unknown')
});
