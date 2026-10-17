import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createStore, SESSION_TTL_MS } from '../src/store.js';
import { classificationExample } from '../public/examples.js';
import { fakeJudge, passingAnswers, tempFile, withServer } from './helpers.js';

const RULES = 'The requester must say the passphrase osprey lantern and name the harbor town of Kettleby.';
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const signUp = (call, username = 'dana', rules = RULES) => call('/api/accounts', { method: 'POST', body: { username, rules } });
const signIn = (call, username, statement) => call('/api/sessions', { method: 'POST', body: { username, statement } });

/* Store */

test('store: accounts are unique and identity rules are encrypted at rest', () => {
  const file = tempFile();
  const store = createStore(file, { secretKey: 'k' });
  const a = store.createAccount({ username: 'dana', rules: RULES, policy: {} });
  assert.ok(a.id);
  assert.equal(store.createAccount({ username: 'dana', rules: 'x', policy: {} }), null);
  assert.ok(!readFileSync(file, 'utf8').includes('osprey'));
  assert.equal(store.accountRules(a.id), RULES);
});

test('store: sessions are hashed, resolve to the account, expire and revoke', () => {
  let clock = 1_000_000;
  const file = tempFile();
  const store = createStore(file, { secretKey: 'k', now: () => clock });
  const a = store.createAccount({ username: 'dana', rules: RULES, policy: {} });
  const { token, expiresAt } = store.createSession(a.id);
  assert.match(token, /^mln_/);
  assert.ok(!readFileSync(file, 'utf8').includes(token));
  assert.equal(new Date(expiresAt).getTime(), clock + SESSION_TTL_MS);
  assert.equal(store.sessionAccount(token).username, 'dana');
  assert.equal(store.sessionAccount('mln_nope'), null);
  assert.equal(store.sessionAccount(undefined), null);

  clock += SESSION_TTL_MS;
  assert.equal(store.sessionAccount(token), null, 'expired');

  const second = store.createSession(a.id).token;
  store.revokeSession(second);
  assert.equal(store.sessionAccount(second), null, 'revoked');
});

test('store: version 1 files (a bare map of locks) are migrated', () => {
  const file = tempFile();
  writeFileSync(file, JSON.stringify({ abc: { id: 'abc', name: 'Old', rules: 'r', secret: { plain: 's' }, ownerHash: 'x', createdAt: 'then', attempts: [] } }));
  const store = createStore(file, { secretKey: '' });
  assert.equal(store.list()[0].name, 'Old');
  assert.equal(store.list()[0].owner, null);
  store.createAccount({ username: 'dana', rules: RULES, policy: {} });
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).version, 2);
  assert.equal(createStore(file, { secretKey: '' }).view('abc').name, 'Old');
});

test('store: locks created by an account are listed for it and manageable by it', () => {
  const store = createStore(tempFile(), { secretKey: 'k' });
  const a = store.createAccount({ username: 'dana', rules: RULES, policy: {} });
  const b = store.createAccount({ username: 'sam', rules: RULES, policy: {} });
  const { lock, ownerToken } = store.create({ ...classificationExample, policy: {}, ownerAccountId: a.id });
  store.create({ ...classificationExample, policy: {} });
  assert.equal(lock.owner, 'dana');
  assert.deepEqual(store.locksFor(a.id).map((l) => l.id), [lock.id]);
  assert.ok(store.canManage(lock.id, { accountId: a.id }));
  assert.ok(!store.canManage(lock.id, { accountId: b.id }));
  assert.ok(store.canManage(lock.id, { ownerToken }));
  assert.ok(!store.canManage(lock.id, {}));
});

/* HTTP */

test('sign-up validates input and refuses duplicates', async () => {
  await withServer(fakeJudge(), async ({ call }) => {
    assert.equal((await signUp(call, 'ab')).status, 400, 'too short');
    assert.equal((await signUp(call, 'has space')).status, 400);
    assert.equal((await signUp(call, '-dash')).status, 400);
    assert.equal((await signUp(call, 'dana', 'too short')).status, 400);
    const ok = await signUp(call, 'Dana');
    assert.equal(ok.status, 201);
    assert.equal(ok.body.account.username, 'dana', 'usernames are lower-cased');
    assert.match(ok.body.token, /^mln_/);
    assert.ok(!ok.text.includes('osprey'), 'rules are never echoed');
    assert.equal((await signUp(call, 'DANA')).status, 409);
  });
});

test('sign-in is adjudicated by the judge against the identity rules', async () => {
  let answers = passingAnswers;
  const judge = fakeJudge(() => answers);
  await withServer(judge, async ({ call }) => {
    await signUp(call);
    const ok = await signIn(call, 'Dana', 'Passphrase osprey lantern, from Kettleby.');
    assert.equal(ok.status, 200);
    assert.equal(ok.body.granted, true);
    assert.equal(ok.body.username, 'dana');
    assert.match(ok.body.token, /^mln_/);
    assert.equal(judge.calls.at(-1).state.ruleset, RULES);
    assert.equal(judge.calls.at(-1).state.access_request, 'Passphrase osprey lantern, from Kettleby.');
    assert.match(judge.calls.at(-1).state.resource, /@dana/);

    answers = { ...passingAnswers, compliance: { score: 2.2 } }; // 0.73 < account minimum 0.8
    const denied = await signIn(call, 'dana', 'osprey?');
    assert.equal(denied.body.granted, false);
    assert.equal(denied.body.token, undefined);
    assert.ok(denied.body.checks.some((c) => c.name === 'compliance' && !c.pass));

    assert.equal((await signIn(call, 'nobody', 'hi')).status, 404);
  });
});

test('sign-in fails closed when the judge errors, and is rate limited per username', async () => {
  const judge = { mode: 'live', model: 'fake', ask: async () => { throw new Error('down'); } };
  await withServer(judge, async ({ call }) => {
    await signUp(call);
    const r = await signIn(call, 'dana', 'osprey lantern');
    assert.equal(r.status, 502);
    assert.equal(r.body.token, undefined);
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await signIn(call, 'dana', 'x')).status);
    assert.equal(statuses.at(-1), 429);
  });
});

test('session tokens: /me, lock ownership, management and sign-out', async () => {
  await withServer(fakeJudge(), async ({ call }) => {
    const dana = (await signUp(call, 'dana')).body.token;
    const sam = (await signUp(call, 'sam')).body.token;

    assert.equal((await call('/api/me')).status, 401);
    assert.equal((await call('/api/me', { headers: bearer('mln_forged') })).status, 401);
    assert.equal((await call('/api/locks', { method: 'POST', body: classificationExample, headers: bearer('mln_forged') })).status, 401, 'bad token is not silently anonymous');

    const created = await call('/api/locks', { method: 'POST', body: classificationExample, headers: bearer(dana) });
    assert.equal(created.status, 201);
    const { id } = created.body.lock;
    assert.equal(created.body.lock.owner, 'dana');
    await call('/api/locks', { method: 'POST', body: classificationExample }); // anonymous lock

    const me = await call('/api/me', { headers: bearer(dana) });
    assert.equal(me.body.username, 'dana');
    assert.deepEqual(me.body.locks.map((l) => l.id), [id]);
    assert.ok(!me.text.includes('osprey') && !me.text.includes('Kestrel-4'));

    assert.equal((await call(`/api/locks/${id}/attempts`, { headers: bearer(dana) })).status, 200);
    assert.equal((await call(`/api/locks/${id}/attempts`, { headers: bearer(sam) })).status, 403);
    assert.equal((await call(`/api/locks/${id}`, { method: 'DELETE', headers: bearer(sam) })).status, 403);

    assert.equal((await call('/api/sessions', { method: 'DELETE', headers: bearer(dana) })).status, 204);
    assert.equal((await call('/api/me', { headers: bearer(dana) })).status, 401, 'revoked');
    assert.equal((await call(`/api/locks/${id}`, { method: 'DELETE', headers: bearer(dana) })).status, 403);

    const again = (await signIn(call, 'dana', 'osprey lantern Kettleby')).body.token;
    assert.equal((await call(`/api/locks/${id}`, { method: 'DELETE', headers: bearer(again) })).status, 204);
  });
});

test('the docs page is served at /api.html, /api and /docs', async () => {
  await withServer(fakeJudge(), async ({ call }) => {
    for (const path of ['/api.html', '/api', '/docs']) {
      const r = await call(path);
      assert.equal(r.status, 200, path);
      assert.match(r.text, /<title>Mellon API<\/title>/);
    }
  });
});
