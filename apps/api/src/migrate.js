import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pool, transaction } from './db.js';

const directory = path.dirname(fileURLToPath(import.meta.url)).replace(/src$/, 'migrations');

export async function runMigrations() {
  await transaction(async client => {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL)');
    const files = (await fs.readdir(directory)).filter(file => file.endsWith('.sql')).sort();
    for (const file of files) {
      const exists = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [file]);
      if (exists.rowCount) continue;
      const sql = await fs.readFile(path.join(directory, file), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version, applied_at) VALUES ($1, now())', [file]);
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMigrations().then(async () => {
    console.log(JSON.stringify({ status: 'migrated' }));
    await pool.end();
  }).catch(async error => {
    console.error(error.message);
    await pool.end();
    process.exit(1);
  });
}
