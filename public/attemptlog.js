// Owner-facing attempt log: every attempt with why it passed or failed.
// Shared by the console (lock owners) and the admin console.

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
};

const FILTERS = [
  ['', 'All'],
  ['granted', 'Granted'],
  ['denied', 'Denied'],
  ['error', 'Errors'],
  ['rate_limited', 'Rate-limited'],
];
const LABEL = { granted: 'Granted', denied: 'Denied', error: 'Error', rate_limited: 'Rate-limited' };
const fmt = (n) => (typeof n === 'number' ? n.toFixed(2) : '—');

// load({ limit, cursor, outcome }) must resolve to the /attempts response.
export function renderAttemptLog(container, { load, onError = console.error, pageSize = 20 }) {
  let outcome = '';
  let entries = [];
  let nextCursor = null;

  const summaryBox = el('div', { className: 'log-summary' });
  const filters = el('div', { className: 'log-filters', role: 'group', ariaLabel: 'Filter attempts' });
  const list = el('div', { className: 'log-list' });
  const more = el('button', { type: 'button', className: 'ghost small log-more hidden', textContent: 'Load more' });
  container.replaceChildren(summaryBox, filters, list, more);

  for (const [value, label] of FILTERS) {
    const b = el('button', { type: 'button', className: 'chip log-filter', textContent: label });
    b.dataset.outcome = value;
    b.setAttribute('aria-pressed', String(value === outcome));
    b.onclick = () => { outcome = value; refresh(); };
    filters.append(b);
  }

  const renderSummary = (s, total) => {
    const rate = s.attempts ? Math.round((s.granted / s.attempts) * 100) : 0;
    const stat = (label, value, cls = '') => el('span', { className: `log-stat ${cls}` }, el('b', { textContent: String(value) }), ` ${label}`);
    summaryBox.replaceChildren(
      stat('attempts', s.attempts),
      stat('granted', s.granted, 'grant'),
      stat('denied', s.denied - s.errors, 'deny'),
      stat('errors', s.errors, s.errors ? 'warn' : ''),
      stat('rate-limited', s.rateLimited, s.rateLimited ? 'warn' : ''),
      stat('pass rate', `${rate}%`),
      s.lastAttemptAt ? el('span', { className: 'log-stat muted', textContent: `last ${new Date(s.lastAttemptAt).toLocaleString()}` }) : null,
    );
    for (const b of filters.children) b.setAttribute('aria-pressed', String(b.dataset.outcome === outcome));
    summaryBox.dataset.total = String(total);
  };

  const checksTable = (checks = []) => el('table', { className: 'log-checks' },
    el('thead', {}, el('tr', {}, ...['Check', 'Value', 'Threshold', ''].map((h) => el('th', { textContent: h })))),
    el('tbody', {}, ...checks.map((c) => el('tr', { className: c.pass ? 'pass' : 'fail' },
      el('td', { textContent: c.name }),
      el('td', { textContent: fmt(c.value) }),
      el('td', { textContent: typeof c.threshold === 'number' ? `${c.op === '<=' ? '≤' : '≥'} ${c.threshold}` : c.name === 'decision' ? 'grant' : '—' }),
      el('td', { className: c.pass ? 'pass' : 'fail', textContent: c.pass ? '✓' : '✗' })))));

  const renderEntry = (e) => {
    const outcomeKey = e.outcome || (e.granted ? 'granted' : 'denied');
    const meta = [
      new Date(e.at).toLocaleString(),
      e.requester ? `@${e.requester}` : 'anonymous',
      e.ip,
      e.mode === 'mock' ? 'mock judge' : e.model,
      typeof e.latencyMs === 'number' ? `${e.latencyMs} ms` : null,
    ].filter(Boolean).join(' · ');
    const why = e.checks?.length || e.answers
      ? el('details', { className: 'log-why' },
        el('summary', { textContent: 'Why' }),
        e.checks?.length ? checksTable(e.checks) : null,
        e.policy ? el('p', { className: 'muted', textContent: `Thresholds in force: confidence ≥ ${e.policy.minConfidence}, compliance ≥ ${e.policy.minCompliance}, manipulation ≤ ${e.policy.maxManipulation}` }) : null,
        e.answers ? el('pre', { className: 'log-raw', textContent: JSON.stringify(e.answers, null, 2) }) : null)
      : null;
    return el('article', { className: `log-entry ${outcomeKey === 'granted' ? 'granted' : 'denied'} outcome-${outcomeKey}` },
      el('div', { className: 'log-head' },
        el('span', { className: `pill ${outcomeKey}`, textContent: LABEL[outcomeKey] || outcomeKey }),
        el('span', { className: 'muted', textContent: meta })),
      e.reason ? el('p', { className: 'log-reason', textContent: e.reason }) : null,
      e.input ? el('blockquote', { className: 'log-input', textContent: e.input }) : null,
      why);
  };

  async function fetchPage(cursor) {
    const q = { limit: pageSize, cursor };
    if (outcome) q.outcome = outcome;
    return load(q);
  }

  async function refresh() {
    try {
      const page = await fetchPage(0);
      entries = page.entries;
      nextCursor = page.nextCursor;
      renderSummary(page.summary, page.total);
      draw();
    } catch (err) {
      onError(err);
    }
  }

  function draw() {
    list.replaceChildren(...entries.map(renderEntry));
    if (!entries.length) list.append(el('p', { className: 'muted', textContent: outcome ? 'No attempts with this outcome.' : 'No attempts yet.' }));
    more.classList.toggle('hidden', nextCursor === null);
  }

  more.onclick = async () => {
    try {
      const page = await fetchPage(nextCursor);
      entries = entries.concat(page.entries);
      nextCursor = page.nextCursor;
      draw();
    } catch (err) {
      onError(err);
    }
  };

  refresh();
  return { refresh };
}
