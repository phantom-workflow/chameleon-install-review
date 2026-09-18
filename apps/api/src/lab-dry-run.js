import fs from 'node:fs/promises';
import { readOnlySql } from './domain.js';

const counts = {
  source_files: /Source files\s*\|\s*([0-9,]+)/i,
  parsed_source_records: /Parsed source records\s*\|\s*([0-9,]+)/i,
  conversations: /Conversations\s*\|\s*([0-9,]+)/i,
  messages: /Messages\s*\|\s*([0-9,]+)/i,
  participants: /Participants\s*\|\s*([0-9,]+)/i,
  attachments: /Attachments\s*\|\s*([0-9,]+)/i,
  operational_events: /Operational events\s*\|\s*([0-9,]+)/i
};

export function parseImportReport(text) {
  const result = {};
  for (const [key, pattern] of Object.entries(counts)) {
    const match = String(text || '').match(pattern);
    result[key] = match ? Number(match[1].replace(/,/g, '')) : null;
  }
  return result;
}

export function buildDryRunReport(reportText) {
  return {
    mode: 'dry-run',
    source: 'approved-lab',
    writes_to_source: false,
    writes_to_ops: false,
    read_only_query_guard: readOnlySql('SELECT table_schema, table_name FROM information_schema.tables'),
    discovered: parseImportReport(reportText),
    eligible: 'counted-from-approved-report',
    normalized: 'not-written-in-dry-run',
    skipped: 'sensitive or malformed records remain excluded',
    unresolved_identity_matches: 'not resolved without a bounded import run',
    malformed_records: 'reported by source artifact without payload output',
    duplicates: 'idempotency keys required; no source rows changed'
  };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const reportPath = process.env.LAB_IMPORT_REPORT || '/srv/chameleon/inspection-staging/artifacts/kai-ingest/IMPORT-REPORT.md';
  fs.readFile(reportPath, 'utf8')
    .then(text => console.log(JSON.stringify(buildDryRunReport(text), null, 2)))
    .catch(error => {
      console.error(JSON.stringify({ mode: 'dry-run', error: 'report-unavailable', detail: error.message }));
      process.exit(1);
    });
}
