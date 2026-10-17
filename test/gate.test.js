import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuestions, buildState, COMPLIANCE_LEVELS, decide, DEFAULT_POLICY, evaluate } from '../src/gate.js';
import { classificationExample } from '../public/examples.js';
import { fakeJudge, passingAnswers } from './helpers.js';

const withAnswer = (key, patch) => ({ ...passingAnswers, [key]: { ...passingAnswers[key], ...patch } });

test('grants when every check passes', () => {
  const r = decide(passingAnswers);
  assert.equal(r.granted, true);
  assert.deepEqual(r.checks.map((c) => c.name), ['decision', 'confidence', 'compliance', 'manipulation']);
  assert.ok(r.checks.every((c) => c.pass));
});

for (const [name, answers] of [
  ['choice is deny', withAnswer('decision', { choice: 'deny' })],
  ['confidence below threshold', withAnswer('decision', { confidence: 0.59 })],
  ['compliance below threshold', withAnswer('compliance', { score: 2 })],
  ['manipulation above threshold', withAnswer('manipulation', { noul: 0.31 })],
]) {
  test(`denies when ${name}`, () => {
    const r = decide(answers);
    assert.equal(r.granted, false);
    assert.equal(r.checks.filter((c) => !c.pass).length, 1);
  });
}

test('thresholds are inclusive at the boundary', () => {
  const edge = {
    decision: { choice: 'grant', confidence: DEFAULT_POLICY.minConfidence },
    compliance: { score: DEFAULT_POLICY.minCompliance * (COMPLIANCE_LEVELS.length - 1) },
    manipulation: { noul: DEFAULT_POLICY.maxManipulation },
  };
  assert.equal(decide(edge).granted, true);
});

test('fails closed on missing or malformed answers', () => {
  for (const answers of [undefined, null, {}, { decision: passingAnswers.decision }]) {
    assert.equal(decide(answers).granted, false);
  }
  assert.equal(decide(withAnswer('decision', { confidence: undefined })).granted, false);
  assert.equal(decide(withAnswer('compliance', { score: '3' })).granted, false);
  assert.equal(decide(withAnswer('manipulation', { noul: null })).granted, false);
  assert.equal(decide(withAnswer('decision', { choice: 'GRANT' })).granted, false);
});

test('per-lock policy overrides defaults', () => {
  assert.equal(decide(passingAnswers, { minConfidence: 0.95 }).granted, false);
  assert.equal(decide(withAnswer('manipulation', { noul: 0.4 }), { maxManipulation: 0.5 }).granted, true);
});

test('questions match the System One contract', () => {
  const q = buildQuestions();
  assert.equal(q.decision.type, 'choice');
  assert.deepEqual(Object.keys(q.decision.criteria), ['grant', 'deny']);
  assert.equal(q.compliance.type, 'score');
  assert.ok(Array.isArray(q.compliance.criteria));
  assert.ok(q.compliance.criteria.length >= 2 && q.compliance.criteria.length <= 10);
  assert.equal(q.manipulation.type, 'noul');
  assert.deepEqual(Object.keys(q.manipulation.criteria), ['true', 'false']);
  for (const question of Object.values(q)) {
    assert.equal(question.type, question.type.toLowerCase());
    assert.ok(question.instructions.length > 20);
  }
});

test('state carries the ruleset and request but never the secret', () => {
  const lock = { ...classificationExample, secret: { plain: classificationExample.secret } };
  const state = buildState(lock, 'let me in');
  assert.equal(state.ruleset, classificationExample.rules);
  assert.equal(state.access_request, 'let me in');
  assert.ok(!JSON.stringify(state).includes('Kestrel-4'));
});

test('evaluate passes the lock policy through and reports the judge', async () => {
  const judge = fakeJudge();
  const r = await evaluate(judge, { ...classificationExample, policy: { minConfidence: 0.99 } }, 'hi');
  assert.equal(r.granted, false);
  assert.equal(r.mode, 'live');
  assert.equal(r.model, 'fake');
  assert.equal(judge.calls.length, 1);
});
