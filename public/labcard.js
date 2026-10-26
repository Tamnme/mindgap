// Lab card shared by the lesson and chapter pages. All text goes in via textContent.

const RUN_LABEL = '▶ Run in lab';

// What each extra capability lets the lab do. Others are shown by name only.
const CAP_MEANING = {
  NET_ADMIN: 'create and change network interfaces inside the lab container',
  SYS_ADMIN: 'mount filesystems inside the lab container (needed for network namespaces); a broad privilege',
};

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (v !== false && v != null) node.setAttribute(k, String(v));
  }
  for (const c of [].concat(children)) if (c != null) node.append(c);
  return node;
}

// Light shell colouring, built from text nodes so nothing is parsed as HTML.
// Programs (first word of each pipeline segment) blue, flags muted, numbers amber, # comments italic.
function shellLine(line) {
  const frag = document.createDocumentFragment();
  let start = true;
  for (const tok of line.split(/(\s+|\|\||&&|[|;]|#.*$)/).filter(Boolean)) {
    let cls = null;
    if (tok.startsWith('#')) cls = 'sh-comment';
    else if (/^(\|\||&&|[|;])$/.test(tok)) { cls = 'sh-op'; start = true; }
    else if (/^\s+$/.test(tok)) cls = null;
    else if (start) { cls = 'sh-cmd'; start = false; }
    else if (/^--?\w/.test(tok)) cls = 'sh-flag';
    else if (/^\d+$/.test(tok)) cls = 'sh-num';
    frag.append(cls ? el('span', { class: cls, text: tok }) : document.createTextNode(tok));
  }
  return frag;
}

function labOutput(out) {
  return [
    el('div', { class: 'lab-label', text: `Output · exit ${out.code ?? '?'}` }),
    out.stdout ? el('pre', { text: out.stdout }) : null,
    out.stderr ? el('pre', { class: 'stderr', text: out.stderr }) : null,
    !out.stdout && !out.stderr ? el('pre', { class: 'muted', text: '(no output)' }) : null,
    el('div', { class: 'lab-note', text: 'The tutor sees this output with your next answer.' }),
  ].filter(Boolean);
}

// A lab card: code on top, Run bar, approval prompt (hidden until needed), output panel once it has run.
// state is the course's lab state from GET /api/courses/:slug; when Docker is unavailable there is no Run button.
// onRun(card) does the run (see runLabCommand).
export function createLabCard(lab, onRun, state) {
  const code = el('pre', { class: 'lab-code' });
  if (lab.explain) code.append(el('span', { class: 'sh-comment sh-explain', text: `# ${lab.explain}` }), '\n');
  (lab.cmd || '').split('\n').forEach((line, n) => { if (n) code.append('\n'); code.append(shellLine(line)); });
  const unavailable = state?.available === false;
  const btn = el('button', { class: 'run', text: RUN_LABEL });
  const card = el('div', { class: 'lab-card' }, [
    code,
    el('div', { class: 'lab-bar' }, [
      unavailable ? el('span', { class: 'lab-unavailable', text: `Labs need Docker: ${state.reason}` }) : btn,
    ]),
    el('div', { class: 'lab-approval hidden' }),
    el('div', { class: 'lab-out hidden' }),
  ]);
  card.dataset.cmd = lab.cmd || '';
  if (!unavailable) btn.addEventListener('click', () => onRun(card));
  return card;
}

export function fillLabCard(card, out) {
  const box = card.querySelector('.lab-out');
  box.replaceChildren(...labOutput(out));
  box.classList.remove('hidden');
}

// Run button while a run is in flight, then back to its resting label (after a run, a failure or a cancel).
export function setLabBusy(card, busy) {
  const btn = card.querySelector('.run');
  const ran = !card.querySelector('.lab-out').classList.contains('hidden');
  btn.disabled = busy;
  btn.textContent = busy ? '… Running' : ran ? '↻ Run again' : RUN_LABEL;
}

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let data = {};
  try { data = await res.json(); } catch { /* 204 and empty bodies */ }
  return { ok: res.ok, status: res.status, body: data };
}

// Shows what the course's lab needs beyond the defaults. Resolves true on Approve, false on Cancel.
function askApproval(card, request) {
  const panel = card.querySelector('.lab-approval');
  return new Promise((resolve) => {
    const items = request.caps.map((cap) => el('li', { text: `${cap}: ${CAP_MEANING[cap] || 'a Linux capability'}` }));
    if (request.network) items.push(el('li', { text: 'Network: outbound internet access' }));
    const finish = (ok) => {
      panel.classList.add('hidden');
      panel.replaceChildren();
      resolve(ok);
    };
    const approve = el('button', { class: 'approve', text: 'Approve and run' });
    const cancel = el('button', { class: 'cancel', text: 'Cancel' });
    approve.addEventListener('click', () => finish(true));
    cancel.addEventListener('click', () => finish(false));
    panel.replaceChildren(
      el('div', { class: 'lab-label', text: 'This lab needs more than the defaults' }),
      el('p', { text: 'By default a lab container has no network and no extra Linux capabilities. This course asks for:' }),
      el('ul', {}, items),
      el('p', { class: 'lab-note', text: 'Approval is remembered for this course. Nothing beyond the defaults runs until you approve.' }),
      el('div', {}, [approve, cancel]),
    );
    panel.classList.remove('hidden');
  });
}

// Runs the card's command. When the course needs approval, asks the learner and posts the approval first.
// Resolves to {stdout, stderr, code}, or null if the learner cancels. Throws Error(message) on failure.
export async function runLabCommand(card, { course, lessonId }) {
  const cmd = card.dataset.cmd;
  let res = await post('/api/lab', { course, lesson_id: lessonId, cmd });
  if (res.status === 428) {
    const { caps, network } = res.body.request;
    if (!(await askApproval(card, res.body.request))) return null;
    const ap = await post(`/api/courses/${encodeURIComponent(course)}/lab-approval`, { caps, network });
    if (!ap.ok) throw new Error(ap.body.error || `HTTP ${ap.status}`);
    res = await post('/api/lab', { course, lesson_id: lessonId, cmd });
  }
  if (!res.ok) throw new Error(res.body.error || `HTTP ${res.status}`);
  return res.body;
}

