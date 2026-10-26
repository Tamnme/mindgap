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
