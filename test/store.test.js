import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createStore } from '../src/store.js';
import { tempFile } from './helpers.js';

const lockInput = { name: 'Vault', description: 'd', rules: 'r', secret: 'the-secret-value', policy: {} };

test('encrypts secrets and hashes owner tokens at rest', () => {
  const file = tempFile();
  const store = createStore(file, { secretKey: 'k1' });
  const { lock, ownerToken } = store.create(lockInput);
  const disk = readFileSync(file, 'utf8');
  assert.ok(!disk.includes('the-secret-value'));
  assert.ok(!disk.includes(ownerToken));
  assert.equal(store.revealSecret(lock.id), 'the-secret-value');
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
});

test('persists across reloads', () => {
  const file = tempFile();
  const { lock, ownerToken } = createStore(file, { secretKey: 'k1' }).create(lockInput);
  const reopened = createStore(file, { secretKey: 'k1' });
  assert.equal(reopened.list().length, 1);
  assert.equal(reopened.revealSecret(lock.id), 'the-secret-value');
  assert.ok(reopened.isOwner(lock.id, ownerToken));
});

test('wrong key cannot decrypt; missing key is reported', () => {
  const file = tempFile();
  const { lock } = createStore(file, { secretKey: 'k1' }).create(lockInput);
  assert.throws(() => createStore(file, { secretKey: 'k2' }).revealSecret(lock.id));
  assert.throws(() => createStore(file, { secretKey: '' }).revealSecret(lock.id), /MELLON_SECRET_KEY/);
});

test('plaintext mode still works without a key', () => {
  const store = createStore(tempFile(), { secretKey: '' });
  assert.equal(store.encrypted, false);
  const { lock } = store.create(lockInput);
  assert.equal(store.revealSecret(lock.id), 'the-secret-value');
});

test('public view never exposes secret or owner hash', () => {
  const store = createStore(tempFile(), { secretKey: 'k' });
  const { lock } = store.create(lockInput);
  for (const view of [lock, ...store.list()]) {
    assert.equal(view.secret, undefined);
    assert.equal(view.ownerHash, undefined);
    assert.equal(view.attempts, undefined);
  }
});

test('owner check rejects wrong, missing and foreign tokens', () => {
  const store = createStore(tempFile(), { secretKey: 'k' });
  const a = store.create(lockInput);
  const b = store.create(lockInput);
  assert.ok(store.isOwner(a.lock.id, a.ownerToken));
  assert.ok(!store.isOwner(a.lock.id, b.ownerToken));
  assert.ok(!store.isOwner(a.lock.id, undefined));
  assert.ok(!store.isOwner('nope', a.ownerToken));
});

test('every attempt is kept, newest first, outside the lock record', async () => {
  const file = tempFile();
  const store = createStore(file, { secretKey: 'k' });
  const { lock } = store.create(lockInput);
  for (let i = 0; i < 120; i++) store.recordAttempt(lock.id, { input: `try ${i}`, granted: i % 3 === 0, outcome: i % 3 === 0 ? 'granted' : 'denied' });
  store.recordAttempt(lock.id, { input: 'x', granted: false, outcome: 'error', error: 'down' });
  store.recordAttempt(lock.id, { input: null, granted: false, outcome: 'rate_limited' });

  const first = await store.attemptLog(lock.id, { limit: 50 });
  assert.equal(first.total, 122);
  assert.equal(first.entries.length, 50);
  assert.equal(first.entries[0].outcome, 'rate_limited');
  assert.equal(first.entries[2].input, 'try 119');
  assert.equal(first.nextCursor, 50);
  const last = await store.attemptLog(lock.id, { limit: 50, cursor: 100 });
  assert.equal(last.entries.at(-1).input, 'try 0');
  assert.equal(last.nextCursor, null);

  assert.equal((await store.attemptLog(lock.id, { outcome: 'granted', limit: 200 })).total, 40);
  assert.equal((await store.attemptLog(lock.id, { outcome: 'error' })).entries[0].error, 'down');
  assert.equal((await store.attemptLog(lock.id, { outcome: 'bogus' })).total, 122, 'unknown filter is ignored');

  assert.deepEqual(
    (({ attempts, granted, denied, errors, rateLimited }) => ({ attempts, granted, denied, errors, rateLimited }))(store.counts(lock.id)),
    { attempts: 121, granted: 40, denied: 81, errors: 1, rateLimited: 1 },
  );
  assert.equal(store.list()[0].attemptCount, 121, 'rate-limited requests are logged but not counted as attempts');
  assert.ok(!readFileSync(file, 'utf8').includes('try 5'), 'logs are not in the main data file');
  assert.equal(createStore(file, { secretKey: 'k' }).counts(lock.id).attempts, 121, 'counters persist');

  store.remove(lock.id);
  assert.equal((await store.attemptLog(lock.id)).total, 0, 'deleting a lock deletes its log');
});

test('older files with embedded attempts are migrated into the log', async () => {
  const file = tempFile();
  const legacy = { version: 2, accounts: {}, sessions: {}, locks: { abc: { id: 'abc', name: 'Old', rules: 'r', secret: { plain: 's' }, ownerHash: 'x', createdAt: 'then',
    attempts: [{ at: 't3', input: 'newest', granted: true }, { at: 't2', input: 'mid', granted: false, error: 'boom' }, { at: 't1', input: 'oldest', granted: false }] } } };
  writeFileSync(file, JSON.stringify(legacy));
  const store = createStore(file, { secretKey: '' });
  const log = await store.attemptLog('abc');
  assert.deepEqual(log.entries.map((e) => [e.input, e.outcome]), [['newest', 'granted'], ['mid', 'error'], ['oldest', 'denied']]);
  assert.equal(store.counts('abc').attempts, 3);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).locks.abc.attempts, undefined);
});

test('MELLON_ATTEMPT_LOG_MAX caps the entries kept per lock', () => {
  const file = tempFile();
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', `
    const { createStore } = await import(${JSON.stringify(new URL('../src/store.js', import.meta.url).href)});
    const store = createStore(${JSON.stringify(file)}, { secretKey: 'k' });
    const { lock } = store.create({ name: 'n', rules: 'r', secret: 's', policy: {} });
    for (let i = 0; i < 40; i++) store.recordAttempt(lock.id, { input: 'i' + i, granted: false });
    const log = await store.attemptLog(lock.id, { limit: 200 });
    console.log(JSON.stringify({ total: log.total, newest: log.entries[0].input, counted: store.counts(lock.id).attempts }));
  `], { env: { ...process.env, MELLON_ATTEMPT_LOG_MAX: '10' }, encoding: 'utf8' });
  const r = JSON.parse(out);
  assert.ok(r.total >= 10 && r.total <= 11, `kept ${r.total}`);
  assert.equal(r.newest, 'i39');
  assert.equal(r.counted, 40, 'counters still cover every attempt');
});

test('remove deletes the lock', () => {
  const store = createStore(tempFile(), { secretKey: 'k' });
  const { lock } = store.create(lockInput);
  store.remove(lock.id);
  assert.equal(store.get(lock.id), null);
  assert.deepEqual(store.list(), []);
});

test('stats aggregate counts across locks', () => {
  const store = createStore(tempFile(), { secretKey: 'k' });
  assert.deepEqual(store.stats(), { locks: 0, attempts: 0, granted: 0, denied: 0, accounts: 0 });
  const a = store.create(lockInput).lock;
  const b = store.create(lockInput).lock;
  store.recordAttempt(a.id, { input: 'x', granted: true });
  store.recordAttempt(a.id, { input: 'y', granted: false });
  store.recordAttempt(b.id, { input: 'z', granted: false });
  assert.deepEqual(store.stats(), { locks: 2, attempts: 3, granted: 1, denied: 2, accounts: 0 });
});
