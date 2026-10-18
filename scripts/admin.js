#!/usr/bin/env node
// Administrator management. This is the only way to set the isAdmin flag: no
// API endpoint can write it. Run it on the server (or in its container):
//
//   node scripts/admin.js list
//   node scripts/admin.js grant <username>
//   node scripts/admin.js revoke <username>
//
// Uses the same storage as the server: MELLON_DATA, or Redis when
// UPSTASH_REDIS_REST_URL/TOKEN (or KV_REST_API_URL/TOKEN) are set, as on Vercel.
// A running server picks up the change on its next request.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { backendFromEnv, createStore } from '../src/store.js';
import { dropPrivileges } from '../src/privileges.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const backend = backendFromEnv(process.env, join(ROOT, 'data', 'locks.json'));
const where = backend.kind === 'redis' ? `Redis (${backend.url})` : backend.file;
const [command, rawName] = process.argv.slice(2);
const username = rawName?.trim().toLowerCase();

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

// In a container this runs as root (docker exec, fly ssh); write as the server's user.
if (backend.kind === 'file') dropPrivileges(backend.file);
const store = createStore(backend);
await store.sync();

switch (command) {
  case 'list': {
    const rows = store.accountsOverview();
    if (!rows.length) console.log(`No accounts in ${where}`);
    for (const a of rows) {
      const flags = [a.isAdmin && 'admin', a.disabled && 'disabled'].filter(Boolean).join(', ');
      console.log(`${a.username.padEnd(32)} ${flags || '-'}`);
    }
    break;
  }
  case 'grant':
  case 'revoke': {
    if (!username) fail(`usage: node scripts/admin.js ${command} <username>`);
    if (!store.setAdmin(username, command === 'grant')) fail(`No account named "${username}" in ${where}`);
    await store.commit();
    console.log(`${command === 'grant' ? 'Granted' : 'Revoked'} administrator access for @${username}`);
    break;
  }
  default:
    fail('usage: node scripts/admin.js <list | grant <username> | revoke <username>>');
}
