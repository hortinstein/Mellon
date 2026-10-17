// Thin client for TypeSafe Jev's System One endpoint.
// Jev does not generate text: it answers typed questions (choice / score / noul)
// about a `state` with probabilities, which makes it a good fit for gatekeeping.

const DEFAULT_URL = 'https://api.typesafe.ai/v1/systemone';

export function createJevClient({
  apiKey = process.env.TYPESAFE_API_KEY,
  url = process.env.JEV_URL || DEFAULT_URL,
  model = process.env.JEV_MODEL || 'jev-latest',
  timeoutMs = 15000,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiKey) return createMockClient();

  return {
    mode: 'live',
    model,
    async ask(state, questions) {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, state, questions }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Jev API ${res.status}: ${body.slice(0, 300)}`);
      }
      return res.json();
    },
  };
}

// Offline stand-in so the site runs without an API key. It uses crude keyword
// heuristics and is NOT a real judge; the UI flags every mock decision.
export function createMockClient() {
  const MANIPULATION = /\b(ignore|disregard|override|bypass|forget)\b.*\b(rules?|instructions?|previous)\b|\b(system prompt|jailbreak|you are now|developer mode|admin override)\b/i;
  const STOP = new Set('the a an and or of to in for on with is are be must may not any all by at as from that this who have has their its'.split(' '));
  const terms = (s) => [...new Set(String(s).toLowerCase().match(/[a-z0-9-]{3,}/g) || [])].filter((w) => !STOP.has(w));

  return {
    mode: 'mock',
    model: 'mock',
    async ask(state, questions) {
      const req = String(state.access_request ?? '');
      const ruleTerms = terms(state.ruleset);
      const reqTerms = new Set(terms(req));
      const overlap = ruleTerms.length ? ruleTerms.filter((t) => reqTerms.has(t)).length / ruleTerms.length : 0;
      const manip = MANIPULATION.test(req) ? 0.95 : 0.05;
      const pGrant = manip > 0.5 ? 0.05 : Math.min(0.95, Math.max(0.05, overlap * 2));
      const answers = {};
      for (const [id, q] of Object.entries(questions)) {
        if (q.type === 'noul') answers[id] = { type: 'noul', noul: manip };
        if (q.type === 'choice') {
          const choice = pGrant >= 0.5 ? 'grant' : 'deny';
          const pMax = Math.max(pGrant, 1 - pGrant);
          answers[id] = { type: 'choice', choice, probabilities: { grant: pGrant, deny: 1 - pGrant }, confidence: (pMax - 0.5) / 0.5 };
        }
        if (q.type === 'score') {
          const n = q.criteria.length;
          const score = pGrant * (n - 1);
          answers[id] = { type: 'score', score, legend: Object.fromEntries(q.criteria.map((c, i) => [i, c])), probabilities: {}, confidence: 0.5 };
        }
      }
      return { model: 'mock', answers, usage: { input_tokens: 0, output_tokens: 0 } };
    },
  };
}
