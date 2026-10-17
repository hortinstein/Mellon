// JSON-file store for locks, accounts and sessions. Secrets and account identity
// rules are encrypted at rest with AES-256-GCM when MELLON_SECRET_KEY is set;
// owner tokens and session tokens are stored only as SHA-256 hashes.
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const MAX_ATTEMPTS_KEPT = 50;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const sha256 = (s) => createHash('sha256').update(s).digest();
const sha256hex = (s) => sha256(s).toString('hex');

export function createStore(file, { secretKey = process.env.MELLON_SECRET_KEY, now = () => Date.now() } = {}) {
  const key = secretKey ? sha256(secretKey) : null;
  const db = load(file);

  const save = () => {
    for (const [hash, s] of Object.entries(db.sessions)) if (s.expiresAt <= now()) delete db.sessions[hash];
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(db, null, 2), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  };

  const seal = (plain) => {
    if (!key) return { plain };
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  };

  const open = (sealed) => {
    if ('plain' in sealed) return sealed.plain;
    if (!key) throw new Error('Secret is encrypted but MELLON_SECRET_KEY is not set');
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
    d.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(sealed.data, 'base64')), d.final()]).toString('utf8');
  };

  const view = ({ id, name, description, rules, policy, createdAt, attempts, ownerAccountId }) => ({
    id, name, description, rules, policy, createdAt,
    attemptCount: attempts.length,
    owner: (ownerAccountId && db.accounts[ownerAccountId]?.username) || null,
  });

  return {
    encrypted: Boolean(key),

    /* Locks */

    create({ name, description, rules, secret, policy, ownerAccountId = null }) {
      const id = randomBytes(6).toString('hex');
      const ownerToken = randomBytes(24).toString('base64url');
      db.locks[id] = {
        id,
        name,
        description,
        rules,
        policy,
        secret: seal(secret),
        ownerHash: sha256hex(ownerToken),
        ownerAccountId,
        createdAt: new Date(now()).toISOString(),
        attempts: [],
      };
      save();
      return { lock: view(db.locks[id]), ownerToken };
    },

    get: (id) => db.locks[id] ?? null,
    view: (id) => (db.locks[id] ? view(db.locks[id]) : null),
    list: () => Object.values(db.locks).map(view),
    locksFor: (accountId) => Object.values(db.locks).filter((l) => l.ownerAccountId === accountId).map(view),

    // Aggregate counts only: no inputs, verdict details or lock ids.
    stats() {
      const all = Object.values(db.locks).flatMap((l) => l.attempts);
      const granted = all.filter((a) => a.granted).length;
      return { locks: Object.keys(db.locks).length, attempts: all.length, granted, denied: all.length - granted, accounts: Object.keys(db.accounts).length };
    },
    revealSecret: (id) => open(db.locks[id].secret),

    isOwner(id, token) {
      const lock = db.locks[id];
      if (!lock || typeof token !== 'string') return false;
      return timingSafeEqual(sha256(token), Buffer.from(lock.ownerHash, 'hex'));
    },

    // Either the lock's owner token or the account that created it.
    canManage(id, { ownerToken, accountId } = {}) {
      const lock = db.locks[id];
      if (!lock) return false;
      return Boolean(accountId && lock.ownerAccountId === accountId) || this.isOwner(id, ownerToken);
    },

    recordAttempt(id, attempt) {
      const lock = db.locks[id];
      lock.attempts.unshift({ at: new Date(now()).toISOString(), ...attempt });
      lock.attempts.length = Math.min(lock.attempts.length, MAX_ATTEMPTS_KEPT);
      save();
    },

    remove(id) {
      delete db.locks[id];
      save();
    },

    /* Accounts: the identity rules are the account's "password", judged by Jev */

    createAccount({ username, rules, policy }) {
      if (Object.values(db.accounts).some((a) => a.username === username)) return null;
      const id = randomBytes(6).toString('hex');
      db.accounts[id] = { id, username, rules: seal(rules), policy, createdAt: new Date(now()).toISOString() };
      save();
      return { id, username, createdAt: db.accounts[id].createdAt };
    },

    accountByName: (username) => Object.values(db.accounts).find((a) => a.username === username) ?? null,
    account: (id) => db.accounts[id] ?? null,
    accountRules: (id) => open(db.accounts[id].rules),

    /* Sessions: opaque bearer tokens, stored hashed */

    createSession(accountId) {
      const token = `mln_${randomBytes(32).toString('base64url')}`;
      const expiresAt = now() + SESSION_TTL_MS;
      db.sessions[sha256hex(token)] = { accountId, expiresAt };
      save();
      return { token, expiresAt: new Date(expiresAt).toISOString() };
    },

    sessionAccount(token) {
      if (typeof token !== 'string' || !token) return null;
      const s = db.sessions[sha256hex(token)];
      if (!s || s.expiresAt <= now()) return null;
      return db.accounts[s.accountId] ?? null;
    },

    revokeSession(token) {
      delete db.sessions[sha256hex(token)];
      save();
    },
  };
}

function load(file) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') raw = {};
    else throw err;
  }
  // Version 1 files were a bare map of locks.
  if (raw.version !== 2) raw = { version: 2, locks: raw, accounts: {}, sessions: {} };
  return raw;
}
