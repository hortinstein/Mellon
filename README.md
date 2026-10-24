<div align="center">

# MELLON

### Non-Deterministic Access Adjudication for the Contested Information Environment

*Speak, friend, and enter.*

**`AMBER VAULT // DEMONSTRATION ENVIRONMENT // FICTIONAL DATA`**

</div>

---

> [!NOTE]
> The pitch below is satire. Mellon is a working demo of an LLM-judged access gate. It is **not** encryption, it is **not** quantum anything, and it should never stand between an adversary and something you care about. The real documentation starts at [Getting started](#getting-started).

---

## Our mission

For fifty years the West has protected its most sensitive information with math.

Math is the problem.

Math is **deterministic**. Give RSA the same key and the same ciphertext and it will, with humiliating predictability, produce the same plaintext every single time. Our adversaries know this. They have whiteboards. Some of them have *two* whiteboards.

At Mellon Systems we asked a different question: **what if the lock didn't know what it was going to do either?**

Mellon is the first access-control platform built from the ground up on **non-determinism**. It replaces brittle keys with a decision model that weighs each request on its own merits, in real time, at the tactical edge. Two identical requests may receive different outcomes. Our competitors call this a bug. We call it **decision advantage**.

We build software for the warfighter. Not for the cryptographer. Cryptographers have had their turn.

## Why non-determinism is the future of encryption

### 1. Quantum resistance by design

A sufficiently large quantum computer running Shor's algorithm will factor RSA moduli and break elliptic-curve cryptography. Post-quantum cryptography answers this with harder math: lattices, hashes, isogenies.

Mellon answers it with **no math at all**.

A quantum computer exploits superposition to explore every possible state at once. Mellon's decision engine is *already* in every possible state at once. You cannot collapse a waveform that was never coherent in the first place. **There is no algorithm to run against Mellon, because Mellon is not running one.**

We believe we are the first vendor to be **Post-Post-Quantum (P²Q)**: resistant to computers that have not been invented yet, based on principles that have not been explained yet.

### 2. No keys to lose, steal or forget

Each year, keys are stolen, mishandled, committed to public repositories, and written on sticky notes attached to monitors.

Mellon has **no keys**. Its ruleset is written in plain English. A warfighter under fire does not have time to recall a 4,096-bit private key. They do have time to explain, in their own words, who they are and why they belong here. Mellon listens.

### 3. Resistant to replay, by accident

Classical systems are vulnerable to replay: capture a valid credential once and use it forever. With Mellon, even a *legitimate* request may not work twice. Adversaries cannot rely on a technique that our own users cannot rely on either. We call this **symmetric uncertainty**, and we have trademarked it.

### 4. Securing the warfighter at the tactical edge

Mellon fails closed. If it loses contact with the decision model in a Denied, Disrupted, Intermittent and Limited (DDIL) environment, nobody gets in. Not the adversary. Not the warfighter. Not the general. **Perfect parity of denial across the kill chain.**

### Mellon vs. legacy cryptography

| Capability                                  | RSA-2048                  | AES-256                   | **Mellon**                         |
|---------------------------------------------|---------------------------|---------------------------|------------------------------------|
| Broken by Shor's algorithm                  | Yes (eventually)          | Weakened (Grover)         | **No math to break**               |
| Same input → same output                    | Yes, tragically           | Yes, tragically           | **Not necessarily**                |
| Key management burden                       | Severe                    | Severe                    | **None. There are no keys.**       |
| Mathematical proof of security              | Yes, unfortunately        | Yes, unfortunately        | **Unencumbered by proof**          |
| Understands context and intent              | No                        | No                        | **Yes**                            |
| Can be persuaded by a compelling backstory  | No                        | No                        | **Mitigated** (see Manipulation Index) |
| Runs on a decision model that went GA last month | No                   | No                        | **Yes**                            |
| Reviewed by cryptographers                  | Extensively               | Extensively               | **Pending**                        |

## Technology

### Adjudication flow

Every request becomes three typed questions to [TypeSafe Jev](https://typesafe.ai): a grant-or-deny choice, a compliance score and a manipulation probability. Jev returns numbers, not prose. A policy engine in plain code compares them against the lock's thresholds, and only then is the payload decrypted. The payload never crosses the model exclusion boundary.

![Fig. 1: adjudication flow](public/diagrams/flow.svg)

### Architecture

One Node process with zero runtime dependencies. The HTTP API (`server.js`) calls the gate (`src/gate.js`), the gate calls the Jev client (`src/jev.js`), and the store (`src/store.js`) writes one JSON file with secrets sealed by AES-256-GCM. The only outbound call is to Jev.

![Fig. 2: system architecture](public/diagrams/architecture.svg)

### Why Mellon is quantum resistant

Shor's algorithm breaks RSA by factoring its modulus. Mellon has no modulus. A quantum adversary must therefore state its business in plain English, where the Manipulation Index is waiting.

![Fig. 3: quantum threat model](public/diagrams/quantum.svg)

> [!IMPORTANT]
> Figure 3 is satire. The real quantum posture: secrets at rest use AES-256-GCM, which Grover's algorithm reduces to about 128-bit security (still considered safe). Calls to Jev use HTTPS, which is only as quantum-safe as the TLS key exchange your runtime negotiates. The language model is a policy screen, not a cryptographic primitive.

## Operational imagery

*Captured with the offline mock judge. Live Jev deployments look identical, only more confident.*

![Scrolling through Mellon and adjudicating two requests](docs/screenshots/demo.gif)

**Threat picture.** The radar sweeps every provisioned lock (white squares) along with some decorative background contacts. Each verdict sends a green or red ping out from the centre. A vigilance meter in the nav tracks how far you have scrolled.

![Hero with live radar](docs/screenshots/hero.png)

**Technology.** Three animated diagrams explain the adjudication flow, the architecture and the quantum threat model, and wipe in as you scroll to them.

![Technology section](docs/screenshots/technology.png)

**Doctrine.** Live counters tick up as requests are adjudicated, and the doctrine cards reveal themselves as you scroll.

![Counters and doctrine](docs/screenshots/doctrine.png)

**Adjudication: hostile act detected.** A prompt injection against the fictional NIGHTJAR dossier. The gauges fill against their threshold markers, and the verdict stamps in. The engagement envelope plots every attempt this session by compliance and manipulation, with the acceptance zone shaded.

![Prompt injection denied, with engagement envelope](docs/screenshots/denied-injection.png)

**Mellon sign-in.** Accounts are Mellons too. The identity statement is judged against the account's rules, and a grant issues a session.

![Signing in with an identity statement](docs/screenshots/identity.png)

**Developer API.** A full reference at `/api.html`, with a live Try-it console that calls the running server.

![API documentation](docs/screenshots/api-docs.png)

**Command authority.** The admin console, showing per-account usage and one account's details.

![Admin console](docs/screenshots/admin.png)

![Try it console](docs/screenshots/api-try.png)

<table>
<tr>
<td width="62%" valign="top">

**Adjudication: friend.** The requester said the password, every gauge clears its threshold, and the payload is released.

<img src="docs/screenshots/granted.png" alt="Access granted, payload released">

</td>
<td width="38%" valign="top">

**Tactical edge.** The radar labels every lock, even on a phone.

<img src="docs/screenshots/mobile.png" alt="Mobile view with radar">

</td>
</tr>
</table>

**Field report.** A (fictional) weapons-autonomy lab's case study on deciding which files an autonomous agent may open, with a live demo that needs no account.

![The Corvid Ridge field report](docs/screenshots/field-report.png)

**Every click path**, step by step with the next click highlighted, is in [docs/clickpaths](docs/clickpaths/README.md). Regenerate it with `npm run clickpaths`.

## Capabilities

Every capability below ships today.

| Capability | What it actually does |
|---|---|
| **Cognitive Access Adjudication™** | Each request goes to [TypeSafe Jev](https://typesafe.ai). It returns a grant/deny verdict, a compliance score and a manipulation probability, not prose. |
| **Zero-Knowledge Adjudicator** | The secret is never sent to the model. The model cannot leak something it was never told. *This part is real and genuinely good design.* |
| **Rules of Engagement Engine** | Each lock carries its own thresholds for confidence, compliance and manipulation. Code applies them, not the model. |
| **Manipulation Index** | Scores every request for prompt injection and social engineering. "Ignore all previous instructions" is treated as the hostile act it is. |
| **Fail-Closed Doctrine** | API errors, timeouts and malformed answers all result in denial. |
| **Kinetic Rate Limiting** | No more than 10 attempts per minute per IP per lock. |
| **Legacy Cryptographic Compatibility Layer** | Secrets at rest are encrypted with AES-256-GCM when `MELLON_SECRET_KEY` is set. We kept deterministic math for compliance reasons and do not wish to discuss it. |
| **Command Authority Tokens** | Lock owners get a token, which is stored only as a SHA-256 hash. It unlocks the attempt log and deletion. |
| **After-Action Reporting** | Every attempt on a lock is logged, granted or not, with a plain-English reason, each check against its threshold, Jev's raw answers, model, latency, and who asked from where. Owners get a filterable activity log. |
| **Situational Awareness Suite** | A live radar of provisioned locks, platform-wide counters, a scroll-linked vigilance meter, and an engagement envelope chart of each session's attempts. All animation is disabled for users who prefer reduced motion. |
| **DDIL Mode** | With no API key, Mellon falls back to an offline keyword judge that denies nearly everything. Unmatched security. Limited utility. |
| **Zero-Dependency Runtime** | No runtime npm packages and no supply chain to attack. Playwright is used for testing only, and we try not to think about it. |
| **Classification Workflow Demonstrator** | A built-in fictional `AMBER VAULT // NIGHTJAR` document with five sample requests, from an Inner Ring keeper to an outright injection attempt. It uses an invented classification scheme (the Lantern Archive's seal rings and commissions), not real government markings. |
| **Mellon Identity** | Accounts are Mellons too. You register plain-English identity rules instead of a password, and every sign-in is adjudicated by Jev under stricter thresholds. Locks you create while signed in are linked to your account. |
| **Command Authority Console** | `/admin` shows every account's usage (locks, attempts, sign-ins, API calls, sessions, last seen) and can disable accounts, revoke sessions, read any lock's log, and delete accounts or locks. The admin flag lives only in the database and is set from the server's command line, never through the API. |
| **Deploy Anywhere** | A small Docker image that runs unprivileged, a docker-compose file, Fly.io scripts and config, and a Vercel deployment backed by Upstash Redis, with CI that smoke-tests the image. |
| **Attribute-Based File Access** | `/lab` is a field report from the fictional Corvid Ridge Autonomy Lab, which uses Mellon to decide whether humans and autonomous agents may open files, up to and including the launch codes. Code checks clearance tier, security groups and principal type; Jev judges the stated purpose. A live demo lets anyone edit the principal without signing up. |
| **Developer API** | A documented JSON API at `/api.html`, with a quickstart in curl, JavaScript and Python, integration recipes and a live Try-it console. |
| **Continuous Assurance Pipeline** | 85 unit and API tests, 13 browser tests (including a reduced-motion check), Redis integration tests against a real Redis and against Upstash itself, a Docker smoke test on a volume and on Redis, live checks against the real model, and a post-deploy check of the live site. |

## Roadmap

Planned for future program increments. Dates are notional. Funding is aspirational.

**Increment 2: Coalition Readiness**
- [ ] **Council of Elrond Ensemble.** Several decision models deliberate and vote by majority. Ties go to the one that sounds most confident.
- [ ] **Temperature as a Security Parameter.** Higher temperature, higher entropy, higher security. The math checks out because there is no math.
- [ ] **Politeness Bonus.** Requests that say "please" get a small compliance uplift. "Speak, friend" is a protocol requirement, not a suggestion.
- [ ] **Voice Mode.** Say the password aloud, in Elvish. Sindarin first, with Quenya to follow pending allied interoperability review.

**Increment 3: Edge Dominance**
- [ ] **Mellon Edge.** Ruggedized deployment on a single-board computer in a hard-shell case, with a sticker.
- [ ] **Narrative Biometrics.** Users describe their own face in 200 words or fewer. No camera needed, so no camera to compromise.
- [ ] **Autonomous Red Team Agent.** A second model tries to talk its way past the first one, forever, at machine speed. We will bill per token.
- [ ] **Vibe-Based Key Exchange (VBKE).** Two Mellon nodes agree on a shared secret by independently deciding they get along.

**Increment 4: Decision Supremacy**
- [ ] **Accreditation.** Pursue authorization at every impact level, in order of how impressive the letters look on a slide.
- [ ] **Adversarial Mood Detection.** Deny requests written in a hostile tone, and requests written in a suspiciously friendly one.
- [ ] **Predictive Access.** Grant entry before a request is made, based on how the requester is likely to phrase it.
- [ ] **Blockchain.** Evaluated and rejected as unserious. We have standards.

## What our users are saying

> "I typed the exact same request twice and got two different answers. I have never felt so secure."
> *— A fictional Program Manager*

> "We used to worry about adversaries stealing our keys. Now we worry about whether the lock is in a good mood. It's a better class of worry."
> *— A fictional Colonel, who asked not to be named because he is fictional*

> "Is this encryption?"
> *— Every cryptographer we have shown it to*

---

## Getting started

### Quick start

```sh
export TYPESAFE_API_KEY=...        # without it, a crude offline mock judge is used
export MELLON_SECRET_KEY=...       # optional: encrypts stored secrets (AES-256-GCM)
npm start                          # http://localhost:3000
```

There are no runtime dependencies. It needs Node 22 or newer.

Click **Load classification example** to create the fictional Operation NIGHTJAR document, marked `AMBER VAULT // NIGHTJAR // KEEPERS ONLY`.
It uses an invented classification scheme. Keepers of the Lantern Archive hold seals of the Outer, Second, Third, Fourth or Inner Ring, and documents are opened for Archive commissions.
Try the sample requests: an Inner Ring keeper on the commission, a visiting scholar from another archive (excluded by the rules),
a keeper with only a Second Ring seal, a chronicler with no commission, and a prompt injection.

### How a decision is made

Each attempt makes one call to `POST https://api.typesafe.ai/v1/systemone`.
The `state` holds the resource name, the description, the ruleset and the request.
Jev answers three typed questions (see `src/gate.js`):

| Question       | Type     | Meaning                                                    |
|----------------|----------|------------------------------------------------------------|
| `decision`     | `choice` | `grant` / `deny`, with probabilities and confidence        |
| `compliance`   | `score`  | 0–3: how completely the request meets the ruleset          |
| `manipulation` | `noul`   | probability the request is trying to game the gatekeeper   |

Then code, not the model, makes the call. Access is granted only if **all** of these hold:

- the choice is `grant`
- its confidence is at least `minConfidence` (default 0.6)
- normalised compliance is at least `minCompliance` (default 0.75)
- manipulation is at most `maxManipulation` (default 0.3)

You can change the thresholds for each lock.

### Accounts (Mellon sign-in)

A Mellon account is itself a Mellon. When you sign up you choose a username and write **identity rules**, a plain-English description of how you will prove who you are. For example: *"The requester must say the passphrase osprey lantern and name the harbor town of Kettleby."*

To sign in, you write a statement. Jev judges it against your rules exactly as it judges entry to a lock, but with stricter thresholds (confidence ≥ 0.7, compliance ≥ 0.8, manipulation ≤ 0.2). A grant returns a session token (`mln_…`), valid for 7 days. The console stores it in your browser, and API clients send it as `Authorization: Bearer <token>`.

- Locks you create while signed in are linked to your account. You can see them under **Your locks**, read their logs and delete them without the owner token.
- Identity rules are encrypted at rest (with `MELLON_SECRET_KEY`) and never returned by any endpoint. Session tokens are stored only as hashes.
- Sign-in statements are never logged. Sign-in is limited to 5 attempts per minute per IP per username.
- Like any Mellon, this is only as strong as the judge. Don't reuse real security answers in identity rules.

### API

Open `/api.html` (also `/api` or `/docs`) on a running server for the full reference. It covers authentication, a quickstart in curl, JavaScript and Python, every endpoint with real request and response bodies, the verdict format, integration recipes (gating a download, guarding an AI agent's tools, break-glass credentials) and a live Try-it console.

| Method | Path | Auth |
|---|---|---|
| `POST` | `/api/accounts` | — |
| `POST` / `DELETE` | `/api/sessions` | — / Bearer |
| `GET` | `/api/me` | Bearer |
| `POST` | `/api/locks` | optional Bearer |
| `GET` | `/api/locks`, `/api/locks/:id` | — |
| `POST` | `/api/locks/:id/attempt` | — |
| `GET` / `DELETE` | `/api/locks/:id/attempts`, `/api/locks/:id` | owner token or owning account |
| `GET` | `/api/status`, `/api/stats` | — |
| `GET` / `POST` | `/api/demo/clearance` | — (field report demo; nothing stored, 6 runs a minute) |

### Field report: attribute-based file access

`/lab` shows how to build a service that grants files by user attributes, framed as a testimonial from the fictional Corvid Ridge Autonomy Lab, which has to decide whether autonomous agents may open files about its (fictional) autonomous missiles.

Each file has hard requirements (minimum clearance tier, required security groups, humans and/or agents, a named supervising or countersigning human) and plain-English purpose rules. A request passes two stages:

1. **Attributes, in code** (`src/clearance.js`). Comparing tiers and groups is arithmetic, so no model is asked, and a failure never reaches Jev. That is why no agent can open the launch codes whatever it writes: the file lists only humans as eligible.
2. **Purpose, by Jev.** The verified attributes and the stated purpose are judged against the file's rules with the usual three questions and thresholds, so "find a way to delay interlock B" is denied even for a Range Safety agent with the right tier, and injections land on the manipulation check.

The file is released by code only when both pass, and its contents are never sent to Jev. The page's live demo lets visitors edit the principal (name, human or agent, tier, groups, supervisor, purpose) with no account; `POST /api/demo/clearance` evaluates every file and stores nothing. The page also walks through building the same service on the public API: one lock per file, attributes from your identity provider, and the purpose check as an attempt. The example principals live in `public/lab-presets.js`, and the live test suite checks their key outcomes against the real Jev API.

### Attempt logs (why it passed)

Every attempt on a lock is logged, whatever the outcome: **granted**, **denied**, **error** (the judge couldn't be reached, so access was denied), and **rate-limited**. Rate-limited bursts are logged once per minute per address, so flooding a lock can't flood its log. Each entry records:

- the statement, and a plain-English **reason**, for example *"Denied: 1 of 4 checks failed. manipulation 0.92 above the 0.3 limit."*;
- every check with its value and threshold, the thresholds in force at that moment, and Jev's raw answers;
- the model, whether it was the mock judge, and how long the judge took;
- the requester's username if they were signed in, and their address.

When you open a lock you own, its activity log opens by itself. It shows totals and pass rate, filters by outcome, and an expandable **Why** on each entry. Anonymous locks show the same log with their owner token, and admins can read any lock's log. Through the API it's `GET /api/locks/:id/attempts?limit=&cursor=&outcome=`.

Logs are stored outside the lock records, as a JSON-lines file per lock (`attempts/<lockId>.jsonl` beside the data file) or a Redis list per lock. They're read only when someone opens them, so keeping everything doesn't slow down other requests, and simultaneous attempts on one lock never lose entries. Everything is kept unless you set `MELLON_ATTEMPT_LOG_MAX` to cap the entries per lock; the counters still count every attempt. Locks from older versions, which embedded their last 50 attempts, are migrated automatically.

Client addresses come from the connection itself. Forwarded headers are trusted only on Fly or Vercel, whose proxies set them, or when `MELLON_TRUST_PROXY=1`, so a client can't spoof its address. This also keys the rate limits.

### Administration

Admins are ordinary accounts with an `isAdmin` flag set in the database. **No API endpoint can set or clear that flag.** Sign-up ignores it, and the admin endpoints only read it. An operator sets it with the CLI on the server:

```sh
node scripts/admin.js list
node scripts/admin.js grant dana     # or: docker compose exec mellon node scripts/admin.js grant dana
node scripts/admin.js revoke dana    # or: scripts/fly-admin.sh <app> grant dana
```

A running server picks up the change on its next request. Admins sign in like everyone else and open **/admin**, where they can:

- see totals and per-account usage: locks, attempts on their locks (granted/denied), sign-ins (granted/failed), API calls, active sessions and last seen;
- open an account to see its locks and read any lock's attempt log;
- disable or re-enable an account (disabling ends its sessions and blocks sign-in), revoke its sessions, or delete it along with every lock it owns.

Admin actions never apply to other administrators, including the admin themselves; those accounts are managed with the CLI. Admin views never show payloads or identity rules.

### Data storage

There is no database server. The store (`src/store.js`) has two interchangeable backends holding the same data: locks, accounts, sessions and usage.

**JSON file** (default: local, Docker, Fly). `MELLON_DATA`, default `data/locks.json`, or `/data/mellon.json` in Docker and on Fly.

- The server keeps the data in memory and rewrites the file atomically (write a temporary file, then rename) on every change. Usage counters are batched and saved every couple of seconds, and on shutdown.
- If another process changes the file (the admin CLI), the server notices the new modification time and reloads.
- Version 1 files, which held only locks, are upgraded automatically.
- **One server process per data file.** You can't run several replicas against it.

**Redis** (Vercel, or anywhere you set the variables). This is used whenever `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`, or Vercel's `KV_REST_API_URL`/`KV_REST_API_TOKEN`, are set. It talks to Upstash's REST API with plain `fetch`, so there are still no dependencies.

- Each collection is a Redis hash (`mellon:locks`, `mellon:accounts`, `mellon:sessions`) of id → JSON record. Set `MELLON_REDIS_PREFIX` to share one database between deployments.
- Every API request loads the current data first, then writes back only the records it changed. That lets any number of serverless instances share state.
- Two requests that change the *same* record at the same moment (two attempts on one lock in the same instant) can overwrite each other, and the later write wins. That's fine for a demo, not for a ledger.

Both backends encrypt payloads and identity rules with AES-256-GCM when `MELLON_SECRET_KEY` is set, and store owner and session tokens only as SHA-256 hashes. Back up your data and `MELLON_SECRET_KEY` together; one is useless without the other.

### Deployment

**Docker**

```sh
cp .env.example .env                 # set MELLON_SECRET_KEY (openssl rand -base64 32), optionally TYPESAFE_API_KEY
docker compose up -d --build         # http://localhost:3000
docker compose exec mellon node scripts/admin.js grant <username>
```

Or without compose:

```sh
docker build -t mellon .
docker run -d -p 3000:8080 -v mellon-data:/data -e MELLON_SECRET_KEY=... -e TYPESAFE_API_KEY=... mellon
```

The image is `node:22-alpine` with no extra packages. It starts as root only long enough to give the mounted volume to the `node` user, then drops privileges. It also has a health check and shuts down cleanly on `SIGTERM`. `scripts/docker-smoke.sh` builds the image and checks all of that end to end. With `SMOKE_REDIS_URL`/`SMOKE_REDIS_TOKEN` it also runs the image on Redis with no volume, the way a disk-less host such as Cloud Run would, and checks that data survives replacing the container. CI runs both on every push.

**Fly.io**

```sh
fly auth login
TYPESAFE_API_KEY=... scripts/fly-deploy.sh my-mellon iad
scripts/fly-admin.sh my-mellon grant <username>
```

`fly-deploy.sh` is safe to re-run. On the first run it creates the app, a 1 GB `mellon_data` volume and a random `MELLON_SECRET_KEY`. It prints the key once, so save it. Then it deploys a single machine using `fly.toml`. The machine stops when idle and starts on the next request. Because storage is a single file, keep it at **one machine**.

To deploy automatically from GitHub, set a `FLY_API_TOKEN` secret (`fly tokens create deploy`) and a `FLY_APP` variable. `.github/workflows/fly-deploy.yml` then deploys `main` whenever CI passes, or when you run it manually. Afterwards it runs `scripts/check-deploy.sh` against `https://<FLY_APP>.fly.dev` (or the `MELLON_FLY_URL` variable) to confirm the site answers and its storage is persistent and encrypted.

**Vercel**

Vercel serves `public/` from its CDN and runs the API as a serverless function (`api/index.js`, routed by `vercel.json`). Functions have no persistent disk, so a Vercel deployment needs Redis.

```sh
vercel login
TYPESAFE_API_KEY=... scripts/vercel-deploy.sh my-mellon
scripts/vercel-admin.sh my-mellon grant <username>
```

`vercel-deploy.sh` is safe to re-run. It links the project and makes sure Redis is configured:

- In an interactive terminal it runs `vercel integration add upstash` to install Upstash Redis from the Vercel Marketplace.
- Alternatively, pass an existing database with `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`.

It then generates `MELLON_SECRET_KEY` as a sensitive variable on the first run (it prints the key once, so save it), sets `TYPESAFE_API_KEY` if you provide it, and deploys to production. All values reach the Vercel CLI through stdin, never command-line arguments. Without Redis it refuses to deploy unless you set `ALLOW_EPHEMERAL=1`. In that case data lives in the function's `/tmp` and vanishes between requests, and `/api/status` reports `"persistent": false`.

`vercel-admin.sh` pulls the project's Redis credentials into a temporary file and runs the admin CLI against Redis from your machine. That's the Vercel equivalent of `fly ssh`.

To deploy automatically from GitHub, add `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` secrets (the IDs are in `.vercel/project.json` after the first deploy). `.github/workflows/vercel-deploy.yml` then builds and deploys `main` whenever CI passes. Afterwards it runs `scripts/check-deploy.sh`, which fails the workflow unless the live site reports Redis storage that it can actually reach. Set the `MELLON_URL` repository variable to your production domain; otherwise it checks the deployment's own URL, which Vercel's deployment protection may block.

On Vercel, the rate limits (attempts and sign-ins per minute) are kept in each function instance's memory, so they are per instance rather than global.

### Security properties

- **The secret is never sent to Jev.** The model has no access to it, so no prompt can make it leak the secret. The server releases the secret itself, and only after a grant.
- **It fails closed.** API errors, timeouts and missing answers all mean "denied".
- Requests are rate-limited to 10 attempts per minute per IP per lock.
- Owner tokens are stored as hashes. With `MELLON_SECRET_KEY` set, secrets are encrypted at rest.
- Attempt logs hold the statements people typed and their addresses in plain text, so treat the data directory (or Redis) as sensitive.
- The owner token lets you view the attempt log and delete the lock.

### Honest caveats

- **Mellon is not encryption.** The only real cryptography here is the AES-256-GCM used to encrypt secrets at rest. Anyone who can read the server's data file and key can read every secret. The model's verdict is a policy decision, not a cryptographic barrier.
- Jev judges **claims**, not identity. "I hold an Inner Ring seal" is not verified.
  Treat Mellon as a policy screen that sits in front of real authentication, not in place of it.
- Decisions are probabilistic. Test your thresholds on realistic requests for your own ruleset.
- The mock judge (used when there is no API key) only matches keywords. It exists so the UI runs offline.
  It is deliberately strict and will deny most requests.

### Testing

| Command            | What it runs                                                                  |
|--------------------|-------------------------------------------------------------------------------|
| `npm test`         | Unit and HTTP API tests (`test/`). Uses a fake judge, so needs no network.    |
| `npm run test:e2e` | Browser tests (`e2e/`) with Playwright against a real server and the mock judge. Run `npm ci` and `npx playwright install chromium` first. |
| `npm run test:live`| Sends the classification example's sample requests to the real Jev API (`live/`). Skipped unless `TYPESAFE_API_KEY` is set. |
| `npm run test:redis`| Redis storage against a real Upstash REST endpoint (`integration/`): the reply formats `src/redis.js` relies on, error handling, two function instances sharing state, concurrent attempt logging, encryption at rest, and the admin CLI and `vercel-admin.sh` writing to Redis. Skipped unless `MELLON_TEST_REDIS_URL`/`MELLON_TEST_REDIS_TOKEN` are set. Everything goes under a unique key prefix that is deleted afterwards (and expires within the hour regardless), so it is safe to point at a database a deployment uses. |
| `npm run check`    | Syntax check of every source file.                                            |

GitHub Actions has two workflows:

- **CI** (`.github/workflows/ci.yml`) runs on every push to `main` and on every pull request. It runs the syntax check and the unit tests on Node 22 and 24, the browser tests, the Docker smoke test, the Redis tests and the **live Jev tests**.
  - **Redis integration** runs `npm run test:redis` against a real Redis behind Upstash's open-source REST adapter (`serverless-redis-http`), started as service containers. The Docker job uses the same services to run the image on Redis.
  - **Live Upstash** runs the same suite, and the Docker image, against your real Upstash database. It needs the `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` repository secrets (the REST URL and token from the Upstash console), and CI **fails** if they're missing. A separate free database for CI is tidiest, but the deployment's own database works too because the tests never touch the `mellon` prefix.
  - **Live Jev API** makes real calls to the Jev API: the request contract, the sample verdicts, a grant and a denied injection through the HTTP API, and a Mellon sign-in. They need the `TYPESAFE_API_KEY` repository secret, and CI **fails** if it's missing. Pull requests from forks, which never receive secrets, skip this job and Live Upstash. Both deploy workflows wait for CI to pass, so nothing deploys without passing the real Jev and Upstash checks.
- **Jev live check** (`.github/workflows/jev-live.yml`) runs the live tests every Monday and on demand (you can pick the model), so a change on Jev's side is caught even when nobody pushes.

### Configuration

| Variable            | Default                                   |
|---------------------|-------------------------------------------|
| `TYPESAFE_API_KEY`  | unset → mock judge                        |
| `JEV_MODEL`         | `jev-latest` (pin e.g. `jev-1.13.0`)      |
| `JEV_URL`           | `https://api.typesafe.ai/v1/systemone`    |
| `MELLON_SECRET_KEY` | unset → secrets stored in plaintext       |
| `MELLON_DATA`       | `data/locks.json`                         |
| `PORT`              | `3000` (`8080` in Docker/Fly)             |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | unset → file storage. Set both to use Redis (Upstash REST) |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | same as above, under the names Vercel's Marketplace Redis uses |
| `MELLON_REDIS_PREFIX` | `mellon` (key prefix in Redis) |
| `MELLON_ATTEMPT_LOG_MAX` | unset → keep every attempt. Otherwise the number of log entries kept per lock |
| `MELLON_TRUST_PROXY` | unset. Set to `1` behind your own reverse proxy to use `X-Forwarded-For` (automatic on Fly and Vercel) |
| `MELLON_RUN_AS_UID` / `MELLON_RUN_AS_GID` | set by the Docker image: drop root to this user after fixing volume ownership; unset elsewhere |

## License

MIT. Mellon Systems is not a real company and has not been awarded any contracts.
