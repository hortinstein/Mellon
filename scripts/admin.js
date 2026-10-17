#!/usr/bin/env node
// Administrator management. This is the only way to set the isAdmin flag: no
// API endpoint can write it. Run it on the server (or in its container):
//
//   node scripts/admin.js list
//   node scripts/admin.js grant <username>
//   node scripts/admin.js revoke <username>
//
// Uses the same MELLON_DATA file as the server. A running server picks up the
// change on its next request.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../src/store.js';
import { dropPrivileges } from '../src/privileges.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const file = process.env.MELLON_DATA || join(ROOT, 'data', 'locks.json');
const [command, rawName] = process.argv.slice(2);
const username = rawName?.trim().toLowerCase();
// In a container this runs as root (docker exec, fly ssh); write as the server's user.
dropPrivileges(file);
const store = createStore(file);

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

switch (command) {
  case 'list': {
    const rows = store.accountsOverview();
    if (!rows.length) console.log(`No accounts in ${file}`);
    for (const a of rows) {
      const flags = [a.isAdmin && 'admin', a.disabled && 'disabled'].filter(Boolean).join(', ');
      console.log(`${a.username.padEnd(32)} ${flags || '-'}`);
    }
    break;
  }
  case 'grant':
  case 'revoke': {
    if (!username) fail(`usage: node scripts/admin.js ${command} <username>`);
    if (!store.setAdmin(username, command === 'grant')) fail(`No account named "${username}" in ${file}`);
    console.log(`${command === 'grant' ? 'Granted' : 'Revoked'} administrator access for @${username}`);
    break;
  }
  default:
    fail('usage: node scripts/admin.js <list | grant <username> | revoke <username>>');
}
