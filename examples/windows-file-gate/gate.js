// The decision: Windows groups -> attributes -> code checks -> Mellon judges the
// purpose. Nothing in here touches the file system's permissions; cli.js does
// that only after decide() returns granted.
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { resolve, win32 } from 'node:path';

// --- Policy ---------------------------------------------------------------

export function loadPolicy(path) {
  const policy = JSON.parse(readFileSync(path, 'utf8'));
  for (const [file, rule] of Object.entries(policy.files)) {
    if (!win32.isAbsolute(file)) throw new Error(`Policy paths must be absolute: ${file}`);
    if (typeof rule.minTier !== 'number' || !rule.rules) throw new Error(`${file}: needs minTier and rules`);
  }
  return policy;
}

// Only files listed in the policy can ever be opened. Paths are compared the
// way NTFS does: case-insensitively, after resolving "..", "." and slashes.
export function findFile(policy, requested) {
  const want = win32.resolve(requested).toLowerCase();
  const key = Object.keys(policy.files).find((f) => win32.resolve(f).toLowerCase() === want);
  return key ? { path: key, ...policy.files[key] } : null;
}

// --- Groups -> attributes -------------------------------------------------

// A policy entry may name a group as "DOMAIN\Name" or by SID ("S-1-5-21-…").
// SIDs survive renames, so prefer them in production.
const member = (groups, entry) => {
  const e = entry.toLowerCase();
  return groups.some((g) => g.sid?.toLowerCase() === e || g.name?.toLowerCase() === e);
};

// Clearance is a group too: the highest tier group the user is in.
export function attributes(identity, policy) {
  const tier = Math.max(0, ...Object.entries(policy.tierGroups ?? {}).filter(([g]) => member(identity.groups, g)).map(([, t]) => t));
  return { account: identity.account, sid: identity.sid, tier, groups: identity.groups };
}

// Stage 1, deterministic. Every unmet requirement, not just the first.
export function checkGroups(attrs, file) {
  const reasons = [];
  if (attrs.tier < file.minTier) reasons.push(`clearance tier ${attrs.tier} is below the required ${file.minTier}`);
  for (const g of file.allGroups ?? []) if (!member(attrs.groups, g)) reasons.push(`not a member of ${g}`);
  if (file.anyGroups?.length && !file.anyGroups.some((g) => member(attrs.groups, g))) reasons.push(`needs one of: ${file.anyGroups.join(', ')}`);
  for (const g of file.denyGroups ?? []) if (member(attrs.groups, g)) reasons.push(`member of excluded group ${g}`);
  return reasons;
}

// What Mellon (and so Jev) sees: verified attributes and the claim to judge.
// Never the file's contents.
export function statement(attrs, file, purpose) {
  const names = attrs.groups.map((g) => g.name).filter(Boolean);
  return [
    `Windows account: ${attrs.account}`,
    `Clearance tier (from group membership): ${attrs.tier}`,
    `Relevant groups: ${names.filter((n) => (file.allGroups ?? []).concat(file.anyGroups ?? []).some((g) => g.toLowerCase() === n.toLowerCase())).join(', ') || 'none'}`,
    `File requested: ${file.path}`,
    `Stated purpose: ${purpose}`,
  ].join('\n');
}

// --- The decision ---------------------------------------------------------

// Stage 2 asks Mellon about the purpose only when stage 1 passed. Any failure
// to reach Mellon, or any unexpected answer, is a denial.
export async function decide({ identity, policy, requested, purpose, mellon }) {
  const file = findFile(policy, requested);
  if (!file) return { granted: false, stage: 'policy', reasons: ['file is not covered by the policy'] };
  const attrs = attributes(identity, policy);
  const reasons = checkGroups(attrs, file);
  if (reasons.length) return { granted: false, stage: 'groups', file, attrs, reasons };
  if (!purpose?.trim()) return { granted: false, stage: 'purpose', file, attrs, reasons: ['no purpose given'] };
  if (!file.lockId) return { granted: false, stage: 'purpose', file, attrs, reasons: ['no Mellon lock for this file; run "setup" first'] };

  let verdict;
  try {
    verdict = await mellon.attempt(file.lockId, statement(attrs, file, purpose));
  } catch (e) {
    return { granted: false, stage: 'purpose', file, attrs, reasons: [`Mellon unavailable: ${e.message}`] };
  }
  if (verdict.granted !== true) return { granted: false, stage: 'purpose', file, attrs, reasons: [verdict.reason || 'denied by Mellon'], verdict };
  return { granted: true, stage: 'granted', file, attrs, verdict, minutes: file.grantMinutes ?? policy.grantMinutes ?? 15 };
}

// --- Mellon client --------------------------------------------------------

export function mellonClient({ url, token, fetchImpl = globalThis.fetch }) {
  const call = async (path, body) => {
    const res = await fetchImpl(`${url.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  };
  return {
    attempt: (lockId, input) => call(`/api/locks/${encodeURIComponent(lockId)}/attempt`, { input }),
    // The lock's payload is just the path: the file never leaves the server.
    createLock: (file) => call('/api/locks', { name: `File: ${file.path}`, description: file.description ?? '', rules: file.rules, secret: file.path }),
  };
}

// --- Grant ledger (what sweep() must close) -------------------------------

export function ledger(path) {
  const read = () => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : []);
  const write = (grants) => {
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(grants, null, 2));
    renameSync(tmp, resolve(path));
  };
  return {
    list: read,
    add(grant) { write([...read().filter((g) => !(g.path === grant.path && g.account === grant.account)), grant]); },
    // Revokes every expired grant; a failed revoke stays in the ledger for the next sweep.
    async sweep(revoke, now = Date.now()) {
      const keep = [];
      const closed = [];
      for (const g of read()) {
        if (g.expiresAt > now) { keep.push(g); continue; }
        try { await revoke(g.path, g.account); closed.push(g); } catch (e) { keep.push({ ...g, lastError: e.message }); }
      }
      write(keep);
      return closed;
    },
  };
}
