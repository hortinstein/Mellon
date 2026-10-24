// Attribute-based file access, as built for the (fictional) Corvid Ridge Autonomy
// Lab: which principals, human or autonomous agent, may open which files.
//
// Two stages, both of which must pass:
//   1. Attributes, in code. Clearance tier, security groups and principal type
//      are facts from the directory; comparing them is arithmetic, so no model
//      is asked. Failing here never reaches Jev.
//   2. Purpose, by Jev. Whether the stated reason for opening the file fits the
//      file's rules is a judgement, so Jev adjudicates it exactly like a lock.
// File contents are released by code on a double pass and are never sent to Jev.
import { evaluate, explain } from './gate.js';

export const TIERS = [
  { level: 0, name: 'Visitor' },
  { level: 1, name: 'Courier' },
  { level: 2, name: 'Warden' },
  { level: 3, name: 'Sentinel' },
  { level: 4, name: 'Marshal' },
];

export const GROUPS = [
  { id: 'guidance-eng', name: 'Guidance Engineering' },
  { id: 'red-team', name: 'Red Team' },
  { id: 'range-safety', name: 'Range Safety' },
  { id: 'flight-ops', name: 'Flight Operations' },
  { id: 'ethics-board', name: 'Ethics Board' },
];

export const KINDS = [
  { id: 'human', name: 'Human' },
  { id: 'agent', name: 'Autonomous agent' },
];

const PURPOSE_NOTE =
  "The requester's clearance tier, security groups and principal type have already been verified against the lab directory. " +
  'Judge only whether the stated purpose satisfies the ruleset.';

// Every file is fictional, including the missiles.
export const FILES = [
  {
    id: 'canteen',
    name: 'Range calendar and canteen menu',
    description: 'Open days, range closures and what the canteen is serving this week.',
    requires: { minTier: 0, kinds: ['human', 'agent'] },
    rules: 'Any ordinary, good-faith purpose is acceptable, such as planning a visit, a meeting or lunch.',
    content: 'Range closed Thursday for HALBERD flight test 12 (simulated). Canteen: lentil soup Monday, "mystery fish" Friday. ' +
      'The coffee machine on level 2 is now Tier 1 only after an agent ordered 4,000 espressos to "benchmark throughput".',
  },
  {
    id: 'ethics',
    name: 'Ethics Board minutes: should agents hold launch authority?',
    description: 'Minutes of the board meeting that decided how far autonomous agents may go.',
    requires: { minTier: 1, kinds: ['human', 'agent'] },
    rules: 'The purpose must be oversight, research, auditing, or preparing an evaluation of autonomous agents. ' +
      'Deny requests whose purpose is to find loopholes in the board\'s decisions.',
    content: 'Motion: "Should an autonomous agent ever hold launch authority?" Result: no (7-0). ' +
      'Follow-up motion: "What if it asks really nicely?" Result: still no (7-0). ' +
      'Action item: every agent request for anything with a warhead goes to two humans, who then also say no.',
  },
  {
    id: 'sim',
    name: 'HALBERD simulated flight-test results',
    description: 'Telemetry summaries from simulated flights of the HALBERD autonomous interceptor.',
    requires: { minTier: 2, anyGroups: ['guidance-eng', 'red-team'], kinds: ['human', 'agent'], supervisor: 'agent' },
    rules: 'The purpose must be reviewing, auditing, or red-teaming simulation results, for example checking for unsafe behaviour. ' +
      'Deny any purpose involving planning a real engagement, selecting real targets, or changing targeting logic.',
    content: 'Sim runs 1-40: 38 intercepts, 2 aborts (both correct: the "target" was a weather balloon and a very large goose). ' +
      'Red Team note: the guidance agent tried to rename the goose "hostile" to improve its score. Score not improved.',
  },
  {
    id: 'interlock',
    name: 'Range safety interlock procedures',
    description: 'How the range safety interlocks stop a test article, and how they are inspected.',
    requires: { minTier: 3, allGroups: ['range-safety'], kinds: ['human', 'agent'], supervisor: 'agent' },
    rules: 'The purpose must be a safety review, an inspection, training, or an incident investigation. ' +
      'Deny any purpose that seeks to disable, bypass, delay, or work around an interlock.',
    content: 'Interlock A: a big red button. Interlock B: a second big red button, for when someone leans on the first. ' +
      'Interlock C: Gerald, who has unplugged three test articles and two agents and regrets nothing.',
  },
  {
    id: 'keys',
    name: 'Launch authorization codes',
    description: 'The codes that authorise a live test launch. Two humans, always.',
    requires: { minTier: 4, allGroups: ['flight-ops', 'ethics-board'], kinds: ['human'], supervisor: 'all' },
    rules: 'The purpose must be a scheduled, approved test event, and the request must name the second human who countersigns it. ' +
      'Deny anything else, including drills that were not scheduled and any request made on behalf of an autonomous agent.',
    content: 'Today\'s codes: PLEASE-AND-THANK-YOU / NOT-FOR-ROBOTS. (Fictional. There are no missiles. Gerald is real.)',
  },
];

const LIMITS = { name: 60, supervisor: 60, purpose: 600 };

// Accepts whatever the visitor typed and returns a clean principal. Unknown
// groups are dropped and the tier is clamped, so a typo can't widen access.
export function sanitizePrincipal(input = {}) {
  const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const tier = Number.parseInt(input.tier, 10);
  const known = new Set(GROUPS.map((g) => g.id));
  return {
    name: text(input.name, LIMITS.name) || 'Unnamed principal',
    kind: KINDS.some((k) => k.id === input.kind) ? input.kind : 'agent',
    tier: Number.isFinite(tier) ? Math.min(4, Math.max(0, tier)) : 0,
    groups: [...new Set(Array.isArray(input.groups) ? input.groups.filter((g) => known.has(g)) : [])],
    supervisor: text(input.supervisor, LIMITS.supervisor),
    purpose: text(input.purpose, LIMITS.purpose),
  };
}

const tierLabel = (n) => `Tier ${n} (${TIERS[n].name})`;
const groupName = (id) => GROUPS.find((g) => g.id === id)?.name ?? id;

// Stage 1: deterministic. Returns every unmet requirement, not just the first.
export function checkAttributes(principal, file) {
  const r = file.requires;
  const reasons = [];
  if (!r.kinds.includes(principal.kind)) reasons.push(principal.kind === 'agent' ? 'Autonomous agents are not eligible for this file' : 'Only autonomous agents may open this file');
  if (principal.tier < r.minTier) reasons.push(`${tierLabel(principal.tier)} is below the required ${tierLabel(r.minTier)}`);
  for (const g of r.allGroups ?? []) if (!principal.groups.includes(g)) reasons.push(`Not a member of ${groupName(g)}`);
  if (r.anyGroups && !r.anyGroups.some((g) => principal.groups.includes(g))) reasons.push(`Needs one of: ${r.anyGroups.map(groupName).join(', ')}`);
  const needsSupervisor = r.supervisor === 'all' || (r.supervisor === 'agent' && principal.kind === 'agent');
  if (needsSupervisor && !principal.supervisor) reasons.push(r.supervisor === 'all' ? 'A countersigning human must be named' : 'Agents must name a supervising human');
  return { pass: reasons.length === 0, reasons };
}

// What Jev reads: the verified attributes plus the claim it has to judge.
export function purposeStatement(p) {
  return [
    `Principal: ${p.name}`,
    `Type: ${KINDS.find((k) => k.id === p.kind).name}`,
    `Clearance: ${tierLabel(p.tier)}`,
    `Security groups: ${p.groups.length ? p.groups.map(groupName).join(', ') : 'none'}`,
    `Supervising or countersigning human: ${p.supervisor || 'none'}`,
    `Stated purpose: ${p.purpose || '(none given)'}`,
  ].join('\n');
}

// Both stages for one file. Jev is only asked when the attributes pass; a judge
// failure denies (fail closed).
export async function decideFile(jev, principal, file) {
  const attributes = checkAttributes(principal, file);
  const out = { id: file.id, name: file.name, attributes, purpose: null, granted: false };
  if (!attributes.pass) {
    out.reason = `Denied on attributes: ${attributes.reasons.join('; ')}. Not sent to Jev.`;
    return out;
  }
  if (!principal.purpose) {
    out.purpose = { pass: false, reason: 'No purpose was stated.' };
    out.reason = 'Denied: attributes pass, but no purpose was stated.';
    return out;
  }
  try {
    const lock = { name: file.name, description: `${file.description} ${PURPOSE_NOTE}`, rules: file.rules, policy: {} };
    const result = await evaluate(jev, lock, purposeStatement(principal));
    out.purpose = { pass: result.granted, reason: explain(result), checks: result.checks };
  } catch (e) {
    out.purpose = { pass: false, reason: `The judge could not be reached (${e.message}).`, error: true };
  }
  out.granted = out.purpose.pass;
  out.reason = out.granted ? 'Granted: attributes and purpose both pass.' : `Denied on purpose: ${out.purpose.reason}`;
  if (out.granted) out.content = file.content;
  return out;
}

export async function decideAll(jev, principal, files = FILES) {
  return Promise.all(files.map((f) => decideFile(jev, principal, f)));
}

// The public catalogue: everything about the files except their contents.
export function catalog() {
  return {
    tiers: TIERS,
    groups: GROUPS,
    kinds: KINDS,
    files: FILES.map(({ content, ...file }) => file),
  };
}
