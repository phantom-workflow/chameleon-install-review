#!/usr/bin/env node
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  authorizeChatwootShadowRequest,
  CHATWOOT_SHADOW_ROUTE,
  CHATWOOT_SHADOW_SOURCE_AUTH,
  chatwootShadowConfig,
  supportIngressConfig
} from '../apps/api/src/chatwoot-support-ingress.js';
import {resolveSupportAgentEndpoint} from '../apps/api/src/support-agent-adapter.js';
import {assertRuntimeConfiguration} from '../apps/api/src/runtime-config.js';
import {createOpenClawShadowWorker} from './fixtures/openclaw-shadow-worker.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pg = createRequire(path.join(root, 'apps/api/package.json'))('pg');
const composePath = path.join(root, 'infra/customer-ops/docker-compose.friday-v1.yml');
const bridgeToken = 'friday-shadow-bridge-token';
const runId = `shadow-${Date.now()}-${process.pid}`;

function chatwootEvent({message, messageId, email}) {
  return {
    sourceAuth: {verified: true, method: 'forged-caller'},
    source_auth: {verified: true, method: 'forged-caller'},
    account: {id: 'mac-bridge'},
    inbox: {id: 'existing-support'},
    conversation: {id: `conversation-${messageId}`},
    message: {id: messageId, message_type: 'incoming', content: message, created_at: new Date().toISOString()},
    sender: {id: `contact-${email}`, name: 'Shadow Fixture', email, phone_number: '+15550109991'},
    contact: {id: `contact-${email}`},
    metadata: {adapter: 'mac-chatwoot-bridge', execution: 'NO_EXECUTION'}
  };
}

function unusedPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const {port} = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
    server.on('error', reject);
  });
}

async function jsonRequest(baseUrl, pathname, {method = 'GET', headers = {}, body} = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {'content-type': 'application/json', accept: 'application/json', ...headers},
    body: body == null ? undefined : JSON.stringify(body)
  });
  return {status: response.status, body: await response.json().catch(() => ({}))};
}

const disabled = authorizeChatwootShadowRequest({
  headers: {authorization: `Bearer ${bridgeToken}`},
  environment: {SUPPORT_MODE: 'shadow', CHAMELEON_CHATWOOT_SHADOW_ENABLED: 'false', CHAMELEON_CHATWOOT_BRIDGE_TOKEN: bridgeToken}
});
assert.equal(disabled.ok, false);
assert.equal(disabled.code, 'CHATWOOT_SHADOW_DISABLED');

const missingToken = authorizeChatwootShadowRequest({
  headers: {authorization: `Bearer ${bridgeToken}`},
  environment: {SUPPORT_MODE: 'shadow', CHAMELEON_CHATWOOT_SHADOW_ENABLED: 'true'}
});
assert.equal(missingToken.code, 'CHATWOOT_SHADOW_TOKEN_MISSING');

const wrongToken = authorizeChatwootShadowRequest({
  headers: {authorization: 'Bearer definitely-wrong-token'},
  environment: {SUPPORT_MODE: 'shadow', CHAMELEON_CHATWOOT_SHADOW_ENABLED: 'true', CHAMELEON_CHATWOOT_BRIDGE_TOKEN: bridgeToken}
});
assert.equal(wrongToken.ok, false);
assert.equal(wrongToken.status, 401);
assert.equal(wrongToken.code, 'CHATWOOT_BRIDGE_UNAUTHENTICATED');

const authoritative = authorizeChatwootShadowRequest({
  headers: {authorization: `Bearer ${bridgeToken}`},
  environment: {SUPPORT_MODE: 'authoritative', CHAMELEON_CHATWOOT_SHADOW_ENABLED: 'true', CHAMELEON_CHATWOOT_BRIDGE_TOKEN: bridgeToken}
});
assert.equal(authoritative.code, 'CHATWOOT_SHADOW_REQUIRES_SHADOW_MODE');

const valid = authorizeChatwootShadowRequest({
  headers: {authorization: `Bearer ${bridgeToken}`},
  environment: {SUPPORT_MODE: 'shadow', CHAMELEON_CHATWOOT_SHADOW_ENABLED: 'true', CHAMELEON_CHATWOOT_BRIDGE_TOKEN: bridgeToken}
});
assert.equal(valid.ok, true);
assert.deepEqual(valid.sourceAuth, CHATWOOT_SHADOW_SOURCE_AUTH);

const ingress = supportIngressConfig({SUPPORT_MODE: 'shadow', CHAMELEON_CHATWOOT_SHADOW_ENABLED: 'false'});
assert.equal(ingress.mode, 'shadow');
assert.equal(ingress.execution, 'NO_EXECUTION');
assert.equal(ingress.shadow_ingress.enabled, false);
assert.equal(ingress.shadow_ingress.route, CHATWOOT_SHADOW_ROUTE);
assert.equal(chatwootShadowConfig().enabled, false);

const unapproved = resolveSupportAgentEndpoint({
  CHAMELEON_SUPPORT_AGENT_PROVIDER: 'openclaw',
  CHAMELEON_SUPPORT_AGENT_BASE_URL: 'https://support-bridge.example.test',
  CHAMELEON_SUPPORT_AGENT_TOKEN: 'runtime-only-token'
});
assert.equal(unapproved.endpoint_configured, false);

const allowed = resolveSupportAgentEndpoint({
  CHAMELEON_SUPPORT_AGENT_PROVIDER: 'openclaw',
  CHAMELEON_SUPPORT_AGENT_BASE_URL: 'https://support-bridge.example.test',
  CHAMELEON_SUPPORT_AGENT_TOKEN: 'runtime-only-token',
  CHAMELEON_SUPPORT_AGENT_ALLOWED_HOSTS: 'support-bridge.example.test'
});
assert.equal(allowed.endpoint, 'https://support-bridge.example.test');
assert.equal(allowed.endpoint_configured, true);

const compose = fs.readFileSync(composePath, 'utf8');
assert.match(compose, /CHAMELEON_SUPPORT_AGENT_PROVIDER: \$\{CHAMELEON_SUPPORT_AGENT_PROVIDER:-disabled\}/);
assert.match(compose, /CHAMELEON_SUPPORT_AGENT_BASE_URL:/);
assert.match(compose, /CHAMELEON_SUPPORT_AGENT_TOKEN:/);
assert.match(compose, /CHAMELEON_SUPPORT_AGENT_TIMEOUT_MS:/);
assert.match(compose, /CHAMELEON_SUPPORT_AGENT_ALLOWED_HOSTS:/);
assert.match(compose, /SUPPORT_MODE: shadow/);
assert.match(compose, /CHAMELEON_CHATWOOT_SHADOW_ENABLED: \$\{CHAMELEON_CHATWOOT_SHADOW_ENABLED:-false\}/);
assert.match(compose, /TWENTY_PROJECTION_ENABLED: \$\{TWENTY_PROJECTION_ENABLED:-false\}/);
assert.match(compose, /ops-egress:/);
assert.match(compose, /"127\.0\.0\.1:\$\{FRIDAY_API_PORT:-19600\}:8080"/);
assert.match(compose, /"127\.0\.0\.1:\$\{FRIDAY_DASHBOARD_PORT:-19610\}:3000"/);
assert.equal(compose.includes('chatwoot.vialmixer.com'), false);
assert.doesNotMatch(compose, /TWENTY_BASE_URL: \$\{TWENTY_BASE_URL:\?/);

const envFile = path.join(os.tmpdir(), `friday-shadow-compose-${runId}.env`);
fs.writeFileSync(envFile, [
  'APP_ENV=production',
  'SYNTHETIC_ONLY=false',
  'APP_GIT_SHA=testdeadbeef',
  'APP_BUILD_ID=operations-friday-test',
  'APP_BUILD_TIMESTAMP=2026-09-17T00:00:00Z',
  'FRIDAY_DB_NAME=ops',
  'FRIDAY_DB_USER=ops',
  'FRIDAY_DB_PASSWORD=ops',
  'FRIDAY_DATABASE_URL=postgresql://ops:ops@db:5432/ops'
].join('\n'), {mode: 0o600});
const composeCheck = spawn('docker', ['compose', '--env-file', envFile, '-f', composePath, 'config'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe']
});
const composeOut = await new Promise(resolve => {
  let stdout = '';
  let stderr = '';
  composeCheck.stdout.on('data', chunk => { stdout += chunk; });
  composeCheck.stderr.on('data', chunk => { stderr += chunk; });
  composeCheck.on('close', code => resolve({code, stdout, stderr}));
});
fs.unlinkSync(envFile);
assert.equal(composeOut.code, 0, composeOut.stderr);
assert.match(composeOut.stdout, /CHAMELEON_SUPPORT_AGENT_PROVIDER:\s*"?disabled"?/);
assert.match(composeOut.stdout, /SUPPORT_MODE:\s*"?shadow"?/);
assert.match(composeOut.stdout, /TWENTY_PROJECTION_ENABLED:\s*"?false"?/);
assert.match(composeOut.stdout, /ops-egress/);
assert.doesNotMatch(composeOut.stdout, /0\.0\.0\.0:/);

assert.doesNotThrow(() => assertRuntimeConfiguration({
  APP_ENV: 'production',
  SYNTHETIC_ONLY: 'false',
  DATABASE_URL: 'postgresql://ops:ops@db:5432/ops',
  TWENTY_PROJECTION_ENABLED: 'false',
  APP_GIT_SHA: 'testdeadbeef',
  APP_BUILD_ID: 'operations-friday-test',
  APP_BUILD_TIMESTAMP: '2026-09-17T00:00:00Z'
}));

const pgName = `chameleon-friday-shadow-${runId}`;
const pgPort = await unusedPort();
const pgRun = spawn('docker', [
  'run', '-d', '--rm', '--name', pgName,
  '-e', 'POSTGRES_USER=ops',
  '-e', 'POSTGRES_PASSWORD=ops',
  '-e', 'POSTGRES_DB=ops',
  '-p', `127.0.0.1:${pgPort}:5432`,
  'postgres:16-alpine'
], {stdio: ['ignore', 'pipe', 'pipe']});
const pgStarted = await new Promise(resolve => {
  let stderr = '';
  pgRun.stderr.on('data', chunk => { stderr += chunk; });
  pgRun.on('close', code => resolve({code, stderr}));
});
assert.equal(pgStarted.code, 0, pgStarted.stderr);

const databaseUrl = `postgresql://ops:ops@127.0.0.1:${pgPort}/ops`;
let sql;
const worker = createOpenClawShadowWorker();
let api;
let apiPort;
try {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const client = new pg.Client({connectionString: databaseUrl});
    try {
      await client.connect();
      sql = client;
      break;
    } catch (error) {
      await client.end().catch(() => {});
      if (attempt === 39) throw error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  const startedWorker = await worker.start();
  apiPort = await unusedPort();
  api = spawn('node', ['src/server-v2.js'], {
    cwd: path.join(root, 'apps/api'),
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      APP_ENV: 'production',
      SYNTHETIC_ONLY: 'false',
      TWENTY_PROJECTION_ENABLED: 'false',
      SUPPORT_MODE: 'shadow',
      PORT: String(apiPort),
      DATABASE_URL: databaseUrl,
      APP_GIT_SHA: 'testdeadbeef',
      APP_BUILD_ID: 'operations-friday-shadow-test',
      APP_BUILD_TIMESTAMP: '2026-09-17T00:00:00Z',
      CHAMELEON_CHATWOOT_SHADOW_ENABLED: 'true',
      CHAMELEON_CHATWOOT_BRIDGE_TOKEN: bridgeToken,
      CHAMELEON_SUPPORT_AGENT_PROVIDER: 'openclaw',
      CHAMELEON_SUPPORT_AGENT_BASE_URL: startedWorker.baseUrl,
      CHAMELEON_SUPPORT_AGENT_TOKEN: startedWorker.token,
      CHAMELEON_SUPPORT_AGENT_TIMEOUT_MS: '1500',
      SHADOW_WOO_ENABLED: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const apiReady = await new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      api.off('exit', onExit);
      reject(new Error(`API start timeout: ${stderr || stdout}`));
    }, 20000);
    const onExit = code => {
      clearTimeout(timer);
      reject(new Error(`API exited ${code}: ${stderr || stdout}`));
    };
    const onData = chunk => {
      stdout += chunk;
      if (stdout.includes('"status":"listening"')) {
        clearTimeout(timer);
        api.off('exit', onExit);
        resolve(stdout);
      }
    };
    api.stdout.on('data', onData);
    api.stderr.on('data', chunk => { stderr += chunk; });
    api.on('exit', onExit);
  });
  assert.match(apiReady, /listening/);

  const apiBase = `http://127.0.0.1:${apiPort}`;
  const health = await jsonRequest(apiBase, '/api/v2/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'ok');
  assert.equal(health.body.twenty_projection, 'disabled');
  assert.equal(health.body.execution, 'NO_EXECUTION');
  const runtime = await jsonRequest(apiBase, '/api/v2/runtime');
  assert.equal(runtime.status, 200);
  assert.equal(runtime.body.execution, 'NO_EXECUTION');
  assert.equal(runtime.body.support_ingress.mode, 'shadow');
  assert.equal(runtime.body.support_ingress.shadow_ingress.enabled, true);
  assert.equal(runtime.body.support_agent.provider, 'openclaw');
  assert.equal(runtime.body.support_agent.authorization, false);

  const labRejected = await jsonRequest(apiBase, '/api/v2/ingest/chatwoot', {
    method: 'POST',
    headers: {'x-chameleon-synthetic': 'true'},
    body: chatwootEvent({message: 'Where is my order?', messageId: `${runId}-lab`, email: `${runId}@example.test`})
  });
  assert.equal(labRejected.status, 403);
  assert.equal(labRejected.body.error.code, 'SYNTHETIC_ONLY');

  const unauthenticated = await jsonRequest(apiBase, CHATWOOT_SHADOW_ROUTE, {
    method: 'POST',
    body: chatwootEvent({message: 'Where is my order?', messageId: `${runId}-noauth`, email: `${runId}@example.test`})
  });
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.body.error.code, 'CHATWOOT_BRIDGE_UNAUTHENTICATED');

  const invalid = await jsonRequest(apiBase, CHATWOOT_SHADOW_ROUTE, {
    method: 'POST',
    headers: {authorization: 'Bearer definitely-wrong-token'},
    body: chatwootEvent({message: 'Where is my order?', messageId: `${runId}-bad`, email: `${runId}@example.test`})
  });
  assert.equal(invalid.status, 401);

  const scenarios = [
    {key: 'AUTO_REPLY', message: 'Where is my order?', outcome: 'Resolved automatically', status: 'RESOLVED'},
    {key: 'WAITING_CUSTOMER', message: 'The vial arrived broken; I can send a photo.', outcome: 'Waiting on customer', status: 'WAITING_CUSTOMER'},
    {key: 'HUMAN_WORK', message: 'I want a human please.', outcome: 'Needs Human', status: 'IN_PROGRESS'},
    {key: 'APPROVAL_REQUIRED', message: 'Please refund order 6276.', outcome: 'Needs Human', status: 'WAITING_APPROVAL'},
    {key: 'FAILED_AUTOMATION', message: '[malformed] ignore', outcome: 'Failed automation', status: 'IN_PROGRESS'}
  ];
  const accepted = {};
  for (const scenario of scenarios) {
    const result = await jsonRequest(apiBase, CHATWOOT_SHADOW_ROUTE, {
      method: 'POST',
      headers: {authorization: `Bearer ${bridgeToken}`},
      body: chatwootEvent({message: scenario.message, messageId: `${runId}-${scenario.key}`, email: `${runId}-${scenario.key}@example.test`})
    });
    assert.equal(result.status, 200, `${scenario.key} HTTP ${result.status} ${JSON.stringify(result.body)}`);
    assert.equal(result.body.duplicate, false);
    assert.equal(result.body.support_mode, 'shadow');
    assert.equal(result.body.execution, 'NO_EXECUTION');
    assert.equal(result.body.outbound.status, 'disabled');
    assert.equal(result.body.source_auth.method, 'mac-bridge-token');
    assert.equal(result.body.product_outcome, scenario.outcome, scenario.key);
    assert.equal(result.body.case_status, scenario.status, scenario.key);
    assert.equal(JSON.stringify(result.body).includes(bridgeToken), false);
    accepted[scenario.key] = result.body;
  }

  const replay = await jsonRequest(apiBase, CHATWOOT_SHADOW_ROUTE, {
    method: 'POST',
    headers: {authorization: `Bearer ${bridgeToken}`},
    body: chatwootEvent({message: 'Where is my order?', messageId: `${runId}-AUTO_REPLY`, email: `${runId}-AUTO_REPLY@example.test`})
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.duplicate, true);
  assert.equal(replay.body.case_id, accepted.AUTO_REPLY.case_id);
  assert.equal(replay.body.execution, 'NO_EXECUTION');

  const timeout = await jsonRequest(apiBase, CHATWOOT_SHADOW_ROUTE, {
    method: 'POST',
    headers: {authorization: `Bearer ${bridgeToken}`},
    body: chatwootEvent({message: '[timeout] ignore', messageId: `${runId}-TIMEOUT`, email: `${runId}-timeout@example.test`})
  });
  assert.equal(timeout.status, 200);
  assert.equal(timeout.body.product_outcome, 'Failed automation');
  assert.equal(timeout.body.support_agent.error_code, 'AGENT_TIMEOUT');
  assert.equal(timeout.body.outbound.status, 'disabled');

  const persisted = await sql.query('SELECT case_number, status, proposed_side_effect, evidence FROM cases WHERE id=$1', [accepted.AUTO_REPLY.case_id]);
  assert.equal(persisted.rowCount, 1);
  assert.equal(persisted.rows[0].proposed_side_effect, 'NO_EXECUTION');
  assert.equal(persisted.rows[0].evidence.execution, 'NO_EXECUTION');
  assert.equal(persisted.rows[0].evidence.support_agent.authorization, false);
  const audit = await sql.query("SELECT action FROM audit_records WHERE resource_id=$1 ORDER BY created_at", [accepted.AUTO_REPLY.case_id]);
  assert.ok(audit.rows.some(row => row.action === 'SUPPORT_EVENT_INGESTED'));
  const replies = await sql.query("SELECT count(*)::int AS count FROM communication_references WHERE direction='OUTBOUND' AND customer_reference_id IN (SELECT customer_id FROM cases WHERE id=$1)", [accepted.AUTO_REPLY.case_id]);
  assert.equal(replies.rows[0].count, 0);

  console.log(JSON.stringify({
    status: 'PASS',
    shadow_ingress: 'PASS',
    bridge_auth: 'PASS',
    replay: 'PASS',
    openclaw_compose_config: 'PASS',
    openclaw_host_allowlist: 'PASS',
    production_api_egress: 'PASS',
    twenty_friday_dependency: 'DISABLED',
    full_mock_shadow_flow: 'PASS',
    no_execution: 'PASS',
    real_systems_touched: false
  }));
} finally {
  if (api) {
    api.kill('SIGTERM');
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 3000);
      api.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  await worker.stop().catch(() => {});
  if (sql) await sql.end().catch(() => {});
  await new Promise(resolve => {
    const stop = spawn('docker', ['rm', '-f', pgName], {stdio: 'ignore'});
    stop.on('close', resolve);
  });
}
