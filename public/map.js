// Map home: renders learner/map.json as an SVG graph and drives lesson starts.
// All map text comes from model-written files, so it is only ever set via textContent.

import { visibleNodes, offGoalCount, isOffGoal, pickNext, dataUrlToBase64, sourceErrorMessage, canWriteChapter, nodeMatches, legendVisible, practiceShakyLabel, lockWhileBusy } from './map-logic.js';

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
const SVG_NS = 'http://www.w3.org/2000/svg';

const state = {
  course: null,       // slug from ?course=
  layers: [],         // layer ids in course.layers order
  layerNames: {},     // layer id -> name
  nodes: [],
  byId: new Map(),
  topo: [],
  selected: null,
  chapters: [],
  generated: false,   // generated courses may write chapters and grow their map
  busy: false,        // an AI call is in flight: AI-starting buttons stay locked, including ones rendered later
  showOff: false,     // draw off-goal nodes (faded)
  query: '',          // node search text; non-matching nodes are dimmed
};

const $ = (id) => document.getElementById(id);
const courseApi = (path) => `/api/courses/${encodeURIComponent(state.course)}${path}`;

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
    const i = state.layers.indexOf(n.layer);
    return i === -1 ? state.layers.length : i;
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
  const ids = new Set(nodes.map((n) => n.id));
  const layers = [...state.layers];
  for (const n of nodes) if (!layers.includes(n.layer)) layers.push(n.layer);
  const groups = layers.map((l) => state.topo.filter((n) => n.layer === l && ids.has(n.id))).map((g, i) => ({ layer: layers[i], nodes: g }))
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
  $('map-empty').classList.toggle('hidden', state.nodes.length > 0);
  $('map-legend').classList.toggle('hidden', !legendVisible(state.nodes.length));
  svg.classList.toggle('hidden', state.nodes.length === 0);
  if (!state.nodes.length) return;
  const { topics, pos, width, height } = layoutFor(visibleNodes(state.nodes, state.showOff));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  // Scale to the container, but never below 80% so labels stay legible (narrow screens scroll the container).
  svg.setAttribute('width', '100%');
  svg.removeAttribute('height');
  svg.style.minWidth = `${Math.round(width * 0.8)}px`;

  // Spine and dotted links are decoration: hidden from assistive tech.
  const deco = svgEl('g', { 'aria-hidden': 'true' });
  svg.append(deco);
  // Spine: topic to topic.
  topics.slice(1).forEach((t, i) => {
    const prev = topics[i];
    deco.append(svgEl('path', { class: 'spine', d: curve(prev.cx, prev.y + TOPIC_H, t.cx, t.y, true) }));
  });
  // Dotted links: topic edge to each of its nodes.
  for (const n of state.nodes) {
    const p = pos.get(n.id);
    if (!p) continue;
    const t = p.topic;
    const fromX = p.side === 'left' ? t.x : t.x + TOPIC_W;
    const toX = p.side === 'left' ? p.x + BOX_W : p.x;
    deco.append(svgEl('path', { class: 'link', d: curve(fromX, t.y + TOPIC_H / 2, toX, p.y + BOX_H / 2) }));
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
      deco.append(svgEl('path', { class: 'rel-edge', d: curve(ax, a.y + BOX_H / 2, bx, b.y + BOX_H / 2) }));
    }
  }

  // One labelled group per layer; its topic header is decoration (the group name says the same).
  const groups = new Map();
  for (const t of topics) {
    const grp = svgEl('g', { role: 'group', 'aria-label': state.layerNames[t.layer] || t.layer });
    groups.set(t.layer, grp);
    svg.append(grp);
    const g = svgEl('g', { class: 'topic', 'aria-hidden': 'true' });
    g.append(svgEl('rect', { x: t.x, y: t.y, width: TOPIC_W, height: TOPIC_H, rx: 6 }));
    const label = svgEl('text', { x: t.cx, y: t.y + TOPIC_H / 2 + 5, 'text-anchor': 'middle' });
    label.textContent = state.layerNames[t.layer] || t.layer;
    const solid = t.nodes.filter((n) => statusOf(n) === 'solid').length;
    const count = svgEl('text', { class: 'count', x: t.x + TOPIC_W - 8, y: t.y + 14, 'text-anchor': 'end' });
    count.textContent = `${solid}/${t.nodes.length}`;
    g.append(label, count);
    grp.append(g);
  }

  for (const n of state.nodes) {
    const p = pos.get(n.id);
    if (!p) continue;
    const status = statusOf(n);
    const cls = ['node', status];
    if (state.selected === n.id) cls.push('selected');
    if (related.has(n.id)) cls.push('related');
    if (state.chapters.includes(n.id)) cls.push('has-chapter');
    if (isOffGoal(n)) cls.push('off-goal');
    if (!nodeMatches(n, state.query)) cls.push('dim');
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
    groups.get(p.topic.layer).append(g);
  }
}

const focusNode = (id) => $('map').querySelector(`[data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });

function select(id) {
  state.selected = id;
  renderMap();
  renderSide();
  focusNode(id); // renderMap rebuilt the nodes; keep keyboard focus where it was
  // Narrow screens stack the panel under the map: bring it into view.
  if (!matchMedia('(min-width: 900px)').matches) {
    $('side').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
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
  const sources = (n.sources || []).filter(u => /^https?:\/\//.test(u));

  // Evidence-style blocks are collapsed by default: the actions come first.
  const more = el('div', { class: 'side-more' });
  const block = (label, body) => more.append(el('details', {}, [el('summary', { text: label }), body]));
  const field = (label, value) => { if (value) block(label, el('p', { text: value })); };
  field('Evidence', n.evidence);
  field('The truth to lock in', n.truth);
  for (const l of n.links || []) field(l.label, l.text);
  field('Lab', n.lab);
  if (sources.length) {
    block('Sources', el('ul', {}, sources.map(u => el('li', {}, [
      el('a', { href: u, target: '_blank', rel: 'noopener noreferrer', text: u }),
    ]))));
  }

  const teachLabel = state.chapters.includes(n.id) ? 'Read the chapter' : 'Teach me this';
  const actions = el('div', { class: 'actions' }, [
    el('button', { class: 'primary', 'data-node': n.id, 'data-action': 'teach', onclick: () => startLesson(n.id, 'teach'), text: teachLabel }),
  ]);
  if (canWriteChapter(state.generated, state.chapters, n.id)) {
    actions.append(el('button', { 'data-node': n.id, 'data-action': 'write', onclick: () => writeChapter(n.id), text: 'Write chapter' }));
  }
  if (status === 'shaky' || status === 'solid') {
    actions.append(el('button', { 'data-node': n.id, 'data-action': 'practice', onclick: () => startLesson(n.id, 'practice'), text: 'Practice' }));
  }
  if (status === 'untested') {
    actions.append(el('button', { 'data-node': n.id, 'data-action': 'probe', onclick: () => startLesson(n.id, 'probe'), text: 'Quick check' }));
  }
  const hint = status === 'untested'
    ? el('p', { class: 'muted small', text: `${teachLabel} teaches the topic. Quick check measures what you already know without teaching: a few questions, and it updates the map.` })
    : null;

  side.append(
    el('h2', { text: n.title || n.id }),
    el('div', {}, [
      el('span', { class: `chip ${status}`, text: status }),
      el('span', { class: 'chip', text: state.layerNames[n.layer] || n.layer || '' }),
    ]),
    actions,
    ...(hint ? [hint] : []),
    more,
  );
  applyBusyLocks(); // a node selected mid-call must not offer live AI buttons
}

function nextLesson() {
  return pickNext(state.topo, state.byId, statusOf);
}

function refreshToolbar() {
  const next = nextLesson();
  const btnNext = $('btn-next');
  btnNext.textContent = next ? `Next lesson: ${next.title || next.id}` : 'Next lesson: none';
  btnNext.disabled = !next;
  btnNext.onclick = () => next && startLesson(next.id, 'teach');

  const shaky = state.topo.filter(n => !isOffGoal(n) && statusOf(n) === 'shaky');
  const btnPractice = $('btn-practice');
  btnPractice.textContent = practiceShakyLabel(shaky.length);
  btnPractice.classList.toggle('hidden', shaky.length === 0);
  btnPractice.disabled = shaky.length === 0;
  // With several shaky nodes this starts the first in learning order; the others are one click away on the map.
  btnPractice.onclick = () => shaky.length && startLesson(shaky[0].id, 'practice');

  $('btn-goal').disabled = false;
  $('btn-goal').onclick = () => startLesson(null, 'course');

  const off = offGoalCount(state.nodes);
  $('off-goal-row').classList.toggle('hidden', off === 0);
  $('show-off-text').textContent = `Show off-goal topics (${off})`;
  $('show-off').checked = state.showOff;

  const btnDebug = $('btn-debug');
  const debug = state.byId.get('debug-method');
  btnDebug.disabled = !debug;
  btnDebug.onclick = () => debug && startLesson('debug-method', 'practice');

  $('btn-sources').onclick = openSources;
}

let busyTimer = null;

// DOM wiring (verified in the browser): lock state is per button, from its own node's chapter.
function applyBusyLocks() {
  document.querySelectorAll('button[data-action]').forEach((b) => {
    b.disabled = state.busy && lockWhileBusy(b.dataset.action, state.chapters.includes(b.dataset.node));
  });
}

// Locks only the buttons that would start another AI call; reading, search and navigation stay live.
// `lockSide` also locks the Sources panel while an import runs.
function setBusy(on, text, lockSide = false) {
  $('busy').classList.toggle('hidden', !on);
  clearInterval(busyTimer);
  if (on) {
    const t0 = Date.now();
    const tick = () => { $('busy-text').textContent = `${text} (${Math.round((Date.now() - t0) / 1000)}s)`; };
    tick();
    busyTimer = setInterval(tick, 1000);
  }
  state.busy = on;
  applyBusyLocks();
  if (lockSide || !on) document.querySelectorAll('#side button, #side input').forEach((b) => { b.disabled = on && lockSide; });
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

// Sources panel (replaces the side panel until a node is selected). Source text is untrusted: text only.
async function sourcesRequest(path, init) {
  const res = await fetch(courseApi(`/sources${path}`), init);
  if (!res.ok) {
    let body = null;
    try { body = await res.json(); } catch { /* no JSON body */ }
    throw new Error(sourceErrorMessage(res.status, body));
  }
  return res.status === 204 ? null : res.json();
}

async function openSources() {
  showError('');
  try {
    renderSources(await sourcesRequest(''));
  } catch (err) {
    showError(`Could not load sources: ${err.message}`);
  }
}

function renderSources(list) {
  const side = $('side');
  side.replaceChildren(el('h2', { text: 'Sources' }), el('p', { class: 'muted', text: 'Sources are read when you start a new goal.' }));
  if (!list.length) side.append(el('p', { class: 'muted', text: 'No sources yet. Add a URL or a file below.' }));
  const ul = el('ul');
  for (const s of list) {
    const v = String((s.origin && s.origin.value) || '');
    const origin = s.origin && s.origin.kind === 'url' && /^https?:\/\//.test(v)
      ? el('a', { href: v, target: '_blank', rel: 'noopener noreferrer', text: v })
      : el('span', { text: v });
    const n = (s.sections || []).length;
    ul.append(el('li', {}, [
      el('strong', { text: s.title || s.id }), ' ', origin,
      el('span', { class: 'muted small', text: ` · ${n} section${n === 1 ? '' : 's'}${s.truncated ? ' (truncated)' : ''} ` }),
      el('button', {
        text: 'Remove',
        onclick: async () => {
          if (!confirm(`Remove source "${s.title || s.id}"?`)) return;
          showError('');
          try {
            await sourcesRequest(`/${encodeURIComponent(s.id)}`, { method: 'DELETE' });
            renderSources(await sourcesRequest(''));
          } catch (err) {
            showError(`Could not remove source: ${err.message}`);
          }
        },
      }),
    ]));
  }
  side.append(ul);

  const url = el('input', { type: 'url', placeholder: 'https://…', 'aria-label': 'Source URL' });
  const file = el('input', { type: 'file', accept: '.pdf,.docx,.pptx,.xlsx,.html,.htm,.md,.txt,.epub', 'aria-label': 'Source file' });
  const add = el('button', { text: 'Add' });
  const importSource = async (body) => {
    showError('');
    setBusy(true, 'Importing source… this can take a minute.', true);
    let ok = false;
    try {
      await sourcesRequest('', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      ok = true;
    } catch (err) {
      showError(`Could not add source: ${err.message}`);
    }
    setBusy(false);
    try { renderSources(await sourcesRequest('')); } catch (err) { showError(`Could not load sources: ${err.message}`); }
    return ok;
  };
  add.onclick = () => { if (url.value.trim()) importSource({ url: url.value.trim() }); };
  file.onchange = () => {
    const f = file.files[0];
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) { showError('Files must be 20 MB or smaller.'); file.value = ''; return; }
    const reader = new FileReader();
    reader.onload = () => importSource({ filename: f.name, data_base64: dataUrlToBase64(reader.result) });
    reader.onerror = () => showError('Could not read that file.');
    reader.readAsDataURL(f);
  };
  side.append(
    el('div', { class: 'actions' }, [url, add]),
    el('div', { class: 'actions' }, [file]),
  );
}

async function writeChapter(nodeId) {
  showError('');
  setBusy(true, 'Writing the chapter… this can take a few minutes.');
  try {
    const res = await fetch(courseApi(`/chapters/${encodeURIComponent(nodeId)}/write`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (!res.ok) throw new Error(await errorText(res));
    location.href = `chapter.html?course=${encodeURIComponent(state.course)}&node=${encodeURIComponent(nodeId)}`;
  } catch (err) {
    showError(`Could not write the chapter: ${err.message}`);
    setBusy(false);
  }
}

async function startLesson(nodeId, mode) {
  // Nodes with a written chapter teach through it; the tutor lives in its drawer.
  if (mode === 'teach' && state.chapters.includes(nodeId)) {
    location.href = `chapter.html?course=${encodeURIComponent(state.course)}&node=${encodeURIComponent(nodeId)}`;
    return;
  }
  showError('');
  setBusy(true, 'Starting lesson… this can take up to a minute.');
  try {
    const res = await fetch('/api/lesson', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(mode === 'course' ? { course: state.course, mode } : { course: state.course, node_id: nodeId, mode }),
    });
    if (!res.ok) throw new Error(await errorText(res));
    const data = await res.json();
    location.href = `lesson.html?course=${encodeURIComponent(state.course)}&id=${encodeURIComponent(data.lesson_id)}`;
  } catch (err) {
    showError(`Could not start lesson: ${err.message}. Try again.`);
    setBusy(false);
  }
}

async function load() {
  state.course = new URLSearchParams(location.search).get('course');
  if (!state.course) {
    showError('No course in the URL. Open one from the course list.');
    return;
  }
  try {
    const [courseRes, mapRes] = await Promise.all([fetch(courseApi('')), fetch(courseApi('/map'))]);
    if (!courseRes.ok) throw new Error(await errorText(courseRes));
    if (!mapRes.ok) throw new Error(await errorText(mapRes));
    const course = await courseRes.json();
    const data = await mapRes.json();
    state.layers = (course.layers || []).map((l) => l.id);
    state.layerNames = Object.fromEntries((course.layers || []).map((l) => [l.id, l.name]));
    state.chapters = Array.isArray(course.chapters) ? course.chapters : [];
    state.generated = course.generated === true;
    $('course-title').textContent = `mindgap · ${course.title || course.slug}`;
    document.title = `mindgap · ${course.title || course.slug}`;
    state.nodes = Array.isArray(data.nodes) ? data.nodes : [];
    state.byId = new Map(state.nodes.map(n => [n.id, n]));
    state.topo = topoSort(state.nodes);
    $('show-off').addEventListener('change', (e) => {
      state.showOff = e.target.checked;
      if (!state.showOff && isOffGoal(state.byId.get(state.selected) || {})) state.selected = null;
      renderMap();
      renderSide();
    });
    $('node-search').addEventListener('input', (e) => {
      state.query = e.target.value;
      renderMap();
    });
    $('node-search').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const first = state.topo.find((n) => (state.showOff || !isOffGoal(n)) && nodeMatches(n, state.query));
      if (first) focusNode(first.id);
    });
    renderMap();
    renderSide();
    refreshToolbar();
  } catch (err) {
    showError(`Could not load the map: ${err.message}`);
  }
}

load();
