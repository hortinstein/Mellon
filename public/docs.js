// API docs page: live base URL, language tabs, copy buttons, table-of-contents
// highlighting and a "Try it" console that calls this server.
import { initScroll } from './fx.js';

const $ = (sel) => document.querySelector(sel);

let session = null;
try { session = JSON.parse(localStorage.getItem('mellon:session')); } catch {}

// Show the real origin everywhere examples mention the base URL.
for (const node of document.querySelectorAll('.origin')) node.textContent = location.origin;

// Account chip + judge status, same as the console.
const nav = $('#nav-account');
if (session) { nav.textContent = `@${session.username}`; nav.classList.add('signed-in'); }
fetch('/api/status').then((r) => r.json()).then((s) => {
  const badge = $('#status');
  badge.textContent = s.mode === 'live' ? `Jev · ${s.model}` : 'Mock judge';
  badge.className = `badge ${s.mode}`;
}).catch(() => {});
const tick = () => { $('#clock').textContent = new Date().toISOString().slice(11, 19) + 'Z'; };
tick();
setInterval(tick, 1000);

/* Language tabs, remembered across visits */
const setLang = (lang) => {
  for (const group of document.querySelectorAll('.codetabs')) {
    for (const b of group.querySelectorAll('[data-lang]')) {
      if (b.tagName === 'BUTTON') b.setAttribute('aria-selected', String(b.dataset.lang === lang));
      else b.hidden = b.dataset.lang !== lang;
    }
  }
  try { localStorage.setItem('mellon:lang', lang); } catch {}
};
for (const b of document.querySelectorAll('.langs button')) b.onclick = () => setLang(b.dataset.lang);
let lang = 'curl';
try { lang = localStorage.getItem('mellon:lang') || 'curl'; } catch {}
setLang(lang);

/* Copy buttons on every code block */
for (const pre of document.querySelectorAll('.docs pre')) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'copy';
  btn.textContent = 'Copy';
  btn.onclick = async () => {
    try {
      await navigator.clipboard.writeText(pre.querySelector('code').textContent);
      btn.textContent = 'Copied';
    } catch {
      btn.textContent = 'Unavailable';
    }
    setTimeout(() => { btn.textContent = 'Copy'; }, 1400);
  };
  pre.append(btn);
}

/* Highlight the section in view */
const links = new Map([...document.querySelectorAll('.toc a')].map((a) => [a.getAttribute('href').slice(1), a]));
const spy = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    for (const a of links.values()) a.removeAttribute('aria-current');
    links.get(e.target.id)?.setAttribute('aria-current', 'true');
  }
}, { rootMargin: '-30% 0px -60% 0px' });
document.querySelectorAll('.docs > section').forEach((s) => spy.observe(s));

/* Try it */
const presets = [
  { label: 'Server status', method: 'GET', path: '/api/status' },
  { label: 'Platform stats', method: 'GET', path: '/api/stats' },
  { label: 'List locks', method: 'GET', path: '/api/locks' },
  { label: 'My account', method: 'GET', path: '/api/me', auth: true },
  { label: 'Create an account', method: 'POST', path: '/api/accounts', body: { username: `demo-${Math.random().toString(36).slice(2, 7)}`, rules: 'The requester must say the passphrase osprey lantern and name the harbor town of Kettleby.' } },
  { label: 'Sign in', method: 'POST', path: '/api/sessions', body: { username: session?.username || 'dana', statement: 'Passphrase osprey lantern. I grew up in Kettleby.' } },
  { label: 'Create a lock', method: 'POST', path: '/api/locks', auth: true, body: { name: 'API demo lock', rules: 'Requester must say the password mellon', secret: 'The doors open.' } },
  { label: 'Request entry', method: 'POST', path: '/api/locks/LOCK_ID/attempt', body: { input: 'Requester says: password mellon' } },
  { label: 'Attempt log', method: 'GET', path: '/api/locks/LOCK_ID/attempts', auth: true },
];
const presetSelect = $('#try-preset');
presets.forEach((p, i) => presetSelect.append(Object.assign(document.createElement('option'), { value: i, textContent: `${p.method} ${p.label}` })));

let lastLockId = null;
const applyPreset = (p) => {
  $('#try-method').value = p.method;
  $('#try-path').value = lastLockId ? p.path.replace('LOCK_ID', lastLockId) : p.path;
  $('#try-body').value = p.body ? JSON.stringify(p.body, null, 2) : '';
  $('#try-auth').checked = Boolean(session && (p.auth || p.method !== 'GET'));
};
presetSelect.onchange = () => applyPreset(presets[presetSelect.value]);
applyPreset(presets[0]);

$('#try-auth').disabled = !session;
$('#try-auth-who').textContent = session ? `(@${session.username})` : '(sign in on the console first)';

$('#try-send').onclick = async () => {
  const method = $('#try-method').value;
  const headers = { 'Content-Type': 'application/json' };
  if ($('#try-auth').checked && session) headers.Authorization = `Bearer ${session.token}`;
  if ($('#try-owner').value.trim()) headers['X-Owner-Token'] = $('#try-owner').value.trim();
  let body;
  if (method !== 'GET' && $('#try-body').value.trim()) {
    try { body = JSON.stringify(JSON.parse($('#try-body').value)); } catch {
      showOut('Invalid JSON in body', 0, null);
      return;
    }
  }
  const started = performance.now();
  try {
    const res = await fetch($('#try-path').value, { method, headers, body });
    const text = await res.text();
    let pretty = text;
    try {
      const json = JSON.parse(text);
      pretty = JSON.stringify(json, null, 2);
      if (json?.lock?.id) lastLockId = json.lock.id;
    } catch {}
    showOut(`${res.status} ${res.statusText}`, performance.now() - started, pretty, res.ok);
  } catch (err) {
    showOut(err.message, performance.now() - started, null);
  }
};

function showOut(status, ms, text, ok = false) {
  $('#try-out').classList.remove('hidden');
  $('#try-status').textContent = status;
  $('#try-status').className = ok ? 'ok' : 'bad';
  $('#try-time').textContent = ms ? `${Math.round(ms)} ms` : '';
  $('#try-response').textContent = text ?? '';
}

initScroll();
