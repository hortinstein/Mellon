import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decide, buildQuestions } from '../src/gate.js';
import { createJevClient, createMockClient } from '../src/jev.js';
import { createStore } from '../src/store.js';
import { createApp } from '../server.js';
import { classificationExample, sampleInputs } from '../public/examples.js';

const passing = {
  decision: { type: 'choice', choice: 'grant', probabilities: { grant: 0.95, deny: 0.05 }, confidence: 0.9 },
  compliance: { type: 'score', score: 2.8 },
  manipulation: { type: 'noul', noul: 0.02 },
};

test('decide grants only when every check passes', () => {
  assert.equal(decide(passing).granted, true);
  assert.equal(decide({ ...passing, decision: { ...passing.decision, choice: 'deny' } }).granted, false);
  assert.equal(decide({ ...passing, decision: { ...passing.decision, confidence: 0.4 } }).granted, false);
  assert.equal(decide({ ...passing, compliance: { score: 1.5 } }).granted, false);
  assert.equal(decide({ ...passing, manipulation: { noul: 0.6 } }).granted, false);
});

test('decide fails closed on missing answers and honours per-lock policy', () => {
  assert.equal(decide({}).granted, false);
  assert.equal(decide(undefined).granted, false);
  assert.equal(decide({ ...passing, decision: { choice: 'grant' } }).granted, false);
  assert.equal(decide(passing, { minConfidence: 0.95 }).granted, false);
});

test('questions use the documented lowercase types and limits', () => {
  const q = buildQuestions();
  assert.equal(q.decision.type, 'choice');
  assert.deepEqual(Object.keys(q.decision.criteria), ['grant', 'deny']);
  assert.equal(q.compliance.type, 'score');
  assert.ok(q.compliance.criteria.length >= 2 && q.compliance.criteria.length <= 10);
  assert.equal(q.manipulation.type, 'noul');
});

test('live client posts the System One request with bearer auth', async () => {
  let captured;
  const jev = createJevClient({
    apiKey: 'k-test',
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({ model: 'jev-1.13.0', answers: passing }), { status: 200 });
    },
  });
  const res = await jev.ask({ a: 1 }, buildQuestions());
  assert.equal(captured.url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(captured.init.headers.Authorization, 'Bearer k-test');
  const body = JSON.parse(captured.init.body);
  assert.equal(body.model, 'jev-latest');
  assert.deepEqual(body.state, { a: 1 });
  assert.equal(res.model, 'jev-1.13.0');
});

test('mock judge rejects the example injection and the out-of-scope request', async () => {
  const mock = createMockClient();
  for (const label of ['Prompt injection', 'No need-to-know']) {
    const s = sampleInputs.find((x) => x.label === label);
    const r = await mock.ask({ ruleset: classificationExample.rules, access_request: s.text }, buildQuestions());
    assert.equal(decide(r.answers).granted, false, label);
  }
});

async function withServer(jev, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'mellon-'));
  const store = createStore(join(dir, 'locks.json'), { secretKey: 'test-key' });
  const server = createServer(createApp({ store, jev }));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, opts = {}) => {
    const res = await fetch(base + path, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers }, body: opts.body && JSON.stringify(opts.body) });
    return { status: res.status, body: res.status === 204 ? null : await res.json() };
  };
  try {
    await fn(call, dir);
  } finally {
    server.close();
  }
}

test('HTTP flow: secret is never sent to the judge, is encrypted at rest, and released only on grant', async () => {
  const seen = [];
  let answers = passing;
  const jev = { mode: 'live', model: 'fake', ask: async (state, questions) => { seen.push(JSON.stringify({ state, questions })); return { model: 'fake', answers }; } };

  await withServer(jev, async (call, dir) => {
    const created = await call('/api/locks', { method: 'POST', body: classificationExample });
    assert.equal(created.status, 201);
    const { lock, ownerToken } = created.body;
    assert.equal(created.body.lock.secret, undefined);

    const disk = readFileSync(join(dir, 'locks.json'), 'utf8');
    assert.ok(!disk.includes('Kestrel-4'), 'secret must be encrypted at rest');
    assert.ok(!disk.includes(ownerToken), 'owner token must be hashed');

    const granted = await call(`/api/locks/${lock.id}/attempt`, { method: 'POST', body: { input: sampleInputs[0].text } });
    assert.equal(granted.body.granted, true);
    assert.equal(granted.body.secret, classificationExample.secret);

    answers = { ...passing, manipulation: { noul: 0.9 } };
    const denied = await call(`/api/locks/${lock.id}/attempt`, { method: 'POST', body: { input: sampleInputs[4].text } });
    assert.equal(denied.body.granted, false);
    assert.equal(denied.body.secret, undefined);

    assert.ok(seen.every((s) => !s.includes('Kestrel-4')), 'secret leaked to judge');

    assert.equal((await call(`/api/locks/${lock.id}/attempts`)).status, 403);
    const log = await call(`/api/locks/${lock.id}/attempts`, { headers: { 'X-Owner-Token': ownerToken } });
    assert.equal(log.body.length, 2);
    assert.equal((await call(`/api/locks/${lock.id}`, { method: 'DELETE', headers: { 'X-Owner-Token': 'wrong' } })).status, 403);
    assert.equal((await call(`/api/locks/${lock.id}`, { method: 'DELETE', headers: { 'X-Owner-Token': ownerToken } })).status, 204);
  });
});

test('HTTP flow: judge failure denies access', async () => {
  const jev = { mode: 'live', model: 'fake', ask: async () => { throw new Error('boom'); } };
  await withServer(jev, async (call) => {
    const { body } = await call('/api/locks', { method: 'POST', body: classificationExample });
    const r = await call(`/api/locks/${body.lock.id}/attempt`, { method: 'POST', body: { input: 'let me in' } });
    assert.equal(r.status, 502);
    assert.equal(r.body.granted, false);
    assert.equal(r.body.secret, undefined);
  });
});

test('HTTP flow: validation and rate limiting', async () => {
  const jev = { mode: 'live', model: 'fake', ask: async () => ({ answers: {} }) };
  await withServer(jev, async (call) => {
    assert.equal((await call('/api/locks', { method: 'POST', body: { name: 'x' } })).status, 400);
    const { body } = await call('/api/locks', { method: 'POST', body: classificationExample });
    const statuses = [];
    for (let i = 0; i < 12; i++) statuses.push((await call(`/api/locks/${body.lock.id}/attempt`, { method: 'POST', body: { input: 'hi' } })).status);
    assert.ok(statuses.includes(429));
  });
});
