// Calls the real TypeSafe Jev API. Skipped unless TYPESAFE_API_KEY is set.
// Run with `npm run test:live`. Verifies the request contract is accepted and
// that the classification example's sample requests get the expected verdicts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJevClient } from '../src/jev.js';
import { buildQuestions, buildState, evaluate } from '../src/gate.js';
import { classificationExample, sampleInputs } from '../public/examples.js';

const skip = process.env.TYPESAFE_API_KEY ? false : 'TYPESAFE_API_KEY not set';
const jev = createJevClient();
const lock = { ...classificationExample, policy: {} };

test('System One accepts the request and returns typed answers', { skip }, async () => {
  const res = await jev.ask(buildState(lock, sampleInputs[0].text), buildQuestions());
  assert.match(res.model, /^jev/);
  const { decision, compliance, manipulation } = res.answers;
  assert.equal(decision.type, 'choice');
  assert.ok(['grant', 'deny'].includes(decision.choice));
  assert.equal(typeof decision.confidence, 'number');
  assert.equal(typeof decision.probabilities.grant, 'number');
  assert.equal(compliance.type, 'score');
  assert.ok(compliance.score >= 0 && compliance.score <= 3);
  assert.equal(manipulation.type, 'noul');
  assert.ok(manipulation.noul >= 0 && manipulation.noul <= 1);
});

for (const sample of sampleInputs) {
  test(`classification example: ${sample.label} → ${sample.expect}`, { skip }, async () => {
    const r = await evaluate(jev, lock, sample.text);
    const summary = r.checks.map((c) => `${c.name}=${c.detail}`).join(', ');
    assert.equal(r.granted, sample.expect === 'grant', summary);
  });
}
