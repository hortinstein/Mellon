import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJevClient } from './src/jev.js';
import { DEFAULT_POLICY, evaluate } from './src/gate.js';
import { createStore, publicView } from './src/store.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const LIMITS = { name: 120, description: 1000, rules: 8000, secret: 8000, input: 4000, bodyBytes: 64 * 1024 };
const ATTEMPTS_PER_MINUTE = 10;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

export function createApp({ store, jev }) {
  const hits = new Map(); // `${ip}:${lockId}` -> timestamps of recent attempts

  const rateLimited = (key) => {
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < 60_000);
    recent.push(now);
    hits.set(key, recent);
    return recent.length > ATTEMPTS_PER_MINUTE;
  };

  const routes = [
    ['GET', /^\/api\/status$/, () => [200, { mode: jev.mode, model: jev.model, encrypted: store.encrypted, defaultPolicy: DEFAULT_POLICY }]],

    ['GET', /^\/api\/stats$/, () => [200, store.stats()]],

    ['GET', /^\/api\/locks$/, () => [200, store.list()]],

    ['POST', /^\/api\/locks$/, async (req) => {
      const body = await readJson(req);
      const err = validate(body, ['name', 'rules', 'secret']);
      if (err) return [400, { error: err }];
      const created = store.create({
        name: body.name.trim(),
        description: (body.description || '').trim(),
        rules: body.rules.trim(),
        secret: body.secret,
        policy: sanitizePolicy(body.policy),
      });
      return [201, created];
    }],

    ['GET', /^\/api\/locks\/(\w+)$/, (req, [id]) => {
      const lock = store.get(id);
      return lock ? [200, publicView(lock)] : [404, { error: 'No such lock' }];
    }],

    ['POST', /^\/api\/locks\/(\w+)\/attempt$/, async (req, [id]) => {
      const lock = store.get(id);
      if (!lock) return [404, { error: 'No such lock' }];
      if (rateLimited(`${req.socket.remoteAddress}:${id}`)) return [429, { error: 'Too many attempts; wait a minute.' }];
      const body = await readJson(req);
      const err = validate(body, ['input']);
      if (err) return [400, { error: err }];

      let result;
      try {
        result = await evaluate(jev, lock, body.input);
      } catch (e) {
        // Fail closed: an unreachable judge never opens the door.
        console.error(`[mellon] judge error on lock ${id}:`, e.message);
        store.recordAttempt(id, { input: body.input, granted: false, error: e.message });
        return [502, { granted: false, error: 'The gatekeeper could not reach a decision. Access denied.' }];
      }

      store.recordAttempt(id, { input: body.input, granted: result.granted, checks: result.checks, mode: result.mode });
      const response = { granted: result.granted, checks: result.checks, mode: result.mode, model: result.model, answers: result.answers };
      if (result.granted) response.secret = store.revealSecret(id);
      return [200, response];
    }],

    ['GET', /^\/api\/locks\/(\w+)\/attempts$/, (req, [id]) => {
      if (!store.isOwner(id, req.headers['x-owner-token'])) return [403, { error: 'Owner token required' }];
      return [200, store.get(id).attempts];
    }],

    ['DELETE', /^\/api\/locks\/(\w+)$/, (req, [id]) => {
      if (!store.isOwner(id, req.headers['x-owner-token'])) return [403, { error: 'Owner token required' }];
      store.remove(id);
      return [204, null];
    }],
  ];

  return async function handler(req, res) {
    const { pathname } = new URL(req.url, 'http://x');
    try {
      if (pathname.startsWith('/api/')) {
        for (const [method, pattern, fn] of routes) {
          const m = pathname.match(pattern);
          if (m && req.method === method) return send(res, ...(await fn(req, m.slice(1))));
        }
        return send(res, 404, { error: 'Not found' });
      }
      return serveStatic(pathname, res);
    } catch (e) {
      if (e.status) return send(res, e.status, { error: e.message });
      console.error(e);
      return send(res, 500, { error: 'Internal error' });
    }
  };
}

function validate(body, required) {
  for (const field of required) {
    if (typeof body[field] !== 'string' || !body[field].trim()) return `"${field}" is required`;
  }
  for (const [field, max] of Object.entries(LIMITS)) {
    if (typeof body[field] === 'string' && body[field].length > max) return `"${field}" exceeds ${max} characters`;
  }
  return null;
}

function sanitizePolicy(policy = {}) {
  const out = {};
  for (const key of Object.keys(DEFAULT_POLICY)) {
    const v = Number(policy?.[key]);
    if (Number.isFinite(v) && v >= 0 && v <= 1) out[key] = v;
  }
  return out;
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > LIMITS.bodyBytes) throw Object.assign(new Error('Body too large'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body === null ? undefined : JSON.stringify(body));
}

async function serveStatic(pathname, res) {
  const rel = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'Forbidden' });
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    send(res, 404, { error: 'Not found' });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const store = createStore(process.env.MELLON_DATA || join(ROOT, 'data', 'locks.json'));
  const jev = createJevClient();
  const port = Number(process.env.PORT) || 3000;
  createServer(createApp({ store, jev })).listen(port, () => {
    console.log(`Mellon listening on http://localhost:${port}`);
    console.log(jev.mode === 'live' ? `Judge: TypeSafe Jev (${jev.model})` : 'Judge: MOCK heuristics (set TYPESAFE_API_KEY to use Jev)');
    if (!store.encrypted) console.log('Warning: secrets stored in plaintext (set MELLON_SECRET_KEY to encrypt at rest)');
  });
}
