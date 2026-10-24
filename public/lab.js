// Field report page: the attribute-based access demo. Loads the file catalogue,
// lets the visitor edit a principal, and shows both stages of every decision.
import { initScroll, reducedMotion } from './fx.js';
import { PRESETS } from './lab-presets.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
};


let catalog = null;
const form = $('#principal');
const field = (name) => form.elements.namedItem(name);

const tierLabel = (n) => `Tier ${n} · ${catalog.tiers[n].name}`;
const groupName = (id) => catalog.groups.find((g) => g.id === id)?.name ?? id;

function requirementText(r) {
  const parts = [tierLabel(r.minTier) + '+'];
  if (r.allGroups) parts.push(r.allGroups.map(groupName).join(' + '));
  if (r.anyGroups) parts.push(r.anyGroups.map(groupName).join(' or '));
  parts.push(r.kinds.length === 1 ? (r.kinds[0] === 'human' ? 'humans only' : 'agents only') : 'humans or agents');
  if (r.supervisor === 'all') parts.push('countersigning human');
  if (r.supervisor === 'agent') parts.push('agents need a supervisor');
  return parts.join(' · ');
}

function fill(p) {
  field('name').value = p.name;
  field('kind').value = p.kind;
  field('tier').value = String(p.tier);
  for (const box of form.querySelectorAll('input[name=group]')) box.checked = p.groups.includes(box.value);
  field('supervisor').value = p.supervisor;
  field('purpose').value = p.purpose;
}

function read() {
  return {
    name: field('name').value,
    kind: field('kind').value,
    tier: Number(field('tier').value),
    groups: [...form.querySelectorAll('input[name=group]:checked')].map((b) => b.value),
    supervisor: field('supervisor').value,
    purpose: field('purpose').value,
  };
}

function renderCabinet(results = null) {
  const byId = new Map((results || []).map((r) => [r.id, r]));
  $('#files').replaceChildren(...catalog.files.map((f) => {
    const r = byId.get(f.id);
    const state = r ? (r.granted ? 'granted' : 'denied') : 'idle';
    const item = el('li', { className: `file ${state}`, id: `file-${f.id}` },
      el('div', { className: 'file-head' },
        el('div', {},
          el('h3', { className: 'file-name', textContent: f.name }),
          el('p', { className: 'file-req', textContent: requirementText(f.requires) })),
        el('span', { className: `file-state ${state}`, textContent: r ? (r.granted ? 'Open' : 'Denied') : 'Locked' })));
    if (r) item.append(stages(r));
    else item.append(el('p', { className: 'file-desc', textContent: f.description }));
    return item;
  }));
  if (results) {
    const open = results.filter((r) => r.granted).length;
    $('#summary').textContent = `· ${open} of ${results.length} open`;
  }
}

function stages(r) {
  const box = el('div', { className: 'stages' });
  const a = r.attributes;
  box.append(stage('1', 'Attributes · code', a.pass ? 'pass' : 'fail', a.pass ? 'Tier, groups and type meet the requirements.' : a.reasons.join('. ') + '.'));
  if (!r.purpose) {
    box.append(stage('2', 'Purpose · Jev', 'skip', 'Not asked: the attributes already failed.'));
  } else {
    const s = stage('2', 'Purpose · Jev', r.purpose.pass ? 'pass' : 'fail', r.purpose.reason);
    if (r.purpose.checks) s.append(readout(r.purpose.checks));
    box.append(s);
  }
  if (r.content) box.append(el('div', { className: 'payload' }, el('p', { className: 'eyebrow', textContent: 'File released' }), el('pre', { className: 'secret', textContent: r.content })));
  return box;
}

function stage(n, title, state, text) {
  const flag = { pass: '✓', fail: '✗', skip: '—' }[state];
  return el('div', { className: `stage ${state}` },
    el('p', { className: 'stage-title' }, el('span', { className: 'idx', textContent: n }), ` ${title} `, el('span', { className: `metric-flag ${state}`, textContent: flag })),
    el('p', { className: 'stage-text', textContent: text }));
}

function readout(checks) {
  const box = el('div', { className: 'readout' });
  for (const [i, c] of checks.entries()) {
    const fillBar = el('div', { className: 'meter-fill' });
    const width = `${Math.round(Math.max(0, Math.min(1, c.value ?? 0)) * 100)}%`;
    if (reducedMotion()) fillBar.style.width = width;
    else requestAnimationFrame(() => requestAnimationFrame(() => { fillBar.style.width = width; }));
    const bar = el('div', { className: 'meter' }, fillBar);
    if (typeof c.threshold === 'number') {
      const mark = el('div', { className: 'meter-threshold', title: `Threshold ${c.op} ${c.threshold}` });
      mark.style.left = `${c.threshold * 100}%`;
      bar.append(mark);
    }
    box.append(el('div', { className: `metric ${c.pass ? 'pass' : 'fail'}`, title: c.detail, style: `--i:${i}` },
      el('span', { className: 'metric-name', textContent: c.name }),
      bar,
      el('span', { className: 'metric-value', textContent: typeof c.value === 'number' ? c.value.toFixed(2) : 'n/a' }),
      el('span', { className: `metric-flag ${c.pass ? 'pass' : 'fail'}`, textContent: c.pass ? '✓' : '✗' })));
  }
  return box;
}

function toast(message) {
  const t = $('#toast');
  t.textContent = message;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), 5000);
}

form.onsubmit = async (e) => {
  e.preventDefault();
  const button = $('#run');
  button.disabled = true;
  button.textContent = 'Adjudicating';
  try {
    const res = await fetch('/api/demo/clearance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ principal: read() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    renderCabinet(data.results);
  } catch (err) {
    toast(err.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Request access';
  }
};

async function init() {
  catalog = await (await fetch('/api/demo/clearance')).json();
  const badge = $('#status');
  badge.textContent = catalog.mode === 'live' ? `Jev · ${catalog.model}` : 'Mock judge';
  badge.className = `badge ${catalog.mode}`;
  if (catalog.mode === 'mock') {
    $('#demo-note').textContent += ' This server is running the stand-in judge (no TYPESAFE_API_KEY), so purpose decisions are crude keyword matches; the attribute stage is exact either way.';
  }

  field('kind').replaceChildren(...catalog.kinds.map((k) => el('option', { value: k.id, textContent: k.name })));
  field('tier').replaceChildren(...catalog.tiers.map((t) => el('option', { value: String(t.level), textContent: tierLabel(t.level) })));
  $('#groups').replaceChildren(...catalog.groups.map((g) =>
    el('label', { className: 'check' }, el('input', { type: 'checkbox', name: 'group', value: g.id }), g.name)));

  $('#presets').replaceChildren(...PRESETS.map((p) => {
    const chip = el('button', { type: 'button', className: `chip ${p.expect}`, textContent: p.label });
    chip.onclick = () => { fill(p.principal); renderCabinet(); $('#summary').textContent = ''; };
    return chip;
  }));
  fill(PRESETS[0].principal);
  renderCabinet();
}

const tick = () => { $('#clock').textContent = new Date().toISOString().slice(11, 19) + 'Z'; };
tick();
setInterval(tick, 1000);

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

initScroll();
init().catch((err) => toast(`Could not load the demo: ${err.message}`));
