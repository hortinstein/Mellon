# Mellon
Non deterministic locking system to prevent unauthorized access to files.

*Speak, friend, and enter.* Mellon holds a **secret** behind a plain-language **ruleset**.
Anyone can ask for entry by describing who they are and why they need access.
[TypeSafe Jev](https://typesafe.ai) judges the request against the ruleset, and the
secret is revealed only if Jev's verdict clears every threshold.

## Quick start

```sh
export TYPESAFE_API_KEY=...        # without it, a crude offline mock judge is used
export MELLON_SECRET_KEY=...       # optional: encrypts stored secrets (AES-256-GCM)
npm start                          # http://localhost:3000
```

There are no runtime dependencies. It needs Node 22 or newer.

## Testing

| Command            | What it runs                                                                  |
|--------------------|-------------------------------------------------------------------------------|
| `npm test`         | Unit and HTTP API tests (`test/`). Uses a fake judge, so needs no network.    |
| `npm run test:e2e` | Browser tests (`e2e/`) with Playwright against a real server and the mock judge. Run `npm ci` and `npx playwright install chromium` first. |
| `npm run test:live`| Sends the classification example's sample requests to the real Jev API (`live/`). Skipped unless `TYPESAFE_API_KEY` is set. |
| `npm run check`    | Syntax check of every source file.                                            |

GitHub Actions has two workflows:

- **CI** (`.github/workflows/ci.yml`) runs on every push to `main` and on every pull request. It runs the syntax check and the unit tests on Node 22 and 24, then the browser tests. If the browser tests fail, it uploads the Playwright report.
- **Jev live check** (`.github/workflows/jev-live.yml`) runs every Monday, on demand (you can pick the model), and when the judge code changes on `main`. It needs a `TYPESAFE_API_KEY` repository secret. Without one, the job is skipped with a notice.

Click **Load classification example** to create a fictional `AMBER VAULT // KEEPERS ONLY` document lock.
Then try the sample requests: a cleared analyst, an allied liaison officer (fails KEEPERS ONLY),
someone with too low a clearance, someone without need-to-know, and a prompt injection.

## How a decision is made

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

## Security properties

- **The secret is never sent to Jev.** The model has no access to it, so no prompt can make it leak the secret. The server releases the secret itself, and only after a grant.
- **It fails closed.** API errors, timeouts and missing answers all mean "denied".
- Requests are rate-limited to 10 attempts per minute per IP per lock.
- Owner tokens are stored as hashes. With `MELLON_SECRET_KEY` set, secrets are encrypted at rest.
- The owner token lets you view the attempt log and delete the lock.

### Caveats

- Jev judges **claims**, not identity. "I hold a Inner Ring clearance" is not verified.
  Treat Mellon as a policy screen that sits in front of real authentication, not in place of it.
- Decisions are probabilistic. Test your thresholds on realistic requests for your own ruleset.
- The mock judge (used when there is no API key) only matches keywords. It exists so the UI runs offline.
  It is deliberately strict and will deny most requests.

## Configuration

| Variable            | Default                                   |
|---------------------|-------------------------------------------|
| `TYPESAFE_API_KEY`  | unset → mock judge                        |
| `JEV_MODEL`         | `jev-latest` (pin e.g. `jev-1.13.0`)      |
| `JEV_URL`           | `https://api.typesafe.ai/v1/systemone`    |
| `MELLON_SECRET_KEY` | unset → secrets stored in plaintext       |
| `MELLON_DATA`       | `data/locks.json`                         |
| `PORT`              | `3000`                                    |
