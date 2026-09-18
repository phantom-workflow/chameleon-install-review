import crypto from 'node:crypto';
import {query, transaction} from './db.js';
import {ingestWooOrderEvents, SOURCE as WOO_SOURCE} from './checkout-sync.js';

export const SHADOW_SOURCE = 'woocommerce-read-only-shadow';
const PAGE_SIZE = 50;
const DEFAULT_OVERLAP_SECONDS = 300;

function text(value, fallback = '') { return String(value ?? fallback).trim(); }
function bool(value) { return text(value).toLowerCase() === 'true'; }
function safeError(error) { return text(error?.message || error, 'unknown Woo shadow failure').slice(0, 1000); }

function config(environment = process.env) {
  const enabled = bool(environment.SHADOW_WOO_ENABLED);
  const baseUrl = text(environment.SHADOW_WOO_BASE_URL).replace(/\/$/, '');
  const consumerKey = text(environment.SHADOW_WOO_CONSUMER_KEY);
  const consumerSecret = text(environment.SHADOW_WOO_CONSUMER_SECRET);
  const overlapSeconds = Math.max(0, Math.min(86400, Number(environment.SHADOW_WOO_OVERLAP_SECONDS || DEFAULT_OVERLAP_SECONDS)));
  const pollSeconds = Math.max(10, Math.min(3600, Number(environment.SHADOW_WOO_POLL_SECONDS || 60)));
  if (enabled) {
    if (!baseUrl || !consumerKey || !consumerSecret) throw Object.assign(new Error('enabled Woo shadow requires SHADOW_WOO_BASE_URL, SHADOW_WOO_CONSUMER_KEY, and SHADOW_WOO_CONSUMER_SECRET'), {code: 'WOO_SHADOW_CONFIG_INCOMPLETE'});
    let parsed;
    try { parsed = new URL(`${baseUrl}/wp-json/wc/v3/orders`); } catch { parsed = null; }
    if (!parsed || !['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) throw Object.assign(new Error('SHADOW_WOO_BASE_URL must be an absolute HTTP(S) URL'), {code: 'WOO_SHADOW_CONFIG_INVALID'});
    const production = text(environment.APP_ENV).toLowerCase() === 'production';
    const loopback = ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname);
    if (production && parsed.protocol !== 'https:' && !loopback) throw Object.assign(new Error('production Woo shadow requires HTTPS outside loopback'), {code: 'WOO_SHADOW_HTTPS_REQUIRED'});
  }
  return Object.freeze({enabled, baseUrl, consumerKey, consumerSecret, overlapSeconds, pollSeconds});
}

function eventId(order) {
  const id = text(order?.id);
  if (!id) throw new Error('Woo shadow order is missing id');
  const modified = text(order.date_modified || order.modified || order.date_created);
  const snapshot = crypto.createHash('sha256').update(JSON.stringify({id, modified, status: order.status, total: order.total, line_items: order.line_items || []})).digest('hex').slice(0, 24);
  return `woo-shadow:${id}:${snapshot}`;
}

function endpoint(baseUrl, watermark, upperBound, page) {
  const url = new URL(`${baseUrl}/wp-json/wc/v3/orders`);
  url.searchParams.set('after', new Date(watermark).toISOString());
  url.searchParams.set('before', new Date(upperBound).toISOString());
  url.searchParams.set('orderby', 'modified');
  url.searchParams.set('order', 'asc');
  url.searchParams.set('per_page', String(PAGE_SIZE));
  url.searchParams.set('page', String(page));
  return url;
}

function basicAuth(key, secret) {
  return `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`;
}

export function createWooShadowWorker({adapter, environment = process.env} = {}) {
  const settings = config(environment);
  let stopped = false;
  let running = false;

  async function initialize() {
    const now = new Date();
    const initialWatermark = new Date(now.getTime() - settings.overlapSeconds * 1000);
    const status = settings.enabled ? 'IDLE' : 'DISABLED';
    await query(`INSERT INTO woo_shadow_checkpoints(source, watermark, status, updated_at)
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (source) DO UPDATE SET status=CASE WHEN $3='DISABLED' THEN 'DISABLED' ELSE woo_shadow_checkpoints.status END, updated_at=$4`,
      [SHADOW_SOURCE, initialWatermark, status, now]);
    await query(`INSERT INTO job_health(id, job_name, expected_cadence_seconds, last_seen_at, evidence, updated_at)
      VALUES ($1,$2,$3,$4,$5,$4)
      ON CONFLICT (job_name) DO UPDATE SET expected_cadence_seconds=EXCLUDED.expected_cadence_seconds, evidence=EXCLUDED.evidence, updated_at=EXCLUDED.updated_at`,
      [crypto.randomUUID(), 'woo-read-only-shadow', settings.pollSeconds * 2, now, {source: SHADOW_SOURCE, status, read_only: true, execution: 'NO_EXECUTION'}]);
    return {source: SHADOW_SOURCE, enabled: settings.enabled};
  }

  async function markError(runId, error) {
    const message = safeError(error);
    const now = new Date();
    await transaction(async client => {
      await client.query(`UPDATE woo_shadow_runs SET status='FAILED', finished_at=$2, error=$3 WHERE id=$1`, [runId, now, message]);
      await client.query(`UPDATE woo_shadow_checkpoints SET status='ERROR', last_attempt_at=$2, last_error=$3, updated_at=$2 WHERE source=$1`, [SHADOW_SOURCE, now, message]);
      await client.query(`INSERT INTO job_health(id, job_name, expected_cadence_seconds, last_seen_at, evidence, updated_at)
        VALUES ($1,$2,$3,$4,$5,$4)
        ON CONFLICT (job_name) DO UPDATE SET expected_cadence_seconds=EXCLUDED.expected_cadence_seconds, last_seen_at=EXCLUDED.last_seen_at, evidence=EXCLUDED.evidence, updated_at=EXCLUDED.updated_at`,
        [crypto.randomUUID(), 'woo-read-only-shadow', settings.pollSeconds * 2, now, {source: SHADOW_SOURCE, status: 'ERROR', error: message, read_only: true, execution: 'NO_EXECUTION'}]);
    });
    return {status: 'ERROR', source: SHADOW_SOURCE, run_id: runId, error: message, execution: 'NO_EXECUTION'};
  }

  async function pollOnce() {
    if (!settings.enabled) return {status: 'DISABLED', source: SHADOW_SOURCE, execution: 'NO_EXECUTION'};
    if (running) return {status: 'BUSY', source: SHADOW_SOURCE, execution: 'NO_EXECUTION'};
    running = true;
    const runId = crypto.randomUUID();
    let run;
    try {
      const checkpoint = (await query('SELECT * FROM woo_shadow_checkpoints WHERE source=$1', [SHADOW_SOURCE])).rows[0];
      const now = new Date();
      const watermark = checkpoint?.watermark || new Date(now.getTime() - settings.overlapSeconds * 1000);
      const upperBound = checkpoint?.upper_bound || now;
      const page = checkpoint?.upper_bound ? checkpoint.next_page : 1;
      await query(`INSERT INTO woo_shadow_runs(id, source, started_at, status, watermark, upper_bound, first_page)
        VALUES ($1,$2,$3,'RUNNING',$4,$5,$6)`, [runId, SHADOW_SOURCE, now, watermark, upperBound, page]);
      await query(`UPDATE woo_shadow_checkpoints SET upper_bound=$2, next_page=$3, status='PROCESSING', last_attempt_at=$4, last_error=NULL, updated_at=$4 WHERE source=$1`, [SHADOW_SOURCE, upperBound, page, now]);

      const url = endpoint(settings.baseUrl, watermark, upperBound, page);
      const response = await fetch(url, {method: 'GET', headers: {accept: 'application/json', authorization: basicAuth(settings.consumerKey, settings.consumerSecret)}});
      if (!response.ok) throw new Error(`Woo shadow GET failed with HTTP ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload)) throw new Error('Woo shadow response must be a JSON order array');

      let accepted = 0;
      let duplicate = 0;
      for (const order of payload) {
        const result = await ingestWooOrderEvents(adapter, {
          source: WOO_SOURCE,
          transport: 'shadow-poll',
          events: [{source_event_id: eventId(order), event_type: 'ORDER_SNAPSHOT', order, occurred_at: order.date_modified || order.date_created, metadata: {source: SHADOW_SOURCE, read_only: true, request_method: 'GET', execution: 'NO_EXECUTION'}}]
        });
        const item = result.results?.[0] || {};
        if (item.duplicate) duplicate += 1;
        else accepted += 1;
      }
      const totalPages = Number(response.headers.get('x-wp-totalpages') || 0);
      const hasNext = payload.length >= PAGE_SIZE || (totalPages > page);
      const nextPage = page + 1;
      const finished = !hasNext;
      const finishedAt = new Date();
      await transaction(async client => {
        await client.query(`UPDATE woo_shadow_runs SET status='SUCCEEDED', finished_at=$2, last_page=$3, request_count=1, records_seen=$4, records_accepted=$5, records_duplicate=$6 WHERE id=$1`, [runId, finishedAt, page, payload.length, accepted, duplicate]);
        if (finished) {
          await client.query(`UPDATE woo_shadow_checkpoints SET watermark=$2, upper_bound=NULL, next_page=1, status='UP', last_success_at=$3, last_attempt_at=$3, last_error=NULL, records_seen=records_seen+$4, records_accepted=records_accepted+$5, updated_at=$3 WHERE source=$1`, [SHADOW_SOURCE, upperBound, finishedAt, payload.length, accepted]);
        } else {
          await client.query(`UPDATE woo_shadow_checkpoints SET next_page=$2, status='PROCESSING', last_attempt_at=$3, records_seen=records_seen+$4, records_accepted=records_accepted+$5, updated_at=$3 WHERE source=$1`, [SHADOW_SOURCE, nextPage, finishedAt, payload.length, accepted]);
        }
        await client.query(`INSERT INTO job_health(id, job_name, expected_cadence_seconds, last_seen_at, evidence, updated_at)
          VALUES ($1,$2,$3,$4,$5,$4)
          ON CONFLICT (job_name) DO UPDATE SET expected_cadence_seconds=EXCLUDED.expected_cadence_seconds, last_seen_at=EXCLUDED.last_seen_at, evidence=EXCLUDED.evidence, updated_at=EXCLUDED.updated_at`,
          [crypto.randomUUID(), 'woo-read-only-shadow', settings.pollSeconds * 2, finishedAt, {source: SHADOW_SOURCE, status: finished ? 'UP' : 'PROCESSING', request_method: 'GET', page, records_seen: payload.length, records_accepted: accepted, records_duplicate: duplicate, execution: 'NO_EXECUTION'}]);
      });
      return {status: finished ? 'SUCCEEDED' : 'CONTINUE', source: SHADOW_SOURCE, run_id: runId, page, records_seen: payload.length, records_accepted: accepted, records_duplicate: duplicate, next_page: finished ? null : nextPage, execution: 'NO_EXECUTION'};
    } catch (error) {
      return await markError(runId, error);
    } finally {
      running = false;
    }
  }

  function start() {
    if (!settings.enabled) return () => {};
    const timer = setInterval(() => { if (!stopped) pollOnce().catch(error => console.error(JSON.stringify({component: 'woo-read-only-shadow', error: safeError(error)}))); }, settings.pollSeconds * 1000);
    timer.unref?.();
    pollOnce().catch(error => console.error(JSON.stringify({component: 'woo-read-only-shadow', error: safeError(error)})));
    return () => { stopped = true; clearInterval(timer); };
  }

  return {settings, initialize, pollOnce, start};
}
