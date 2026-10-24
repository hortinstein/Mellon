import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../src/store.js';
import { createApp } from '../server.js';

export const passingAnswers = {
  decision: { type: 'choice', choice: 'grant', probabilities: { grant: 0.95, deny: 0.05 }, confidence: 0.9 },
  compliance: { type: 'score', score: 2.8 },
  manipulation: { type: 'noul', noul: 0.02 },
};

export const tempFile = (name = 'locks.json') => join(mkdtempSync(join(tmpdir(), 'mellon-')), name);

// A judge that records every request it receives and answers with `answers()`.
export function fakeJudge(answers = () => passingAnswers) {
  const calls = [];
  return {
    calls,
    mode: 'live',
    model: 'fake',
    async ask(state, questions) {
      calls.push({ state, questions });
      return { model: 'fake', answers: answers(state, questions) };
    },
  };
}

export async function withServer(jev, fn, { secretKey = 'test-key' } = {}) {
  const file = tempFile();
  const store = createStore(file, { secretKey });
  const server = createServer(createApp({ store, jev }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, { body, headers, raw, ...opts } = {}) => {
    const res = await fetch(base + path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: raw ?? (body && JSON.stringify(body)),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    return { status: res.status, body: json, text, headers: res.headers };
  };
  try {
    await fn({ call, file, store, base });
  } finally {
    server.close();
  }
}
