// Chapter page: authored sections with predict-first checkpoints, widgets and labs; tutor in a drawer.
// Chapter prose is authored and model text comes from the tutor: both go through renderMarkdown (escapes first).

import { renderMarkdown } from './md.js';
import { elapsedText, turnErrorText, withCode } from './ui-text.js';
import { createLabCard, fillLabCard, runLabCommand, setLabBusy } from './labcard.js';
import { topoSort, gridRefs } from './map-logic.js';
import { statusMark, statusOf, fillCourseBar } from './chrome.js';
import { firstOpenCheckpoint, flatBlocks, answerEvent, answersFrom, sectionState } from './chapter-logic.js';

const $ = (id) => document.getElementById(id);
const course = new URLSearchParams(location.search).get('course');
const nodeId = new URLSearchParams(location.search).get('node');

const S = {
  chapter: null,
  lessonId: null,
  answers: {},      // checkpoint id -> learner event
  units: [],        // [{el, block}] in reading order, one per block
  lab: null,        // course lab state: {available, reason?, request, approved}
  queue: [],        // learner events waiting for the tutor
  sending: false,
  unread: 0,
  topo: [],         // map nodes in learning order
  refs: {},         // node id -> grid ref, as the course sheet numbers it
};

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v; // only ever renderMarkdown output
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, String(v));
  }
  for (const c of [].concat(children)) if (c != null) node.append(c);
  return node;
}

const md = (src, cls = 'prose') => el('div', { class: cls, html: renderMarkdown(src) });

function showError(msg) {
  $('error').textContent = msg;
  $('error').classList.toggle('hidden', !msg);
}

function httpError(res, data) {
  return Object.assign(new Error(data.error || ''), { status: res.status });
}

async function postJson(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw httpError(res, data);
  return data;
}

async function getJson(url) {
  const res = await fetch(url);
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw httpError(res, data);
  return data;
}

// Under the title: the topic's mark, then "L1·01 · gap · Chapter 1 · Physical".
function renderMeta() {
  const parts = [S.refs[S.node.id], statusOf(S.node.status), `Chapter ${S.chapter.number}`, S.chapter.kicker];
  $('ch-meta').replaceChildren(statusMark(S.node.status), ' ', parts.filter(Boolean).join(' · '));
}

// ---------- checkpoints ----------

function receipt(cp, ans) {
  // Options read "label: explanation"; the receipt keeps only the label.
  const short = (o) => String(o).split(': ')[0];
  const pick = ans.skipped ? null : short(ans.chosen);
  const line = ans.skipped
    ? `Skipped · answer: ${short(cp.options[cp.key])}`
    : ans.correct
      ? `Right: ${pick} · confidence ${ans.confidence}`
      : `You: ${pick} · answer: ${short(cp.options[cp.key])}`;
  const mark = statusMark(ans.skipped ? 'untested' : ans.correct ? 'solid' : 'gap', 'sm');
  const details = el('div', { class: 'cp-details hidden' }, [
    md(cp.prompt, 'cp-q'),
    el('p', { text: cp.why }),
    ans.reasoning ? el('p', { class: 'muted', text: `Your reasoning: ${ans.reasoning}` }) : null,
  ]);
  const btn = el('button', {
    class: `cp-receipt ${ans.skipped ? 'skipped' : ans.correct ? 'right' : 'wrong'}`,
    'aria-expanded': 'false',
    onclick: () => {
      const open = details.classList.toggle('hidden') === false;
      btn.setAttribute('aria-expanded', String(open));
    },
  }, [mark, ' ', line]);
  return el('div', { class: 'cp folded' }, [btn, details]);
}

function checkpointCard(cp) {
  const ans = S.answers[cp.id];
  if (ans) return receipt(cp, ans);

  let chosen = null;
  let confidence = null;
  const commit = el('button', { class: 'primary', disabled: true, text: 'Submit' });
  const sync = () => { commit.disabled = chosen == null || confidence == null; };

  const promptId = `cp-q-${cp.id}`;
  const opts = cp.options.map((o, i) => el('label', { class: 'opt' }, [
    el('input', { type: 'radio', name: `cp-${cp.id}`, onchange: () => { chosen = i; sync(); } }),
    el('span', { text: o }),
  ]));
  const confBtns = [1, 2, 3, 4, 5].map((c) => el('button', {
    type: 'button', 'aria-pressed': 'false', text: String(c),
    'aria-label': `Confidence ${c} of 5${c === 1 ? ', guessing' : c === 5 ? ', certain' : ''}`,
    onclick: () => {
      confidence = c;
      confBtns.forEach((b, i) => { b.classList.toggle('on', i + 1 === c); b.setAttribute('aria-pressed', String(i + 1 === c)); });
      sync();
    },
  }));
  const why = el('textarea', { placeholder: 'Why? Think out loud (optional, but the tutor reads it)', rows: 2 });

  commit.addEventListener('click', () => record(cp, answerEvent(cp, chosen, confidence, why.value.trim())));
  const skip = el('button', { class: 'linkish', text: 'skip, show me ›', onclick: () => record(cp, { type: 'checkpoint', id: cp.id, skipped: true }) });

  return el('div', { class: 'cp' }, [
    el('div', { class: 'cp-kicker', text: 'Checkpoint · predict first' }),
    Object.assign(md(cp.prompt, 'cp-q'), { id: promptId }),
    el('fieldset', { class: 'cp-opts', 'aria-labelledby': promptId }, opts),
    el('div', { class: 'conf', role: 'group', 'aria-label': 'Confidence, 1 guessing to 5 certain' }, [
      el('span', { text: 'Confidence' }),
      el('span', { class: 'conf-end', text: '1 guessing' }),
      ...confBtns,
      el('span', { class: 'conf-end', text: '5 certain' }),
    ]),
    why,
    el('div', { class: 'cp-actions' }, [commit, skip]),
  ]);
}

function record(cp, event) {
  S.answers[cp.id] = event;
  const unit = S.units.find((u) => u.block.checkpoint?.id === cp.id);
  unit.el.replaceChildren(receipt(cp, event));
  applyLocks();
  enqueue(event);
}

// ---------- widgets ----------

function widgetCard(w) {
  const key = `nb-explored-${nodeId}-${w.id}`;
  let explored = false;
  try { explored = localStorage.getItem(key) === '1'; } catch { /* storage blocked */ }

  const badge = el('span', { class: `w-badge${explored ? '' : ' hidden'}`, text: 'explored' });
  const host = el('div', { class: 'sim-host' });
  let instance = null;
  const mount = async () => {
    instance?.destroy?.();
    host.replaceChildren();
    try {
      const mod = await import(`/widgets/${w.kind || 'sim'}.js`);
      instance = mod.mount(host, w);
    } catch {
      host.replaceChildren(el('p', { class: 'muted small', text: 'widget unavailable' }));
    }
  };
  // First button click, or first input/change inside the widget (sliders count).
  const markExplored = (e) => {
    if (explored || (e.type === 'click' && !e.target.closest('button'))) return;
    explored = true;
    badge.classList.remove('hidden');
    try { localStorage.setItem(key, '1'); } catch { /* storage blocked */ }
  };
  for (const t of ['click', 'input', 'change']) host.addEventListener(t, markExplored);

  const card = el('div', { class: 'widget' });
  const focusBtn = el('button', { class: 'w-tool', text: 'Focus' });
  const setFocus = (on) => {
    card.classList.toggle('focused', on);
    document.body.classList.toggle('has-focus', on);
    focusBtn.textContent = on ? 'Close' : 'Focus';
  };
  focusBtn.addEventListener('click', () => setFocus(!card.classList.contains('focused')));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && card.classList.contains('focused')) setFocus(false); });

  card.append(
    el('div', { class: 'w-head' }, [
      el('div', { class: 'w-titles' }, [
        el('h3', { class: 'w-kicker' }, [el('span', { text: w.title }), badge]),
        w.hint ? el('p', { class: 'w-hint', text: w.hint }) : null,
      ]),
      el('div', { class: 'w-tools' }, [el('button', { class: 'w-tool', text: 'Reset', onclick: mount }), focusBtn]),
    ]),
    el('div', { class: 'w-body' }, [host]),
    w.takeaway ? md(w.takeaway, 'w-take') : null,
  );
  mount();
  return card;
}

// ---------- labs ----------

async function runLab(card) {
  setLabBusy(card, true);
  try {
    const out = await runLabCommand(card, { course, lessonId: S.lessonId });
    if (out) {
      fillLabCard(card, { cmd: card.dataset.cmd, ...out });
      showError('');
    }
  } catch (err) {
    showError(`Lab run failed: ${err.message}`);
  } finally {
    setLabBusy(card, false);
  }
}

// ---------- rendering + gating ----------

function renderArticle() {
  const ch = S.chapter;
  const article = $('article');
  article.replaceChildren();
  S.units = [];
  ch.sections.forEach((s, si) => {
    const sec = el('section', { id: `s-${s.id}`, class: 'ch-section' }, [
      el('h2', {}, [el('span', { class: 'sec-num', text: `${ch.number}.${si + 1}` }), document.createTextNode(s.title)]),
    ]);
    for (const block of s.blocks) {
      let node;
      if (block.md) node = md(block.md);
      else if (block.checkpoint) node = checkpointCard(block.checkpoint);
      else if (block.widget) node = widgetCard(block.widget);
      else if (block.lab) node = createLabCard(block.lab, runLab, S.lab);
      const unit = el('div', { class: 'unit' }, [node]);
      sec.append(unit);
      S.units.push({ el: unit, block, section: s.id });
    }
    article.append(sec);
  });
}

function applyLocks() {
  const open = firstOpenCheckpoint(S.units.map((u) => u.block), S.answers);
  S.units.forEach((u, i) => {
    const locked = i > open;
    u.el.classList.toggle('locked', locked);
    u.el.inert = locked;
  });
  // Section headings lock with their first block.
  document.querySelectorAll('.ch-section').forEach((sec) => {
    const first = sec.querySelector('.unit');
    const h = sec.querySelector('h2');
    h.classList.toggle('locked', first.classList.contains('locked'));
  });
  renderToc();
}

function renderToc() {
  const states = sectionState(S.chapter, S.answers);
  const toc = $('toc');
  toc.replaceChildren();
  const layerNodes = S.topo.filter((n) => n.layer === S.node.layer);
  layerNodes.forEach((n) => {
    const current = n.id === nodeId;
    const has = S.chapterIds.includes(n.id);
    const label = [el('span', { class: 'toc-num num', text: S.refs[n.id] || '' }), el('span', { text: n.title }), statusMark(n.status, 'sm')];
    label[2].title = statusOf(n.status);
    const item = has && !current
      ? el('a', { class: 'toc-item', href: `chapter.html?course=${encodeURIComponent(course)}&node=${encodeURIComponent(n.id)}` }, label)
      : el('div', { class: `toc-item${current ? ' current' : ' no-chapter'}`, title: has ? '' : 'No chapter yet' }, label);
    toc.append(item);
    if (current) {
      toc.append(el('div', { class: 'toc-sections' }, S.chapter.sections.map((s) => el('a', {
        class: `toc-sec st-${states[s.id]}`,
        href: `#s-${s.id}`,
        text: s.title,
      }))));
    }
  });
}

// ---------- tutor drawer ----------

function drawerAppend(kind, content) {
  const thread = $('drawer-thread');
  const node = kind === 'tutor'
    ? el('div', { class: 'bubble tutor' }, [md(content, '')])
    : el('div', { class: `bubble ${kind}`, text: content });
  thread.append(node);
  thread.scrollTop = thread.scrollHeight;
  return node;
}

function noteFor(ev) {
  if (ev.type === 'ask') return ['learner', ev.text];
  if (ev.type === 'checkpoint') {
    return ['note', ev.skipped ? `${ev.id}: skipped` : `${ev.id}: ${ev.correct ? 'right' : 'wrong'}, ${ev.chosen} · confidence ${ev.confidence}`];
  }
  return ['note', ev.type];
}

let opener = null;
function setOpen(open) {
  const drawer = $('drawer');
  if (open === drawer.classList.contains('open')) return;
  if (open) opener = document.activeElement;
  drawer.classList.toggle('open', open);
  drawer.inert = !open;
  $('tutor-fab').setAttribute('aria-expanded', String(open));
  if (open) {
    S.unread = 0;
    $('tutor-badge').classList.add('hidden');
    $('ask-text').focus();
  } else {
    (opener?.isConnected ? opener : $('tutor-fab')).focus();
    opener = null;
  }
}

let tutorText = '';
let tutorStart = 0;
let tutorTimer = null;
function paintTutorState() {
  const t = tutorText && elapsedText(Date.now() - tutorStart);
  $('tutor-state').textContent = tutorText ? `· ${tutorText}${t ? ` ${t}` : ''}` : '';
}
function setTutorState(text) {
  if (text !== tutorText && text) tutorStart = Date.now();
  tutorText = text;
  if (text === 'reviewing…' && !tutorTimer) tutorTimer = setInterval(paintTutorState, 1000);
  else if (text !== 'reviewing…' && tutorTimer) { clearInterval(tutorTimer); tutorTimer = null; }
  paintTutorState();
}

function handleTurn(turn) {
  for (const u of turn.node_updates || []) {
    if (u.id !== nodeId) continue;
    S.node.status = u.status;
    renderMeta();
    renderToc();
  }
  if (!turn.say || !turn.say.trim()) return;
  drawerAppend('tutor', turn.say);
  if (!$('drawer').classList.contains('open')) {
    S.unread += 1;
    $('tutor-badge').textContent = String(S.unread);
    $('tutor-badge').classList.remove('hidden');
  }
}

function enqueue(event) {
  const [kind, text] = noteFor(event);
  drawerAppend(kind, text);
  S.queue.push(event);
  pump();
}

// One tutor call at a time: the server allows a single turn in flight per lesson.
async function pump() {
  if (S.sending || !S.queue.length) return;
  S.sending = true;
  setTutorState('reviewing…');
  try {
    const { turn } = await postJson('/api/turn', { course, lesson_id: S.lessonId, event: S.queue[0] });
    S.queue.shift();
    handleTurn(turn);
  } catch (err) {
    S.sending = false;
    setTutorState('error');
    const retry = el('button', { text: 'Retry', onclick: () => { box.remove(); pump(); } });
    const box = el('div', { class: 'notice error' }, [el('span', { text: `${turnErrorText(err)} ` }), retry]);
    $('drawer-thread').append(box);
    return;
  }
  S.sending = false;
  setTutorState(S.queue.length ? 'reviewing…' : '');
  pump();
}

function currentSectionTitle() {
  const states = sectionState(S.chapter, S.answers);
  const open = S.chapter.sections.find((s) => states[s.id] === 'open') || S.chapter.sections.at(-1);
  return open.title;
}

// ---------- boot ----------

function replay(events) {
  S.answers = answersFrom(events);
  for (const ev of events) {
    if (ev.role === 'learner') {
      const [kind, text] = noteFor(ev.data);
      drawerAppend(kind, text);
    } else if (ev.role === 'tutor' && ev.data?.say?.trim()) {
      drawerAppend('tutor', ev.data.say);
    }
  }
  // The learner spoke last and the tutor never answered: offer to send it again.
  const last = events.at(-1);
  if (last?.role === 'learner') {
    const retry = el('button', { text: 'Ask it again', onclick: () => { box.remove(); S.queue.push(last.data); pump(); } });
    const box = el('div', { class: 'notice' }, [el('span', { text: "The tutor hasn't reviewed your last message. " }), retry]);
    $('drawer-thread').append(box);
  }
}

async function init() {
  if (!course || !nodeId) return showError('No chapter in the URL. Open one from the map.');
  fillCourseBar(course);
  // Phones: the chapter list starts folded so the reading starts at the top of the screen.
  if (!matchMedia('(min-width: 960px)').matches) $('toc-wrap').open = false;
  try {
    const c = encodeURIComponent(course);
    const [chapter, map, info, lesson] = await Promise.all([
      getJson(`/api/courses/${c}/chapters/${encodeURIComponent(nodeId)}`),
      getJson(`/api/courses/${c}/map`),
      getJson(`/api/courses/${c}`),
      postJson('/api/chapter', { course, node_id: nodeId }),
    ]);
    S.chapter = chapter;
    S.lab = info.lab;
    S.map = map;
    S.chapterIds = info.chapters || [];
    S.node = S.map.nodes.find((n) => n.id === nodeId) || { layer: '', title: S.chapter.title };
    S.lessonId = lesson.lesson_id;

    document.title = `mindgap · ${S.chapter.title}`;
    const layers = info.layers || [];
    S.topo = topoSort(S.map.nodes, layers);
    S.refs = gridRefs(S.topo, layers);
    fillCourseBar(course, info.title);
    $('side-layer').textContent = layers.find((l) => l.id === S.node.layer)?.name || S.chapter.kicker;
    $('ch-title').textContent = S.chapter.title;
    $('ch-lede').textContent = S.chapter.lede;
    renderMeta();

    replay(lesson.events);
    renderArticle();
    applyLocks();
    for (const ev of lesson.events) {
      if (ev.role !== 'lab') continue;
      const card = [...document.querySelectorAll('.lab-card')].find((c) => c.dataset.cmd === ev.data.cmd);
      if (card) fillLabCard(card, ev.data);
    }
  } catch (err) {
    showError(withCode(`Could not load chapter${err.message ? `: ${err.message}` : ''}`, err.status));
  }

  $('tutor-fab').addEventListener('click', () => setOpen(!$('drawer').classList.contains('open')));
  $('drawer-close').addEventListener('click', () => setOpen(false));
  $('drawer').addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
  $('ask-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('ask-text').value.trim();
    if (!text || !S.lessonId) return;
    $('ask-text').value = '';
    enqueue({ type: 'ask', text, section: currentSectionTitle() });
  });
  $('ask-text').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('ask-form').requestSubmit();
  });
}

init();
