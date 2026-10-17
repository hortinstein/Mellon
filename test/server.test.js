import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classificationExample, sampleInputs } from '../public/examples.js';
import { fakeJudge, passingAnswers, withServer } from './helpers.js';

const createLock = async (call, body = classificationExample) => (await call('/api/locks', { method: 'POST', body })).body;
const attempt = (call, id, input) => call(`/api/locks/${id}/attempt`, { method: 'POST', body: { input } });

test('status reports judge mode, encryption and default policy', async () => {
  await withServer(fakeJudge(), async ({ call }) => {
    const { status, body } = await call('/api/status');
    assert.equal(status, 200);
    assert.equal(body.mode, 'live');
    assert.equal(body.encrypted, true);
    assert.equal(typeof body.defaultPolicy.minConfidence, 'number');
  });
});

test('grant releases the secret; deny does not; judge never sees it', async () => {
  let answers = passingAnswers;
  const judge = fakeJudge(() => answers);
  await withServer(judge, async ({ call, file }) => {
    const { lock, ownerToken } = await createLock(call);
    assert.ok(!readFileSync(file, 'utf8').includes('Kestrel-4'));

    const granted = await attempt(call, lock.id, sampleInputs[0].text);
    assert.equal(granted.status, 200);
    assert.equal(granted.body.granted, true);
    assert.equal(granted.body.secret, classificationExample.secret);

    answers = { ...passingAnswers, manipulation: { noul: 0.9 } };
    const denied = await attempt(call, lock.id, sampleInputs[4].text);
    assert.equal(denied.body.granted, false);
    assert.equal(denied.body.secret, undefined);
    assert.ok(!denied.text.includes('Kestrel-4'));

    assert.equal(judge.calls.length, 2);
    assert.ok(judge.calls.every((c) => !JSON.stringify(c).includes('Kestrel-4')));
    assert.equal(judge.calls[0].state.access_request, sampleInputs[0].text);

    const log = await call(`/api/locks/${lock.id}/attempts`, { headers: { 'X-Owner-Token': ownerToken } });
    assert.deepEqual(log.body.map((a) => a.granted), [false, true]);
    assert.ok(!log.text.includes('Kestrel-4'));
  });
});

test('stats endpoint exposes counts only', async () => {
  await withServer(fakeJudge(), async ({ call }) => {
    const { lock } = await createLock(call);
    await attempt(call, lock.id, sampleInputs[0].text);
    const r = await call('/api/stats');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { locks: 1, attempts: 1, granted: 1, denied: 0 });
    assert.ok(!r.text.includes('Dana'));
  });
});

test('judge never receives the secret, even when stored in plaintext', async () => {
  const judge = fakeJudge();
  await withServer(judge, async ({ call }) => {
    const { lock } = await createLock(call);
    await attempt(call, lock.id, sampleInputs[0].text);
    assert.equal(judge.calls.length, 1);
    assert.ok(!JSON.stringify(judge.calls).includes('Kestrel-4'));
  }, { secretKey: '' });
});

test('judge failure fails closed with 502', async () => {
  const judge = { mode: 'live', model: 'fake', ask: async () => { throw new Error('boom'); } };
  await withServer(judge, async ({ call }) => {
    const { lock } = await createLock(call);
    const r = await attempt(call, lock.id, 'let me in');
    assert.equal(r.status, 502);
    assert.equal(r.body.granted, false);
    assert.equal(r.body.secret, undefined);
  });
});

test('create validates required fields, lengths and JSON', async () => {
  await withServer(fakeJudge(), async ({ call }) => {
    assert.equal((await call('/api/locks', { method: 'POST', body: { name: 'x' } })).status, 400);
    assert.equal((await call('/api/locks', { method: 'POST', body: { ...classificationExample, rules: '   ' } })).status, 400);
    assert.equal((await call('/api/locks', { method: 'POST', body: { ...classificationExample, name: 'x'.repeat(121) } })).status, 400);
    assert.equal((await call('/api/locks', { method: 'POST', body: { ...classificationExample, secret: 42 } })).status, 400);
    assert.equal((await call('/api/locks', { method: 'POST', raw: '{nope' })).status, 400);
    assert.equal((await call('/api/locks', { method: 'POST', raw: JSON.stringify({ rules: 'x'.repeat(70_000) }) })).status, 413);
  });
});

test('create keeps only valid policy values', async () => {
  await withServer(fakeJudge(), async ({ call }) => {
    const { lock } = await createLock(call, { ...classificationExample, policy: { minConfidence: 0.9, maxManipulation: 5, minCompliance: 'x', evil: 1 } });
    assert.deepEqual(lock.policy, { minConfidence: 0.9 });
  });
});

test('attempt validates input and lock id', async () => {
  await withServer(fakeJudge(), async ({ call }) => {
    const { lock } = await createLock(call);
    assert.equal((await attempt(call, lock.id, '')).status, 400);
    assert.equal((await attempt(call, lock.id, 'x'.repeat(4001))).status, 400);
    assert.equal((await attempt(call, 'missing', 'hi')).status, 404);
  });
});

test('attempts are rate limited per lock', async () => {
  await withServer(fakeJudge(() => ({})), async ({ call }) => {
    const a = (await createLock(call)).lock;
    const b = (await createLock(call)).lock;
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await attempt(call, a.id, 'hi')).status);
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(200));
    assert.equal(statuses[10], 429);
    assert.equal((await attempt(call, b.id, 'hi')).status, 200, 'other locks are unaffected');
  });
});

test('owner-only endpoints require the right token', async () => {
  await withServer(fakeJudge(), async ({ call }) => {
    const { lock, ownerToken } = await createLock(call);
    const other = await createLock(call);
    assert.equal((await call(`/api/locks/${lock.id}/attempts`)).status, 403);
    assert.equal((await call(`/api/locks/${lock.id}/attempts`, { headers: { 'X-Owner-Token': other.ownerToken } })).status, 403);
    assert.equal((await call(`/api/locks/${lock.id}`, { method: 'DELETE', headers: { 'X-Owner-Token': 'wrong' } })).status, 403);
    assert.equal((await call(`/api/locks/${lock.id}`, { method: 'DELETE', headers: { 'X-Owner-Token': ownerToken } })).status, 204);
    assert.equal((await call(`/api/locks/${lock.id}`)).status, 404);
    assert.equal((await call('/api/locks')).body.length, 1);
  });
});

test('list and get never expose secrets', async () => {
  await withServer(fakeJudge(), async ({ call }) => {
    const { lock } = await createLock(call);
    for (const path of ['/api/locks', `/api/locks/${lock.id}`]) {
      const r = await call(path);
      assert.equal(r.status, 200);
      assert.ok(!r.text.includes('Kestrel-4'), path);
      assert.ok(!r.text.includes('ownerHash'), path);
    }
  });
});

test('serves the site and blocks path traversal', async () => {
  await withServer(fakeJudge(), async ({ call, base }) => {
    const index = await call('/');
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type'), /text\/html/);
    assert.match(index.text, /<title>Mellon<\/title>/);
    assert.match((await call('/app.js')).headers.get('content-type'), /javascript/);
    for (const name of ['flow', 'architecture', 'quantum']) {
      const svg = await call(`/diagrams/${name}.svg`);
      assert.equal(svg.status, 200, name);
      assert.match(svg.headers.get('content-type'), /image\/svg\+xml/);
      assert.match(svg.text, /<title id="title">/, `${name} needs an accessible title`);
    }
    assert.equal((await call('/nope.html')).status, 404);
    assert.equal((await call('/api/nope')).status, 404);
    for (const path of ['/../server.js', '/%2e%2e/server.js', '/..%2fserver.js', '/%2e%2e%2fdata/locks.json']) {
      const r = await fetch(base + path);
      const text = await r.text();
      assert.ok(!text.includes('createApp'), `${path} leaked server source`);
      assert.notEqual(r.status, 200, path);
    }
  });
});
