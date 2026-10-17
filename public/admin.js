// Admin console. Everything here is enforced by the server; this page only
// renders what /api/admin/* returns for an account flagged isAdmin.

const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

let session = null;
try { session = JSON.parse(localStorage.getItem('mellon:session')); } catch {}
let rows = [];
let selected = null;

const api = async (path, opts = {}) => {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.token}` } : {}) },
    body: opts.body && JSON.stringify(opts.body),
  });
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) throw Object.assign(new Error(data?.error || res.statusText), { status: res.status });
  return data;
};

let toastTimer;
function notify(message, kind = 'error') {
  const toast = $('#toast');
  toast.className = `toast ${kind === 'ok' ? 'ok' : ''}`;
  toast.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 5000);
}

const ago = (iso) => {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

function showGate(title, text, link) {
  const gate = $('#gate');
  gate.classList.remove('hidden');
  gate.replaceChildren(el('h2', { className: 'gate-title', textContent: title }), el('p', { textContent: text }));
  if (link) gate.append(el('a', { className: 'button ghost', href: link.href, textContent: link.label }));
}

/* Overview */

function renderTiles(t) {
  const tiles = [
    ['Accounts', t.accounts], ['Admins', t.admins], ['Active sessions', t.activeSessions],
    ['Locks', t.locks], ['Attempts', t.attempts], ['Granted', t.granted, 'grant'], ['Denied', t.denied, 'deny'],
  ];
  $('#tiles').replaceChildren(...tiles.map(([label, value, cls]) =>
    el('div', { className: 'tile' }, el('span', { className: `stat-value ${cls || ''}`, textContent: String(value) }), el('span', { className: 'stat-label', textContent: label }))));
}

function usageBar(r, max) {
  const bar = el('div', { className: 'usage', title: `${r.granted} granted, ${r.denied} denied` });
  if (r.attempts) {
    const g = el('span', { className: 'seg grant' });
    const d = el('span', { className: 'seg deny' });
    g.style.width = `${(r.granted / max) * 100}%`;
    d.style.width = `${(r.denied / max) * 100}%`;
    bar.append(g, d);
  }
  return el('div', { className: 'usage-cell' }, bar, el('span', { className: 'usage-num', textContent: `${r.granted} / ${r.denied}` }));
}

function renderTable() {
  const q = $('#filter').value.trim().toLowerCase();
  const max = Math.max(1, ...rows.map((r) => r.attempts));
  const body = $('#accounts tbody');
  body.replaceChildren();
  for (const r of rows.filter((x) => x.username.includes(q))) {
    const status = r.isAdmin ? 'Admin' : r.disabled ? 'Disabled' : 'Active';
    const tr = el('tr', { className: `${selected === r.username ? 'selected' : ''} ${r.disabled ? 'off' : ''}`, tabIndex: 0 },
      el('td', {}, el('strong', { textContent: `@${r.username}` })),
      el('td', {}, el('span', { className: `pill ${status.toLowerCase()}`, textContent: status })),
      el('td', { className: 'num', textContent: String(r.locks) }),
      el('td', {}, usageBar(r, max)),
      el('td', { className: 'num', textContent: `${r.signIns} / ${r.failedSignIns}` }),
      el('td', { className: 'num', textContent: String(r.apiCalls) }),
      el('td', { className: 'num', textContent: String(r.activeSessions) }),
      el('td', { textContent: ago(r.lastSeenAt), title: r.lastSeenAt || '' }));
    tr.onclick = () => select(r.username);
    tr.onkeydown = (e) => { if (e.key === 'Enter') select(r.username); };
    body.append(tr);
  }
  if (!body.children.length) body.append(el('tr', {}, el('td', { colSpan: 8, className: 'muted', textContent: 'No matching accounts.' })));
}

async function load() {
  const data = await api('/api/admin/overview');
  rows = data.accounts;
  renderTiles(data.totals);
  renderTable();
  if (selected && rows.some((r) => r.username === selected)) await select(selected);
  else { selected = null; $('#detail').classList.add('hidden'); }
}

/* Account detail */

async function select(username) {
  selected = username;
  renderTable();
  const { account: a, locks } = await api(`/api/admin/accounts/${username}`);
  $('#detail').classList.remove('hidden');
  $('#detail-name').textContent = `@${a.username}`;
  $('#detail-status').textContent = a.isAdmin ? 'Administrator' : a.disabled ? 'Disabled' : 'Active';
  $('#detail-log').replaceChildren();

  const facts = [
    ['Created', new Date(a.createdAt).toUTCString()],
    ['Last sign-in', a.lastSignInAt ? new Date(a.lastSignInAt).toUTCString() : 'never'],
    ['Last seen', a.lastSeenAt ? new Date(a.lastSeenAt).toUTCString() : 'never'],
    ['Sign-ins', `${a.signIns} granted, ${a.failedSignIns} denied`],
    ['API calls', String(a.apiCalls)],
    ['Active sessions', String(a.activeSessions)],
    ['Attempts on their locks', `${a.attempts} (${a.granted} granted, ${a.denied} denied)`],
  ];
  $('#detail-facts').replaceChildren(...facts.flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: v })]));

  const locked = a.isAdmin;
  for (const id of ['#act-disable', '#act-revoke', '#act-delete']) $(id).disabled = locked;
  $('#act-disable').textContent = a.disabled ? 'Enable account' : 'Disable account';
  $('#detail-note').classList.toggle('hidden', !locked);
  $('#detail-note').textContent = locked ? 'Administrator accounts are managed with scripts/admin.js on the server.' : '';

  const list = $('#detail-locks');
  list.replaceChildren();
  if (!locks.length) list.append(el('li', { className: 'muted', textContent: 'No locks.' }));
  for (const lock of locks) {
    const view = el('button', { type: 'button', className: 'ghost small', textContent: 'Log' });
    const del = el('button', { type: 'button', className: 'danger small', textContent: 'Delete' });
    view.onclick = () => showLog(lock);
    del.onclick = async () => {
      if (!confirm(`Delete lock "${lock.name}" and its payload?`)) return;
      try { await api(`/api/locks/${lock.id}`, { method: 'DELETE' }); notify(`Deleted "${lock.name}"`, 'ok'); await load(); } catch (e) { notify(e.message); }
    };
    list.append(el('li', { className: 'admin-lock' },
      el('span', {}, el('strong', { textContent: lock.name }), el('span', { className: 'muted', textContent: ` · ${lock.attemptCount} attempts` })),
      el('span', { className: 'row' }, view, del)));
  }
}

async function showLog(lock) {
  try {
    const attempts = await api(`/api/locks/${lock.id}/attempts`);
    const box = $('#detail-log');
    box.replaceChildren(el('p', { className: 'eyebrow', textContent: `Attempt log: ${lock.name}` }));
    if (!attempts.length) box.append(el('p', { className: 'muted', textContent: 'No attempts yet.' }));
    for (const at of attempts) {
      box.append(el('div', { className: `log-entry ${at.granted ? 'granted' : 'denied'}` },
        el('div', { className: 'muted', textContent: `${new Date(at.at).toUTCString()} · ${at.granted ? 'granted' : 'denied'}${at.error ? ' · error' : ''}${at.mode === 'mock' ? ' · mock' : ''}` }),
        el('div', { textContent: at.input })));
    }
  } catch (e) {
    notify(e.message);
  }
}

const act = async (fn, message) => {
  try { await fn(); notify(message, 'ok'); await load(); } catch (e) { notify(e.message); }
};

$('#act-disable').onclick = () => {
  const row = rows.find((r) => r.username === selected);
  act(() => api(`/api/admin/accounts/${selected}/disable`, { method: 'POST', body: { disabled: !row.disabled } }),
    `@${selected} ${row.disabled ? 'enabled' : 'disabled'}`);
};
$('#act-revoke').onclick = () => act(() => api(`/api/admin/accounts/${selected}/revoke-sessions`, { method: 'POST' }), `Revoked @${selected}'s sessions`);
$('#act-delete').onclick = () => {
  if (!confirm(`Delete @${selected} and every lock it owns? This cannot be undone.`)) return;
  act(() => api(`/api/admin/accounts/${selected}`, { method: 'DELETE' }), `Deleted @${selected}`);
};
$('#filter').oninput = renderTable;

/* Boot */

const nav = $('#nav-account');
if (session) { nav.textContent = `@${session.username}`; nav.classList.add('signed-in'); }

(async () => {
  if (!session) return showGate('Sign in required', 'Sign in on the console with an administrator account to continue.', { href: '/#identity', label: 'Go to sign in' });
  try {
    await load();
    $('#admin-app').classList.remove('hidden');
  } catch (e) {
    if (e.status === 403) showGate('Not an administrator', `@${session.username} does not have administrator access. An operator can grant it on the server with: node scripts/admin.js grant ${session.username}`);
    else if (e.status === 401) showGate('Session expired', 'Sign in again on the console.', { href: '/#identity', label: 'Go to sign in' });
    else showGate('Could not load', e.message);
  }
})();
