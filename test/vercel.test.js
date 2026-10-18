import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { backendFromEnv, createStore } from '../src/store.js';
import { classificationExample } from '../public/examples.js';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RULES = 'The requester must say the passphrase osprey lantern and name the harbor town of Kettleby.';
const TOKEN = 'upstash-test-token';

/* A fake Upstash REST endpoint: POST /pipeline with HGETALL / HSET / HDEL. */
function fakeUpstash() {
  const hashes = new Map();
  const lists = new Map();
  const log = [];
  let failNext = 0;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401); return res.end('{"error":"unauthorized"}'); }
    if (failNext > 0) { failNext--; res.writeHead(500); return res.end('{"error":"boom"}'); }
    if (req.url !== '/pipeline') { res.writeHead(404); return res.end(); }
    const results = JSON.parse(body).map(([cmd, key, ...args]) => {
      log.push(cmd);
      const h = hashes.get(key) ?? new Map();
      hashes.set(key, h);
      if (cmd === 'HGETALL') return { result: [...h].flat() };
      if (cmd === 'HSET') { h.set(args[0], args[1]); return { result: 1 }; }
      if (cmd === 'HDEL') return { result: Number(h.delete(args[0])) };
      const list = lists.get(key) ?? [];
      lists.set(key, list);
      if (cmd === 'LPUSH') { list.unshift(...args); return { result: list.length }; }
      if (cmd === 'LTRIM') { const [a, b] = args.map(Number); lists.set(key, list.slice(a, b + 1)); return { result: 'OK' }; }
      if (cmd === 'LRANGE') { const [a, b] = args.map(Number); return { result: list.slice(a, b === -1 ? undefined : b + 1) }; }
      if (cmd === 'LLEN') return { result: list.length };
      if (cmd === 'DEL') { const n = Number(lists.delete(key) | hashes.delete(key)); return { result: n }; }
      return { error: `ERR unknown command ${cmd}` };
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(results));
  });
  return { server, hashes, lists, log, failOnce: () => { failNext = 1; } };
}

let upstash;
let upstashUrl;
const instances = [];

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));

before(async () => {
  upstash = fakeUpstash();
  upstashUrl = await listen(upstash.server);
  Object.assign(process.env, { KV_REST_API_URL: upstashUrl, KV_REST_API_TOKEN: TOKEN, MELLON_SECRET_KEY: 'vercel-test', TYPESAFE_API_KEY: '' });
  // Two copies of the function module = two independent serverless instances.
  for (const n of [1, 2]) {
    const { default: handler } = await import(`../api/index.js?instance=${n}`);
    const server = createServer(handler);
    instances.push({ server, base: await listen(server) });
  }
});

after(() => {
  upstash.server.close();
  for (const i of instances) i.server.close();
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

test('backendFromEnv picks Redis from Upstash or Vercel KV variables, else a file', () => {
  assert.deepEqual(backendFromEnv({ UPSTASH_REDIS_REST_URL: 'https://u', UPSTASH_REDIS_REST_TOKEN: 't' }), { kind: 'redis', url: 'https://u', token: 't', prefix: 'mellon' });
  assert.equal(backendFromEnv({ KV_REST_API_URL: 'https://k', KV_REST_API_TOKEN: 't', MELLON_REDIS_PREFIX: 'x' }).prefix, 'x');
  assert.deepEqual(backendFromEnv({ KV_REST_API_URL: 'https://k' }), { kind: 'file', file: 'data/locks.json' }, 'URL without token is not enough');
  assert.deepEqual(backendFromEnv({ VERCEL: '1' }), { kind: 'file', file: '/tmp/mellon.json' });
  assert.deepEqual(backendFromEnv({ MELLON_DATA: '/d/m.json' }), { kind: 'file', file: '/d/m.json' });
});

test('redis store: separate instances share data and write only changed records', async () => {
  const backend = { kind: 'redis', url: upstashUrl, token: TOKEN, prefix: 'unit' };
  const a = createStore(backend, { secretKey: 'k' });
  const b = createStore(backend, { secretKey: 'k' });

  await a.sync();
  const acct = a.createAccount({ username: 'dana', rules: RULES, policy: {} });
  const { lock } = a.create({ ...classificationExample, policy: {}, ownerAccountId: acct.id });
  const before = upstash.log.length;
  await a.commit();
  assert.deepEqual(upstash.log.slice(before), ['HSET', 'HSET'], 'one write per changed record');
  assert.ok(![...upstash.hashes.get('unit:accounts').values()].join().includes('osprey'), 'identity rules encrypted in Redis');

  await b.sync();
  assert.equal(b.accountByName('dana').id, acct.id);
  assert.equal(b.revealSecret(lock.id), classificationExample.secret);
  b.recordAttempt(lock.id, { input: 'hi', granted: false });
  await b.commit();

  await a.sync();
  assert.equal((await a.attemptLog(lock.id)).total, 1);
  assert.equal((await a.attemptLog(lock.id)).entries[0].input, 'hi');
  a.deleteAccount(acct.id);
  await a.commit();
  await b.sync();
  assert.equal(b.accountByName('dana'), null);
  assert.equal(b.get(lock.id), null, 'deletes propagate (HDEL)');

  const quiet = upstash.log.length;
  await b.commit();
  assert.equal(upstash.log.length, quiet, 'nothing written when nothing changed');
});

test('function: accounts, locks and admin work across instances via Redis', async () => {
  const status = await call(1, '/api/status');
  assert.equal(status.body.storage, 'redis');
  assert.equal(status.body.persistent, true);

  const signUp = await call(1, '/api/accounts', { method: 'POST', body: { username: 'root', rules: RULES } });
  assert.equal(signUp.status, 201);
  const signIn = await call(2, '/api/sessions', { method: 'POST', body: { username: 'root', statement: 'Requester says the passphrase osprey lantern and names the harbor town of Kettleby.' } });
  assert.equal(signIn.body.granted, true, 'account created on instance 1 signs in on instance 2');
  const token = signIn.body.token;

  const created = await call(2, '/api/locks', { method: 'POST', headers: bearer(token), body: { name: 'Gate', rules: 'Requester must say the password mellon', secret: 'The doors open.' } });
  const { id } = created.body.lock;
  const attempt = await call(1, `/api/locks/${id}/attempt`, { method: 'POST', body: { input: 'Requester says: password mellon' } });
  assert.equal(attempt.body.granted, true);
  assert.equal(attempt.body.secret, 'The doors open.');
  assert.equal((await call(2, `/api/locks/${id}/attempts`, { headers: bearer(token) })).body.entries.length, 1);

  // Admin: the CLI writes the flag straight to Redis; no endpoint can.
  assert.equal((await call(1, '/api/admin/overview', { headers: bearer(token) })).status, 403);
  const env = { ...process.env, KV_REST_API_URL: upstashUrl, KV_REST_API_TOKEN: TOKEN };
  const { stdout } = await run(process.execPath, [`${ROOT}scripts/admin.js`, 'grant', 'root'], { env });
  assert.match(stdout, /Granted administrator access for @root/);
  const overview = await call(2, '/api/admin/overview', { headers: bearer(token) });
  assert.equal(overview.status, 200);
  assert.equal(overview.body.accounts.find((a) => a.username === 'root').isAdmin, true);
  assert.match((await run(process.execPath, [`${ROOT}scripts/admin.js`, 'list'], { env })).stdout, /root\s+admin/);

  // Sign-out on one instance is honoured by the other.
  assert.equal((await call(1, '/api/sessions', { method: 'DELETE', headers: bearer(token) })).status, 204);
  assert.equal((await call(2, '/api/me', { headers: bearer(token) })).status, 401);
});

test('redis: attempt logs are separate lists, and simultaneous attempts are all logged', async () => {
  const created = await call(1, '/api/locks', { method: 'POST', body: { name: 'Busy', rules: 'Requester must say the password mellon', secret: 's' } });
  const { lock, ownerToken } = created.body;
  await Promise.all([1, 2, 1, 2, 1, 2].map((n, i) => call(n, `/api/locks/${lock.id}/attempt`, { method: 'POST', body: { input: `concurrent ${i}` } })));
  assert.equal(upstash.lists.get(`mellon:attempts:${lock.id}`).length, 6, 'no entries lost to concurrent writes');
  assert.ok(![...upstash.hashes.get('mellon:locks').values()].join().includes('concurrent'), 'logs are not inside lock records');
  const log = await call(2, `/api/locks/${lock.id}/attempts?limit=4`, { headers: { 'X-Owner-Token': ownerToken } });
  assert.equal(log.body.total, 6);
  assert.equal(log.body.entries.length, 4);
  assert.equal(log.body.nextCursor, 4);
  assert.ok(log.body.entries.every((e) => e.reason && e.checks?.length === 4));
  assert.equal((await call(1, `/api/locks/${lock.id}`, { method: 'DELETE', headers: { 'X-Owner-Token': ownerToken } })).status, 204);
  assert.equal(upstash.lists.has(`mellon:attempts:${lock.id}`), false, 'deleting the lock deletes its log');
});

test('function: handles the rewritten /api/index?path= form', async () => {
  const r = await call(1, '/api/index?path=status');
  assert.equal(r.status, 200);
  assert.equal(r.body.storage, 'redis');
  assert.equal((await call(2, '/api/index?path=locks')).status, 200);
});

test('function: a storage failure fails closed and releases nothing', async () => {
  const created = await call(1, '/api/locks', { method: 'POST', body: { name: 'G', rules: 'Requester must say the password mellon', secret: 'never-leak' } });
  upstash.failOnce();
  const r = await call(2, `/api/locks/${created.body.lock.id}/attempt`, { method: 'POST', body: { input: 'Requester says: password mellon' } });
  assert.equal(r.status, 500);
  assert.ok(!r.text.includes('never-leak'));
});

test('vercel.json: static site from public/, API rewritten to the function', () => {
  const cfg = JSON.parse(readFileSync(`${ROOT}vercel.json`, 'utf8'));
  assert.equal(cfg.outputDirectory, 'public');
  assert.ok(existsSync(`${ROOT}api/index.js`));
  assert.ok(cfg.functions['api/index.js'].maxDuration >= 20, 'room for a Jev call (15 s timeout)');
  const sources = cfg.rewrites.map((r) => r.source);
  assert.ok(sources.indexOf('/api') < sources.indexOf('/api/:path*'), '/api (docs page) must be matched before the API catch-all');
  assert.equal(cfg.rewrites.find((r) => r.source === '/api/:path*').destination, '/api/index');
  for (const page of ['/api', '/docs', '/admin']) assert.ok(existsSync(`${ROOT}public${cfg.rewrites.find((r) => r.source === page).destination}`), page);
});
