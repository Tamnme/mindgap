// Workbench: tutor thread, question card, simulator and lab panels for one lesson.
// Model text is rendered with renderMarkdown (escapes first); everything else uses textContent.

import { renderMarkdown } from './md.js';
import { planNodes, replyQuestion } from './map-logic.js';
import { elapsedText, turnErrorText, withCode } from './ui-text.js';
import { createLabCard, fillLabCard, runLabCommand, setLabBusy } from './labcard.js';

const $ = (id) => document.getElementById(id);
const course = new URLSearchParams(location.search).get('course');
const lessonId = new URLSearchParams(location.search).get('id');
const mapUrl = `map.html?course=${encodeURIComponent(course || '')}`;

const S = {
  meta: null,
  node: null,
  mapNodes: [],      // all course map nodes, for plan cards
  turn: null,        // latest tutor turn
  waiting: false,    // /api/turn in flight
  labRunning: false,
  done: false,
  pending: null,     // {event, summary} not yet acknowledged by the server
  selectedChoice: null,
  confidence: null,
  scenario: null,    // last simulator scenario opened in the thread
  sim: null,         // {card, instance} of the live simulator
  simToken: 0,
  lab: null,         // course lab state: {available, reason?, request, approved}
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) node.setAttribute(k, String(v));
  }
  for (const c of [].concat(children)) if (c != null) node.append(c);
  return node;
}

async function errorText(res) {
  try {
    const body = await res.json();
    return body.error || '';
  } catch {
    return '';
  }
}

function showError(msg) {
  const box = $('error');
  box.textContent = msg;
  box.classList.toggle('hidden', !msg);
}

function showTurnError(msg) {
  const box = $('turn-error');
  $('turn-error-text').textContent = msg || '';
  box.classList.toggle('hidden', !msg);
  $('btn-retry').disabled = S.waiting;
}

const messageFor = turnErrorText;

// The page scrolls, not the thread: sims and lab cards live inline in the conversation.
function scrollToBottom() {
  window.scrollTo({ top: document.body.scrollHeight });
}

function appendTutor(say) {
  // renderMarkdown escapes all model text before adding its own tags.
  const body = el('div');
  body.innerHTML = renderMarkdown(say);
  const bubble = el('div', { class: 'bubble tutor' }, [el('div', { class: 'who', text: 'Tutor' }), body]);
  $('thread').append(bubble);
  return bubble;
}

function appendLearner(summary) {
  $('thread').append(el('div', { class: 'bubble learner', text: summary }));
  scrollToBottom();
}

// A command the tutor suggested: code on top, Run bar, output panel once it has run.
function appendLabCard(lab) {
  const card = createLabCard(lab, runLab, S.lab);
  $('thread').append(card);
  return card;
}

// Replay: put a recorded lab run into the last card with that command, else its own card.
function appendLabRun(out) {
  const cards = [...document.querySelectorAll('.lab-card')].filter(c => c.dataset.cmd === (out.cmd ?? ''));
  const card = cards.at(-1) || appendLabCard({ cmd: out.cmd });
  fillLabCard(card, out);
}

// A tutor turn in the thread: the message, then any simulator or lab it opened.
function appendAssessment(a) {
  const card = el('div', { class: 'card assessment-card' }, [el('div', { class: 'who', text: 'Assessment' })]);
  for (const r of a.strands || []) {
    card.append(el('p', {}, [el('strong', { text: r.strand }), ': ', el('span', { text: r.assessment })]));
  }
  if (a.summary) card.append(el('p', { text: a.summary }));
  $('thread').append(card);
}

function appendPlan(plan) {
  const { nodes, rest } = planNodes(plan, S.mapNodes);
  const approach = el('div');
  approach.innerHTML = renderMarkdown(plan.approach || '');
  const card = el('div', { class: 'card plan-card' }, [el('div', { class: 'who', text: 'Proposed plan' }), approach]);
  const list = el('ol', { class: 'plan-nodes' });
  for (const n of nodes) {
    const s = ['untested', 'gap', 'shaky', 'solid'].includes(n.status) ? n.status : 'untested';
    list.append(el('li', {}, [el('span', { text: `${n.title || n.id} ` }), el('span', { class: `chip ${s}`, text: s })]));
  }
  card.append(list);
  if (rest > 0) card.append(el('p', { class: 'muted small', text: `${rest} topics set aside` }));
  card.append(el('p', { class: 'muted small', text: 'Reply below to agree or ask for changes.' }));
  $('thread').append(card);
}

function appendTurn(turn) {
  const bubble = turn.say ? appendTutor(turn.say) : null;
  if (turn.assessment) appendAssessment(turn.assessment);
  if (turn.plan) appendPlan(turn.plan);
  if (turn.sim && turn.sim.scenario && turn.sim.scenario !== S.scenario) openSim(turn.sim.scenario);
  if (turn.lab && turn.lab.cmd) appendLabCard(turn.lab);
  return bubble;
}

function summarize(e) {
  if (e.type === 'answer') {
    const parts = [];
    if (e.choice != null) parts.push(`Answer: ${e.choice}`);
    if (e.text) parts.push(e.text);
    if (e.confidence) parts.push(`Confidence ${e.confidence}/5`);
    if (e.reasoning) parts.push(`Because: ${e.reasoning}`);
    return parts.join('\n') || 'Answer';
  }
  if (e.type === 'lost') return e.text ? `I'm lost: ${e.text}` : "I'm lost";
  if (e.type === 'ask') return `Question: ${e.text}`;
  return JSON.stringify(e);
}

function isChoice(q) {
  return !!q && q.kind === 'choice' && Array.isArray(q.options) && q.options.length > 0;
}

function renderQuestion(q) {
  S.selectedChoice = null;
  S.confidence = null;
  $('reasoning').value = '';
  $('q-text').value = '';
  const card = $('question');
  card.classList.toggle('hidden', !q);
  if (!q) return;

  // renderMarkdown escapes the prompt first, same as tutor bubbles.
  $('q-prompt').innerHTML = renderMarkdown(q.prompt || '');
  const opts = $('q-options');
  opts.replaceChildren();
  const choice = isChoice(q);
  opts.classList.toggle('hidden', !choice);
  if (choice) {
    q.options.forEach((opt) => {
      const input = el('input', { type: 'radio', name: 'choice' });
      input.addEventListener('change', () => { S.selectedChoice = opt; refreshControls(); });
      opts.append(el('label', { class: 'opt' }, [input, el('span', { text: opt })]));
    });
  }
  $('q-free').classList.toggle('hidden', choice);

  const conf = $('q-confidence');
  conf.classList.toggle('hidden', !q.wants_confidence);
  const cb = $('conf-buttons');
  cb.replaceChildren();
  if (q.wants_confidence) {
    for (let c = 1; c <= 5; c++) {
      const end = c === 1 ? ', guessing' : c === 5 ? ', certain' : '';
      const b = el('button', { type: 'button', 'aria-label': `Confidence ${c} of 5${end}`, text: String(c) });
      b.addEventListener('click', () => {
        S.confidence = S.confidence === c ? null : c;
        syncConfidence();
        refreshControls();
      });
      cb.append(b);
    }
  }
}

function syncConfidence() {
  document.querySelectorAll('#conf-buttons button').forEach((b) => {
    const on = Number(b.textContent) === S.confidence;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

// One live simulator at a time: opening a new one closes the previous card.
function openSim(scenario) {
  const token = ++S.simToken;
  if (S.sim) {
    S.sim.instance?.destroy?.();
    S.sim.card.querySelector('.sim-host')
      .replaceChildren(el('p', { class: 'muted small', text: 'Closed. A newer simulator is open below.' }));
  }
  const host = el('div', { class: 'sim-host' });
  const card = el('div', { class: 'card sim-card' }, [el('div', { class: 'who', text: `Simulator · ${scenario}` }), host]);
  $('thread').append(card);
  S.sim = { card, instance: null };
  S.scenario = scenario;
  import('/sim/switch-sim.js')
    .then((mod) => {
      if (token !== S.simToken) return;
      S.sim.instance = mod.mount(host, scenario);
    })
    .catch(() => {
      if (token !== S.simToken) return;
      host.replaceChildren(el('p', { class: 'muted small', text: 'simulator unavailable' }));
    });
}

function setStatusChip(status) {
  const chip = $('status-chip');
  const s = ['untested', 'gap', 'shaky', 'solid'].includes(status) ? status : 'untested';
  chip.className = `chip ${s}`;
  chip.textContent = s;
}

function renderBanner() {
  const banner = $('done-banner');
  banner.classList.toggle('hidden', !S.done);
  if (S.done) {
    banner.replaceChildren(
      el('span', { text: S.meta?.mode === 'course' ? 'Plan approved — ' : 'Lesson complete — ' }),
      el('a', { href: mapUrl, text: 'back to map' }),
    );
  }
}

// Keep the plan cards' node statuses current. Idempotent, so replay (fresh map) and live turns can both call it.
function applyNodeUpdates(turn) {
  for (const u of turn.node_updates || []) {
    const n = S.mapNodes.find((x) => x.id === u.id);
    if (n) n.status = u.status;
  }
}

// Apply a tutor turn's controls. Used for live turns and for the last turn on replay.
function applyTurn(turn) {
  S.turn = turn;
  applyNodeUpdates(turn);
  renderQuestion(replyQuestion(turn));
  if (S.meta) {
    for (const u of turn.node_updates || []) {
      if (u.id === S.meta.node_id) setStatusChip(u.status);
    }
  }
  S.done = !!turn.lesson_done;
  renderBanner();
  refreshControls();
}

let waitStart = 0;
let waitTimer = null;
function trackElapsed() {
  if (S.waiting && !waitTimer) {
    waitStart = Date.now();
    waitTimer = setInterval(() => { $('elapsed').textContent = elapsedText(Date.now() - waitStart); }, 1000);
  } else if (!S.waiting && waitTimer) {
    clearInterval(waitTimer);
    waitTimer = null;
    $('elapsed').textContent = '';
  }
}

function refreshControls() {
  const locked = S.waiting || S.done;
  const q = replyQuestion(S.turn);
  let hasAnswer = false;
  if (q && isChoice(q)) hasAnswer = S.selectedChoice != null;
  else if (q) hasAnswer = $('q-text').value.trim() !== '';

  $('btn-submit').disabled = locked || !hasAnswer;
  $('btn-lost').disabled = locked;
  $('btn-ask').disabled = locked;
  document.querySelectorAll('.lab-card .run').forEach((b) => { b.disabled = locked || S.labRunning; });
  $('waiting').classList.toggle('hidden', !S.waiting);
  trackElapsed();
  $('ask-input').disabled = locked;
  $('ask-send').disabled = locked || $('ask-input').value.trim() === '';
  document.querySelectorAll('#question input, #question textarea, #question button')
    .forEach((x) => { x.disabled = locked; });
  $('btn-retry').disabled = S.waiting;
}

async function dispatch() {
  S.waiting = true;
  showTurnError('');
  refreshControls();
  try {
    const res = await fetch('/api/turn', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ course, lesson_id: lessonId, event: S.pending.event }),
    });
    if (!res.ok) throw new HttpError(res.status, await errorText(res));
    const data = await res.json();
    if (!data.turn) throw new HttpError(res.status, 'empty turn');
    S.pending = null;
    showTurnError('');
    S.waiting = false;
    applyNodeUpdates(data.turn); // before the plan card renders
    const bubble = appendTurn(data.turn);
    applyTurn(data.turn);
    // Long explanations: show the start of the reply, not its end.
    (bubble || $('question')).scrollIntoView({ block: 'start', behavior: 'smooth' });
  } catch (err) {
    S.waiting = false;
    showTurnError(messageFor(err));
    refreshControls();
  }
}

// Shows the learner's submission immediately; a failed send keeps it pending for Retry.
function send(event, summary) {
  S.pending = { event, summary };
  appendLearner(summary);
  showTurnError('');
  return dispatch();
}

function onSubmit() {
  const q = replyQuestion(S.turn);
  if (!q) return;
  const reasoning = $('reasoning').value.trim();
  const event = { type: 'answer' };
  if (isChoice(q)) event.choice = S.selectedChoice;
  else event.text = $('q-text').value.trim();
  if (S.confidence) event.confidence = S.confidence;
  if (reasoning) event.reasoning = reasoning;
  send(event, summarize(event));
}

function onLost() {
  const text = $('reasoning').value.trim();
  const event = { type: 'lost' };
  if (text) event.text = text;
  send(event, summarize(event));
}

function openAsk(open) {
  $('ask-box').classList.toggle('hidden', !open);
  if (open) $('ask-input').focus();
  else { $('ask-input').value = ''; $('btn-ask').focus(); }
  refreshControls();
}

function onAsk(e) {
  e.preventDefault();
  const text = $('ask-input').value.trim();
  if (!text || S.waiting || S.done) return;
  openAsk(false);
  send({ type: 'ask', text }, summarize({ type: 'ask', text }));
}

async function runLab(card) {
  S.labRunning = true;
  setLabBusy(card, true);
  refreshControls();
  try {
    const out = await runLabCommand(card, { course, lessonId });
    if (out) {
      fillLabCard(card, { cmd: card.dataset.cmd, ...out });
      showError('');
    }
  } catch (err) {
    showError(`Lab run failed: ${err.message}`);
  } finally {
    S.labRunning = false;
    setLabBusy(card, false);
    refreshControls();
  }
}

// Rebuild the thread from the transcript. Roles: tutor | learner | lab.
function replay(events) {
  let lastTutor = null;
  let lastLearner = null;
  for (const ev of events) {
    if (ev.role === 'tutor') {
      const t = ev.data || ev.turn || ev;
      appendTurn(t);
      lastTutor = t;
      lastLearner = null;
    } else if (ev.role === 'learner') {
      const e = ev.data || ev.event || ev;
      appendLearner(summarize(e));
      lastLearner = { event: e, summary: summarize(e) };
    } else if (ev.role === 'lab') {
      const o = ev.data || ev.lab || ev;
      appendLabRun(o);
    }
  }
  if (lastTutor) applyTurn(lastTutor);
  if (lastLearner) {
    // The learner spoke last and no tutor reply is recorded: offer a retry.
    S.pending = lastLearner;
    showTurnError('The tutor has not answered your last message. Retry?');
  }
  refreshControls();
  scrollToBottom();
}

async function init() {
  if (!course || !lessonId) {
    showError('No lesson in the URL. Start a lesson from the map.');
    return;
  }
  $('back-map').href = mapUrl;
  $('btn-submit').addEventListener('click', onSubmit);
  $('btn-lost').addEventListener('click', onLost);
  $('btn-ask').addEventListener('click', () => openAsk($('ask-box').classList.contains('hidden')));
  $('ask-box').addEventListener('submit', onAsk);
  $('ask-cancel').addEventListener('click', () => openAsk(false));
  $('ask-input').addEventListener('input', refreshControls);
  $('ask-box').addEventListener('keydown', (e) => { if (e.key === 'Escape') openAsk(false); });
  $('btn-retry').addEventListener('click', () => { if (S.pending && !S.waiting) dispatch(); });
  $('q-text').addEventListener('input', refreshControls);

  try {
    const c = encodeURIComponent(course);
    const [lessonRes, mapRes, courseRes] = await Promise.all([
      fetch(`/api/lesson/${encodeURIComponent(lessonId)}?course=${c}`),
      fetch(`/api/courses/${c}/map`),
      fetch(`/api/courses/${c}`),
    ]);
    if (!lessonRes.ok) throw new HttpError(lessonRes.status, await errorText(lessonRes));
    const { meta = {}, events = [] } = await lessonRes.json();
    S.meta = meta;
    if (courseRes.ok) S.lab = (await courseRes.json()).lab ?? null;
    if (mapRes.ok) {
      const map = await mapRes.json();
      S.mapNodes = map.nodes || [];
      S.node = S.mapNodes.find(n => n.id === meta.node_id) || null;
    }
    if (meta.mode === 'course') {
      $('title').textContent = 'New goal';
      $('status-chip').classList.add('hidden');
    } else {
      $('title').textContent = S.node?.title || meta.node_id || 'Lesson';
      setStatusChip(S.node?.status);
    }
    if (meta.mode) {
      const m = $('mode-chip');
      m.textContent = meta.mode;
      m.classList.remove('hidden');
    }
    replay(events);
  } catch (err) {
    showError(withCode(`Could not load lesson${err.message ? `: ${err.message}` : ''}`, err.status));
  }
}

init();
