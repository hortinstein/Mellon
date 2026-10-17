<div align="center">

# MELLON

### Non-Deterministic Access Adjudication for the Contested Information Environment

*Speak, friend, and enter.*

**`ULTRA-MEGA-SENSITIVE // EYES ONLY (BOTH OF THEM) // DO NOT PERCEIVE`**

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

Each year, keys are stolen, mishandled, committed to public repositories, and written on sticky notes attached to monitors marked DO NOT PERCEIVE.

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

## Operational imagery

*Captured with the offline mock judge. Live Jev deployments look identical, only more confident.*

![Scrolling through Mellon and adjudicating two requests](docs/screenshots/demo.gif)

**Threat picture.** The radar sweeps every provisioned lock (white squares) along with some decorative "unidentified vibes". Each verdict sends a green or red ping out from the centre. A vigilance meter in the nav tracks how far you have scrolled.

![Hero with live radar](docs/screenshots/hero.png)

**Doctrine.** Live counters tick up as requests are adjudicated, and the doctrine cards reveal themselves as you scroll.

![Counters and doctrine](docs/screenshots/doctrine.png)

**Adjudication: hostile act detected.** A prompt injection against the fictional NIGHTJAR dossier. The gauges fill against their threshold markers, and the verdict stamps in. The engagement envelope plots every attempt this session by compliance and manipulation, with the acceptance zone shaded.

![Prompt injection denied, with engagement envelope](docs/screenshots/denied-injection.png)

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
| **After-Action Reporting** | The most recent 50 entry attempts per lock are kept for review, newest first. |
| **Situational Awareness Suite** | A live radar of provisioned locks, platform-wide counters, a scroll-linked vigilance meter, and an engagement envelope chart of each session's attempts. All animation is disabled for users who prefer reduced motion. |
| **DDIL Mode** | With no API key, Mellon falls back to an offline keyword judge that denies nearly everything. Unmatched security. Limited utility. |
| **Zero-Dependency Runtime** | No runtime npm packages and no supply chain to attack. Playwright is used for testing only, and we try not to think about it. |
| **Classification Workflow Demonstrator** | A built-in fictional `ULTRA-MEGA-SENSITIVE // OBSIDIAN APEX` dossier with five sample requests, from a THERMONUCLEAR VANTA-cleared synergy analyst to an outright injection attempt. Every clearance level and marking is invented. |
| **Continuous Assurance Pipeline** | 40 unit and API tests, 6 browser tests (including a reduced-motion check), and a weekly live check against the real model in GitHub Actions. |

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

Click **Load classification example** to create the fictional Operation NIGHTJAR dossier, marked `ULTRA-MEGA-SENSITIVE // OBSIDIAN APEX`.
Then try the sample requests: a cleared synergy analyst, a liaison from the Coalition of Moderately Friendly Nations (fails HOME TEAM ONLY),
someone with only a TACTICAL BEIGE clearance, a podcaster with no Need-to-Know-to-Know, and a prompt injection.
All clearance levels, markings and organisations are made up.

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

### Security properties

- **The secret is never sent to Jev.** The model has no access to it, so no prompt can make it leak the secret. The server releases the secret itself, and only after a grant.
- **It fails closed.** API errors, timeouts and missing answers all mean "denied".
- Requests are rate-limited to 10 attempts per minute per IP per lock.
- Owner tokens are stored as hashes. With `MELLON_SECRET_KEY` set, secrets are encrypted at rest.
- The owner token lets you view the attempt log and delete the lock.

### Honest caveats

- **Mellon is not encryption.** The only real cryptography here is the AES-256-GCM used to encrypt secrets at rest. Anyone who can read the server's data file and key can read every secret. The model's verdict is a policy decision, not a cryptographic barrier.
- Jev judges **claims**, not identity. "I hold a THERMONUCLEAR VANTA clearance" is not verified.
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
| `npm run check`    | Syntax check of every source file.                                            |

GitHub Actions has two workflows:

- **CI** (`.github/workflows/ci.yml`) runs on every push to `main` and on every pull request. It runs the syntax check and the unit tests on Node 22 and 24, then the browser tests. If the browser tests fail, it uploads the Playwright report.
- **Jev live check** (`.github/workflows/jev-live.yml`) runs every Monday, on demand (you can pick the model), and when the judge code changes on `main`. It needs a `TYPESAFE_API_KEY` repository secret. Without one, the job is skipped with a notice.

### Configuration

| Variable            | Default                                   |
|---------------------|-------------------------------------------|
| `TYPESAFE_API_KEY`  | unset → mock judge                        |
| `JEV_MODEL`         | `jev-latest` (pin e.g. `jev-1.13.0`)      |
| `JEV_URL`           | `https://api.typesafe.ai/v1/systemone`    |
| `MELLON_SECRET_KEY` | unset → secrets stored in plaintext       |
| `MELLON_DATA`       | `data/locks.json`                         |
| `PORT`              | `3000`                                    |

## License

MIT. Mellon Systems is not a real company and has not been awarded any contracts.
