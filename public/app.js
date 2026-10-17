import { classificationExample, sampleInputs } from './examples.js';

const $ = (sel) => document.querySelector(sel);
let current = null;

const api = async (path, opts = {}) => {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body && JSON.stringify(opts.body),
  });
  const data = res.status === 204 ? null : await res.json();
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
  const f = $('#create-form');
  f.minConfidence.placeholder = s.defaultPolicy.minConfidence;
  f.minCompliance.placeholder = s.defaultPolicy.minCompliance;
  f.maxManipulation.placeholder = s.defaultPolicy.maxManipulation;
}

async function loadLocks() {
  const locks = await api('/api/locks');
  const list = $('#lock-list');
  list.replaceChildren();
  if (!locks.length) list.append(el('li', { className: 'muted', textContent: 'No locks provisioned. Create one or load the classification example.' }));
  for (const lock of locks) {
    const btn = el('button', { type: 'button', className: 'lock' + (current?.id === lock.id ? ' active' : '') },
      el('strong', { textContent: lock.name }),
      el('span', { className: 'muted', textContent: `${lock.attemptCount} attempt${lock.attemptCount === 1 ? '' : 's'}` }));
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
  $('#attempt-form').input.value = '';

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
  fill.style.width = `${Math.round(Math.max(0, Math.min(1, c.value ?? 0)) * 100)}%`;
  bar.append(fill);
  if (typeof c.threshold === 'number') {
    const mark = el('div', { className: 'meter-threshold', title: `Threshold ${c.op} ${c.threshold}` });
    mark.style.left = `${c.threshold * 100}%`;
    bar.append(mark);
  }
  return bar;
}

function renderResult(r) {
  const box = $('#result');
  box.className = `result ${r.granted ? 'granted' : 'denied'}`;
  const meta = [r.mode === 'mock' ? 'Mock judge' : r.model, new Date().toISOString().slice(11, 19) + 'Z'].filter(Boolean).join(' · ');
  box.replaceChildren(el('div', { className: 'verdict' },
    el('h3', { textContent: r.granted ? 'Access granted' : 'Access denied' }),
    el('span', { className: 'verdict-meta', textContent: meta })));
  if (r.error) box.append(el('p', { className: 'note error', textContent: r.error }));
  if (r.mode === 'mock') box.append(el('p', { className: 'note', textContent: 'Mock judge: set TYPESAFE_API_KEY for real Jev decisions.' }));
  if (r.checks) {
    const readout = el('div', { className: 'readout' });
    for (const c of r.checks) {
      readout.append(el('div', { className: `metric ${c.pass ? 'pass' : 'fail'}`, title: c.detail },
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
      el('p', { textContent: `Lock "${lock.name}" created. Owner token (saved in this browser; copy it to manage the lock elsewhere):` }),
      el('code', { textContent: ownerToken }),
    );
    openLock(lock);
  } catch (err) {
    alert(err.message);
  }
};

$('#attempt-form').onsubmit = async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Judging…';
  try {
    renderResult(await api(`/api/locks/${current.id}/attempt`, { method: 'POST', body: { input: e.target.input.value } }));
  } catch (err) {
    renderResult({ granted: false, error: err.message });
  } finally {
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
    alert(err.message);
  }
};

$('#delete-lock').onclick = async () => {
  if (!confirm(`Delete "${current.name}" and its secret?`)) return;
  try {
    await api(`/api/locks/${current.id}`, { method: 'DELETE', headers: ownerHeaders() });
    current = null;
    $('#door').classList.add('hidden');
    loadLocks();
  } catch (err) {
    alert(err.message);
  }
};

const tick = () => { $('#clock').textContent = new Date().toISOString().slice(11, 19) + 'Z'; };
tick();
setInterval(tick, 1000);

loadStatus();
loadLocks();
