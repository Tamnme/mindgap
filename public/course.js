// Course page: Home (what next + the sheet), Map (the sheet + topic details) and Sources, as hash views.
// All map text comes from model-written files, so it is only ever set via textContent.

import { elapsedText, withCode } from './ui-text.js';
import {
  offGoalCount, isOffGoal, pickNext, dataUrlToBase64, sourceErrorMessage, canWriteChapter, nodeMatches, lockWhileBusy,
  sheetRows, gridRefs, alternates, prereqRoute, statusCounts, isFirstRun, gridMove,
} from './map-logic.js';

const STATUSES = ['untested', 'gap', 'shaky', 'solid'];
const MAX_COLS = 10; // longer layers wrap within their row

const state = {
  course: null,       // slug from ?course=
  layers: [],         // [{id, name}] in course order
  layerNames: {},     // layer id -> name
  nodes: [],
  byId: new Map(),
  topo: [],
  refs: {},           // node id -> grid ref "L3·04"
  selected: null,
  chapters: [],
  generated: false,   // generated courses may write chapters and grow their map
  busy: false,        // an AI call is in flight: AI-starting buttons stay locked, including ones rendered later
  showOff: false,     // show off-goal topics (dimmed)
  query: '',          // topic search text; non-matching squares are dimmed
  lastLesson: null,   // {id, nodeId, title, mode} from the course list
  view: 'home',
};

const $ = (id) => document.getElementById(id);
const courseApi = (path) => `/api/courses/${encodeURIComponent(state.course)}${path}`;
const chapterUrl = (id) => `chapter.html?course=${encodeURIComponent(state.course)}&node=${encodeURIComponent(id)}`;

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

function statusOf(node) {
  return STATUSES.includes(node.status) ? node.status : 'untested';
}

// Kahn's algorithm; ties broken by layer order then file order. Cycles fall back to sort order.
function topoSort(nodes) {
  const ids = state.layers.map((l) => l.id);
  const layerIdx = (n) => {
    const i = ids.indexOf(n.layer);
    return i === -1 ? ids.length : i;
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

// ---------- the status mark: one form at every scale ----------

const mark = (status, size = '') => el('span', { class: `mark ${status} ${size}`.trim(), 'aria-hidden': 'true' });

// ---------- the sheet ----------

function renderSheets() {
  renderSheet($('sheet-home'), 'home');
  if (state.view === 'map') renderSheet($('sheet-map'), 'map');
}

function renderSheet(slot, where) {
  slot.replaceChildren();
  if (!state.nodes.length) return;
  const counts = statusCounts(state.nodes, statusOf);
  const rows = sheetRows(state.topo, state.layers, state.showOff);
  const cols = Math.min(MAX_COLS, Math.max(1, ...rows.map((r) => r.nodes.length)));
  const route = state.selected ? prereqRoute(state.selected, state.byId) : null;

  const key = el('ul', { class: 'sheet-key', 'aria-label': 'Key' }, ['solid', 'shaky', 'gap', 'untested'].map((s) =>
    el('li', {}, [mark(s), el('span', { text: s }), el('span', { class: 'num', text: String(counts[s]) })])));
  const note = el('p', { class: 'sheet-note' }, [
    el('span', { class: 'num', text: String(counts.untested) }), ` of `,
    el('span', { class: 'num', text: String(counts.total) }), ' untested',
  ]);

  const head = el('div', { class: 'sheet-cols', 'aria-hidden': 'true' }, [el('span'),
    ...Array.from({ length: cols }, (_, i) => el('span', { class: 'num', text: String(i + 1).padStart(2, '0') }))]);

  const grid = el('div', { class: 'sheet-grid', style: `--cols:${cols}` }, [head]);
  const current = state.selected && rows.some((r) => r.nodes.some((n) => n.id === state.selected))
    ? state.selected : rows[0]?.nodes[0]?.id;
  for (const r of rows) {
    const squares = r.nodes.map((n) => {
      const status = statusOf(n);
      const cls = ['sq', status];
      if (isOffGoal(n)) cls.push('off-goal');
      if (state.selected === n.id) cls.push('selected');
      if (route && route.has(n.id)) cls.push('on-route');
      if (route && n.id !== state.selected && !route.has(n.id)) cls.push('off-route');
      if (!nodeMatches(n, state.query)) cls.push('no-match');
      return el('button', {
        type: 'button', class: cls.join(' '), 'data-id': n.id, tabindex: n.id === current ? 0 : -1,
        'aria-label': `${n.title || n.id}, ${status}${isOffGoal(n) ? ', off-goal' : ''}, ${state.refs[n.id]}`,
        'aria-pressed': state.selected === n.id ? 'true' : 'false',
        onclick: () => (where === 'home' ? openOnMap(n.id) : select(n.id)),
      }, [
        el('span', { class: 'sq-top' }, [el('span', { class: 'sq-ref num', text: state.refs[n.id] }), mark(status, 'sm')]),
        el('span', { class: 'sq-title', text: n.title || n.id }),
      ]);
    });
    grid.append(el('div', { class: 'sheet-row', role: 'group', 'aria-label': r.name }, [
      el('span', { class: 'sheet-code', title: r.name }, [r.code, el('span', { class: 'sr-only', text: ` ${r.name}` })]),
      ...squares,
    ]));
  }
  grid.addEventListener('keydown', (e) => {
    const id = e.target.dataset?.id;
    const to = id && gridMove(rows, id, e.key);
    if (!to) return;
    e.preventDefault();
    grid.querySelectorAll('.sq').forEach((b) => { b.tabIndex = b.dataset.id === to ? 0 : -1; });
    grid.querySelector(`[data-id="${CSS.escape(to)}"]`)?.focus();
  });

  const hint = route
    ? el('p', { class: 'sheet-hint', text: route.size ? `Outlined: the ${route.size} topic${route.size === 1 ? '' : 's'} “${state.byId.get(state.selected)?.title || state.selected}” builds on.` : `“${state.byId.get(state.selected)?.title || state.selected}” builds on nothing else.` })
    : el('p', { class: 'sheet-hint', text: where === 'home' ? 'Select a square to open it on the map.' : 'Select a square to see what it builds on.' });

  slot.append(el('div', { class: `sheet-frame at-${where}` }, [
    el('div', { class: 'sheet-head' }, [note, key]),
    el('div', { class: 'sheet-scroll' }, [grid]),
    hint,
  ]));
}

const focusSquare = (id) => document.querySelector(`#sheet-${state.view} [data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });

function select(id) {
  state.selected = id;
  history.replaceState(null, '', `#map:${encodeURIComponent(id)}`);
  renderSheets();
  renderSide();
  focusSquare(id); // the sheet was rebuilt; keep keyboard focus where it was
  // Narrow screens stack the panel under the sheet: bring it into view.
  if (!matchMedia('(min-width: 900px)').matches) {
    $('side').scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
}

function openOnMap(id) {
  state.selected = id;
  location.hash = `map:${encodeURIComponent(id)}`;
}

// ---------- Home: what now? ----------

function renderNext() {
  const box = $('next');
  box.replaceChildren();
  const first = isFirstRun(state.nodes, statusOf);
  $('sheet-home').classList.toggle('hidden', !state.nodes.length);
  $('view-home').classList.toggle('solo', !state.nodes.length);

  if (first) {
    box.append(
      el('h2', { class: 'next-title', text: 'What do you want to learn?' }),
      el('p', { class: 'lede', text: 'Tell it what you want to learn. It probes what you already know, then teaches the gaps.' }),
      el('div', { class: 'actions' }, [
        el('button', { class: 'primary', 'data-action': 'goal', onclick: () => startLesson(null, 'course'), text: 'Start with your goal' }),
      ]),
      el('p', { class: 'muted small', text: state.nodes.length
        ? 'Every topic on the sheet is untested. The tutor asks a few prediction questions, marks each topic, and proposes a plan.'
        : 'This course has no map yet. Add sources first if you have any; the tutor draws the map when you approve its plan.' }),
      ...(state.nodes.length ? [] : [el('p', { class: 'small' }, [el('a', { href: '#sources', text: 'Add sources' })])]),
    );
    renderResume(box);
    applyBusyLocks();
    return;
  }

  const main = pickNext(state.topo, state.byId, statusOf);
  const alts = alternates(state.topo, state.byId, statusOf, main);
  const counts = statusCounts(state.nodes, statusOf);

  if (main) {
    box.append(topicBlock(main, 'teach'));
  } else if (alts.review) {
    box.append(topicBlock(alts.review, 'practice'));
    alts.review = null;
  } else {
    box.append(
      el('h2', { class: 'next-title', text: counts.total && counts.solid === counts.total ? 'Everything in scope is solid.' : 'Nothing is ready to teach.' }),
      el('p', { class: 'lede', text: 'Practise to keep it that way, or set a new goal to widen the map.' }),
      el('div', { class: 'actions' }, [
        ...(state.topo.find((n) => !isOffGoal(n) && statusOf(n) === 'solid')
          ? [el('button', { class: 'primary', 'data-action': 'practice', 'data-node': state.topo.find((n) => !isOffGoal(n) && statusOf(n) === 'solid').id, onclick: (e) => startLesson(e.target.dataset.node, 'practice'), text: 'Practise' })]
          : []),
        el('button', { 'data-action': 'goal', onclick: () => startLesson(null, 'course'), text: 'New goal' }),
      ]),
    );
  }

  const altItems = [];
  if (alts.review) altItems.push(altRow(alts.review, 'Review', 'practice'));
  if (alts.gap) altItems.push(altRow(alts.gap, 'Teach', 'teach'));
  if (altItems.length) box.append(el('h3', { class: 'alts-h', text: 'Or' }), el('ul', { class: 'alts' }, altItems));
  renderResume(box);
  applyBusyLocks();
}

function topicBlock(n, mode) {
  const status = statusOf(n);
  const hasChapter = state.chapters.includes(n.id);
  const actions = [
    // No data-node: these always start a tutor call, so the chapter exemption in lockWhileBusy must not apply.
    el('button', { class: 'primary', 'data-action': mode, onclick: () => startLesson(n.id, mode, true),
      text: mode === 'practice' ? 'Start practice' : 'Start lesson' }),
  ];
  if (hasChapter) actions.push(el('a', { class: 'button', href: chapterUrl(n.id), text: 'Read chapter' }));
  else if (canWriteChapter(state.generated, state.chapters, n.id)) {
    actions.push(el('button', { 'data-action': 'write', 'data-node': n.id, onclick: () => writeChapter(n.id), text: 'Write chapter' }));
  }
  const reason = n.evidence
    ? el('blockquote', { class: 'evidence' }, [el('p', { text: n.evidence }), el('footer', { text: 'From your last answer on this topic' })])
    : el('p', { class: 'lede', text: 'Not tested yet. The lesson starts by checking what you already know.' });
  return el('div', { class: 'topic-block' }, [
    el('div', { class: 'tb-mark' }, [mark(status, 'lg'), el('span', { class: 'num', text: state.refs[n.id] })]),
    el('h2', { class: 'next-title' }, [el('span', { class: 'next-pre', text: mode === 'practice' ? 'Review ' : 'Next ' }), n.title || n.id]),
    el('p', { class: 'meta', text: `${status} · ${state.layerNames[n.layer] || n.layer || ''}` }),
    reason,
    el('div', { class: 'actions' }, actions),
  ]);
}

function altRow(n, verb, mode) {
  const status = statusOf(n);
  return el('li', {}, [
    mark(status),
    el('div', { class: 'alt-body' }, [
      el('p', { class: 'alt-title' }, [el('span', { class: 'num', text: state.refs[n.id] }), ' ', n.title || n.id]),
      el('p', { class: 'alt-why', text: n.evidence || status }),
    ]),
    el('button', { 'data-action': mode, onclick: () => startLesson(n.id, mode, true), text: verb }),
  ]);
}

function renderResume(box) {
  const l = state.lastLesson;
  if (!l) return;
  box.append(el('p', { class: 'resume' }, ['Resume: ',
    el('a', { href: `lesson.html?course=${encodeURIComponent(state.course)}&id=${encodeURIComponent(l.id)}`, text: l.title || l.nodeId || 'last lesson' })]));
}

// ---------- Map: topic details ----------

function renderSide() {
  const side = $('side');
  side.replaceChildren();
  const n = state.byId.get(state.selected);
  if (!n) {
    side.append(el('p', { class: 'muted', text: 'Select a square to see its evidence and lesson options.' }));
    return;
  }
  const status = statusOf(n);
  const sources = (n.sources || []).filter(u => /^https?:\/\//.test(u));

  // Evidence-style blocks are collapsed by default: the actions come first.
  const more = el('div', { class: 'side-more' });
  const block = (label, body) => more.append(el('details', {}, [el('summary', { text: label }), body]));
  const field = (label, value) => { if (value) block(label, el('p', { text: value })); };
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
    el('div', { class: 'tb-mark' }, [mark(status, 'lg'), el('span', { class: 'num', text: state.refs[n.id] })]),
    el('h2', { text: n.title || n.id }),
    el('p', { class: 'meta', text: `${status}${isOffGoal(n) ? ' · off-goal' : ''} · ${state.layerNames[n.layer] || n.layer || ''}` }),
    ...(n.evidence ? [el('blockquote', { class: 'evidence' }, [el('p', { text: n.evidence })])] : []),
    actions,
    ...(hint ? [hint] : []),
    more,
  );
  applyBusyLocks(); // a topic selected mid-call must not offer live AI buttons
}

// ---------- views ----------

function showView() {
  const [view, arg] = location.hash.slice(1).split(':');
  state.view = ['home', 'map', 'sources'].includes(view) ? view : 'home';
  if (state.view === 'map' && arg) {
    const id = decodeURIComponent(arg);
    if (state.byId.has(id)) state.selected = id;
  }
  for (const v of ['home', 'map', 'sources']) $(`view-${v}`).classList.toggle('hidden', v !== state.view);
  document.querySelectorAll('.tabs a').forEach((a) => {
    if (a.dataset.view === state.view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  if (state.view === 'home') { renderNext(); renderSheet($('sheet-home'), 'home'); }
  if (state.view === 'map') {
    renderSheet($('sheet-map'), 'map');
    renderSide();
    if (state.selected) focusSquare(state.selected);
  }
  if (state.view === 'sources') openSources();
}

function refreshChrome() {
  const off = offGoalCount(state.nodes);
  $('off-goal-row').classList.toggle('hidden', off === 0);
  $('show-off-text').textContent = `Show off-goal topics (${off})`;
  $('show-off').checked = state.showOff;
  $('btn-goal').onclick = () => { $('more').open = false; startLesson(null, 'course'); };
  const debug = state.byId.get('debug-method');
  $('btn-debug').classList.toggle('hidden', !debug);
  $('btn-debug').onclick = () => { $('more').open = false; startLesson('debug-method', 'practice'); };
  $('busy-cancel').onclick = cancelCall;
}

// ---------- busy, errors ----------

let busyTimer = null;

// DOM wiring (verified in the browser): lock state is per button, from its own node's chapter.
function applyBusyLocks() {
  document.querySelectorAll('button[data-action]').forEach((b) => {
    b.disabled = state.busy && lockWhileBusy(b.dataset.action, state.chapters.includes(b.dataset.node));
  });
}

// Locks only the buttons that would start another AI call; reading, the sheet, search and navigation stay live.
// `lockSources` also locks the Sources view while an import runs.
function setBusy(on, text, lockSources = false) {
  $('busy').classList.toggle('hidden', !on);
  $('busy-cancel').classList.toggle('hidden', lockSources); // an import is not a tutor call
  clearInterval(busyTimer);
  if (on) {
    const t0 = Date.now();
    const tick = () => { const e = elapsedText(Date.now() - t0); $('busy-text').textContent = e ? `${text} (${e})` : text; };
    tick();
    busyTimer = setInterval(tick, 1000);
  }
  state.busy = on;
  applyBusyLocks();
  if (lockSources || !on) document.querySelectorAll('#sources button, #sources input').forEach((b) => { b.disabled = on && lockSources; });
}

// The cancel button is outside every [data-action], so no busy lock reaches it.
function cancelCall() {
  fetch(courseApi('/cancel'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {});
}

const failText = (what, err) => (err.message === 'cancelled' ? 'Cancelled. Nothing was changed.' : withCode(`${what}: ${err.message}`, err.status));

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

// ---------- Sources ----------

// Source text is untrusted: text only.
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
  const box = $('sources');
  box.replaceChildren(el('h2', { text: 'Sources' }), el('p', { class: 'muted', text: 'Sources are read when you start a new goal.' }));
  if (!list.length) box.append(el('p', { class: 'muted', text: 'No sources yet. Add a URL or a file below.' }));
  const ul = el('ul', { class: 'source-list' });
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
  box.append(ul);

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
  box.append(
    el('div', { class: 'actions' }, [url, add]),
    el('div', { class: 'actions' }, [file]),
  );
}

// ---------- AI calls ----------

async function writeChapter(nodeId) {
  showError('');
  setBusy(true, 'Writing the chapter… this can take a few minutes.');
  try {
    const res = await fetch(courseApi(`/chapters/${encodeURIComponent(nodeId)}/write`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    if (!res.ok) throw new Error(await errorText(res));
    location.href = chapterUrl(nodeId);
  } catch (err) {
    showError(failText('Could not write the chapter', err));
    setBusy(false);
  }
}

// `direct`: the home's Start lesson always opens a tutor lesson, even when a chapter exists (Read chapter sits beside it).
async function startLesson(nodeId, mode, direct = false) {
  // From the map, nodes with a written chapter teach through it; the tutor lives in its drawer.
  if (!direct && mode === 'teach' && state.chapters.includes(nodeId)) {
    location.href = chapterUrl(nodeId);
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
    showError(failText('Could not start lesson', err) + (err.message === 'cancelled' ? '' : '. Try again.'));
    setBusy(false);
  }
}

// ---------- keys ----------

function onKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t.closest && t.closest('input, textarea, select, [contenteditable]')) return;
  if (e.key === '/') {
    e.preventDefault();
    if (state.view !== 'map') { history.pushState(null, '', '#map'); showView(); }
    $('node-search').focus();
  } else if (e.key === 'n' && state.view === 'home' && !state.busy) {
    document.querySelector('#next .primary')?.click();
  }
}

// ---------- load ----------

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
    state.layers = (course.layers || []).map((l) => ({ id: l.id, name: l.name }));
    state.layerNames = Object.fromEntries(state.layers.map((l) => [l.id, l.name]));
    state.chapters = Array.isArray(course.chapters) ? course.chapters : [];
    state.generated = course.generated === true;
    $('course-title').textContent = course.title || course.slug;
    document.title = `${course.title || course.slug} · mindgap`;
    state.nodes = Array.isArray(data.nodes) ? data.nodes : [];
    state.byId = new Map(state.nodes.map(n => [n.id, n]));
    state.topo = topoSort(state.nodes);
    state.refs = gridRefs(state.topo, state.layers);
  } catch (err) {
    showError(`Could not load the course: ${err.message}`);
    return;
  }
  // Resume is secondary: a failure here just leaves it out.
  try {
    const list = await (await fetch('/api/courses')).json();
    state.lastLesson = (Array.isArray(list) && list.find((c) => c.slug === state.course)?.lastLesson) || null;
  } catch { /* no resume link */ }

  $('show-off').addEventListener('change', (e) => {
    state.showOff = e.target.checked;
    if (!state.showOff && isOffGoal(state.byId.get(state.selected) || {})) state.selected = null;
    renderSheets();
    renderSide();
  });
  $('node-search').addEventListener('input', (e) => {
    state.query = e.target.value;
    renderSheet($('sheet-map'), 'map');
  });
  $('node-search').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const first = state.topo.find((n) => (state.showOff || !isOffGoal(n)) && nodeMatches(n, state.query));
    if (first) select(first.id);
  });
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', showView);
  refreshChrome();
  showView();
}

load();
