// JSON-file store for locks. Secrets are encrypted at rest with AES-256-GCM when
// MELLON_SECRET_KEY is set; owner tokens are stored only as SHA-256 hashes.
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const MAX_ATTEMPTS_KEPT = 50;
const sha256 = (s) => createHash('sha256').update(s).digest();

export function createStore(file, { secretKey = process.env.MELLON_SECRET_KEY } = {}) {
  const key = secretKey ? sha256(secretKey) : null;
  let locks = load(file);

  const save = () => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(locks, null, 2), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  };

  const seal = (plain) => {
    if (!key) return { plain };
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  };

  const open = (sealed) => {
    if ('plain' in sealed) return sealed.plain;
    if (!key) throw new Error('Secret is encrypted but MELLON_SECRET_KEY is not set');
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
    d.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(sealed.data, 'base64')), d.final()]).toString('utf8');
  };

  return {
    encrypted: Boolean(key),

    create({ name, description, rules, secret, policy }) {
      const id = randomBytes(6).toString('hex');
      const ownerToken = randomBytes(24).toString('base64url');
      locks[id] = {
        id,
        name,
        description,
        rules,
        policy,
        secret: seal(secret),
        ownerHash: sha256(ownerToken).toString('hex'),
        createdAt: new Date().toISOString(),
        attempts: [],
      };
      save();
      return { lock: publicView(locks[id]), ownerToken };
    },

    get: (id) => locks[id] ?? null,
    list: () => Object.values(locks).map(publicView),
    revealSecret: (id) => open(locks[id].secret),

    isOwner(id, token) {
      const lock = locks[id];
      if (!lock || typeof token !== 'string') return false;
      return timingSafeEqual(sha256(token), Buffer.from(lock.ownerHash, 'hex'));
    },

    recordAttempt(id, attempt) {
      const lock = locks[id];
      lock.attempts.unshift({ at: new Date().toISOString(), ...attempt });
      lock.attempts.length = Math.min(lock.attempts.length, MAX_ATTEMPTS_KEPT);
      save();
    },

    remove(id) {
      delete locks[id];
      save();
    },
  };
}

export function publicView({ id, name, description, rules, policy, createdAt, attempts }) {
  return { id, name, description, rules, policy, createdAt, attemptCount: attempts.length };
}

function load(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}
