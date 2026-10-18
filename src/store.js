// Store for locks, accounts and sessions. Secrets and account identity rules are
// encrypted at rest with AES-256-GCM when MELLON_SECRET_KEY is set; owner tokens
// and session tokens are stored only as SHA-256 hashes.
//
// Two backends hold the same data:
//  - file (default): one JSON file owned by one process. Writes are atomic (temp
//    file + rename) and edits by another process (scripts/admin.js) are picked
//    up on the next call because the file's mtime changes.
//  - redis (Upstash REST): for serverless hosts such as Vercel, where there is
//    no persistent disk. Each request calls sync() to load the current data and
//    commit() to write back only the records it changed.
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRedisBackend } from './redis.js';

const MAX_ATTEMPTS_KEPT = 50;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const sha256 = (s) => createHash('sha256').update(s).digest();
const sha256hex = (s) => sha256(s).toString('hex');
const USAGE_SAVE_DELAY_MS = 2000;
const freshUsage = () => ({ apiCalls: 0, signIns: 0, failedSignIns: 0, lastSignInAt: null, lastSeenAt: null });

// Picks the backend from the environment: Upstash/Vercel KV credentials mean
// Redis; otherwise a JSON file (in /tmp on Vercel, which is not persistent).
export function backendFromEnv(env = process.env, defaultFile = 'data/locks.json') {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (url && token) return { kind: 'redis', url, token, prefix: env.MELLON_REDIS_PREFIX || 'mellon' };
  return { kind: 'file', file: env.MELLON_DATA || (env.VERCEL ? '/tmp/mellon.json' : defaultFile) };
}

export function createStore(target, { secretKey = process.env.MELLON_SECRET_KEY, now = () => Date.now(), fetchImpl } = {}) {
  const backend = typeof target === 'string' ? { kind: 'file', file: target } : target;
  const redis = backend.kind === 'redis' ? createRedisBackend({ ...backend, fetchImpl }) : null;
  const file = backend.file;
  const key = secretKey ? sha256(secretKey) : null;
  let db = redis ? emptyDb() : load(file);
  let seenMtime = redis ? null : mtimeOf(file);
  let usageTimer = null;
  const dirty = new Set(); // "collection\u0000id" pairs changed since the last commit

  const mark = (collection, id) => dirty.add(`${collection}\u0000${id}`);

  const pruneSessions = () => {
    for (const [hash, s] of Object.entries(db.sessions)) if (s.expiresAt <= now()) { delete db.sessions[hash]; mark('sessions', hash); }
  };

  // File: write now. Redis: nothing until commit(), which the server calls once
  // per request.
  const save = () => {
    if (redis) return;
    clearTimeout(usageTimer);
    usageTimer = null;
    pruneSessions();
    dirty.clear();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(db, null, 2), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
    seenMtime = mtimeOf(file);
  };

  // File only: reload if another process (the admin CLI) changed the file.
  // Usage counters not yet flushed are dropped in that case; they are advisory.
  const refresh = () => {
    if (redis) return;
    const m = mtimeOf(file);
    if (m !== seenMtime) {
      db = load(file);
      seenMtime = m;
    }
  };

  const usageOf = (account) => (account.usage ??= freshUsage());
  const isActive = (account) => Boolean(account) && !account.disabled;

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

  const api = {
    encrypted: Boolean(key),
    storage: backend.kind,

    // Load the latest data (Redis) before handling a request.
    async sync() {
      if (redis) {
        db = await redis.load();
        dirty.clear();
      }
    },

    // Persist this request's changes (Redis). Only changed records are written.
    async commit() {
      if (!redis) return;
      pruneSessions();
      if (!dirty.size) return;
      const changes = [...dirty].map((k) => {
        const [collection, id] = k.split('\u0000');
        return { collection, id, value: db[collection][id] ?? null };
      });
      dirty.clear();
      await redis.save(changes);
    },

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
      mark('locks', id);
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
      if (accountId && db.accounts[accountId]?.isAdmin) return true;
      return Boolean(accountId && lock.ownerAccountId === accountId) || this.isOwner(id, ownerToken);
    },

    recordAttempt(id, attempt) {
      const lock = db.locks[id];
      lock.attempts.unshift({ at: new Date(now()).toISOString(), ...attempt });
      lock.attempts.length = Math.min(lock.attempts.length, MAX_ATTEMPTS_KEPT);
      mark('locks', id);
      save();
    },

    remove(id) {
      delete db.locks[id];
      mark('locks', id);
      save();
    },

    /* Accounts: the identity rules are the account's "password", judged by Jev */

    createAccount({ username, rules, policy }) {
      if (Object.values(db.accounts).some((a) => a.username === username)) return null;
      const id = randomBytes(6).toString('hex');
      // isAdmin is deliberately not settable here; see setAdmin.
      db.accounts[id] = { id, username, rules: seal(rules), policy, createdAt: new Date(now()).toISOString(), isAdmin: false, disabled: false, usage: freshUsage() };
      mark('accounts', id);
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
      mark('sessions', sha256hex(token));
      save();
      return { token, expiresAt: new Date(expiresAt).toISOString() };
    },

    sessionAccount(token) {
      if (typeof token !== 'string' || !token) return null;
      const s = db.sessions[sha256hex(token)];
      if (!s || s.expiresAt <= now()) return null;
      const account = db.accounts[s.accountId];
      return isActive(account) ? account : null;
    },

    revokeSession(token) {
      delete db.sessions[sha256hex(token)];
      mark('sessions', sha256hex(token));
      save();
    },

    /* Usage and administration. Note: nothing here is reachable from an API
       endpoint that can set isAdmin; only setAdmin does, and only the CLI calls it. */

    // Called on every authenticated request; saved lazily.
    touch(accountId) {
      const account = db.accounts[accountId];
      if (!account) return;
      const usage = usageOf(account);
      usage.apiCalls += 1;
      usage.lastSeenAt = new Date(now()).toISOString();
      mark('accounts', accountId);
      if (redis) return;
      usageTimer ??= setTimeout(save, USAGE_SAVE_DELAY_MS);
      usageTimer.unref?.();
    },

    recordSignIn(accountId, ok) {
      const usage = usageOf(db.accounts[accountId]);
      if (ok) {
        usage.signIns += 1;
        usage.lastSignInAt = usage.lastSeenAt = new Date(now()).toISOString();
      } else {
        usage.failedSignIns += 1;
      }
      mark('accounts', accountId);
      save();
    },

    setAdmin(username, isAdmin) {
      const account = api.accountByName(username);
      if (!account) return false;
      account.isAdmin = Boolean(isAdmin);
      mark('accounts', account.id);
      save();
      return true;
    },

    setDisabled(accountId, disabled) {
      db.accounts[accountId].disabled = Boolean(disabled);
      mark('accounts', accountId);
      if (disabled) api.revokeSessionsFor(accountId);
      save();
    },

    revokeSessionsFor(accountId) {
      let n = 0;
      for (const [hash, s] of Object.entries(db.sessions)) if (s.accountId === accountId) { delete db.sessions[hash]; mark('sessions', hash); n++; }
      save();
      return n;
    },

    // Removes the account, its sessions and every lock it owns.
    deleteAccount(accountId) {
      const locks = Object.values(db.locks).filter((l) => l.ownerAccountId === accountId);
      for (const l of locks) { delete db.locks[l.id]; mark('locks', l.id); }
      for (const [hash, s] of Object.entries(db.sessions)) if (s.accountId === accountId) { delete db.sessions[hash]; mark('sessions', hash); }
      delete db.accounts[accountId];
      mark('accounts', accountId);
      save();
      return { locksDeleted: locks.length };
    },

    accountsOverview() {
      const t = now();
      return Object.values(db.accounts).map((account) => {
        const locks = Object.values(db.locks).filter((l) => l.ownerAccountId === account.id);
        const attempts = locks.flatMap((l) => l.attempts);
        const granted = attempts.filter((a) => a.granted).length;
        return {
          username: account.username,
          createdAt: account.createdAt,
          isAdmin: Boolean(account.isAdmin),
          disabled: Boolean(account.disabled),
          locks: locks.length,
          attempts: attempts.length,
          granted,
          denied: attempts.length - granted,
          activeSessions: Object.values(db.sessions).filter((s) => s.accountId === account.id && s.expiresAt > t).length,
          ...freshUsage(),
          ...account.usage,
        };
      }).sort((a, b) => a.username.localeCompare(b.username));
    },

    flush() {
      if (usageTimer) save();
    },
  };

  // Every call first picks up external edits to the file (file backend).
  for (const [name, fn] of Object.entries(api)) {
    if (typeof fn === 'function') api[name] = (...args) => { refresh(); return fn.apply(api, args); };
  }
  return api;
}

function mtimeOf(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

const emptyDb = () => ({ version: 2, locks: {}, accounts: {}, sessions: {} });

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
