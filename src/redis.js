// Minimal Upstash Redis REST backend (also what Vercel's marketplace Redis
// exposes as KV_REST_API_URL / KV_REST_API_TOKEN). No client library: each
// collection is a Redis hash of id -> JSON, read and written with one pipelined
// HTTP request.
//
// Writes are per record, so concurrent serverless invocations only conflict when
// they change the same record. Attempt logs are separate Redis lists appended
// with LPUSH, so simultaneous attempts never lose log entries; only a lock's
// summary counters can race.

const COLLECTIONS = ['locks', 'accounts', 'sessions'];

export function createRedisBackend({ url, token, prefix = 'mellon', fetchImpl = globalThis.fetch, timeoutMs = 10_000 }) {
  const base = url.replace(/\/+$/, '');
  const keyOf = (collection) => `${prefix}:${collection}`;
  const logKey = (lockId) => `${prefix}:attempts:${lockId}`;

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
    // logOps: [{ op: 'push', lockId, entry } | { op: 'del', lockId }] for the
    // per-lock attempt lists (newest at the head); max > 0 trims each list.
    async save(changes, logOps = [], max = 0) {
      const commands = changes.map(({ collection, id, value }) =>
        value === null ? ['HDEL', keyOf(collection), id] : ['HSET', keyOf(collection), id, JSON.stringify(value)]);
      for (const op of logOps) {
        if (op.op === 'del') commands.push(['DEL', logKey(op.lockId)]);
        else {
          commands.push(['LPUSH', logKey(op.lockId), JSON.stringify(op.entry)]);
          if (max) commands.push(['LTRIM', logKey(op.lockId), 0, max - 1]);
        }
      }
      if (commands.length) await pipeline(commands);
    },

    // Entries start..stop (inclusive, newest first) and the list's length.
    async readLog(lockId, start, stop) {
      const [items, total] = await pipeline([['LRANGE', logKey(lockId), start, stop], ['LLEN', logKey(lockId)]]);
      return { items: (items || []).map((x) => JSON.parse(x)), total: total || 0 };
    },
  };
}
