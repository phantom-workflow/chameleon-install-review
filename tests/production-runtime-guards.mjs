import assert from 'node:assert/strict';
import {assertRuntimeConfiguration} from '../apps/api/src/runtime-config.js';
import {createWooShadowWorker} from '../apps/api/src/woo-shadow.js';

const production = {
  APP_ENV: 'production',
  SYNTHETIC_ONLY: 'false',
  DATABASE_URL: 'postgresql://ops:password@db:5432/ops',
  TWENTY_BASE_URL: 'https://twenty.example.test',
  TWENTY_API_KEY: 'runtime-only-secret',
  APP_GIT_SHA: 'abc123',
  APP_BUILD_ID: 'operations-friday-abc123',
  APP_BUILD_TIMESTAMP: '2026-09-16T20:00:00Z'
};

assert.throws(() => assertRuntimeConfiguration({...production, TWENTY_API_KEY: ''}), /TWENTY_API_KEY/);
assert.throws(() => assertRuntimeConfiguration({...production, SYNTHETIC_ONLY: 'true'}), /SYNTHETIC_ONLY=false/);
assert.throws(() => assertRuntimeConfiguration({...production, DATABASE_URL: 'https://not-postgres.example.test'}), /DATABASE_URL/);
assert.doesNotThrow(() => assertRuntimeConfiguration(production));
assert.doesNotThrow(() => assertRuntimeConfiguration({...production, TWENTY_PROJECTION_ENABLED: 'false', TWENTY_BASE_URL: '', TWENTY_API_KEY: ''}));
assert.throws(() => assertRuntimeConfiguration({...production, TWENTY_PROJECTION_ENABLED: 'true', TWENTY_API_KEY: ''}), /TWENTY_API_KEY/);
assert.throws(() => createWooShadowWorker({adapter: {}, environment: {...production, SHADOW_WOO_ENABLED: 'true'}}), /SHADOW_WOO_BASE_URL/);
assert.throws(() => createWooShadowWorker({adapter: {}, environment: {...production, SHADOW_WOO_ENABLED: 'true', SHADOW_WOO_BASE_URL: 'http://source.example.test', SHADOW_WOO_CONSUMER_KEY: 'key', SHADOW_WOO_CONSUMER_SECRET: 'secret'}}), /HTTPS/);
const disabled = createWooShadowWorker({adapter: {}, environment: {...production, SHADOW_WOO_ENABLED: 'false'}});
assert.equal(disabled.settings.enabled, false);
console.log(JSON.stringify({status: 'PASS', production_required_config: true, synthetic_only_rejected: true, invalid_database_rejected: true, shadow_credentials_required: true, shadow_https_gate: true, execution: 'NO_EXECUTION'}));
