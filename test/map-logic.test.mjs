import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleNodes, offGoalCount, planNodes, pickNext } from '../public/map-logic.js';

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

test('pickNext treats off-goal prereqs as met and skips off-goal nodes', () => {
  const ns = [
    { id: 'o', in_scope: false, status: 'gap' },
    { id: 'n', prereqs: ['o'], status: 'untested' },
  ];
  const byId = new Map(ns.map((n) => [n.id, n]));
  assert.equal(pickNext(ns, byId, (n) => n.status).id, 'n');
});

import { dataUrlToBase64, sourceErrorMessage } from '../public/map-logic.js';

test('dataUrlToBase64 strips the prefix', () => {
  assert.equal(dataUrlToBase64('data:application/pdf;base64,QUJD'), 'QUJD');
  assert.equal(dataUrlToBase64('nope'), '');
});

test('sourceErrorMessage: 503 with install names markitdown', () => {
  assert.equal(
    sourceErrorMessage(503, { error: 'markitdown is not installed', install: "pip install 'markitdown[all]'" }),
    "Sources need markitdown: run `pip install 'markitdown[all]'`, then restart mindgap.",
  );
  assert.equal(sourceErrorMessage(422, { error: 'bad' }), 'bad');
  assert.equal(sourceErrorMessage(500, null), 'HTTP 500');
});

test('canWriteChapter: generated courses only, and only without a chapter', async () => {
  const { canWriteChapter } = await import('../public/map-logic.js');
  assert.equal(canWriteChapter(true, ['a'], 'b'), true);
  assert.equal(canWriteChapter(true, ['a'], 'a'), false);
  assert.equal(canWriteChapter(false, [], 'a'), false);
  assert.equal(canWriteChapter(undefined, [], 'a'), false);
});

test('replyQuestion: a pending plan turn still gets a reply box', async () => {
  const { replyQuestion } = await import('../public/map-logic.js');
  const q = { kind: 'choice', prompt: 'p', options: ['a'], wants_confidence: true };
  assert.equal(replyQuestion({ question: q }), q);
  const plan = { approach: 'x', in_scope: [] };
  const r = replyQuestion({ plan, question: null });
  assert.equal(r.kind, 'free');
  assert.deepEqual(r.options, []);
  assert.equal(r.wants_confidence, false);
  assert.equal(replyQuestion({ say: 'go', question: null }), null);
  assert.equal(replyQuestion({ plan, approved: true, lesson_done: true }), null);
  assert.equal(replyQuestion(null), null);
});
