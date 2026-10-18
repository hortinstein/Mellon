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
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRedisBackend } from './redis.js';

// Attempt logs live outside the lock records (a JSON-lines file per lock, or a
// Redis list per lock) and are only read when someone views them. Every attempt
// is kept unless MELLON_ATTEMPT_LOG_MAX caps the entries kept per lock.
const LOG_MAX = Math.max(0, Number(process.env.MELLON_ATTEMPT_LOG_MAX) || 0);
const OUTCOMES = ['granted', 'denied', 'error', 'rate_limited'];
const zeroCounts = () => ({ attempts: 0, granted: 0, denied: 0, errors: 0, rateLimited: 0, lastAttemptAt: null });
const outcomeOf = (e) => e.outcome ?? (e.error ? 'error' : e.granted ? 'granted' : 'denied');
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
  const pendingLog = []; // Redis: attempt-log operations waiting for commit()
  const logDir = redis ? null : join(dirname(file), 'attempts');
  const logPath = (id) => join(logDir, `${id}.jsonl`);

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
      if (migrate()) save();
    }
  };

  const countsOf = (lock) => (lock.counts ??= zeroCounts());

  const bump = (lock, entry) => {
    const c = countsOf(lock);
    const outcome = outcomeOf(entry);
    if (outcome === 'rate_limited') c.rateLimited += 1;
    else {
      c.attempts += 1;
      if (outcome === 'granted') c.granted += 1;
      else c.denied += 1;
      if (outcome === 'error') c.errors += 1;
    }
    c.lastAttemptAt = entry.at;
  };

  const appendLog = (id, entries) => {
    if (redis) {
      for (const entry of entries) pendingLog.push({ op: 'push', lockId: id, entry });
      return;
    }
    mkdirSync(logDir, { recursive: true });
    appendFileSync(logPath(id), entries.map((e) => `${JSON.stringify(e)}\n`).join(''), { mode: 0o600 });
    if (LOG_MAX) {
      const lines = readFileSync(logPath(id), 'utf8').split('\n').filter(Boolean);
      if (lines.length > LOG_MAX * 1.1) writeFileSync(logPath(id), `${lines.slice(-LOG_MAX).join('\n')}\n`, { mode: 0o600 });
    }
  };

  const deleteLog = (id) => {
    if (redis) pendingLog.push({ op: 'del', lockId: id });
    else rmSync(logPath(id), { force: true });
  };

  // Older data embedded the last 50 attempts in each lock: move them to the log.
  const migrate = () => {
    let changed = false;
    for (const lock of Object.values(db.locks)) {
      if (!Array.isArray(lock.attempts)) continue;
      const oldestFirst = lock.attempts.slice().reverse().map((e) => ({ ...e, outcome: outcomeOf(e) }));
      delete lock.attempts;
      lock.counts = zeroCounts();
      for (const e of oldestFirst) bump(lock, e);
      if (oldestFirst.length) appendLog(lock.id, oldestFirst);
      mark('locks', lock.id);
      changed = true;
    }
    return changed;
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

  const view = ({ id, name, description, rules, policy, createdAt, counts, ownerAccountId }) => ({
    id, name, description, rules, policy, createdAt,
    attemptCount: counts?.attempts ?? 0,
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
        pendingLog.length = 0;
        migrate();
      }
    },

    // Persist this request's changes (Redis). Only changed records are written.
    async commit() {
      if (!redis) return;
      pruneSessions();
      if (!dirty.size && !pendingLog.length) return;
      const changes = [...dirty].map((k) => {
        const [collection, id] = k.split('\u0000');
        return { collection, id, value: db[collection][id] ?? null };
      });
      const logOps = pendingLog.splice(0);
      dirty.clear();
      await redis.save(changes, logOps, LOG_MAX);
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
        counts: zeroCounts(),
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
      const t = zeroCounts();
      for (const l of Object.values(db.locks)) for (const k of ['attempts', 'granted', 'denied']) t[k] += countsOf(l)[k];
      return { locks: Object.keys(db.locks).length, attempts: t.attempts, granted: t.granted, denied: t.denied, accounts: Object.keys(db.accounts).length };
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

    // Every attempt, whatever its outcome, is appended to the lock's log.
    recordAttempt(id, attempt) {
      const lock = db.locks[id];
      const entry = { at: new Date(now()).toISOString(), ...attempt };
      entry.outcome = outcomeOf(entry);
      bump(lock, entry);
      appendLog(id, [entry]);
      mark('locks', id);
      save();
    },

    counts: (id) => ({ ...zeroCounts(), ...db.locks[id]?.counts }),

    // Newest first. outcome filters to one of OUTCOMES; cursor is an offset.
    async attemptLog(id, { limit = 25, cursor = 0, outcome } = {}) {
      limit = Math.min(Math.max(1, Number(limit) || 25), 200);
      cursor = Math.max(0, Number(cursor) || 0);
      if (outcome && !OUTCOMES.includes(outcome)) outcome = undefined;
      let entries;
      let total;
      if (redis && !outcome) {
        ({ items: entries, total } = await redis.readLog(id, cursor, cursor + limit - 1));
      } else {
        let all;
        if (redis) all = (await redis.readLog(id, 0, -1)).items;
        else all = existsSync(logPath(id)) ? readFileSync(logPath(id), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).reverse() : [];
        if (outcome) all = all.filter((e) => outcomeOf(e) === outcome);
        total = all.length;
        entries = all.slice(cursor, cursor + limit);
      }
      return { entries, total, nextCursor: cursor + limit < total ? cursor + limit : null };
    },

    remove(id) {
      delete db.locks[id];
      deleteLog(id);
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
      for (const l of locks) { delete db.locks[l.id]; deleteLog(l.id); mark('locks', l.id); }
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
        const sum = (k) => locks.reduce((n, l) => n + countsOf(l)[k], 0);
        return {
          username: account.username,
          createdAt: account.createdAt,
          isAdmin: Boolean(account.isAdmin),
          disabled: Boolean(account.disabled),
          locks: locks.length,
          attempts: sum('attempts'),
          granted: sum('granted'),
          denied: sum('denied'),
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

  if (!redis && migrate()) save();

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
