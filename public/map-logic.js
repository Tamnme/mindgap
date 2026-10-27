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

// Next node to teach: in-scope, gap/untested, every prereq solid/shaky (unknown or off-goal prereqs count as met).
// Falls back to the first in-scope gap. `topo` is in learning order; `status` maps a node to its status.
export function pickNext(topo, byId, status) {
  const good = (s) => s === 'shaky' || s === 'solid';
  const ok = (n) => !isOffGoal(n) && ['gap', 'untested'].includes(status(n)) &&
    (n.prereqs || []).every((p) => !byId.has(p) || isOffGoal(byId.get(p)) || good(status(byId.get(p))));
  return topo.find(ok) || topo.find((n) => !isOffGoal(n) && status(n) === 'gap') || null;
}

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
