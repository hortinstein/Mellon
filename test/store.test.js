import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
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

test('attempt log is newest-first and capped at 50', () => {
  const store = createStore(tempFile(), { secretKey: 'k' });
  const { lock } = store.create(lockInput);
  for (let i = 0; i < 60; i++) store.recordAttempt(lock.id, { input: `try ${i}`, granted: false });
  const { attempts } = store.get(lock.id);
  assert.equal(attempts.length, 50);
  assert.equal(attempts[0].input, 'try 59');
  assert.equal(store.list()[0].attemptCount, 50);
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
  assert.deepEqual(store.stats(), { locks: 0, attempts: 0, granted: 0, denied: 0 });
  const a = store.create(lockInput).lock;
  const b = store.create(lockInput).lock;
  store.recordAttempt(a.id, { input: 'x', granted: true });
  store.recordAttempt(a.id, { input: 'y', granted: false });
  store.recordAttempt(b.id, { input: 'z', granted: false });
  assert.deepEqual(store.stats(), { locks: 2, attempts: 3, granted: 1, denied: 2 });
});
