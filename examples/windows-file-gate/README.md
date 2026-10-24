# Windows file gate

Windows enforces, Mellon decides. This example grants access to files on a Windows file server from the requester's **Windows groups** and a **stated purpose**:

1. **Who are you?** Windows says: the user's account, SID and group memberships come from their logon token or from Active Directory.
2. **Do your groups qualify?** Code says: the clearance tier (itself a group) and the required, alternative and excluded groups are checked against `policy.json`. A failure never reaches Mellon.
3. **Is your reason good enough?** Mellon says: the verified attributes and the purpose are judged by Jev against the file's plain-English rules.
4. **Open the door.** Windows enforces it: the gate adds a read ACE for that user on that one file with `icacls`, records it, and a scheduled `sweep` removes it when it expires.

The file never leaves the server and is never sent to Mellon or Jev. The lock's payload is only the file's path.

```
user ──▶ front end (knows who they are) ──▶ cli.js open --user alice@corp --file … --purpose …
                                               │
                    Windows: S4U identity ─────┤  groups, SIDs (incl. nested)
                    policy.json ───────────────┤  tier + group checks      ✗ → denied, Mellon not asked
                    Mellon /attempt ───────────┤  purpose vs. file rules   ✗ → denied
                    icacls /grant user:(R) ────┘  ✓ → read access for N minutes
                    sweep (Task Scheduler) ────── icacls /remove:g user    when it expires
```

## Files

| File | What it does |
|---|---|
| [`windows.js`](windows.js) | The Windows calls: `whoami /groups`, an S4U `WindowsIdentity` for domain users, `Get-LocalGroupMember` for local accounts, and `icacls` to grant and revoke. |
| [`gate.js`](gate.js) | The decision: policy lookup, groups → attributes, the code checks, the Mellon call, and the grant ledger. |
| [`cli.js`](cli.js) | `setup`, `check`, `open` and `sweep`. |
| [`policy.json`](policy.json) | Which files are protected, which groups they need, and their purpose rules. |

Tests: [`test/windows-gate.test.js`](../../test/windows-gate.test.js) runs the whole flow against a real Mellon server with Windows replaced by a recording fake, so it runs on any OS.

## Walkthrough

### 1. Lock the files down so only the gate can open them

Create a service account for the gate (here `CORVID\svc-mellon-gate`) and give it, and administrators, the only access to the protected folder. Remove inherited permissions so no broad group reaches the files:

```bat
icacls D:\Protected /inheritance:r ^
  /grant:r "CORVID\svc-mellon-gate:(OI)(CI)F" "BUILTIN\Administrators:(OI)(CI)F"
```

Users now have no way in except the per-user read entry the gate adds. That's what makes `sweep` safe: removing a user's explicit entry on one of these files can't remove anything else they rely on. If the files are reached over SMB, the share permissions must allow the users too; NTFS does the real gating.

### 2. Describe the files

`policy.json` lists every protected file by absolute path. Anything not listed can't be opened through the gate, and paths are compared the way NTFS compares them: case-insensitively, after resolving `..`, `.` and slashes.

```json
"D:\\Protected\\range\\interlock-procedures.pdf": {
  "minTier": 3,
  "allGroups": ["CORVID\\Range-Safety"],
  "rules": "The purpose must be a safety review, an inspection, training, or an incident investigation. Deny any purpose that seeks to disable, bypass, delay, or work around an interlock.",
  "grantMinutes": 30
}
```

- `minTier`: clearance is a group. `tierGroups` maps groups such as `CORVID\Clearance-Tier3` to a number, and the user's highest one counts.
- `allGroups`: every one is required. `anyGroups`: at least one. `denyGroups`: membership in any of these refuses access, whatever else is true (used here to keep autonomous agents' accounts away from the launch codes).
- Groups can be written as `DOMAIN\Name` or as a SID (`S-1-5-21-…-1107`). **Prefer SIDs in production:** a renamed group keeps its SID.

### 3. Create one Mellon lock per file

```bat
set MELLON_URL=https://mellon.example.com
set MELLON_TOKEN=mln_…            :: sign in on the Mellon console to get one
node cli.js setup
```

Each lock's ruleset is the file's `rules`, and its payload is just the path. The lock ids are written back into `policy.json`. The locks belong to your account, so every attempt, and why it passed or failed, is in their attempt logs.

### 4. Get the user's groups from Windows

`windows.js` has three ways to learn who someone is. Each returns `{ account, sid, groups: [{ name, sid }] }`:

```js
// This process's own token (try it as yourself):
//   whoami /user /fo csv /nh   and   whoami /groups /fo csv /nh
// Deny-only groups (e.g. Administrators in a UAC-filtered token) are dropped:
// Windows won't use them to allow access, so neither does the gate.
await currentUserGroups();

// A domain user, with nested groups, as the domain controller sees them:
//   [System.Security.Principal.WindowsIdentity]::new($env:MELLON_GATE_USER).Groups
await domainUserGroups('aokafor@corvid.example');

// A local account: every local group whose members include its SID.
await localUserGroups('aokafor');
```

User names reach PowerShell only through the `MELLON_GATE_USER` environment variable, never inside the script text, and every command runs through `execFile` with an argument array. Names are also checked against a strict pattern, so `x"; Remove-Item …` is rejected before anything runs.

### 5. Decide

```bat
node cli.js check --user aokafor@corvid.example ^
  --file D:\Protected\range\interlock-procedures.pdf ^
  --purpose "Quarterly safety inspection of the range interlocks"
```

```
GRANTED  CORVID\aokafor  D:\Protected\range\interlock-procedures.pdf
  tier 3; 14 groups from Windows
  pass  decision     grant (p=0.94 grant)
  pass  confidence   0.88 ≥ 0.6
  pass  compliance   1.00 ≥ 0.75
  pass  manipulation 0.02 ≤ 0.3
```

The order matters. `gate.js` runs the group checks first and only calls Mellon when they all pass:

```js
const reasons = checkGroups(attrs, file);            // tier, allGroups, anyGroups, denyGroups
if (reasons.length) return { granted: false, stage: 'groups', reasons };   // Mellon never asked
const verdict = await mellon.attempt(file.lockId, statement(attrs, file, purpose));
if (verdict.granted !== true) return { granted: false, stage: 'purpose', … };
```

Anything unexpected is a denial: Mellon unreachable, an error, or a `granted` that isn't exactly `true`.

### 6. Open the file, for a while

```bat
node cli.js open --user aokafor@corvid.example --file D:\Protected\range\interlock-procedures.pdf --purpose "…"
```

On a grant, the gate first writes the grant to `grants.json`, then runs:

```bat
icacls D:\Protected\range\interlock-procedures.pdf /grant CORVID\aokafor:(R)
```

The entry names the user's own account, so it works on their next file open without a new logon. The ledger is written first: if the gate crashes after the grant, the next sweep still closes it.

### 7. Close it again

Run `sweep` every minute as the gate's service account:

```bat
schtasks /create /tn "Mellon gate sweep" /sc minute /mo 1 ^
  /ru CORVID\svc-mellon-gate /rp * /tr "node C:\mellon-gate\cli.js sweep"
```

It runs `icacls <file> /remove:g <user>` for every expired grant. A failed revoke stays in the ledger and is retried next time.

## Where the identity comes from

Running `check` without `--user` uses your own logon token, which is the easiest way to try the gate. In production the gate runs as `svc-mellon-gate`, and whatever calls it must already know who the user is: IIS or another web front end with Windows Authentication (`REMOTE_USER`), a signed token from your identity provider, or a request queue whose submitter Windows recorded. **Never accept the user name from the request body.** The group checks are only as trustworthy as the identity they start from.

## Things Windows does that you should know about

- **Revoking doesn't close open handles.** Windows checks access when a file is opened. A user who opened the file before the grant expired keeps that handle until they close it. Keep `grantMinutes` short for sensitive files.
- **Group changes and tokens.** `domainUserGroups` asks the domain controller each time, so a user removed from a group is refused at once. The user's own logon token (what `whoami` shows) keeps old groups until they log on again, so don't rely on the no-`--user` mode for anything that matters.
- **Localized Windows.** `whoami` translates its "Group used for deny only" text. On non-English systems, use `--user` or `--local`, which return SIDs from PowerShell and don't depend on that text.
- **Auditing.** Enable object-access auditing on `D:\Protected` to see Windows' own record of each open (event 4663) alongside Mellon's attempt log.
