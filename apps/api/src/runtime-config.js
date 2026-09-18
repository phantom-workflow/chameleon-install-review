const PRODUCTION = 'production';

function configured(environment, key) {
  const value = String(environment[key] || '').trim();
  return value && value !== 'unknown' ? value : '';
}

export function isProduction(environment = process.env) {
  return String(environment.APP_ENV || '').trim().toLowerCase() === PRODUCTION;
}

export function twentyProjectionEnabled(environment = process.env) {
  return String(environment.TWENTY_PROJECTION_ENABLED || 'true').trim().toLowerCase() !== 'false';
}

export function assertRuntimeConfiguration(environment = process.env) {
  if (!isProduction(environment)) return {environment: String(environment.APP_ENV || 'staging').trim() || 'staging', twenty_projection: twentyProjectionEnabled(environment)};

  const projectionEnabled = twentyProjectionEnabled(environment);
  const required = ['DATABASE_URL', 'APP_GIT_SHA', 'APP_BUILD_ID', 'APP_BUILD_TIMESTAMP'];
  if (projectionEnabled) required.push('TWENTY_BASE_URL', 'TWENTY_API_KEY');
  const missing = required.filter(key => !configured(environment, key));
  if (String(environment.SYNTHETIC_ONLY || '').toLowerCase() !== 'false') missing.push('SYNTHETIC_ONLY=false');
  if (missing.length) {
    const error = new Error(`production runtime configuration is incomplete: ${missing.join(', ')}`);
    error.code = 'PRODUCTION_RUNTIME_CONFIG_INCOMPLETE';
    throw error;
  }
  try {
    const database = new URL(environment.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error('DATABASE_URL must use postgres:// or postgresql://');
    if (projectionEnabled) {
      const twenty = new URL(environment.TWENTY_BASE_URL);
      if (!['http:', 'https:'].includes(twenty.protocol) || !twenty.hostname) throw new Error('TWENTY_BASE_URL must be an absolute HTTP(S) URL');
    }
  } catch (error) {
    const failure = new Error(`production runtime configuration is invalid: ${error.message}`);
    failure.code = 'PRODUCTION_RUNTIME_CONFIG_INVALID';
    throw failure;
  }
  return {environment: PRODUCTION, twenty_projection: projectionEnabled};
}
