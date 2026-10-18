// Minimal Upstash Redis REST backend (also what Vercel's marketplace Redis
// exposes as KV_REST_API_URL / KV_REST_API_TOKEN). No client library: each
// collection is a Redis hash of id -> JSON, read and written with one pipelined
// HTTP request.
//
// Writes are per record, so concurrent serverless invocations only conflict when
// they change the same record (e.g. two attempts on one lock at the same
// moment, where the later write wins).

const COLLECTIONS = ['locks', 'accounts', 'sessions'];

export function createRedisBackend({ url, token, prefix = 'mellon', fetchImpl = globalThis.fetch, timeoutMs = 10_000 }) {
  const base = url.replace(/\/+$/, '');
  const keyOf = (collection) => `${prefix}:${collection}`;

  const pipeline = async (commands) => {
    const res = await fetchImpl(`${base}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Redis ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const results = await res.json();
    const failed = results.find((r) => r.error);
    if (failed) throw new Error(`Redis error: ${failed.error}`);
    return results.map((r) => r.result);
  };

  return {
    async load() {
      const results = await pipeline(COLLECTIONS.map((c) => ['HGETALL', keyOf(c)]));
      const db = { version: 2, locks: {}, accounts: {}, sessions: {} };
      COLLECTIONS.forEach((collection, i) => {
        const flat = results[i] || [];
        for (let j = 0; j < flat.length; j += 2) db[collection][flat[j]] = JSON.parse(flat[j + 1]);
      });
      return db;
    },

    // changes: [{ collection, id, value | null }] — null deletes the record.
    async save(changes) {
      if (!changes.length) return;
      await pipeline(changes.map(({ collection, id, value }) =>
        value === null ? ['HDEL', keyOf(collection), id] : ['HSET', keyOf(collection), id, JSON.stringify(value)]));
    },
  };
}
