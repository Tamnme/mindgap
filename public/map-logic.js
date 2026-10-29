// Pure map/plan rules (no DOM), shared by map.js, lesson.js and the tests.

export const isOffGoal = (n) => n.in_scope === false;

// Nodes to draw or offer: off-goal ones only when showOff is set.
export function visibleNodes(nodes, showOff) {
  return showOff ? nodes : nodes.filter((n) => !isOffGoal(n));
}

export const offGoalCount = (nodes) => nodes.filter(isOffGoal).length;

// Plan nodes in prereq order (stable: ties keep the plan's order). Unknown ids are dropped.
// `rest` counts map nodes the plan sets aside.
export function planNodes(plan, nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const want = (plan?.in_scope || []).filter((id) => byId.has(id));
  const placed = new Set();
  const order = [];
  let left = want.slice();
  while (left.length) {
    const id = left.find((i) => (byId.get(i).prereqs || []).every((p) => placed.has(p) || !want.includes(p))) ?? left[0];
    placed.add(id);
    order.push(byId.get(id));
    left = left.filter((i) => i !== id);
  }
  return { nodes: order, rest: nodes.length - order.length };
}

// The question the learner answers this turn. A presented plan carries `question: null` by contract,
// but the learner still has to reply to it, so a pending plan gets a free-text box.
export function replyQuestion(turn) {
  if (turn?.question) return turn.question;
  if (turn?.plan && !turn.approved && !turn.lesson_done) {
    return { kind: 'free', prompt: 'Reply to the plan: say go, or ask for changes.', options: [], wants_confidence: false };
  }
  return null;
}

// Next node to teach: in-scope, gap/untested, every prereq solid/shaky (unknown or off-goal prereqs count as met).
// Falls back to the first in-scope gap. `topo` is in learning order; `status` maps a node to its status.
export function pickNext(topo, byId, status) {
  const good = (s) => s === 'shaky' || s === 'solid';
  const ok = (n) => !isOffGoal(n) && ['gap', 'untested'].includes(status(n)) &&
    (n.prereqs || []).every((p) => !byId.has(p) || isOffGoal(byId.get(p)) || good(status(byId.get(p))));
  return topo.find(ok) || topo.find((n) => !isOffGoal(n) && status(n) === 'gap') || null;
}

// Write chapter is offered only for generated courses, on nodes with no chapter yet.
export const canWriteChapter = (generated, chapters, id) => generated === true && !chapters.includes(id);

// "data:<mime>;base64,<payload>" -> "<payload>".
export function dataUrlToBase64(dataUrl) {
  const i = String(dataUrl).indexOf(',');
  return i === -1 ? '' : String(dataUrl).slice(i + 1);
}

// Message for a failed sources request; a 503 with `install` means markitdown is missing.
export function sourceErrorMessage(status, body) {
  if (status === 503 && body && body.install) {
    return `Sources need markitdown: run \`${body.install}\`, then restart mindgap.`;
  }
  return (body && body.error) || `HTTP ${status}`;
}

// Search: case-insensitive substring on title and id. An empty query matches everything.
export function nodeMatches(node, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return `${node.title || ''}\n${node.id || ''}`.toLowerCase().includes(q);
}

// Buttons tagged with these data-action values start an AI call and are locked while one runs.
const AI_ACTIONS = new Set(['next', 'practice', 'debug', 'goal', 'write', 'probe', 'teach']);
export const startsAiCall = (action) => AI_ACTIONS.has(action);

// 'teach' on a node with a written chapter just navigates, so it stays enabled.
export const lockWhileBusy = (action, hasChapter) => startsAiCall(action) && !(action === 'teach' && hasChapter);

// --- Survey sheet: rows of grid-referenced squares, one row per layer. ---

const STOP = new Set(['and', 'of', 'the', 'a', 'an', 'to', 'in', 'on', 'for']);

// Short margin code from a layer id: "L3" as-is; "layer-3" -> L3; "ownership-basics" -> OB; "overlay" -> OV.
function codeFor(id) {
  if (id.length <= 3) return id;
  const words = id.split(/[^A-Za-z0-9]+/).filter((w) => w && !STOP.has(w.toLowerCase()));
  const num = words.find((w) => /^\d+$/.test(w));
  if (num) return `${(words[0] || 'L')[0]}${num}`.slice(0, 3);
  return words.length > 1 ? words[0][0] + words[1][0] : (words[0] || id).slice(0, 2);
}

// Margin code per layer (see codeFor); clashes get a digit.
export function layerCodes(layers) {
  const out = {};
  const used = new Set();
  for (const { id } of layers) {
    const base = codeFor(id).toUpperCase();
    let code = base;
    for (let i = 2; used.has(code); i++) code = `${base}${i}`;
    used.add(code);
    out[id] = code;
  }
  return out;
}

const UNKNOWN_LAYER = { id: null, name: 'Other', code: '??' };

// All rows in course layer order (unknown layers last), each node keeping its place even when hidden.
function allRows(topo, layers) {
  const codes = layerCodes(layers);
  const rows = layers.map((l) => ({ layer: l.id, name: l.name || l.id, code: codes[l.id], nodes: [] }));
  const byLayer = new Map(rows.map((r) => [r.layer, r]));
  const other = { layer: UNKNOWN_LAYER.id, name: UNKNOWN_LAYER.name, code: UNKNOWN_LAYER.code, nodes: [] };
  for (const n of topo) (byLayer.get(n.layer) || other).nodes.push(n);
  return [...rows, other];
}

// Rows to draw: off-goal squares only when showOff; empty rows dropped. `topo` is in learning order.
export function sheetRows(topo, layers, showOff) {
  return allRows(topo, layers)
    .map((r) => ({ ...r, nodes: visibleNodes(r.nodes, showOff) }))
    .filter((r) => r.nodes.length);
}

// "L3·04": row code and 1-based column in learning order. Off-goal nodes keep a number, so refs never shift.
export function gridRefs(topo, layers) {
  const refs = {};
  for (const r of allRows(topo, layers)) r.nodes.forEach((n, i) => { refs[n.id] = `${r.code}·${String(i + 1).padStart(2, '0')}`; });
  return refs;
}

// The two runner-up suggestions beside the main pick: first shaky (review) and first gap whose prereqs are all solid.
export function alternates(topo, byId, status, main) {
  const free = (n) => !isOffGoal(n) && n !== main;
  const review = topo.find((n) => free(n) && status(n) === 'shaky') || null;
  const solidPrereqs = (n) => (n.prereqs || []).every((p) => !byId.has(p) || isOffGoal(byId.get(p)) || status(byId.get(p)) === 'solid');
  const gap = topo.find((n) => free(n) && n !== review && status(n) === 'gap' && solidPrereqs(n)) || null;
  return { review, gap };
}

// Every topic `id` builds on, directly or not.
export function prereqRoute(id, byId) {
  const seen = new Set();
  const walk = (x) => {
    for (const p of byId.get(x)?.prereqs || []) {
      if (p !== id && !seen.has(p)) { seen.add(p); walk(p); }
    }
  };
  walk(id);
  return seen;
}

export function statusCounts(nodes, status) {
  const c = { untested: 0, gap: 0, shaky: 0, solid: 0, total: 0, off: 0 };
  for (const n of nodes) {
    if (isOffGoal(n)) { c.off++; continue; }
    c[status(n)]++;
    c.total++;
  }
  return c;
}

// Nothing measured and no plan approved (an approved plan marks off-goal nodes): the goal question is the home.
export const isFirstRun = (nodes, status) => nodes.every((n) => status(n) === 'untested' && !isOffGoal(n));

// Arrow-key move across the sheet: left/right wrap within a row, up/down keep the column, clamped to the row.
export function gridMove(rows, id, key) {
  const r = rows.findIndex((row) => row.nodes.some((n) => n.id === id));
  if (r === -1) return null;
  const row = rows[r].nodes;
  const c = row.findIndex((n) => n.id === id);
  if (key === 'ArrowRight') return row[(c + 1) % row.length].id;
  if (key === 'ArrowLeft') return row[(c - 1 + row.length) % row.length].id;
  const to = key === 'ArrowDown' ? rows[r + 1] : key === 'ArrowUp' ? rows[r - 1] : null;
  return to ? to.nodes[Math.min(c, to.nodes.length - 1)].id : null;
}
