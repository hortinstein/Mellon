#!/usr/bin/env node
// Mellon file gate for Windows.
//
//   node cli.js setup                                   create a Mellon lock per policy file
//   node cli.js check --file <path> --purpose "<why>" [--user <upn> | --local <name>]
//   node cli.js open  --file <path> --purpose "<why>" [--user <upn> | --local <name>]
//   node cli.js sweep                                   revoke expired grants (Task Scheduler, every minute)
//
// Without --user/--local the identity is this process's own logon token (good
// for trying it out). In production a front end that has already authenticated
// the caller (IIS with Windows Authentication, a signed request, …) passes
// --user, and the gate runs as the service account that owns the files.
//
// Options: --policy <file> (default ./policy.json), --ledger <file> (default ./grants.json)
// Environment: MELLON_URL (default http://localhost:3000), MELLON_TOKEN (session token; needed for setup)
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decide, ledger, loadPolicy, mellonClient } from './gate.js';
import * as windows from './windows.js';

const HERE = dirname(fileURLToPath(import.meta.url));

export async function main(argv, { run = windows.defaultRunner, fetchImpl = globalThis.fetch, env = process.env, log = console.log, now = Date.now } = {}) {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      policy: { type: 'string', default: join(HERE, 'policy.json') },
      ledger: { type: 'string', default: join(HERE, 'grants.json') },
      file: { type: 'string' },
      purpose: { type: 'string' },
      user: { type: 'string' },
      local: { type: 'string' },
    },
  });
  const command = positionals[0];
  const policy = loadPolicy(values.policy);
  const mellon = mellonClient({ url: env.MELLON_URL || 'http://localhost:3000', token: env.MELLON_TOKEN, fetchImpl });
  const grants = ledger(values.ledger);

  if (command === 'setup') {
    if (!env.MELLON_TOKEN) throw new Error('Set MELLON_TOKEN to a Mellon session token so the locks belong to your account.');
    for (const [path, file] of Object.entries(policy.files)) {
      if (file.lockId) continue;
      const { lock } = await mellon.createLock({ path, ...file });
      file.lockId = lock.id;
      log(`lock ${lock.id}  ${path}`);
    }
    writeFileSync(values.policy, `${JSON.stringify(policy, null, 2)}\n`);
    return 0;
  }

  if (command === 'sweep') {
    const closed = await grants.sweep((path, account) => windows.revokeRead(path, account, run), now());
    for (const g of closed) log(`revoked  ${g.account}  ${g.path}`);
    return 0;
  }

  if (command !== 'check' && command !== 'open') {
    log('usage: node cli.js <setup | check | open | sweep> [--file <path> --purpose "<why>"] [--user <upn> | --local <name>]');
    return 2;
  }
  if (!values.file) throw new Error('--file is required');

  const identity = values.user ? await windows.domainUserGroups(values.user, run)
    : values.local ? await windows.localUserGroups(values.local, run)
      : await windows.currentUserGroups(run);

  const result = await decide({ identity, policy, requested: values.file, purpose: values.purpose, mellon });
  log(`${result.granted ? 'GRANTED' : 'DENIED'}  ${identity.account}  ${result.file?.path ?? values.file}`);
  if (result.attrs) log(`  tier ${result.attrs.tier}; ${result.attrs.groups.length} groups from Windows`);
  for (const r of result.reasons ?? []) log(`  ${result.stage}: ${r}`);
  if (result.verdict?.checks) for (const c of result.verdict.checks) log(`  ${c.pass ? 'pass' : 'FAIL'}  ${c.name.padEnd(12)} ${c.detail}`);
  if (!result.granted) return 1;

  if (command === 'open') {
    const expiresAt = now() + result.minutes * 60_000;
    // Record first: if the grant succeeds but we crash, sweep still closes it.
    grants.add({ path: result.file.path, account: identity.account, expiresAt, grantedAt: now() });
    await windows.grantRead(result.file.path, identity.account, run);
    log(`  read access for ${identity.account} until ${new Date(expiresAt).toISOString()}`);
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(`error: ${e.message}`); process.exit(2); });
}
