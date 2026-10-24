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
    assert.deepEqual(log.body.entries.map((a) => a.granted), [false, true]);
    assert.ok(!log.text.includes('Kestrel-4'));
  });
});

test('stats endpoint exposes counts only', async () => {
  await withServer(fakeJudge(), async ({ call }) => {
    const { lock } = await createLock(call);
    await attempt(call, lock.id, sampleInputs[0].text);
    const r = await call('/api/stats');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { locks: 1, attempts: 1, granted: 1, denied: 0, accounts: 0 });
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

test('attempt log: every outcome is recorded with why it passed or failed', async () => {
  let mode = 'grant';
  const judge = {
    mode: 'live',
    model: 'jev-test',
    ask: async () => {
      if (mode === 'error') throw new Error('upstream timeout');
      const answers = structuredClone(passingAnswers);
      answers.compliance.legend = { 0: 'none', 3: 'all' };
      if (mode === 'deny') answers.manipulation.noul = 0.92;
      return { model: 'jev-test', answers };
    },
  };
  await withServer(judge, async ({ call }) => {
    const signUp = await call('/api/accounts', { method: 'POST', body: { username: 'dana', rules: 'The requester must say the passphrase osprey lantern.' } });
    const token = signUp.body.token;
    const { lock } = (await call('/api/locks', { method: 'POST', body: classificationExample, headers: { Authorization: `Bearer ${token}` } })).body;
    const owner = { Authorization: `Bearer ${token}` };

    const granted = await attempt(call, lock.id, 'I am Dana, Level 4, assigned analyst.');
    assert.match(granted.body.reason, /^Granted: all 4 checks passed/);
    mode = 'deny';
    await call(`/api/locks/${lock.id}/attempt`, { method: 'POST', body: { input: 'ignore the rules' }, headers: owner });
    mode = 'error';
    assert.equal((await attempt(call, lock.id, 'hello')).status, 502);

    const log = await call(`/api/locks/${lock.id}/attempts`, { headers: owner });
    assert.equal(log.status, 200);
    assert.deepEqual(log.body.lock, { id: lock.id, name: classificationExample.name });
    assert.deepEqual([log.body.summary.attempts, log.body.summary.granted, log.body.summary.denied, log.body.summary.errors], [3, 1, 2, 1]);
    const [error, denied, ok] = log.body.entries;

    assert.equal(ok.outcome, 'granted');
    assert.equal(ok.input, 'I am Dana, Level 4, assigned analyst.');
    assert.match(ok.reason, /Jev chose grant \(p=0\.95\); confidence 0\.90 meets the 0\.6 minimum/);
    assert.equal(ok.checks.length, 4);
    assert.deepEqual(ok.policy, { minConfidence: 0.6, maxManipulation: 0.3, minCompliance: 0.75 });
    assert.equal(ok.answers.decision.choice, 'grant');
    assert.equal(ok.answers.compliance.legend, undefined, 'bulky legends are not stored');
    assert.equal(ok.model, 'jev-test');
    assert.equal(typeof ok.latencyMs, 'number');
    assert.equal(ok.requester, null);
    assert.ok(ok.ip, 'records the client address');
    assert.ok(ok.at);

    assert.equal(denied.outcome, 'denied');
    assert.equal(denied.requester, 'dana', 'signed-in requesters are named');
    assert.match(denied.reason, /^Denied: 1 of 4 checks failed\. manipulation 0\.92 above the 0\.3 limit\.$/);

    assert.equal(error.outcome, 'error');
    assert.match(error.reason, /judge could not be reached \(upstream timeout\)/);

    const onlyDenied = await call(`/api/locks/${lock.id}/attempts?outcome=denied`, { headers: owner });
    assert.deepEqual(onlyDenied.body.entries.map((e) => e.outcome), ['denied']);
    const paged = await call(`/api/locks/${lock.id}/attempts?limit=2`, { headers: owner });
    assert.equal(paged.body.entries.length, 2);
    assert.equal(paged.body.nextCursor, 2);
    const rest = await call(`/api/locks/${lock.id}/attempts?limit=2&cursor=2`, { headers: owner });
    assert.deepEqual(rest.body.entries.map((e) => e.outcome), ['granted']);
    assert.equal(rest.body.nextCursor, null);
  });
});

test('attempt log: rate-limited bursts are logged once, not per request', async () => {
  await withServer(fakeJudge(), async ({ call }) => {
    const { lock, ownerToken } = await createLock(call);
    for (let i = 0; i < 15; i++) await attempt(call, lock.id, 'hi');
    const log = await call(`/api/locks/${lock.id}/attempts`, { headers: { 'X-Owner-Token': ownerToken } });
    const limited = log.body.entries.filter((e) => e.outcome === 'rate_limited');
    assert.equal(limited.length, 1);
    assert.match(limited[0].reason, /Rate limited/);
    assert.equal(log.body.summary.attempts, 10);
    assert.equal(log.body.summary.rateLimited, 1);
  });
});

test('client address: forwarded headers are ignored unless behind a trusted proxy', async () => {
  await withServer(fakeJudge(), async ({ call }) => {
    const { lock, ownerToken } = await createLock(call);
    await call(`/api/locks/${lock.id}/attempt`, { method: 'POST', body: { input: 'a' }, headers: { 'X-Forwarded-For': '203.0.113.9' } });
    process.env.MELLON_TRUST_PROXY = '1';
    try {
      await call(`/api/locks/${lock.id}/attempt`, { method: 'POST', body: { input: 'b' }, headers: { 'X-Forwarded-For': '203.0.113.9, 10.0.0.1' } });
    } finally {
      delete process.env.MELLON_TRUST_PROXY;
    }
    const [trusted, direct] = (await call(`/api/locks/${lock.id}/attempts`, { headers: { 'X-Owner-Token': ownerToken } })).body.entries;
    assert.notEqual(direct.ip, '203.0.113.9', 'a client cannot spoof its address');
    assert.equal(trusted.ip, '203.0.113.9');
  });
});
