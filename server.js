import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJevClient } from './src/jev.js';
import { DEFAULT_POLICY, evaluate } from './src/gate.js';
import { createStore } from './src/store.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const LIMITS = { name: 120, description: 1000, rules: 8000, secret: 8000, input: 4000, statement: 4000, username: 32, bodyBytes: 64 * 1024 };
const ATTEMPTS_PER_MINUTE = 10;
const SIGNINS_PER_MINUTE = 5;
const USERNAME = /^[a-z0-9][a-z0-9_-]{2,31}$/;
const MIN_IDENTITY_RULES = 24;
// Sign-in is judged more strictly than a typical lock.
export const ACCOUNT_POLICY = { minConfidence: 0.7, minCompliance: 0.8, maxManipulation: 0.2 };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

export function createApp({ store, jev }) {
  const hits = new Map(); // rate-limit key -> timestamps of recent attempts

  const rateLimited = (key, limit = ATTEMPTS_PER_MINUTE) => {
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < 60_000);
    recent.push(now);
    hits.set(key, recent);
    return recent.length > limit;
  };

  // Resolves `Authorization: Bearer <session token>`. A header that is present
  // but invalid is an error rather than silently anonymous.
  const auth = (req) => {
    if (req.auth) return req.auth;
    const header = req.headers.authorization;
    if (!header) return (req.auth = { account: null });
    const token = header.match(/^Bearer\s+(\S+)$/i)?.[1];
    const account = token && store.sessionAccount(token);
    if (!account) return (req.auth = { error: [401, { error: 'Invalid or expired session token' }] });
    store.touch(account.id);
    return (req.auth = { account, token });
  };

  const manager = (req) => ({ ownerToken: req.headers['x-owner-token'], accountId: auth(req).account?.id });

  // Admin status comes only from the database flag, which no endpoint can write.
  const admin = (req) => {
    const { account, error } = auth(req);
    if (error) return { error };
    if (!account) return { error: [401, { error: 'Sign in first' }] };
    if (!account.isAdmin) return { error: [403, { error: 'Administrator access required' }] };
    return { account };
  };

  // Admin actions never target other administrators: those are managed with the CLI.
  const adminTarget = (username) => {
    const target = store.accountByName(username);
    if (!target) return { error: [404, { error: 'No such account' }] };
    if (target.isAdmin) return { error: [403, { error: 'Administrator accounts are managed with scripts/admin.js on the server' }] };
    return { target };
  };

  const routes = [
    ['GET', /^\/api\/status$/, () => [200, { mode: jev.mode, model: jev.model, encrypted: store.encrypted, defaultPolicy: DEFAULT_POLICY, accountPolicy: ACCOUNT_POLICY }]],

    ['GET', /^\/api\/stats$/, () => [200, store.stats()]],

    ['GET', /^\/api\/locks$/, () => [200, store.list()]],

    ['POST', /^\/api\/locks$/, async (req) => {
      const { account, error } = auth(req);
      if (error) return error;
      const body = await readJson(req);
      const err = validate(body, ['name', 'rules', 'secret']);
      if (err) return [400, { error: err }];
      const created = store.create({
        name: body.name.trim(),
        description: (body.description || '').trim(),
        rules: body.rules.trim(),
        secret: body.secret,
        policy: sanitizePolicy(body.policy),
        ownerAccountId: account?.id ?? null,
      });
      return [201, created];
    }],

    ['GET', /^\/api\/locks\/(\w+)$/, (req, [id]) => {
      const lock = store.view(id);
      return lock ? [200, lock] : [404, { error: 'No such lock' }];
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
      if (!store.canManage(id, manager(req))) return [403, { error: 'Owner token or owning account required' }];
      return [200, store.get(id).attempts];
    }],

    ['DELETE', /^\/api\/locks\/(\w+)$/, (req, [id]) => {
      if (!store.canManage(id, manager(req))) return [403, { error: 'Owner token or owning account required' }];
      store.remove(id);
      return [204, null];
    }],

    /* Accounts, authenticated by Mellon itself */

    ['POST', /^\/api\/accounts$/, async (req) => {
      const body = await readJson(req);
      const err = validate(body, ['username', 'rules']);
      if (err) return [400, { error: err }];
      const username = body.username.trim().toLowerCase();
      if (!USERNAME.test(username)) return [400, { error: 'Username must be 3-32 characters: a-z, 0-9, "_" or "-", starting with a letter or digit' }];
      if (body.rules.trim().length < MIN_IDENTITY_RULES) return [400, { error: `Identity rules must be at least ${MIN_IDENTITY_RULES} characters` }];
      if (rateLimited(`${req.socket.remoteAddress}:signup`)) return [429, { error: 'Too many sign-ups; wait a minute.' }];
      const account = store.createAccount({ username, rules: body.rules.trim(), policy: ACCOUNT_POLICY });
      if (!account) return [409, { error: 'Username is taken' }];
      const session = store.createSession(account.id);
      return [201, { account: { username: account.username, createdAt: account.createdAt }, ...session }];
    }],

    ['POST', /^\/api\/sessions$/, async (req) => {
      const body = await readJson(req);
      const err = validate(body, ['username', 'statement']);
      if (err) return [400, { error: err }];
      const username = body.username.trim().toLowerCase();
      if (rateLimited(`${req.socket.remoteAddress}:signin:${username}`, SIGNINS_PER_MINUTE)) return [429, { error: 'Too many sign-in attempts; wait a minute.' }];
      const account = store.accountByName(username);
      if (!account) return [404, { granted: false, error: 'No such account' }];
      if (account.disabled) return [403, { granted: false, error: 'This account has been disabled by an administrator' }];

      // The account is adjudicated exactly like a lock whose payload is a session.
      const gate = {
        name: `Mellon account @${account.username}`,
        description: 'Sign-in to a Mellon account. The ruleset is how the account holder said they would prove who they are.',
        rules: store.accountRules(account.id),
        policy: account.policy,
      };
      let result;
      try {
        result = await evaluate(jev, gate, body.statement);
      } catch (e) {
        console.error(`[mellon] judge error on sign-in for @${username}:`, e.message);
        return [502, { granted: false, error: 'The gatekeeper could not reach a decision. Sign-in denied.' }];
      }
      // Statements are never logged: for an account they work like a password.
      store.recordSignIn(account.id, result.granted);
      const response = { granted: result.granted, checks: result.checks, mode: result.mode, model: result.model };
      if (result.granted) Object.assign(response, { username: account.username }, store.createSession(account.id));
      return [200, response];
    }],

    ['DELETE', /^\/api\/sessions$/, (req) => {
      const { account, token, error } = auth(req);
      if (error) return error;
      if (!account) return [401, { error: 'Sign in first' }];
      store.revokeSession(token);
      return [204, null];
    }],

    ['GET', /^\/api\/me$/, (req) => {
      const { account, error } = auth(req);
      if (error) return error;
      if (!account) return [401, { error: 'Sign in first' }];
      return [200, { username: account.username, createdAt: account.createdAt, isAdmin: Boolean(account.isAdmin), locks: store.locksFor(account.id) }];
    }],

    /* Administration */

    ['GET', /^\/api\/admin\/overview$/, (req) => {
      const { error } = admin(req);
      if (error) return error;
      const accounts = store.accountsOverview();
      const activeSessions = accounts.reduce((n, a) => n + a.activeSessions, 0);
      return [200, { totals: { ...store.stats(), activeSessions, admins: accounts.filter((a) => a.isAdmin).length }, accounts }];
    }],

    ['GET', /^\/api\/admin\/accounts\/([a-z0-9_-]+)$/, (req, [username]) => {
      const { error } = admin(req);
      if (error) return error;
      const row = store.accountsOverview().find((a) => a.username === username);
      if (!row) return [404, { error: 'No such account' }];
      return [200, { account: row, locks: store.locksFor(store.accountByName(username).id) }];
    }],

    ['POST', /^\/api\/admin\/accounts\/([a-z0-9_-]+)\/disable$/, async (req, [username]) => {
      const { error } = admin(req);
      if (error) return error;
      const { target, error: targetError } = adminTarget(username);
      if (targetError) return targetError;
      const body = await readJson(req);
      if (typeof body.disabled !== 'boolean') return [400, { error: '"disabled" must be true or false' }];
      store.setDisabled(target.id, body.disabled);
      return [200, { username, disabled: body.disabled }];
    }],

    ['POST', /^\/api\/admin\/accounts\/([a-z0-9_-]+)\/revoke-sessions$/, (req, [username]) => {
      const { error } = admin(req);
      if (error) return error;
      const { target, error: targetError } = adminTarget(username);
      if (targetError) return targetError;
      return [200, { username, revoked: store.revokeSessionsFor(target.id) }];
    }],

    ['DELETE', /^\/api\/admin\/accounts\/([a-z0-9_-]+)$/, (req, [username]) => {
      const { error } = admin(req);
      if (error) return error;
      const { target, error: targetError } = adminTarget(username);
      if (targetError) return targetError;
      return [200, { username, ...store.deleteAccount(target.id) }];
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
  const aliases = { '/': '/index.html', '/api': '/api.html', '/docs': '/api.html', '/admin': '/admin.html' };
  const rel = normalize(aliases[pathname] ?? pathname).replace(/^(\.\.[/\\])+/, '');
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

export function start() {
  const store = createStore(process.env.MELLON_DATA || join(ROOT, 'data', 'locks.json'));
  const jev = createJevClient();
  const port = Number(process.env.PORT) || 3000;
  const server = createServer(createApp({ store, jev }));
  const shutdown = () => {
    store.flush();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  server.listen(port, () => {
    console.log(`Mellon listening on http://localhost:${port}`);
    console.log(jev.mode === 'live' ? `Judge: TypeSafe Jev (${jev.model})` : 'Judge: MOCK heuristics (set TYPESAFE_API_KEY to use Jev)');
    if (!store.encrypted) console.log('Warning: secrets stored in plaintext (set MELLON_SECRET_KEY to encrypt at rest)');
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) start();
