// Visual effects: scroll progress, reveal-on-scroll, parallax, radar, counters,
// the adjudication sequence and the engagement envelope chart. Everything here is
// decorative; the app works without it and honours prefers-reduced-motion.

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

/* Scroll: progress bar, "vigilance" readout, parallax, reveal */
export function initScroll() {
  const bar = document.getElementById('progress-bar');
  const vigilance = document.getElementById('vigilance');
  let queued = false;
  const update = () => {
    queued = false;
    const max = document.documentElement.scrollHeight - innerHeight;
    const p = max > 0 ? Math.min(1, scrollY / max) : 0;
    bar.style.transform = `scaleX(${p})`;
    vigilance.textContent = `${Math.round(p * 100)}%`;
    document.documentElement.style.setProperty('--scroll', String(scrollY));
  };
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
  addEventListener('resize', update);
  update();

  const targets = document.querySelectorAll('[data-reveal]');
  if (reducedMotion() || !('IntersectionObserver' in window)) {
    targets.forEach((t) => t.classList.add('in'));
    return;
  }
  document.documentElement.classList.add('fx');
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      io.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -8% 0px' });
  targets.forEach((t, i) => {
    t.style.setProperty('--stagger', `${(i % 4) * 90}ms`);
    io.observe(t);
  });
}

/* Count-up numbers, started when first scrolled into view */
export function createCounters(root) {
  const cells = [...root.querySelectorAll('[data-count]')];
  const shown = new Map(cells.map((c) => [c, 0]));
  let visible = false;
  let pending = null;

  const animate = (cell, to) => {
    const from = shown.get(cell);
    shown.set(cell, to);
    if (reducedMotion() || from === to) { cell.textContent = to.toLocaleString(); return; }
    const start = performance.now();
    const dur = 1200;
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      cell.textContent = Math.round(from + (to - from) * eased).toLocaleString();
      if (t < 1) requestAnimationFrame(step);
      else cell.classList.add('bump');
    };
    cell.classList.remove('bump');
    requestAnimationFrame(step);
  };

  const apply = (stats) => cells.forEach((c) => animate(c, stats[c.dataset.count] ?? 0));
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !visible) { visible = true; if (pending) apply(pending); }
  }).observe(root);

  return (stats) => { pending = stats; if (visible) apply(stats); };
}

/* Radar: each lock is a contact; decorative background contacts drift around */
export function createRadar(canvas) {
  const ctx = canvas.getContext('2d');
  let contacts = [];
  const ghosts = Array.from({ length: 7 }, () => ({ a: Math.random() * Math.PI * 2, r: 0.3 + Math.random() * 0.65, drift: (Math.random() - 0.5) * 0.0004, seen: -1e9 }));
  const pings = [];
  let size = 0;
  let sweep = -Math.PI / 2;
  let last = performance.now();

  const resize = () => {
    const dpr = Math.min(2, devicePixelRatio || 1);
    size = canvas.clientWidth;
    canvas.width = canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const norm = (a) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

  function draw(now) {
    const dt = now - last;
    last = now;
    if (!reducedMotion()) sweep += dt * 0.0011;
    const c = size / 2;
    const R = c - 6;
    // Not laid out yet (hidden, or still loading): try again next frame.
    if (R <= 0) { requestAnimationFrame(draw); return; }
    ctx.clearRect(0, 0, size, size);

    // Rings, crosshair, bearing ticks
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 4; i++) { ctx.beginPath(); ctx.arc(c, c, (R * i) / 4, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(c - R, c); ctx.lineTo(c + R, c); ctx.moveTo(c, c - R); ctx.lineTo(c, c + R); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    for (let d = 0; d < 360; d += 10) {
      const a = (d * Math.PI) / 180;
      const len = d % 30 === 0 ? 8 : 4;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * R, c + Math.sin(a) * R);
      ctx.lineTo(c + Math.cos(a) * (R - len), c + Math.sin(a) * (R - len));
      ctx.stroke();
    }

    // Sweep wedge with fading trail
    for (let i = 0; i < 28; i++) {
      const a0 = sweep - (i + 1) * 0.022;
      ctx.fillStyle = `rgba(53,208,127,${0.13 * (1 - i / 28)})`;
      ctx.beginPath(); ctx.moveTo(c, c); ctx.arc(c, c, R, a0, a0 + 0.023); ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(53,208,127,0.8)';
    ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c + Math.cos(sweep) * R, c + Math.sin(sweep) * R); ctx.stroke();

    // Contacts glow when the sweep passes, then fade
    const plot = (p, color, radius, floor = 0.18, peak = 1) => {
      if (norm(sweep - p.a) < 0.05) p.seen = now;
      const glow = Math.max(floor, peak - (now - p.seen) / 2600);
      const x = c + Math.cos(p.a) * p.r * R;
      const y = c + Math.sin(p.a) * p.r * R;
      ctx.globalAlpha = glow;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = glow * 0.35;
      ctx.beginPath(); ctx.arc(x, y, radius * 2.6, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      return { x, y, glow };
    };
    for (const g of ghosts) { g.a += g.drift * dt; plot(g, '#5a6068', 1.6, 0.12, 0.55); }
    for (const k of contacts) {
      const { x, y, glow } = plot(k, '#f5f6f7', 4, 0.55);
      ctx.strokeStyle = `rgba(245,246,247,${glow * 0.6})`;
      ctx.strokeRect(x - 8, y - 8, 16, 16);
      if (size > 260) {
        ctx.globalAlpha = glow;
        ctx.fillStyle = '#e8eaed';
        ctx.font = '500 10px "JetBrains Mono", monospace';
        const w = ctx.measureText(k.label).width;
        ctx.fillText(k.label, x + 12 + w > size - 4 ? x - 12 - w : x + 12, y - 10);
        ctx.globalAlpha = 1;
      }
    }

    // Verdict pings expand from the centre
    for (let i = pings.length - 1; i >= 0; i--) {
      const p = pings[i];
      const t = (now - p.at) / 1600;
      if (t >= 1) { pings.splice(i, 1); continue; }
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = 1 - t;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(c, c, t * R, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  return {
    setLocks(locks) {
      contacts = locks.map((l) => ({
        a: (hash(l.id) % 3600) / 3600 * Math.PI * 2,
        r: 0.3 + 0.6 * Math.min(1, Math.log10(1 + l.attemptCount) / 1.5),
        label: l.name.replace(/^Operation\s+/i, '').split(/\s+[—-]\s+/)[0].toUpperCase().slice(0, 18),
        seen: -1e9,
      }));
    },
    ping(granted) { pings.push({ at: performance.now(), color: granted ? '#35d07f' : '#ff4d4f' }); },
  };
}

/* Terminal-style sequence shown while the adjudicator is thinking */
export async function runSequence(list, lines, done) {
  list.replaceChildren();
  list.classList.remove('hidden');
  if (reducedMotion()) { list.classList.add('hidden'); return done; }
  let finished = false;
  done.finally(() => { finished = true; });
  for (const text of lines) {
    const li = document.createElement('li');
    li.textContent = text;
    list.append(li);
    await sleep(230);
    li.classList.add('ok');
  }
  if (!finished) {
    const li = document.createElement('li');
    li.className = 'wait';
    li.textContent = 'AWAITING JUDGEMENT';
    list.append(li);
  }
  try { return await done; } finally {
    list.lastElementChild?.classList.add('ok');
    await sleep(160);
    list.classList.add('hidden');
  }
}

/* Engagement envelope: compliance (x) vs manipulation (y) per attempt, with
   the lock's acceptance zone shaded. Shape + colour + tooltip encode verdict. */
export function renderEnvelope(figure, points, policy) {
  const plot = figure.querySelector('.envelope-plot');
  figure.classList.toggle('hidden', points.length === 0);
  if (!points.length) return;

  const W = 360, H = 240, m = { l: 44, r: 12, t: 12, b: 36 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const x = (v) => m.l + v * iw;
  const y = (v) => m.t + (1 - v) * ih;

  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Engagement envelope: ${points.length} attempt(s) plotted by compliance and manipulation` });

  // Acceptance zone: compliance >= min, manipulation <= max
  const zx = x(policy.minCompliance), zy = y(policy.maxManipulation);
  root.append(svg('rect', { x: zx, y: zy, width: x(1) - zx, height: y(0) - zy, class: 'zone' }));
  const zl = svg('text', { x: x(1) - 6, y: y(0) - 8, 'text-anchor': 'end', class: 'zone-label' });
  zl.textContent = 'ACCEPTANCE ZONE';
  root.append(zl);

  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    root.append(svg('line', { x1: x(t), x2: x(t), y1: y(0), y2: y(1), class: 'grid' }));
    root.append(svg('line', { x1: x(0), x2: x(1), y1: y(t), y2: y(t), class: 'grid' }));
    const xt = svg('text', { x: x(t), y: y(0) + 14, 'text-anchor': 'middle', class: 'tick' });
    xt.textContent = t.toFixed(2).replace(/0$/, '');
    const yt = svg('text', { x: x(0) - 8, y: y(t) + 3, 'text-anchor': 'end', class: 'tick' });
    yt.textContent = t.toFixed(2).replace(/0$/, '');
    root.append(xt, yt);
  }
  const xl = svg('text', { x: x(0.5), y: H - 4, 'text-anchor': 'middle', class: 'axis' });
  xl.textContent = 'COMPLIANCE →';
  const yl = svg('text', { x: 12, y: y(0.5), 'text-anchor': 'middle', class: 'axis', transform: `rotate(-90 12 ${y(0.5)})` });
  yl.textContent = 'MANIPULATION →';
  root.append(xl, yl);

  const tip = Object.assign(document.createElement('div'), { className: 'tip hidden' });
  points.forEach((p, i) => {
    const cx = x(p.compliance), cy = y(p.manipulation);
    const g = svg('g', { class: `pt ${p.granted ? 'grant' : 'deny'}${i === points.length - 1 ? ' latest' : ''}`, tabindex: '0' });
    if (i === points.length - 1) g.append(svg('circle', { cx, cy, r: 6, class: 'pulse' }));
    if (p.granted) g.append(svg('circle', { cx, cy, r: 5, class: 'mark' }));
    else g.append(svg('path', { d: `M${cx - 5} ${cy - 5}L${cx + 5} ${cy + 5}M${cx + 5} ${cy - 5}L${cx - 5} ${cy + 5}`, class: 'mark' }));
    g.append(svg('circle', { cx, cy, r: 13, class: 'hit' }));
    const show = () => {
      tip.replaceChildren();
      const strong = document.createElement('strong');
      strong.textContent = `#${p.n} ${p.granted ? 'Granted' : 'Denied'}`;
      const detail = document.createElement('span');
      detail.textContent = `compliance ${p.compliance.toFixed(2)} · manipulation ${p.manipulation.toFixed(2)}`;
      const label = document.createElement('span');
      label.className = 'tip-label';
      label.textContent = p.label;
      tip.append(strong, detail, label);
      tip.style.left = `${(cx / W) * 100}%`;
      tip.style.top = `${(cy / H) * 100}%`;
      tip.classList.remove('hidden');
    };
    const hide = () => tip.classList.add('hidden');
    g.addEventListener('pointerenter', show);
    g.addEventListener('focus', show);
    g.addEventListener('pointerleave', hide);
    g.addEventListener('blur', hide);
    root.append(g);
  });
  plot.replaceChildren(root, tip);
}
