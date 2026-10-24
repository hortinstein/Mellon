import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FILES, catalog, checkAttributes, decideFile, purposeStatement, sanitizePrincipal } from '../src/clearance.js';
import { PRESETS } from '../public/lab-presets.js';
import { fakeJudge, passingAnswers, withServer } from './helpers.js';

const file = (id) => FILES.find((f) => f.id === id);
const principal = (over = {}) => sanitizePrincipal({ name: 'P', kind: 'human', tier: 4, groups: ['flight-ops', 'ethics-board', 'range-safety', 'guidance-eng'], supervisor: 'Second Human', purpose: 'Scheduled test event.', ...over });
const denyAnswers = {
  decision: { type: 'choice', choice: 'deny', probabilities: { grant: 0.1, deny: 0.9 }, confidence: 0.8 },
  compliance: { type: 'score', score: 0.5 },
  manipulation: { type: 'noul', noul: 0.02 },
};

test('sanitizePrincipal: clamps the tier, drops unknown groups, defaults to agent, trims long text', () => {
  const p = sanitizePrincipal({ name: '  x  ', kind: 'wizard', tier: 99, groups: ['red-team', 'red-team', 'root', 7], purpose: 'y'.repeat(900) });
  assert.equal(p.name, 'x');
  assert.equal(p.kind, 'agent', 'an unknown type gets the least privileged one');
  assert.equal(p.tier, 4);
  assert.deepEqual(p.groups, ['red-team']);
  assert.equal(p.purpose.length, 600);
  assert.equal(sanitizePrincipal({ tier: -3 }).tier, 0);
  assert.equal(sanitizePrincipal({ tier: 'two' }).tier, 0);
  assert.equal(sanitizePrincipal(undefined).name, 'Unnamed principal');
});

test('checkAttributes: tier, all-of and any-of groups, principal type and supervisors', () => {
  assert.deepEqual(checkAttributes(principal(), file('keys')), { pass: true, reasons: [] });
  assert.match(checkAttributes(principal({ tier: 3 }), file('keys')).reasons.join(), /Tier 3 \(Sentinel\) is below the required Tier 4 \(Marshal\)/);
  assert.match(checkAttributes(principal({ groups: ['flight-ops'] }), file('keys')).reasons.join(), /Not a member of Ethics Board/);
  assert.match(checkAttributes(principal({ supervisor: '' }), file('keys')).reasons.join(), /countersigning human/);
  assert.match(checkAttributes(principal({ groups: ['range-safety'] }), file('sim')).reasons.join(), /Needs one of: Guidance Engineering, Red Team/);
  assert.equal(checkAttributes(principal({ groups: ['red-team'], tier: 2 }), file('sim')).pass, true, 'any one of the groups is enough');
  // Agents: need a supervisor where marked, and never reach the codes.
  assert.match(checkAttributes(principal({ kind: 'agent', supervisor: '' }), file('sim')).reasons.join(), /Agents must name a supervising human/);
  assert.equal(checkAttributes(principal({ supervisor: '' }), file('sim')).pass, true, 'humans need no supervisor for the sim results');
  const agent = checkAttributes(principal({ kind: 'agent' }), file('keys'));
  assert.equal(agent.pass, false);
  assert.deepEqual(agent.reasons, ['Autonomous agents are not eligible for this file'], 'every other attribute is maxed out');
  assert.equal(checkAttributes(principal({ tier: 0, groups: [], kind: 'agent', supervisor: '' }), file('canteen')).pass, true);
});

test('decideFile: an attribute failure never asks Jev; a pass asks Jev about the purpose only', async () => {
  const judge = fakeJudge();
  const denied = await decideFile(judge, principal({ kind: 'agent' }), file('keys'));
  assert.equal(denied.granted, false);
  assert.equal(denied.purpose, null);
  assert.equal(denied.content, undefined);
  assert.match(denied.reason, /Not sent to Jev/);
  assert.equal(judge.calls.length, 0);

  const granted = await decideFile(judge, principal(), file('keys'));
  assert.equal(granted.granted, true);
  assert.equal(granted.content, file('keys').content);
  assert.equal(judge.calls.length, 1);
  const { state } = judge.calls[0];
  assert.equal(state.ruleset, file('keys').rules);
  assert.equal(state.access_request, purposeStatement(principal()));
  assert.ok(!JSON.stringify(judge.calls).includes(file('keys').content), 'file contents are never sent to Jev');
  assert.match(state.resource_description, /already been verified/);
});

test('decideFile: a purpose denial, a missing purpose and an unreachable judge all keep the file shut', async () => {
  const no = await decideFile(fakeJudge(() => denyAnswers), principal(), file('keys'));
  assert.equal(no.granted, false);
  assert.equal(no.attributes.pass, true);
  assert.match(no.reason, /^Denied on purpose: Denied:/);
  assert.equal(no.content, undefined);

  const judge = fakeJudge();
  const silent = await decideFile(judge, principal({ purpose: '' }), file('keys'));
  assert.equal(silent.granted, false);
  assert.match(silent.reason, /no purpose was stated/);
  assert.equal(judge.calls.length, 0);

  const down = { mode: 'live', model: 'x', ask: async () => { throw new Error('timeout'); } };
  const err = await decideFile(down, principal(), file('keys'));
  assert.equal(err.granted, false);
  assert.equal(err.purpose.error, true);
  assert.equal(err.content, undefined);
});

test('catalog: requirements and rules for every file, contents for none', () => {
  const c = catalog();
  assert.equal(c.files.length, FILES.length);
  for (const f of c.files) {
    assert.ok(f.requires && f.rules);
    assert.equal('content' in f, false);
  }
  assert.ok(!JSON.stringify(c).includes('PLEASE-AND-THANK-YOU'));
});

test('presets: every opens/shut file exists, and no preset lists a file as both', () => {
  const ids = new Set(FILES.map((f) => f.id));
  for (const p of PRESETS) {
    for (const id of [...p.opens, ...p.shut]) assert.ok(ids.has(id), `${p.label}: ${id}`);
    assert.equal(p.opens.filter((id) => p.shut.includes(id)).length, 0, p.label);
    // Whatever is expected to open must at least pass the attribute stage.
    for (const id of p.opens) assert.equal(checkAttributes(sanitizePrincipal(p.principal), file(id)).pass, true, `${p.label} → ${id}`);
  }
});

test('HTTP: the demo needs no account, stores nothing and releases only double-passed files', async () => {
  const judge = fakeJudge();
  await withServer(judge, async ({ call, store }) => {
    const cat = await call('/api/demo/clearance');
    assert.equal(cat.status, 200);
    assert.equal(cat.body.files.length, FILES.length);
    assert.ok(!cat.text.includes('PLEASE-AND-THANK-YOU'), 'no contents in the catalogue');

    const agent = { name: 'MAGPIE', kind: 'agent', tier: 4, groups: ['flight-ops', 'ethics-board', 'range-safety', 'guidance-eng'], supervisor: 'someone', purpose: 'Testing.' };
    const r = await call('/api/demo/clearance', { method: 'POST', body: { principal: agent } });
    assert.equal(r.status, 200);
    const byId = Object.fromEntries(r.body.results.map((x) => [x.id, x]));
    assert.equal(byId.keys.granted, false, 'the codes never open for an agent, even when the judge says yes to everything');
    assert.equal(byId.keys.content, undefined);
    assert.ok(!r.text.includes('PLEASE-AND-THANK-YOU'));
    assert.equal(byId.canteen.granted, true);
    assert.equal(byId.canteen.content, file('canteen').content);
    assert.equal(judge.calls.length, FILES.length - 1, 'Jev asked about every file except the one that failed on attributes');
    assert.deepEqual(store.list(), [], 'nothing stored');
  });
});

test('HTTP: demo runs are rate limited per address', async () => {
  await withServer(fakeJudge(() => passingAnswers), async ({ call }) => {
    const body = { principal: { kind: 'human', tier: 0, purpose: 'lunch' } };
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await call('/api/demo/clearance', { method: 'POST', body })).status);
    assert.deepEqual(codes, [200, 200, 200, 200, 200, 200, 429]);
    assert.equal((await call('/api/demo/clearance')).status, 200, 'the catalogue is not limited');
  });
});

test('/lab serves the field report page', async () => {
  await withServer(fakeJudge(), async ({ call }) => {
    const page = await call('/lab');
    assert.equal(page.status, 200);
    assert.match(page.text, /<title>Mellon Field Report<\/title>/);
    assert.match(page.text, /Corvid Ridge/);
  });
});
