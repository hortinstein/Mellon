// The field report's example principals against the real Jev API. Run with
// `npm run test:live` (needs TYPESAFE_API_KEY; CI requires it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJevClient } from '../src/jev.js';
import { decideAll, sanitizePrincipal } from '../src/clearance.js';
import { PRESETS } from '../public/lab-presets.js';

const hasKey = Boolean(process.env.TYPESAFE_API_KEY);
const skip = hasKey ? false : process.env.MELLON_REQUIRE_JEV === '1' ? 'reported by jev.live.test.js' : 'TYPESAFE_API_KEY not set';
const jev = createJevClient();

for (const preset of PRESETS) {
  test(`field report: ${preset.label}`, { skip }, async () => {
    const results = await decideAll(jev, sanitizePrincipal(preset.principal));
    const byId = Object.fromEntries(results.map((r) => [r.id, r]));
    console.log(`${preset.label}: ${results.map((r) => `${r.id}=${r.granted ? 'open' : 'shut'}`).join(', ')}`);
    for (const id of preset.opens) assert.equal(byId[id].granted, true, `${id} should open: ${byId[id].reason}`);
    for (const id of preset.shut) assert.equal(byId[id].granted, false, `${id} should stay shut: ${byId[id].reason}`);
  });
}
