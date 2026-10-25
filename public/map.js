// Map home: renders learner/map.json as an SVG graph and drives lesson starts.
// All map text comes from model-written files, so it is only ever set via textContent.

const LAYERS = ['L1', 'L2', 'L3', 'L4', 'overlay', 'services'];
const STATUSES = ['untested', 'gap', 'shaky', 'solid'];
// Roadmap layout: one yellow topic per layer on a curved spine, its nodes in a column on each side.
const W = 1000;
const BOX_W = 250;
const BOX_H = 46;
const BOX_GAP = 10;
const TOPIC_W = 250;
const TOPIC_H = 50;
const BLOCK_GAP = 56;
const EDGE = 14; // room for the status badges on the outer edges
const SWAY = 50; // topics alternate left/right of centre so the spine curves
const TITLE_CHARS = 32;
const LAYER_NAMES = {
  L1: 'Physical: links and NICs',
  L2: 'Layer 2: switching',
  L3: 'Layer 3: routing',
  L4: 'Layer 4: transport',
  overlay: 'Overlays and Kubernetes',
  services: 'Services and debugging',
};
const SVG_NS = 'http://www.w3.org/2000/svg';

const state = { nodes: [], byId: new Map(), topo: [], selected: null, chapters: [] };

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, String(v));
  }
  for (const c of [].concat(children)) if (c != null) node.append(c);
  return node;
}

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function statusOf(node) {
  return STATUSES.includes(node.status) ? node.status : 'untested';
}

function isGood(status) {
  return status === 'shaky' || status === 'solid';
}

// Kahn's algorithm; ties broken by layer order then file order. Cycles fall back to sort order.
function topoSort(nodes) {
  const layerIdx = (n) => {
    const i = LAYERS.indexOf(n.layer);
    return i === -1 ? LAYERS.length : i;
  };
  const sortKey = nodes.map((n, i) => ({ n, i, l: layerIdx(n) }))
    .sort((a, b) => a.l - b.l || a.i - b.i);
  const placed = new Set();
  const order = [];
  let remaining = sortKey.slice();
  while (remaining.length) {
    const next = remaining.find(({ n }) => (n.prereqs || []).every(p => placed.has(p) || !state.byId.has(p)));
    const pick = next || remaining[0];
    placed.add(pick.n.id);
    order.push(pick.n);
    remaining = remaining.filter(x => x !== pick);
  }
  return order;
}

// Two-line wrap at TITLE_CHARS; overflow past two lines is cut with an ellipsis.
function wrapTitle(text, max = TITLE_CHARS) {
  const words = String(text || '').split(/\s+/).filter(Boolean)
    .flatMap(w => w.match(new RegExp(`.{1,${max}}`, 'g')) || []);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= max) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > 2) {
    lines.length = 2;
    lines[1] = lines[1].slice(0, max - 1) + '…';
  }
  return lines;
}

function layoutFor(nodes) {
  const layers = [...LAYERS];
  for (const n of nodes) if (!layers.includes(n.layer)) layers.push(n.layer);
  const groups = layers.map((l) => state.topo.filter((n) => n.layer === l)).map((g, i) => ({ layer: layers[i], nodes: g }))
    .filter((g) => g.nodes.length);
  const pos = new Map();
  const topics = [];
  let y = 8;
  groups.forEach((g, gi) => {
    // Left column takes the first half in learning order; a lone node goes right.
    const leftN = g.nodes.length === 1 ? 0 : Math.ceil(g.nodes.length / 2);
    const left = g.nodes.slice(0, leftN);
    const right = g.nodes.slice(leftN);
    const colH = (k) => k * BOX_H + Math.max(0, k - 1) * BOX_GAP;
    const blockH = Math.max(TOPIC_H, colH(left.length), colH(right.length));
    const cx = W / 2 + (gi % 2 ? SWAY : -SWAY);
    const topic = { layer: g.layer, x: cx - TOPIC_W / 2, y: y + (blockH - TOPIC_H) / 2, cx, nodes: g.nodes };
    topics.push(topic);
    const place = (col, x, side) => {
      const top = y + (blockH - colH(col.length)) / 2;
      col.forEach((n, r) => pos.set(n.id, { x, y: top + r * (BOX_H + BOX_GAP), side, topic }));
    };
    place(left, EDGE, 'left');
    place(right, W - BOX_W - EDGE, 'right');
    y += blockH + BLOCK_GAP;
  });
  return { topics, pos, width: W, height: y - BLOCK_GAP + 8 };
}

// Cubic curve between two points, bending horizontally (side links) or vertically (spine).
function curve(x1, y1, x2, y2, vertical) {
  if (vertical) {
    const my = (y1 + y2) / 2;
    return `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`;
  }
  const mx = (x1 + x2) / 2;
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
}

const BADGE = { solid: '✓', shaky: '~', gap: '!' };

function renderMap() {
  const svg = $('map');
  svg.replaceChildren();
  const { topics, pos, width, height } = layoutFor(state.nodes);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  // Scale to the container, but never below 80% so labels stay legible (narrow screens scroll the container).
  svg.setAttribute('width', '100%');
  svg.removeAttribute('height');
  svg.style.minWidth = `${Math.round(width * 0.8)}px`;

  // Spine: topic to topic.
  topics.slice(1).forEach((t, i) => {
    const prev = topics[i];
    svg.append(svgEl('path', { class: 'spine', d: curve(prev.cx, prev.y + TOPIC_H, t.cx, t.y, true) }));
  });
  // Dotted links: topic edge to each of its nodes.
  for (const n of state.nodes) {
    const p = pos.get(n.id);
    if (!p) continue;
    const t = p.topic;
    const fromX = p.side === 'left' ? t.x : t.x + TOPIC_W;
    const toX = p.side === 'left' ? p.x + BOX_W : p.x;
    svg.append(svgEl('path', { class: 'link', d: curve(fromX, t.y + TOPIC_H / 2, toX, p.y + BOX_H / 2) }));
  }

  // Selected node: dashed curves to its prereqs and dependants (instead of drawing every edge).
  const sel = state.selected && state.byId.get(state.selected);
  const related = new Set();
  if (sel && pos.has(sel.id)) {
    const a = pos.get(sel.id);
    const others = [...(sel.prereqs || []), ...state.nodes.filter((n) => (n.prereqs || []).includes(sel.id)).map((n) => n.id)];
    for (const id of others) {
      const b = pos.get(id);
      if (!b) continue;
      related.add(id);
      const ax = a.side === 'left' ? a.x + BOX_W : a.x;
      const bx = b.side === 'left' ? b.x + BOX_W : b.x;
      svg.append(svgEl('path', { class: 'rel-edge', d: curve(ax, a.y + BOX_H / 2, bx, b.y + BOX_H / 2) }));
    }
  }

  for (const t of topics) {
    const g = svgEl('g', { class: 'topic' });
    g.append(svgEl('rect', { x: t.x, y: t.y, width: TOPIC_W, height: TOPIC_H, rx: 6 }));
    const label = svgEl('text', { x: t.cx, y: t.y + TOPIC_H / 2 + 5, 'text-anchor': 'middle' });
    label.textContent = LAYER_NAMES[t.layer] || t.layer;
    const solid = t.nodes.filter((n) => statusOf(n) === 'solid').length;
    const count = svgEl('text', { class: 'count', x: t.x + TOPIC_W - 8, y: t.y + 14, 'text-anchor': 'end' });
    count.textContent = `${solid}/${t.nodes.length}`;
    g.append(label, count);
    svg.append(g);
  }

  for (const n of state.nodes) {
    const p = pos.get(n.id);
    if (!p) continue;
    const status = statusOf(n);
    const cls = ['node', status];
    if (state.selected === n.id) cls.push('selected');
    if (related.has(n.id)) cls.push('related');
    if (state.chapters.includes(n.id)) cls.push('has-chapter');
    const g = svgEl('g', {
      class: cls.join(' '),
      role: 'button',
      tabindex: 0,
      'data-id': n.id,
      'aria-label': `${n.title || n.id}, ${status}${state.chapters.includes(n.id) ? ', chapter ready' : ''}`,
    });
    const title = svgEl('title');
    title.textContent = `${n.title || n.id} (${status})`;
    g.append(title);
    g.append(svgEl('rect', { x: p.x, y: p.y, width: BOX_W, height: BOX_H, rx: 6 }));
    const lines = wrapTitle(n.title || n.id);
    lines.forEach((line, i) => {
      const t = svgEl('text', { x: p.x + BOX_W / 2, y: p.y + BOX_H / 2 + 5 + (i - (lines.length - 1) / 2) * 16, 'text-anchor': 'middle' });
      t.textContent = line;
      g.append(t);
    });
    if (state.chapters.includes(n.id)) {
      // Tag on the top edge = a written chapter exists.
      const tx = p.x + BOX_W / 2;
      g.append(svgEl('rect', { class: 'ch-tag', x: tx - 30, y: p.y - 8, width: 60, height: 15, rx: 7.5 }));
      const tt = svgEl('text', { class: 'ch-tag-txt', x: tx, y: p.y + 3, 'text-anchor': 'middle' });
      tt.textContent = 'CHAPTER';
      g.append(tt);
    }
    if (BADGE[status]) {
      // Badge on the outer edge, like roadmap.sh's check marks.
      const bx = p.side === 'left' ? p.x : p.x + BOX_W;
      g.append(svgEl('circle', { class: `badge-dot ${status}`, cx: bx, cy: p.y + BOX_H / 2, r: 11 }));
      const bt = svgEl('text', { class: 'badge-txt', x: bx, y: p.y + BOX_H / 2 + 4.5, 'text-anchor': 'middle' });
      bt.textContent = BADGE[status];
      g.append(bt);
    }
    g.addEventListener('click', () => select(n.id));
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(n.id); }
    });
    svg.append(g);
  }
}

function select(id) {
  state.selected = id;
  renderMap();
  renderSide();
}

function renderSide() {
  const side = $('side');
  side.replaceChildren();
  const n = state.byId.get(state.selected);
  if (!n) {
    side.append(el('p', { class: 'muted', text: 'Select a node to see its evidence and lesson options.' }));
    return;
  }
  const status = statusOf(n);
  const twins = n.twins || {};
  const sources = (n.sources || []).filter(u => /^https?:\/\//.test(u));

  const dl = el('dl');
  const field = (label, value) => {
    if (!value) return;
    dl.append(el('dt', { text: label }), el('dd', { text: value }));
  };
  field('Evidence', n.evidence);
  field('The truth to lock in', n.truth);
  field('Cloud twin (AWS)', twins.aws);
  field('Kubernetes twin', twins.k8s);
  field('Proxmox twin', twins.proxmox);
  field('Lab', n.lab);
  if (sources.length) {
    const ul = el('ul', {}, sources.map(u => el('li', {}, [
      el('a', { href: u, target: '_blank', rel: 'noopener noreferrer', text: u }),
    ])));
    dl.append(el('dt', { text: 'Sources' }), el('dd', {}, [ul]));
  }

  const actions = el('div', { class: 'actions' }, [
    el('button', { class: 'primary', 'data-action': 'teach', onclick: () => startLesson(n.id, 'teach'), text: state.chapters.includes(n.id) ? 'Read the chapter' : 'Teach me this' }),
  ]);
  if (status === 'shaky' || status === 'solid') {
    actions.append(el('button', { 'data-action': 'practice', onclick: () => startLesson(n.id, 'practice'), text: 'Practice' }));
  }

  side.append(
    el('h2', { text: n.title || n.id }),
    el('div', {}, [
      el('span', { class: `chip ${status}`, text: status }),
      el('span', { class: 'chip', text: n.layer || '' }),
      el('span', { class: 'chip', text: n.id }),
    ]),
    dl,
    actions,
  );
}

function nextLesson() {
  const ok = (n) => (n.status === 'gap' || n.status === 'untested') &&
    (n.prereqs || []).every(p => state.byId.has(p) && isGood(statusOf(state.byId.get(p))));
  return state.topo.find(ok) || state.topo.find(n => statusOf(n) === 'gap') || null;
}

function refreshToolbar() {
  const next = nextLesson();
  const btnNext = $('btn-next');
  btnNext.textContent = next ? `Next lesson: ${next.title || next.id}` : 'Next lesson: none';
  btnNext.disabled = !next;
  btnNext.onclick = () => next && startLesson(next.id, 'teach');

  const shaky = state.topo.filter(n => statusOf(n) === 'shaky');
  const btnPractice = $('btn-practice');
  btnPractice.textContent = `Practice shaky (${shaky.length})`;
  btnPractice.disabled = shaky.length === 0;
  btnPractice.onclick = () => shaky.length && startLesson(shaky[0].id, 'practice');

  const btnDebug = $('btn-debug');
  const debug = state.byId.get('debug-method');
  btnDebug.disabled = !debug;
  btnDebug.onclick = () => debug && startLesson('debug-method', 'practice');
}

function setBusy(on, text) {
  $('busy').classList.toggle('hidden', !on);
  if (text) $('busy-text').textContent = text;
  document.querySelectorAll('button').forEach(b => { b.disabled = on; });
  if (!on) refreshToolbar();
}

function showError(msg) {
  const box = $('error');
  box.textContent = msg;
  box.classList.toggle('hidden', !msg);
}

async function errorText(res) {
  try {
    const body = await res.json();
    return body.error || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

async function startLesson(nodeId, mode) {
  // Nodes with a written chapter teach through it; the tutor lives in its drawer.
  if (mode === 'teach' && state.chapters.includes(nodeId)) {
    location.href = `chapter.html?node=${encodeURIComponent(nodeId)}`;
    return;
  }
  showError('');
  setBusy(true, 'Starting lesson… this can take up to a minute.');
  try {
    const res = await fetch('/api/lesson', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ node_id: nodeId, mode }),
    });
    if (!res.ok) throw new Error(await errorText(res));
    const data = await res.json();
    location.href = `lesson.html?id=${encodeURIComponent(data.lesson_id)}`;
  } catch (err) {
    showError(`Could not start lesson: ${err.message}. Try again.`);
    setBusy(false);
  }
}

async function load() {
  try {
    const res = await fetch('/api/map');
    if (!res.ok) throw new Error(await errorText(res));
    const data = await res.json();
    try {
      const idx = await fetch('/chapters/index.json');
      if (idx.ok) state.chapters = await idx.json();
    } catch { /* no chapters: every node uses the tutor lesson */ }
    state.nodes = Array.isArray(data.nodes) ? data.nodes : [];
    state.byId = new Map(state.nodes.map(n => [n.id, n]));
    state.topo = topoSort(state.nodes);
    renderMap();
    renderSide();
    refreshToolbar();
  } catch (err) {
    showError(`Could not load the map: ${err.message}`);
  }
}

load();
