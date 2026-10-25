// Sequence-diagram stepper. Pure logic exported for tests; DOM only inside mount().
const NS = 'http://www.w3.org/2000/svg';
const W = 480, LEFT = 140, RIGHT = 100, TOP = 56, ROW = 52;

export const clampStep = (i, n) => Math.max(0, Math.min(i, Math.max(n, 1) - 1));

const laneX = (i, n) => LEFT + (n < 2 ? 0 : (i * (W - LEFT - RIGHT)) / (n - 1));

export function layoutSteps(steps, width = W, lanes) {
  const n = lanes || Math.max(2, ...steps.flatMap((s) => [s.from, s.to]).map((v) => v + 1));
  const x = (i) => LEFT + (i * (width - LEFT - RIGHT)) / (n - 1);
  return steps.map((s, k) => {
    const o = { x1: x(s.from), x2: x(s.to), y: TOP + ROW * k };
    if (s.drop) o.dropX = (o.x1 + o.x2) / 2;
    return o;
  });
}

export function validate(cfg) {
  const errs = [];
  if (!Array.isArray(cfg.lanes) || cfg.lanes.length < 2) return ['lanes must be an array of at least 2 names'];
  if (!Array.isArray(cfg.scenarios) || !cfg.scenarios.length) return ['scenarios must be a non-empty array'];
  cfg.scenarios.forEach((sc, i) => {
    if (!sc || !sc.name) errs.push(`scenario ${i}: missing name`);
    if (!sc || !Array.isArray(sc.steps) || !sc.steps.length) return errs.push(`scenario ${i}: steps must be a non-empty array`);
    sc.steps.forEach((s, j) => {
      const ok = (v) => Number.isInteger(v) && v >= 0 && v < cfg.lanes.length;
      if (!ok(s.from) || !ok(s.to)) errs.push(`scenario ${i} step ${j}: from/to must be lane indexes 0-${cfg.lanes.length - 1}`);
      else if (s.from === s.to) errs.push(`scenario ${i} step ${j}: from and to are the same lane`);
      if (!s.label || typeof s.label !== 'string') errs.push(`scenario ${i} step ${j}: missing label`);
    });
  });
  return errs;
}

const h = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const s = (tag, attrs, text) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, String(v));
  if (text != null) n.textContent = text;
  return n;
};
const btn = (cls, text) => { const b = h('button', cls, text); b.type = 'button'; return b; };

export function mount(host, cfg) {
  let sc = 0, step = 0;
  const root = h('div', 'nbtimeline');
  const scnRow = h('div', 'tl-row');
  const scnBtns = cfg.scenarios.map((x, i) => {
    const b = btn('tl-scn', x.name);
    b.addEventListener('click', () => { sc = i; step = 0; render(); });
    scnRow.append(b);
    return b;
  });
  const prev = btn('tl-prev', 'Prev'), next = btn('tl-next', 'Next');
  const count = h('span', 'tl-count'); count.setAttribute('aria-live', 'polite');
  const ctl = h('div', 'tl-row'); ctl.append(prev, next, count);
  const svg = s('svg', { class: 'tl-svg', width: '100%', role: 'img', preserveAspectRatio: 'xMidYMin meet' });
  const note = h('p', 'tl-note'); note.setAttribute('aria-live', 'polite');
  root.append(scnRow, ctl, svg, note);

  prev.addEventListener('click', () => { step = clampStep(step - 1, cfg.scenarios[sc].steps.length); render(); });
  next.addEventListener('click', () => { step = clampStep(step + 1, cfg.scenarios[sc].steps.length); render(); });

  function render() {
    const steps = cfg.scenarios[sc].steps;
    const n = cfg.lanes.length;
    scnBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(i === sc)));
    prev.disabled = step === 0;
    next.disabled = step === steps.length - 1;
    count.textContent = `${step + 1} / ${steps.length}`;
    const height = TOP + ROW * steps.length;
    svg.setAttribute('viewBox', `0 0 ${W} ${height}`);
    svg.setAttribute('aria-label', `${cfg.scenarios[sc].name}: sequence diagram, step ${step + 1} of ${steps.length}`);
    const kids = [];
    cfg.lanes.forEach((name, i) => {
      const x = laneX(i, n);
      const [a, ...rest] = name.split(' ');
      kids.push(s('text', { x, y: 16, 'text-anchor': 'middle', class: 'tl-lane' }, a));
      if (rest.length) kids.push(s('text', { x, y: 32, 'text-anchor': 'middle', class: 'tl-lane2' }, rest.join(' ')));
      kids.push(s('line', { x1: x, x2: x, y1: 40, y2: height - 8, class: 'tl-line' }));
    });
    const L = layoutSteps(steps, W, n);
    for (let k = 0; k <= step; k++) {
      const { x1, x2, y, dropX } = L[k], st = steps[k];
      const dir = x2 > x1 ? 1 : -1;
      const end = dropX != null ? dropX : x2;
      const g = s('g', { class: k === step ? 'tl-arrow tl-cur' : 'tl-arrow' });
      g.append(s('line', { x1, y1: y, x2: end, y2: y, class: 'tl-shaft', 'stroke-dasharray': dropX != null ? '5 3' : '0' }));
      if (dropX != null) {
        g.append(s('path', { d: `M${end - 6} ${y - 6} L${end + 6} ${y + 6} M${end - 6} ${y + 6} L${end + 6} ${y - 6}`, class: 'tl-x' }));
        g.append(s('text', { x: end + dir * 12, y: y + 4, 'text-anchor': dir > 0 ? 'start' : 'end', class: 'tl-drop' }, 'dropped'));
      } else {
        g.append(s('path', { d: `M${x2} ${y} L${x2 - dir * 9} ${y - 5} L${x2 - dir * 9} ${y + 5} Z`, class: 'tl-head' }));
      }
      g.append(s('text', { x: (x1 + x2) / 2, y: y - 8, 'text-anchor': 'middle', class: 'tl-label' }, st.label));
      if (st.at) g.append(s('text', { x: 4, y: y + 4, class: 'tl-at' }, st.at));
      kids.push(g);
    }
    svg.replaceChildren(...kids);
    note.textContent = steps[step].note || '';
  }

  host.append(root);
  render();
  return { destroy: () => root.remove() };
}
