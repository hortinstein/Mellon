// The Windows side: who is this user, which groups are they in, and how do we
// open (and later close) a file for them. Every call goes through execFile with
// an argument array, never a shell string, and user names reach PowerShell only
// through an environment variable, so nothing a user types is ever parsed as code.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

// Swappable so the logic can be tested on any OS (see test/windows-gate.test.js).
export const defaultRunner = async (file, args, env = {}) => {
  const { stdout } = await exec(file, args, { env: { ...process.env, ...env }, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  return stdout;
};

const POWERSHELL = ['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']];
const ACCOUNT = /^[A-Za-z0-9._\- ]+(\\[A-Za-z0-9._\- $]+)?$|^[A-Za-z0-9._\-]+@[A-Za-z0-9.\-]+$/;

export function assertAccount(account) {
  if (typeof account !== 'string' || !ACCOUNT.test(account) || account.length > 256) throw new Error(`Not a Windows account name: ${JSON.stringify(account)}`);
  return account;
}

// --- 1. Groups ------------------------------------------------------------

// The current process's own logon token: `whoami /groups /fo csv /nh`.
// Rows look like: "CORVID\Range-Safety","Group","S-1-5-21-...-1107","Mandatory group, Enabled by default, Enabled group"
// Deny-only groups (e.g. Administrators in a UAC-filtered token) are dropped:
// Windows itself won't use them to allow access, so neither do we.
export async function currentUserGroups(run = defaultRunner) {
  const [user, groups] = await Promise.all([
    run('whoami.exe', ['/user', '/fo', 'csv', '/nh']),
    run('whoami.exe', ['/groups', '/fo', 'csv', '/nh']),
  ]);
  const [name, sid] = parseCsvLine(user.trim());
  return { account: name, sid, groups: parseWhoamiGroups(groups) };
}

export function parseWhoamiGroups(csv) {
  return csv.split(/\r?\n/).filter((l) => l.trim()).map(parseCsvLine)
    .filter(([, , , attributes = '']) => !/deny only/i.test(attributes))
    .map(([name, , sid]) => ({ name, sid }));
}

// A domain user, as the domain controller sees them, including nested groups:
// an S4U identity built from the UPN carries the same group SIDs a real logon
// would. Run this on a domain-joined machine.
const DOMAIN_SCRIPT = `
$id = [System.Security.Principal.WindowsIdentity]::new($env:MELLON_GATE_USER)
$groups = foreach ($g in $id.Groups) {
  $name = try { $g.Translate([System.Security.Principal.NTAccount]).Value } catch { $null }
  [pscustomobject]@{ name = $name; sid = $g.Value }
}
[pscustomobject]@{ account = $id.Name; sid = $id.User.Value; groups = @($groups) } | ConvertTo-Json -Depth 3 -Compress`;

export async function domainUserGroups(upn, run = defaultRunner) {
  const out = await run(POWERSHELL[0], [...POWERSHELL[1], DOMAIN_SCRIPT], { MELLON_GATE_USER: assertAccount(upn) });
  return normalize(JSON.parse(out));
}

// A local account on this machine (no domain): every local group that lists it.
const LOCAL_SCRIPT = `
$user = Get-LocalUser -Name $env:MELLON_GATE_USER -ErrorAction Stop
$groups = foreach ($g in Get-LocalGroup) {
  $members = Get-LocalGroupMember -Group $g -ErrorAction SilentlyContinue
  if ($members | Where-Object { $_.SID -eq $user.SID }) { [pscustomobject]@{ name = "$env:COMPUTERNAME\\$($g.Name)"; sid = $g.SID.Value } }
}
[pscustomobject]@{ account = "$env:COMPUTERNAME\\$($user.Name)"; sid = $user.SID.Value; groups = @($groups) } | ConvertTo-Json -Depth 3 -Compress`;

export async function localUserGroups(name, run = defaultRunner) {
  const out = await run(POWERSHELL[0], [...POWERSHELL[1], LOCAL_SCRIPT], { MELLON_GATE_USER: assertAccount(name) });
  return normalize(JSON.parse(out));
}

function normalize({ account, sid, groups }) {
  return { account, sid, groups: (Array.isArray(groups) ? groups : groups ? [groups] : []).map((g) => ({ name: g.name ?? g.sid, sid: g.sid })) };
}

// --- 2. Enforcement: a time-boxed NTFS read grant -------------------------

// Windows does the enforcing. The protected files carry no ACE for individual
// users (only the gate's service account and admins), so the explicit read
// grant added here is the user's only way in, and removing it closes the door.
export async function grantRead(path, account, run = defaultRunner) {
  await run('icacls.exe', [path, '/grant', `${assertAccount(account)}:(R)`]);
}

export async function revokeRead(path, account, run = defaultRunner) {
  await run('icacls.exe', [path, '/remove:g', assertAccount(account)]);
}

// Minimal CSV for whoami output: quoted fields, "" escapes a quote.
export function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}
