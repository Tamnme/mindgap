import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleNodes, offGoalCount, planNodes } from '../public/map-logic.js';

const nodes = [
  { id: 'a' },
  { id: 'b', prereqs: ['a'] },
  { id: 'c', in_scope: false },
  { id: 'd', prereqs: ['b'] },
];

test('visibleNodes hides off-goal unless asked', () => {
  assert.deepEqual(visibleNodes(nodes, false).map((n) => n.id), ['a', 'b', 'd']);
  assert.equal(visibleNodes(nodes, true).length, 4);
  assert.equal(offGoalCount(nodes), 1);
});

test('planNodes orders by prereqs, drops unknown ids, counts the rest', () => {
  const r = planNodes({ in_scope: ['d', 'b', 'zzz', 'a'] }, nodes);
  assert.deepEqual(r.nodes.map((n) => n.id), ['a', 'b', 'd']);
  assert.equal(r.rest, 1);
});

test('planNodes survives a cycle', () => {
  const cyc = [{ id: 'x', prereqs: ['y'] }, { id: 'y', prereqs: ['x'] }];
  assert.equal(planNodes({ in_scope: ['x', 'y'] }, cyc).nodes.length, 2);
});
