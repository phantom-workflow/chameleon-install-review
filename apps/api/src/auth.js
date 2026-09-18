import crypto from 'node:crypto';
import { query, transaction } from './db.js';

export const USER_TYPES = new Set(['HUMAN', 'AGENT']);
export const USER_ROLES = new Set(['ADMIN', 'MANAGER', 'STAFF', 'READ_ONLY']);
export const SESSION_TTL_SECONDS = Math.max(900, Number(process.env.AUTH_SESSION_TTL_SECONDS || 8 * 60 * 60));
export const PASSWORD_MIN_LENGTH = 12;

const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAXMEM = 32 * 1024 * 1024;

function encode(value) {
  return Buffer.from(value).toString('base64url');
}

function decode(value) {
  return Buffer.from(value, 'base64url');
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function normalizedLogin(value) {
  return String(value || '').trim().toLowerCase();
}

export function validatePassword(password) {
  const value = String(password || '');
  if (value.length < PASSWORD_MIN_LENGTH) {
    throw Object.assign(new Error(`password must be at least ${PASSWORD_MIN_LENGTH} characters`), {code: 'PASSWORD_TOO_SHORT', status: 400});
  }
  return value;
}

export async function hashPassword(password) {
  const value = validatePassword(password);
  const salt = crypto.randomBytes(16);
  const derived = await new Promise((resolve, reject) => {
    crypto.scrypt(value, salt, SCRYPT_KEY_LENGTH, {
      N: SCRYPT_COST,
      r: SCRYPT_BLOCK_SIZE,
      p: SCRYPT_PARALLELIZATION,
      maxmem: SCRYPT_MAXMEM
    }, (error, key) => error ? reject(error) : resolve(key));
  });
  return `scrypt:${SCRYPT_COST}:${SCRYPT_BLOCK_SIZE}:${SCRYPT_PARALLELIZATION}:${encode(salt)}:${encode(derived)}`;
}

export async function verifyPassword(password, encoded) {
  const parts = String(encoded || '').split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, cost, blockSize, parallelization, saltEncoded, hashEncoded] = parts;
  const salt = decode(saltEncoded);
  const expected = decode(hashEncoded);
  if (!salt.length || expected.length !== SCRYPT_KEY_LENGTH) return false;
  try {
    const derived = await new Promise((resolve, reject) => {
      crypto.scrypt(String(password || ''), salt, expected.length, {
        N: Number(cost),
        r: Number(blockSize),
        p: Number(parallelization),
        maxmem: SCRYPT_MAXMEM
      }, (error, key) => error ? reject(error) : resolve(key));
    });
    return crypto.timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || row.display_name || row.username,
    username: row.username,
    email: row.email || null,
    user_type: row.user_type || 'HUMAN',
    role: row.role || 'READ_ONLY',
    active: Boolean(row.active),
    created_at: row.created_at,
    updated_at: row.updated_at || row.created_at,
    last_login_at: row.last_login_at || null
  };
}

function userSelect() {
  return `SELECT users.id, users.username, users.display_name, users.name, users.email, users.active, users.user_type, users.role,
      users.created_at, users.updated_at, users.last_login_at, users.password_hash
    FROM users`;
}

export async function findUserByLogin(login) {
  const normalized = normalizedLogin(login);
  if (!normalized) return null;
  const result = await query(`${userSelect()} WHERE lower(username)=lower($1) OR lower(email)=lower($1) LIMIT 1`, [normalized]);
  return result.rows[0] || null;
}

export async function findUserById(id) {
  const result = await query(`${userSelect()} WHERE id=$1 LIMIT 1`, [String(id)]);
  return result.rows[0] || null;
}

export async function authenticateCredentials(login, password) {
  const user = await findUserByLogin(login);
  if (!user || user.user_type !== 'HUMAN' || !user.active || !user.password_hash || !(await verifyPassword(password, user.password_hash))) {
    return null;
  }
  return user;
}

export async function createSession(userId) {
  const token = encode(crypto.randomBytes(32));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  await query(`INSERT INTO auth_sessions(id, token_hash, user_id, created_at, expires_at, last_seen_at)
    VALUES ($1,$2,$3,$4,$5,$4)`, [crypto.randomUUID(), tokenHash(token), userId, now, expiresAt]);
  return {token, expiresAt};
}

export async function userForSessionToken(token) {
  const value = String(token || '').trim();
  if (!value || value.length < 32) return null;
  const result = await query(`${userSelect()}
    JOIN auth_sessions s ON s.user_id=users.id
    WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at > now() AND users.active=true
    LIMIT 1`, [tokenHash(value)]);
  return result.rows[0] || null;
}

export function bearerToken(req) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+([^\s]+)$/i);
  return match ? match[1] : '';
}

export async function authenticateRequest(req) {
  return userForSessionToken(bearerToken(req));
}

export async function revokeSessionToken(token) {
  const value = String(token || '').trim();
  if (!value) return false;
  const result = await query('UPDATE auth_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL', [tokenHash(value)]);
  return result.rowCount > 0;
}

export async function revokeUserSessions(userId) {
  await query('UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [userId]);
}

function validateUserInput(input, {partial = false} = {}) {
  const name = input.name === undefined && partial ? undefined : String(input.name || '').trim();
  const username = input.username === undefined && partial ? undefined : normalizedLogin(input.username || input.email);
  const email = input.email === undefined && partial ? undefined : String(input.email || '').trim().toLowerCase() || null;
  const role = input.role === undefined && partial ? undefined : String(input.role || '').toUpperCase();
  const userType = input.user_type === undefined && partial ? undefined : String(input.user_type || 'HUMAN').toUpperCase();
  if (name !== undefined && (!name || name.length > 160)) throw Object.assign(new Error('name is required and must be at most 160 characters'), {status: 400, code: 'INVALID_USER_NAME'});
  if (username !== undefined && (!username || username.length > 160)) throw Object.assign(new Error('username or email is required and must be at most 160 characters'), {status: 400, code: 'INVALID_USER_LOGIN'});
  if (email !== undefined && email && email.length > 320) throw Object.assign(new Error('email is too long'), {status: 400, code: 'INVALID_USER_EMAIL'});
  if (role !== undefined && !USER_ROLES.has(role)) throw Object.assign(new Error('invalid role'), {status: 400, code: 'INVALID_USER_ROLE'});
  if (userType !== undefined && !USER_TYPES.has(userType)) throw Object.assign(new Error('invalid user type'), {status: 400, code: 'INVALID_USER_TYPE'});
  return {name, username, email, role, userType};
}

function parseActive(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  throw Object.assign(new Error('active must be a boolean'), {status: 400, code: 'INVALID_ACTIVE_FLAG'});
}

export async function listUsers() {
  const result = await query(`${userSelect()} ORDER BY created_at, username`);
  return result.rows.map(publicUser);
}

export async function createUser(input) {
  const fields = validateUserInput(input);
  if (!fields.role) throw Object.assign(new Error('role is required'), {status: 400, code: 'INVALID_USER_ROLE'});
  const password = fields.userType === 'AGENT' ? null : validatePassword(input.password);
  const passwordHash = password ? await hashPassword(password) : null;
  const now = new Date();
  const id = crypto.randomUUID();
  try {
    const result = await query(`INSERT INTO users(id, username, display_name, name, email, password_hash, user_type, role, active, created_at, updated_at)
      VALUES ($1,$2,$3,$3,$4,$5,$6,$7,true,$8,$8) RETURNING id, username, display_name, name, email, active, user_type, role, created_at, updated_at, last_login_at`, [id, fields.username, fields.name, fields.email, passwordHash, fields.userType, fields.role, now]);
    return result.rows[0];
  } catch (error) {
    if (error?.code === '23505') throw Object.assign(new Error('username or email is already in use'), {status: 409, code: 'USER_ALREADY_EXISTS'});
    throw error;
  }
}

export async function updateUser(id, input) {
  const existing = await findUserById(id);
  if (!existing) throw Object.assign(new Error('user not found'), {status: 404, code: 'USER_NOT_FOUND'});
  const fields = validateUserInput(input, {partial: true});
  const passwordHash = input.password === undefined || input.password === ''
    ? undefined
    : await hashPassword(input.password);
  const next = {
    name: fields.name ?? existing.name ?? existing.display_name,
    username: fields.username ?? existing.username,
    email: fields.email === undefined ? existing.email : fields.email,
    role: fields.role ?? existing.role,
    userType: fields.userType ?? existing.user_type,
    active: parseActive(input.active, existing.active),
    passwordHash: passwordHash === undefined ? existing.password_hash : passwordHash
  };
  if (!USER_ROLES.has(next.role)) throw Object.assign(new Error('user role is required'), {status: 400, code: 'INVALID_USER_ROLE'});
  if (!USER_TYPES.has(next.userType)) throw Object.assign(new Error('invalid user type'), {status: 400, code: 'INVALID_USER_TYPE'});
  if (next.userType === 'HUMAN' && !next.passwordHash) throw Object.assign(new Error('human users require a password'), {status: 400, code: 'PASSWORD_REQUIRED'});
  try {
    const result = await query(`UPDATE users SET username=$1, display_name=$2, name=$2, email=$3, password_hash=$4, user_type=$5, role=$6, active=$7, updated_at=now()
      WHERE id=$8 RETURNING id, username, display_name, name, email, active, user_type, role, created_at, updated_at, last_login_at`, [next.username, next.name, next.email, next.passwordHash, next.userType, next.role, next.active, id]);
    if (!result.rowCount) throw Object.assign(new Error('user not found'), {status: 404, code: 'USER_NOT_FOUND'});
    if (!next.active || passwordHash !== undefined) await revokeUserSessions(id);
    return result.rows[0];
  } catch (error) {
    if (error?.code === '23505') throw Object.assign(new Error('username or email is already in use'), {status: 409, code: 'USER_ALREADY_EXISTS'});
    throw error;
  }
}

export async function touchLogin(userId) {
  await query('UPDATE users SET last_login_at=now(), updated_at=updated_at WHERE id=$1', [userId]);
}

export async function bootstrapAdmin(input) {
  const fields = validateUserInput({...input, role: 'ADMIN', user_type: 'HUMAN'});
  const passwordHash = await hashPassword(input.password);
  const now = new Date();
  return transaction(async client => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('chameleon-operations-access-control-bootstrap'))`);
    const existing = await client.query(`SELECT id FROM users WHERE password_hash IS NOT NULL LIMIT 1`);
    if (existing.rowCount) throw Object.assign(new Error('an authenticated user already exists; bootstrap is already complete'), {status: 409, code: 'BOOTSTRAP_ALREADY_COMPLETE'});
    try {
      const result = await client.query(`INSERT INTO users(id, username, display_name, name, email, password_hash, user_type, role, active, created_at, updated_at)
        VALUES ($1,$2,$3,$3,$4,$5,'HUMAN','ADMIN',true,$6,$6) RETURNING id, username, display_name, name, email, active, user_type, role, created_at, updated_at, last_login_at`, [crypto.randomUUID(), fields.username, fields.name, fields.email, passwordHash, now]);
      return result.rows[0];
    } catch (error) {
      if (error?.code === '23505') throw Object.assign(new Error('username or email is already in use'), {status: 409, code: 'USER_ALREADY_EXISTS'});
      throw error;
    }
  });
}
