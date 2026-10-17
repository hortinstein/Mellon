import { classificationExample, sampleInputs } from './examples.js';
import { createCounters, createRadar, initScroll, reducedMotion, renderEnvelope, runSequence } from './fx.js';

const $ = (sel) => document.querySelector(sel);
let current = null;
let defaultPolicy = { minConfidence: 0.6, minCompliance: 0.75, maxManipulation: 0.3 };
const plotted = new Map(); // lock id -> attempts plotted during this visit
const radar = createRadar($('#radar'));
const updateCounters = createCounters($('#stats'));
const refreshStats = () => api('/api/stats').then(updateCounters).catch(() => {});

// Mellon session (from a granted sign-in), kept per browser.
let session = null;
try { session = JSON.parse(localStorage.getItem('mellon:session')); } catch {}
const saveSession = (s) => { session = s; try { s ? localStorage.setItem('mellon:session', JSON.stringify(s)) : localStorage.removeItem('mellon:session'); } catch {} };

const api = async (path, opts = {}) => {
  const auth = session?.token ? { Authorization: `Bearer ${session.token}` } : {};
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...auth, ...(opts.headers || {}) },
    body: opts.body && JSON.stringify(opts.body),
  });
  const data = res.status === 204 ? null : await res.json();
  if (res.status === 401 && session && /session/i.test(data?.error || '')) {
    saveSession(null);
    renderIdentity();
  }
  if (!res.ok && !(data && 'granted' in data)) throw new Error(data?.error || res.statusText);
  return data;
};

const tokens = {
  get: (id) => { try { return localStorage.getItem(`mellon:owner:${id}`) || ''; } catch { return ''; } },
  set: (id, t) => { try { localStorage.setItem(`mellon:owner:${id}`, t); } catch {} },
};

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

async function loadStatus() {
  const s = await api('/api/status');
  const badge = $('#status');
  badge.textContent = s.mode === 'live' ? `Jev · ${s.model}` : 'Mock judge';
  badge.className = `badge ${s.mode}`;
  badge.title = s.mode === 'live' ? 'Decisions come from TypeSafe Jev' : 'No TYPESAFE_API_KEY set: decisions use crude keyword heuristics';
  $('#crypto').textContent = s.encrypted ? 'AES-256-GCM' : 'Plaintext';
  defaultPolicy = s.defaultPolicy;
  const f = $('#create-form');
  f.minConfidence.placeholder = s.defaultPolicy.minConfidence;
  f.minCompliance.placeholder = s.defaultPolicy.minCompliance;
  f.maxManipulation.placeholder = s.defaultPolicy.maxManipulation;
}

async function loadLocks() {
  const locks = await api('/api/locks');
  radar.setLocks(locks);
  const list = $('#lock-list');
  list.replaceChildren();
  if (!locks.length) list.append(el('li', { className: 'muted', textContent: 'No locks provisioned. Create one or load the classification example.' }));
  for (const lock of locks) {
    const btn = el('button', { type: 'button', className: 'lock' + (current?.id === lock.id ? ' active' : '') },
      el('strong', { textContent: lock.name }),
      el('span', { className: 'muted' },
        ...(lock.owner ? [el('span', { className: 'owner', textContent: `@${lock.owner}` })] : []),
        `${lock.attemptCount} attempt${lock.attemptCount === 1 ? '' : 's'}`));
    btn.onclick = () => openLock(lock);
    list.append(el('li', {}, btn));
  }
}

function openLock(lock) {
  current = lock;
  $('#door').classList.remove('hidden');
  $('#door-name').textContent = lock.name;
  $('#door-desc').textContent = lock.description;
  $('#door-rules').textContent = lock.rules;
  $('#result').classList.add('hidden');
  $('#log').replaceChildren();
  $('#owner-token').value = tokens.get(lock.id);
  const mine = session && lock.owner === session.username;
  $('#owner-note').classList.toggle('hidden', !mine);
  $('#owner-note').textContent = mine ? `You own this lock through @${session.username}. No owner token needed.` : '';
  $('#attempt-form').input.value = '';
  $('#sequence').classList.add('hidden');
  drawEnvelope();

  const samples = $('#samples');
  samples.replaceChildren();
  if (lock.name === classificationExample.name) {
    samples.append(el('span', { className: 'muted', textContent: 'Scenarios' }));
    for (const s of sampleInputs) {
      const chip = el('button', { type: 'button', className: `chip ${s.expect}`, textContent: s.label, title: `Expected: ${s.expect}` });
      chip.onclick = () => { $('#attempt-form').input.value = s.text; };
      samples.append(chip);
    }
  }
  loadLocks();
  $('#door').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function meter(c) {
  const bar = el('div', { className: 'meter' });
  const fill = el('div', { className: 'meter-fill' });
  const width = `${Math.round(Math.max(0, Math.min(1, c.value ?? 0)) * 100)}%`;
  if (reducedMotion()) fill.style.width = width;
  else requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = width; }));
  bar.append(fill);
  if (typeof c.threshold === 'number') {
    const mark = el('div', { className: 'meter-threshold', title: `Threshold ${c.op} ${c.threshold}` });
    mark.style.left = `${c.threshold * 100}%`;
    bar.append(mark);
  }
  return bar;
}

function renderResult(r, box = $('#result')) {
  box.className = `result ${r.granted ? 'granted' : 'denied'}`;
  const meta = [r.mode === 'mock' ? 'Mock judge' : r.model, new Date().toISOString().slice(11, 19) + 'Z'].filter(Boolean).join(' · ');
  box.replaceChildren(el('div', { className: 'verdict' },
    el('h3', { textContent: r.granted ? 'Access granted' : 'Access denied' }),
    el('span', { className: 'verdict-meta', textContent: meta })));
  if (r.error) box.append(el('p', { className: 'note error', textContent: r.error }));
  if (r.mode === 'mock') box.append(el('p', { className: 'note', textContent: 'Mock judge: set TYPESAFE_API_KEY for real Jev decisions.' }));
  if (r.checks) {
    const readout = el('div', { className: 'readout' });
    for (const [i, c] of r.checks.entries()) {
      readout.append(el('div', { className: `metric ${c.pass ? 'pass' : 'fail'}`, title: c.detail, style: `--i:${i}` },
        el('span', { className: 'metric-name', textContent: c.name }),
        meter(c),
        el('span', { className: 'metric-value', textContent: typeof c.value === 'number' ? c.value.toFixed(2) : 'n/a' }),
        el('span', { className: `metric-flag ${c.pass ? 'pass' : 'fail'}`, textContent: c.pass ? '✓' : '✗' })));
    }
    box.append(readout);
  }
  if (r.secret) {
    box.append(el('div', { className: 'payload' },
      el('p', { className: 'eyebrow', textContent: 'Payload released' }),
      el('pre', { className: 'secret', textContent: r.secret })));
  }
  if (r.token) {
    box.append(el('div', { className: 'payload' },
      el('p', { className: 'eyebrow', textContent: 'Session issued' }),
      el('pre', { className: 'secret', textContent: `@${r.username} · expires ${new Date(r.expiresAt).toUTCString()}` })));
  }
}

/* Identity: accounts are themselves Mellons */

async function renderIdentity() {
  const on = Boolean(session);
  $('#signed-out').classList.toggle('hidden', on);
  $('#signed-in').classList.toggle('hidden', !on);
  $('#whoami').textContent = on ? `@${session.username}` : 'Not signed in';
  $('#whoami').classList.toggle('on', on);
  const nav = $('#nav-account');
  nav.textContent = on ? `@${session.username}` : 'Sign in';
  nav.classList.toggle('signed-in', on);
  if (!on) return;
  $('#me-name').textContent = `@${session.username}`;
  try {
    const me = await api('/api/me');
    const list = $('#my-locks');
    list.replaceChildren();
    if (!me.locks.length) list.append(el('li', { className: 'muted', textContent: 'No locks yet. Anything you provision now is linked to you.' }));
    for (const lock of me.locks) {
      const btn = el('button', { type: 'button', className: 'lock' },
        el('strong', { textContent: lock.name }),
        el('span', { className: 'muted', textContent: `${lock.attemptCount} attempt${lock.attemptCount === 1 ? '' : 's'}` }));
      btn.onclick = () => openLock(lock);
      list.append(el('li', {}, btn));
    }
  } catch {}
}

for (const tab of document.querySelectorAll('.tab')) {
  tab.onclick = () => {
    for (const t of document.querySelectorAll('.tab')) t.setAttribute('aria-selected', String(t === tab));
    $('#signin-form').classList.toggle('hidden', tab.dataset.tab !== 'signin');
    $('#signup-form').classList.toggle('hidden', tab.dataset.tab !== 'signup');
  };
}

$('#signup-form').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const r = await api('/api/accounts', { method: 'POST', body: { username: f.username.value, rules: f.rules.value } });
    saveSession({ token: r.token, username: r.account.username, expiresAt: r.expiresAt });
    f.reset();
    notify(`Account @${r.account.username} created. You are signed in.`, 'ok');
    renderIdentity();
    loadLocks();
    refreshStats();
  } catch (err) {
    notify(err.message);
  }
};

$('#signin-form').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true;
  $('#signin-result').classList.add('hidden');
  const request = api('/api/sessions', { method: 'POST', body: { username: f.username.value, statement: f.statement.value } });
  const lines = ['ESTABLISHING UPLINK TO ADJUDICATOR', 'TRANSMITTING IDENTITY STATEMENT', 'IDENTITY RULES NEVER SENT TO CLIENT', 'EVALUATING IDENTITY RULES'];
  try {
    const r = await runSequence($('#signin-sequence'), lines, request);
    renderResult(r, $('#signin-result'));
    radar.ping(r.granted);
    if (r.granted) {
      saveSession({ token: r.token, username: r.username, expiresAt: r.expiresAt });
      f.reset();
      setTimeout(() => { $('#signin-result').classList.add('hidden'); renderIdentity(); loadLocks(); }, reducedMotion() ? 0 : 1600);
    }
  } catch (err) {
    renderResult({ granted: false, error: err.message }, $('#signin-result'));
  } finally {
    btn.disabled = false;
  }
};

$('#signout').onclick = async () => {
  try { await api('/api/sessions', { method: 'DELETE' }); } catch {}
  saveSession(null);
  document.querySelector('.tab[data-tab=signin]').click();
  renderIdentity();
  loadLocks();
  if (current) openLock(current);
};

$('#copy-token').onclick = async () => {
  try {
    await navigator.clipboard.writeText(session.token);
    notify('Session token copied. Send it as "Authorization: Bearer <token>".', 'ok');
  } catch {
    notify('Could not access the clipboard.');
  }
};

let toastTimer;
function notify(message, kind = 'error') {
  const toast = $('#toast');
  toast.className = `toast ${kind === 'ok' ? 'ok' : ''}`;
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 5000);
}

function drawEnvelope() {
  if (!current) return;
  renderEnvelope($('#envelope'), plotted.get(current.id) || [], { ...defaultPolicy, ...current.policy });
}

function recordPoint(r, input) {
  const value = (name) => r.checks?.find((c) => c.name === name)?.value;
  const compliance = value('compliance');
  const manipulation = value('manipulation');
  if (typeof compliance !== 'number' || typeof manipulation !== 'number') return;
  const points = plotted.get(current.id) || [];
  const sample = sampleInputs.find((s) => s.text === input);
  points.push({ n: points.length + 1, compliance, manipulation, granted: r.granted, label: sample ? sample.label : input.slice(0, 48) });
  plotted.set(current.id, points);
  drawEnvelope();
}

$('#load-example').onclick = () => {
  const f = $('#create-form');
  for (const [k, v] of Object.entries(classificationExample)) f[k].value = v;
};

$('#create-form').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  const policy = {};
  for (const k of ['minConfidence', 'minCompliance', 'maxManipulation']) if (f[k].value !== '') policy[k] = Number(f[k].value);
  try {
    const { lock, ownerToken } = await api('/api/locks', {
      method: 'POST',
      body: { name: f.name.value, description: f.description.value, rules: f.rules.value, secret: f.secret.value, policy },
    });
    tokens.set(lock.id, ownerToken);
    f.reset();
    const notice = $('#created');
    notice.classList.remove('hidden');
    notice.replaceChildren(
      el('p', { textContent: `Lock "${lock.name}" created${lock.owner ? ` and linked to @${lock.owner}` : ''}. Owner token (saved in this browser; copy it to manage the lock elsewhere):` }),
      el('code', { textContent: ownerToken }),
    );
    openLock(lock);
    refreshStats();
    renderIdentity();
  } catch (err) {
    notify(err.message);
  }
};

$('#attempt-form').onsubmit = async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Judging…';
  const input = e.target.input.value;
  $('#result').classList.add('hidden');
  const request = api(`/api/locks/${current.id}/attempt`, { method: 'POST', body: { input } });
  const lines = [
    'ESTABLISHING UPLINK TO ADJUDICATOR',
    `TRANSMITTING STATEMENT OF ACCESS (${input.length} CHARS)`,
    'PAYLOAD WITHHELD FROM MODEL',
    'EVALUATING RULES OF ENGAGEMENT',
    'COMPUTING MANIPULATION INDEX',
  ];
  try {
    const r = await runSequence($('#sequence'), lines, request);
    renderResult(r);
    recordPoint(r, input);
    radar.ping(r.granted);
  } catch (err) {
    renderResult({ granted: false, error: err.message });
    radar.ping(false);
  } finally {
    refreshStats();
    btn.disabled = false;
    btn.textContent = 'Request entry';
    loadLocks();
  }
};

const ownerHeaders = () => ({ 'X-Owner-Token': $('#owner-token').value.trim() });

$('#show-log').onclick = async () => {
  try {
    const attempts = await api(`/api/locks/${current.id}/attempts`, { headers: ownerHeaders() });
    const log = $('#log');
    log.replaceChildren();
    if (!attempts.length) log.append(el('p', { className: 'muted', textContent: 'No attempts yet.' }));
    for (const a of attempts) {
      log.append(el('div', { className: `log-entry ${a.granted ? 'granted' : 'denied'}` },
        el('div', { className: 'muted', textContent: `${new Date(a.at).toLocaleString()} · ${a.granted ? 'granted' : 'denied'}${a.error ? ' · error' : ''}${a.mode === 'mock' ? ' · mock' : ''}` }),
        el('div', { textContent: a.input })));
    }
  } catch (err) {
    notify(err.message);
  }
};

$('#delete-lock').onclick = async () => {
  if (!confirm(`Delete "${current.name}" and its secret?`)) return;
  try {
    await api(`/api/locks/${current.id}`, { method: 'DELETE', headers: ownerHeaders() });
    current = null;
    $('#door').classList.add('hidden');
    loadLocks();
    refreshStats();
  } catch (err) {
    notify(err.message);
  }
};

const tick = () => { $('#clock').textContent = new Date().toISOString().slice(11, 19) + 'Z'; };
tick();
setInterval(tick, 1000);

initScroll();
renderIdentity();
loadStatus();
loadLocks();
refreshStats();
