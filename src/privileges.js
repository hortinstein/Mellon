// Container helper: when started as root in the Mellon image (Docker, Fly), make
// the data directory writable by the unprivileged user and switch to it before
// touching any data. It only acts when the image opts in by setting
// MELLON_RUN_AS_UID/GID, so running the CLI as root on an ordinary host never
// changes file ownership.
import { chownSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function dropPrivileges(dataFile, env = process.env) {
  const uid = Number(env.MELLON_RUN_AS_UID);
  const gid = Number(env.MELLON_RUN_AS_GID ?? env.MELLON_RUN_AS_UID);
  if (!env.MELLON_RUN_AS_UID || !Number.isInteger(uid) || !Number.isInteger(gid)) return false;
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return false;
  const dir = dirname(dataFile);
  mkdirSync(dir, { recursive: true });
  chownTree(dir, uid, gid); // includes attempts/ logs

  process.setgid(gid);
  process.setuid(uid);
  return true;
}

function chownTree(path, uid, gid) {
  chownSync(path, uid, gid);
  if (statSync(path).isDirectory()) for (const name of readdirSync(path)) chownTree(join(path, name), uid, gid);
}
