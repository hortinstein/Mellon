// Runs Mellon's Redis storage against a real Upstash REST endpoint. Run with
// `npm run test:redis`.
//
//   MELLON_TEST_REDIS_URL / MELLON_TEST_REDIS_TOKEN   the endpoint to test
//
// In CI this suite runs twice: against a real Redis behind Upstash's open-source
// REST adapter (serverless-redis-http), and against a real Upstash database.
// Without the variables the tests skip, unless MELLON_REQUIRE_REDIS=1 (set in
// CI), which turns the missing endpoint into a failure.
//
// Everything is written under a unique key prefix, never "mellon", so it can
// share a database with a deployment. Keys are deleted afterwards and given a
// one-hour expiry along the way, so even an interrupted run cleans up after itself.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createRedisBackend } from '../src/redis.js';
import { createStore } from '../src/store.js';
import { classificationExample } from '../public/examples.js';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const URL_ = process.env.MELLON_TEST_REDIS_URL;
const TOKEN = process.env.MELLON_TEST_REDIS_TOKEN;
const configured = Boolean(URL_ && TOKEN);
const required = process.env.MELLON_REQUIRE_REDIS === '1';
const skip = configured ? false : required ? false : 'MELLON_TEST_REDIS_URL / MELLON_TEST_REDIS_TOKEN not set';
const live = skip || (!configured && 'no endpoint'); // for every test but the configuration check

const PREFIX = `mellon-test-${process.env.GITHUB_RUN_ID || 'local'}-${randomBytes(4).toString('hex')}`;
const RULES = 'The requester must say the passphrase osprey lantern and name the harbor town of Kettleby.';
const SIGN_IN = 'Requester says the passphrase osprey lantern and names the harbor town of Kettleby.';

// Raw REST calls, independent of src/redis.js, so the tests check what is really stored.
async function rest(commands, token = TOKEN) {
  const res = await fetch(`${URL_.replace(/\/+$/, '')}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  return { status: res.status, body: await res.json() };
}
const one = async (...cmd) => (await rest([cmd])).body[0].result;

// Every key this run wrote: all of them start with PREFIX.
async function keysOfThisRun() {
  const keys = [];
  let cursor = '0';
  do {
    const [next, batch] = await one('SCAN', cursor, 'MATCH', `${PREFIX}*`, 'COUNT', 500);
    keys.push(...batch);
    cursor = String(next);
  } while (cursor !== '0');
  return keys;
}

const backend = (prefix = PREFIX) => ({ kind: 'redis', url: URL_, token: TOKEN, prefix });

// Counts the Redis commands a store sends, by wrapping fetch.
function countingFetch() {
  const sent = [];
  const fetchImpl = (url, init) => {
    sent.push(...JSON.parse(init.body).map((c) => c[0]));
    return fetch(url, init);
  };
  return { sent, fetchImpl };
}

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const instances = [];
const APP_PREFIX = `${PREFIX}-app`;

before(async () => {
  if (!configured) return;
  // Two copies of the Vercel function module = two serverless instances sharing Redis.
  Object.assign(process.env, {
    KV_REST_API_URL: URL_, KV_REST_API_TOKEN: TOKEN, MELLON_REDIS_PREFIX: APP_PREFIX,
    MELLON_SECRET_KEY: 'redis-integration', TYPESAFE_API_KEY: '',
  });
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  for (const n of [1, 2]) {
    const { default: handler } = await import(`../api/index.js?redis-instance=${n}`);
    const server = createServer(handler);
    instances.push({ server, base: await listen(server) });
  }
});

// Safety net: anything this run wrote expires within the hour even if cleanup never runs.
afterEach(async () => {
  if (!configured) return;
  const keys = await keysOfThisRun();
  if (keys.length) await rest(keys.map((k) => ['EXPIRE', k, 3600]));
});

after(async () => {
  for (const i of instances) i.server.close();
  if (!configured) return;
  const keys = await keysOfThisRun();
  if (keys.length) await rest([['DEL', ...keys]]);
  assert.deepEqual(await keysOfThisRun(), [], 'test keys cleaned up');
});

const call = async (n, path, { method = 'GET', body, headers = {} } = {}) => {
  const res = await fetch(instances[n - 1].base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
};
const bearer = (t) => ({ Authorization: `Bearer ${t}` });

test('a Redis REST endpoint is configured', { skip }, () => {
  assert.ok(configured, 'MELLON_TEST_REDIS_URL / MELLON_TEST_REDIS_TOKEN are not set. In CI, add UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN repository secrets.');
  assert.match(URL_, /^https?:\/\//);
});

test('REST contract: replies have the shapes src/redis.js relies on', { skip: live }, async () => {
  const h = `${PREFIX}:contract:h`;
  const l = `${PREFIX}:contract:l`;
  const { status, body } = await rest([
    ['HSET', h, 'a', '{"x":1}'],
    ['HGETALL', h],
    ['HGETALL', `${PREFIX}:contract:missing`],
    ['HDEL', h, 'a'],
    ['HDEL', h, 'a'],
    ['LPUSH', l, 'first', 'second'],
    ['LTRIM', l, 0, 0],
    ['LRANGE', l, 0, -1],
    ['LLEN', l],
    ['LLEN', `${PREFIX}:contract:missing`],
    ['LRANGE', `${PREFIX}:contract:missing`, 0, -1],
    ['DEL', l],
  ]);
  assert.equal(status, 200);
  assert.deepEqual(body.map((r) => r.result), [
    1,
    ['a', '{"x":1}'], // HGETALL is a flat [field, value, ...] array of strings
    [],
    1,
    0,
    2,
    'OK',
    ['second'], // LPUSH puts the last value at the head
    1, // integers come back as numbers
    0,
    [],
    1,
  ]);
});

test('REST contract: a bad token is a 401 and the backend refuses to continue', { skip: live }, async () => {
  assert.equal((await rest([['LLEN', `${PREFIX}:x`]], 'wrong-token')).status, 401);
  const bad = createRedisBackend({ url: URL_, token: 'wrong-token', prefix: PREFIX });
  await assert.rejects(bad.load(), /Redis 401/);
  await assert.rejects(createStore({ ...backend(), token: 'wrong-token' }).sync(), /Redis 401/, 'a request fails rather than serving empty data');
});

test('REST contract: a command error inside a pipeline is reported, not swallowed', { skip: live }, async () => {
  // The attempt log for lock "clash" is a list; writing it as a hash is a WRONGTYPE error.
  await one('LPUSH', `${PREFIX}:attempts:clash`, '{}');
  const { body } = await rest([['HSET', `${PREFIX}:attempts:clash`, 'a', 'b']]);
  assert.match(body[0].error, /WRONGTYPE/);
  const r = createRedisBackend({ url: URL_, token: TOKEN, prefix: `${PREFIX}:attempts` });
  await assert.rejects(r.save([{ collection: 'clash', id: 'a', value: { x: 1 } }]), /WRONGTYPE/);
});

test('backend: load, save, delete and attempt-log trimming round-trip', { skip: live }, async () => {
  const prefix = `${PREFIX}-backend`;
  const r = createRedisBackend({ url: URL_, token: TOKEN, prefix });
  assert.deepEqual(await r.load(), { version: 2, locks: {}, accounts: {}, sessions: {} }, 'empty database loads as empty');

  const awkward = { name: 'Ünïcødé 🔒 "quotes" \\ back\nslash', big: 'x'.repeat(200_000) };
  await r.save([{ collection: 'locks', id: 'L1', value: awkward }, { collection: 'accounts', id: 'A1', value: { username: 'dana' } }]);
  const db = await r.load();
  assert.deepEqual(db.locks.L1, awkward, 'unicode, escapes and a 200 KB value survive');
  assert.equal(db.accounts.A1.username, 'dana');

  for (let i = 0; i < 5; i++) await r.save([], [{ op: 'push', lockId: 'L1', entry: { n: i } }], 3);
  const log = await r.readLog('L1', 0, -1);
  assert.equal(log.total, 3, 'LTRIM keeps only the newest entries');
  assert.deepEqual(log.items.map((e) => e.n), [4, 3, 2], 'newest first');
  assert.deepEqual((await r.readLog('L1', 1, 1)).items.map((e) => e.n), [3], 'pages by range');
  assert.deepEqual(await r.readLog('never-logged', 0, -1), { items: [], total: 0 });

  await r.save([{ collection: 'locks', id: 'L1', value: null }], [{ op: 'del', lockId: 'L1' }]);
  assert.deepEqual((await r.load()).locks, {});
  assert.equal(await one('EXISTS', `${prefix}:attempts:L1`), 0);
  await rest([['DEL', `${prefix}:locks`, `${prefix}:accounts`]]);
});

test('store: separate instances share data, encrypt at rest and write only what changed', { skip: live }, async () => {
  const counter = countingFetch();
  const a = createStore(backend(), { secretKey: 'k', fetchImpl: counter.fetchImpl });
  const b = createStore(backend(), { secretKey: 'k' });

  await a.sync();
  const acct = a.createAccount({ username: 'dana', rules: RULES, policy: {} });
  const { lock } = a.create({ ...classificationExample, policy: {}, ownerAccountId: acct.id });
  counter.sent.length = 0;
  await a.commit();
  assert.deepEqual(counter.sent, ['HSET', 'HSET'], 'one write per changed record');

  const raw = JSON.stringify(await one('HGETALL', `${PREFIX}:locks`)) + JSON.stringify(await one('HGETALL', `${PREFIX}:accounts`));
  assert.ok(!raw.includes('Kestrel-4'), 'the secret is encrypted in Redis');
  assert.ok(!raw.includes('osprey'), 'identity rules are encrypted in Redis');

  await b.sync();
  assert.equal(b.accountByName('dana').id, acct.id);
  assert.equal(b.revealSecret(lock.id), classificationExample.secret);
  b.recordAttempt(lock.id, { input: 'hi', granted: false });
  await b.commit();

  await a.sync();
  const log = await a.attemptLog(lock.id);
  assert.equal(log.total, 1);
  assert.equal(log.entries[0].input, 'hi');

  counter.sent.length = 0;
  await a.commit();
  assert.deepEqual(counter.sent, [], 'nothing written when nothing changed');

  a.deleteAccount(acct.id);
  await a.commit();
  await b.sync();
  assert.equal(b.accountByName('dana'), null);
  assert.equal(b.get(lock.id), null, 'deletes propagate');
  assert.equal(await one('EXISTS', `${PREFIX}:attempts:${lock.id}`), 0, "the lock's log list is deleted too");

  const wrongKey = createStore(backend(), { secretKey: 'not-k' });
  const c = createStore(backend(), { secretKey: 'k' });
  await c.sync();
  const { lock: other } = c.create({ name: 'K', rules: 'r', secret: 'only-with-k', policy: {} });
  await c.commit();
  await wrongKey.sync();
  assert.throws(() => wrongKey.revealSecret(other.id), 'a different MELLON_SECRET_KEY cannot read secrets');
});

test('function: two instances share accounts, locks, logs, admin and sign-out through Redis', { skip: live }, async () => {
  const status = await call(1, '/api/status');
  assert.equal(status.body.storage, 'redis');
  assert.equal(status.body.persistent, true);

  assert.equal((await call(1, '/api/accounts', { method: 'POST', body: { username: 'root', rules: RULES } })).status, 201);
  const signIn = await call(2, '/api/sessions', { method: 'POST', body: { username: 'root', statement: SIGN_IN } });
  assert.equal(signIn.body.granted, true, 'account created on instance 1 signs in on instance 2');
  const token = signIn.body.token;

  const created = await call(2, '/api/locks', { method: 'POST', headers: bearer(token), body: { name: 'Gate', rules: 'Requester must say the password mellon', secret: 'The doors open.' } });
  const { id } = created.body.lock;
  const attempt = await call(1, `/api/locks/${id}/attempt`, { method: 'POST', body: { input: 'Requester says: password mellon' } });
  assert.equal(attempt.body.granted, true);
  assert.equal(attempt.body.secret, 'The doors open.');
  const log = await call(2, `/api/locks/${id}/attempts`, { headers: bearer(token) });
  assert.equal(log.body.entries.length, 1);
  assert.equal(log.body.entries[0].outcome, 'granted');
  assert.equal((await call(1, '/api/me', { headers: bearer(token) })).body.locks.length, 1, 'lock linked to the account on the other instance');

  // The admin CLI writes the flag straight to Redis; no endpoint can.
  assert.equal((await call(1, '/api/admin/overview', { headers: bearer(token) })).status, 403);
  const env = { ...process.env, KV_REST_API_URL: URL_, KV_REST_API_TOKEN: TOKEN, MELLON_REDIS_PREFIX: APP_PREFIX };
  assert.match((await run(process.execPath, [`${ROOT}scripts/admin.js`, 'grant', 'root'], { env })).stdout, /Granted administrator access for @root/);
  const overview = await call(2, '/api/admin/overview', { headers: bearer(token) });
  assert.equal(overview.status, 200);
  assert.equal(overview.body.accounts.find((a) => a.username === 'root').isAdmin, true);

  assert.equal((await call(1, '/api/sessions', { method: 'DELETE', headers: bearer(token) })).status, 204);
  assert.equal((await call(2, '/api/me', { headers: bearer(token) })).status, 401, 'sign-out on one instance is honoured by the other');
});

test('function: simultaneous attempts on both instances are all logged', { skip: live }, async () => {
  const created = await call(1, '/api/locks', { method: 'POST', body: { name: 'Busy', rules: 'Requester must say the password mellon', secret: 's' } });
  const { lock, ownerToken } = created.body;
  await Promise.all(Array.from({ length: 10 }, (_, i) => call(1 + (i % 2), `/api/locks/${lock.id}/attempt`, { method: 'POST', body: { input: `concurrent ${i}` } })));
  assert.equal(await one('LLEN', `${APP_PREFIX}:attempts:${lock.id}`), 10, 'no entries lost to concurrent writes');
  const log = await call(2, `/api/locks/${lock.id}/attempts?limit=4`, { headers: { 'X-Owner-Token': ownerToken } });
  assert.equal(log.body.total, 10);
  assert.equal(log.body.entries.length, 4);
  assert.equal(log.body.nextCursor, 4);
  assert.equal((await call(1, `/api/locks/${lock.id}`, { method: 'DELETE', headers: { 'X-Owner-Token': ownerToken } })).status, 204);
  assert.equal(await one('EXISTS', `${APP_PREFIX}:attempts:${lock.id}`), 0, 'deleting the lock deletes its log');
});

test('scripts/vercel-admin.sh grants admin in Upstash using the credentials Vercel hands it', { skip: live }, async () => {
  assert.equal((await call(1, '/api/accounts', { method: 'POST', body: { username: 'ops', rules: RULES } })).status, 201);
  // A stand-in `vercel` CLI whose `env pull` writes the variables the Upstash
  // integration puts on a project. Everything after that is real.
  const dir = mkdtempSync(join(tmpdir(), 'mellon-vercel-'));
  writeFileSync(join(dir, 'vercel'), `#!/usr/bin/env bash
case "$1 $2" in
  "link "*) exit 0 ;;
  "env pull") printf 'KV_REST_API_URL="%s"\\nKV_REST_API_TOKEN="%s"\\nMELLON_REDIS_PREFIX="%s"\\n' "$UP_URL" "$UP_TOKEN" "$UP_PREFIX" > "$3" ;;
  *) echo "unexpected: $*" >&2; exit 9 ;;
esac
`);
  chmodSync(join(dir, 'vercel'), 0o755);
  const env = { PATH: `${dir}:${process.env.PATH}`, HOME: dir, UP_URL: URL_, UP_TOKEN: TOKEN, UP_PREFIX: APP_PREFIX };
  const r = spawnSync('bash', [`${ROOT}scripts/vercel-admin.sh`, 'mellon-test', 'grant', 'ops'], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Granted administrator access for @ops/);
  const listed = spawnSync('bash', [`${ROOT}scripts/vercel-admin.sh`, 'mellon-test', 'list'], { env, encoding: 'utf8' });
  assert.match(listed.stdout, /ops\s+admin/);
  const flat = await one('HGETALL', `${APP_PREFIX}:accounts`);
  const ops = flat.filter((_, i) => i % 2).map((v) => JSON.parse(v)).find((a) => a.username === 'ops');
  assert.equal(ops.isAdmin, true, 'flag written to Redis');
});
