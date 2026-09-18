import {pool} from './db.js';
import {bootstrapAdmin} from './auth.js';
import {runMigrations} from './migrate.js';

const required = ['BOOTSTRAP_ADMIN_NAME', 'BOOTSTRAP_ADMIN_USERNAME', 'BOOTSTRAP_ADMIN_PASSWORD'];

async function main() {
  for (const key of required) {
    if (!process.env[key]) throw new Error(`${key} must be supplied through the protected runtime environment`);
  }
  const user = await bootstrapAdmin({
    name: process.env.BOOTSTRAP_ADMIN_NAME,
    username: process.env.BOOTSTRAP_ADMIN_USERNAME,
    email: process.env.BOOTSTRAP_ADMIN_EMAIL || undefined,
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD
  });
  console.log(JSON.stringify({status: 'bootstrapped', user}));
}

runMigrations().then(main).catch(error => {
  console.error(JSON.stringify({status: 'failed', code: error.code || 'BOOTSTRAP_FAILED', message: error.message}));
  process.exitCode = 1;
}).finally(() => pool.end());
