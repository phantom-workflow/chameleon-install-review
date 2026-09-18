#!/usr/bin/env node

const production = String(process.env.APP_ENV || '').toLowerCase() === 'production';
if (production) {
  const required = ['CHAMELEON_API_BASE_URL', 'APP_GIT_SHA', 'APP_BUILD_ID', 'APP_BUILD_TIMESTAMP'];
  const missing = required.filter(key => !String(process.env[key] || '').trim() || process.env[key] === 'unknown');
  if (missing.length) {
    console.error(JSON.stringify({status: 'failed', code: 'PRODUCTION_DASHBOARD_RUNTIME_CONFIG_INCOMPLETE', missing}));
    process.exit(1);
  }
}
console.log(JSON.stringify({status: 'ok', environment: production ? 'production' : String(process.env.APP_ENV || 'staging'), build_id: process.env.APP_BUILD_ID || 'unknown'}));
