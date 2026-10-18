// Vercel serverless entry point. Vercel serves public/ from its CDN and
// rewrites every /api/* request here (see vercel.json). Storage is Redis when
// Upstash credentials are present; without them it falls back to a file in
// /tmp, which does not survive between invocations (/api/status reports
// "persistent": false).
import { createApp } from '../server.js';
import { createJevClient } from '../src/jev.js';
import { backendFromEnv, createStore } from '../src/store.js';

const store = createStore(backendFromEnv(process.env));
const handler = createApp({ store, jev: createJevClient() });

export default function mellon(req, res) {
  // The platform normally passes the original URL; if it passes the rewritten
  // one (/api/index?path=locks/abc), restore the original before routing.
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/index' || url.pathname === '/api/index.js') {
    const path = url.searchParams.get('path') ?? '';
    url.searchParams.delete('path');
    req.url = `/api/${path}${url.search}`;
  }
  return handler(req, res);
}
