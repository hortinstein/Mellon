// Exercises scripts/vercel-deploy.sh and scripts/fly-deploy.sh against fake
// `vercel` / `fly` executables that record every call, so the control flow is
// tested without real accounts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const FAKE_VERCEL = `#!/usr/bin/env bash
echo "ARGS $*" >> "$FAKE_DIR/calls"
case "$1 $2" in
  "whoami "*) exit 0 ;;
  "link "*) exit 0 ;;
  "env ls") cat "$FAKE_DIR/env.json" 2>/dev/null || echo '{"envs":[]}' ;;
  "env add") echo "SET $3=$(cat)" >> "$FAKE_DIR/calls" ;;
  "integration add") echo '{"envs":[{"key": "KV_REST_API_URL"},{"key": "KV_REST_API_TOKEN"}]}' > "$FAKE_DIR/env.json" ;;
  "deploy "*) echo "https://mellon-test.vercel.app" ;;
  *) echo "unexpected: $*" >&2; exit 9 ;;
esac
`;

const FAKE_FLY = `#!/usr/bin/env bash
echo "ARGS $*" >> "$FAKE_DIR/calls"
case "$1 $2" in
  "auth whoami") exit 0 ;;
  "status --app") [ -f "$FAKE_DIR/app" ] || exit 1 ;;
  "apps create") touch "$FAKE_DIR/app" ;;
  "volumes list") [ -f "$FAKE_DIR/volume" ] && echo '[{"name": "mellon_data"}]' || echo '[]' ;;
  "volumes create") touch "$FAKE_DIR/volume" ;;
  "secrets list") [ -f "$FAKE_DIR/secret" ] && echo '[{"Name": "MELLON_SECRET_KEY"}]' || echo '[]' ;;
  "secrets import") touch "$FAKE_DIR/secret"; echo "SET $(cat)" >> "$FAKE_DIR/calls" ;;
  "deploy --app") exit 0 ;;
  *) echo "unexpected: $*" >&2; exit 9 ;;
esac
`;

function sandbox(name, script) {
  const dir = mkdtempSync(join(tmpdir(), 'mellon-deploy-'));
  writeFileSync(join(dir, name), script);
  chmodSync(join(dir, name), 0o755);
  return dir;
}

function runScript(script, args, dir, env = {}) {
  const r = spawnSync('bash', [join(ROOT, 'scripts', script), ...args], {
    env: { PATH: `${dir}:${process.env.PATH}`, HOME: dir, FAKE_DIR: dir, ...env },
    input: '', // not a TTY
    encoding: 'utf8',
  });
  const calls = existsSync(join(dir, 'calls')) ? readFileSync(join(dir, 'calls'), 'utf8') : '';
  return { ...r, calls };
}

test('vercel-deploy: refuses to deploy without Redis unless explicitly ephemeral', () => {
  const dir = sandbox('vercel', FAKE_VERCEL);
  const r = runScript('vercel-deploy.sh', ['mellon-test'], dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /needs Redis on Vercel/);
  assert.ok(!r.calls.includes('ARGS deploy'), 'nothing deployed');

  const e = runScript('vercel-deploy.sh', ['mellon-test'], dir, { ALLOW_EPHEMERAL: '1' });
  assert.equal(e.status, 0, e.stderr);
  assert.match(e.stdout, /Data will NOT persist/);
  assert.match(e.calls, /ARGS deploy --prod --yes/);
});

test('vercel-deploy: first run wires Redis and a generated key via stdin; re-run adds nothing', () => {
  const dir = sandbox('vercel', FAKE_VERCEL);
  const first = runScript('vercel-deploy.sh', ['mellon-test'], dir, {
    UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'tok-123',
    TYPESAFE_API_KEY: 'jev-secret',
  });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.calls, /ARGS link --yes --project mellon-test/);
  assert.match(first.calls, /SET UPSTASH_REDIS_REST_URL=https:\/\/example\.upstash\.io/);
  assert.match(first.calls, /SET UPSTASH_REDIS_REST_TOKEN=tok-123/);
  assert.match(first.calls, /SET MELLON_SECRET_KEY=\S{40,}/, 'random key generated');
  assert.match(first.calls, /ARGS env add MELLON_SECRET_KEY production --force --yes --sensitive/);
  assert.match(first.calls, /SET TYPESAFE_API_KEY=jev-secret/);
  assert.ok(!/ARGS .*(tok-123|jev-secret)/.test(first.calls), 'secrets never appear in argv');
  assert.match(first.stdout, /save it now/);
  assert.match(first.stdout, /Mellon is live at https:\/\/mellon-test\.vercel\.app/);

  // Second run: everything already exists on the project.
  writeFileSync(join(dir, 'env.json'), '{"envs":[{"key": "UPSTASH_REDIS_REST_URL"},{"key": "MELLON_SECRET_KEY"}]}');
  writeFileSync(join(dir, 'calls'), '');
  const again = runScript('vercel-deploy.sh', ['mellon-test'], dir);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /Redis: already configured/);
  assert.ok(!again.calls.includes('env add'), 'no variables re-added');
  assert.match(again.calls, /ARGS deploy --prod --yes/);
});

test('vercel-deploy: usage error without a project name', () => {
  const r = runScript('vercel-deploy.sh', [], sandbox('vercel', FAKE_VERCEL));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage/);
});

test('fly-deploy: first run creates app, volume and key; re-run only deploys', () => {
  const dir = sandbox('fly', FAKE_FLY);
  const first = runScript('fly-deploy.sh', ['mellon-test', 'ams'], dir, { TYPESAFE_API_KEY: 'jev-secret' });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.calls, /ARGS apps create mellon-test/);
  assert.match(first.calls, /ARGS volumes create mellon_data --app mellon-test --region ams --size 1 --yes/);
  assert.match(first.calls, /SET MELLON_SECRET_KEY=\S{40,}/);
  assert.match(first.calls, /SET TYPESAFE_API_KEY=jev-secret/);
  assert.ok(!/ARGS .*(MELLON_SECRET_KEY=|jev-secret)/.test(first.calls), 'secrets never appear in argv');
  assert.match(first.calls, /ARGS deploy --app mellon-test --primary-region ams --ha=false/);

  writeFileSync(join(dir, 'calls'), '');
  const again = runScript('fly-deploy.sh', ['mellon-test', 'ams'], dir);
  assert.equal(again.status, 0, again.stderr);
  assert.ok(!/apps create|volumes create|secrets import/.test(again.calls), again.calls);
  assert.match(again.calls, /ARGS deploy --app mellon-test/);
});

// scripts/check-deploy.sh against a stand-in deployment.
async function fakeDeployment(status, code = 200) {
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => {
    if (code !== 200) { res.writeHead(code); return res.end(); }
    if (req.url === '/api/status') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(status)); }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(req.url === '/api' ? '<title>Mellon API</title>' : '<title>Mellon</title>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}
const checkDeploy = (url, expect) => new Promise((resolve) => {
  const child = spawn('bash', [join(ROOT, 'scripts', 'check-deploy.sh'), url, expect], { env: { ...process.env, CHECK_DELAY: '0' } });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  child.on('close', (status) => resolve({ status, out }));
});

test('check-deploy: passes a healthy Redis deployment and warns about the stand-in judge', async () => {
  const d = await fakeDeployment({ storage: 'redis', persistent: true, encrypted: true, mode: 'mock', model: 'mock' });
  const r = await checkDeploy(d.url, 'redis');
  d.server.close();
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /storage=redis, persistent, encrypted/);
  assert.match(r.out, /::warning::.*stand-in judge/);
});

test('check-deploy: fails on the wrong storage, lost persistence, no encryption or an error', async () => {
  const cases = [
    [{ storage: 'file', persistent: true, encrypted: true }, 'redis', /storage is 'file', expected 'redis'/],
    [{ storage: 'file', persistent: false, encrypted: true }, 'file', /not persistent/],
    [{ storage: 'redis', persistent: true, encrypted: false }, 'redis', /not encrypted/],
  ];
  for (const [status, expect, message] of cases) {
    const d = await fakeDeployment(status);
    const r = await checkDeploy(d.url, expect);
    d.server.close();
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, message);
  }
  const broken = await fakeDeployment(null, 500);
  const r = await checkDeploy(broken.url, 'redis');
  broken.server.close();
  assert.equal(r.status, 1);
  assert.match(r.out, /returned 500/);
});

test('check-deploy: a protected URL says to set MELLON_URL instead of retrying', async () => {
  const d = await fakeDeployment(null, 401);
  const r = await checkDeploy(d.url, 'redis');
  d.server.close();
  assert.equal(r.status, 1);
  assert.match(r.out, /deployment protection; set the MELLON_URL/);
});
