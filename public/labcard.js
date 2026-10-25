// Lab card shared by the lesson and chapter pages. All text goes in via textContent.

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

// A lab card: code on top, Run bar, output panel once it has run. onRun(card) does the fetch.
export function createLabCard(lab, onRun) {
  const code = el('pre', { class: 'lab-code' });
  if (lab.explain) code.append(el('span', { class: 'sh-comment sh-explain', text: `# ${lab.explain}` }), '\n');
  (lab.cmd || '').split('\n').forEach((line, n) => { if (n) code.append('\n'); code.append(shellLine(line)); });
  const btn = el('button', { class: 'run', text: '▶ Run in netlab' });
  const card = el('div', { class: 'lab-card' }, [
    code,
    el('div', { class: 'lab-bar' }, [btn]),
    el('div', { class: 'lab-out hidden' }),
  ]);
  card.dataset.cmd = lab.cmd || '';
  btn.addEventListener('click', () => onRun(card));
  return card;
}

export function fillLabCard(card, out) {
  const box = card.querySelector('.lab-out');
  box.replaceChildren(...labOutput(out));
  box.classList.remove('hidden');
}

