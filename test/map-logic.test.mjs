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

import { nodeMatches, lockWhileBusy } from '../public/map-logic.js';

test('nodeMatches: case-insensitive substring on title and id, empty matches all', () => {
  const n = { id: 'tcp-handshake', title: 'Three-way Handshake' };
  assert.equal(nodeMatches(n, ''), true);
  assert.equal(nodeMatches(n, '  '), true);
  assert.equal(nodeMatches(n, 'HANDSHAKE'), true);
  assert.equal(nodeMatches(n, 'tcp-h'), true);
  assert.equal(nodeMatches(n, 'udp'), false);
  assert.equal(nodeMatches({ id: 'x' }, 'x'), true);
});

test('lockWhileBusy locks AI-starting actions only', () => {
  for (const a of ['next', 'practice', 'debug', 'goal', 'write', 'probe']) assert.equal(lockWhileBusy(a, false), true, a);
  assert.equal(lockWhileBusy('teach', false), true);
  assert.equal(lockWhileBusy('teach', true), false);
  for (const a of ['sources', 'remove', 'add', undefined]) assert.equal(lockWhileBusy(a, false), false, String(a));
});

import { layerCodes, sheetRows, gridRefs, alternates, prereqRoute, statusCounts, isFirstRun, gridMove } from '../public/map-logic.js';

const st = (n) => n.status || 'untested';

test('layerCodes: short ids as-is, numbered ids keep the number, words give initials, clashes numbered', () => {
  assert.deepEqual(
    layerCodes([{ id: 'L1' }, { id: 'overlay' }, { id: 'services' }, { id: 'serving' }, { id: 'l2' }]),
    { L1: 'L1', overlay: 'OV', services: 'SE', serving: 'SE2', l2: 'L2' },
  );
  assert.deepEqual(
    layerCodes([{ id: 'layer-0' }, { id: 'layer-12' }, { id: 'ownership-basics' }, { id: 'state_of_the_art' }, { id: 'one-basics' }]),
    { 'layer-0': 'L0', 'layer-12': 'L12', 'ownership-basics': 'OB', state_of_the_art: 'SA', 'one-basics': 'OB2' },
  );
  assert.deepEqual(layerCodes([]), {});
});

const sheet = [
  { id: 'a', layer: 'L1', status: 'solid' },
  { id: 'b', layer: 'L2', prereqs: ['a'], status: 'gap' },
  { id: 'c', layer: 'L2', prereqs: ['b'], status: 'shaky' },
  { id: 'x', layer: 'L2', in_scope: false },
  { id: 'd', layer: 'L3', prereqs: ['a'], status: 'gap' },
  { id: 'e', layer: 'zz' },
];
const layers = [{ id: 'L1', name: 'One' }, { id: 'L2', name: 'Two' }, { id: 'L3', name: 'Three' }, { id: 'L9', name: 'Empty' }];

test('sheetRows: course layer order, unknown layer last, empty layers dropped, off-goal only when shown', () => {
  const rows = sheetRows(sheet, layers, false);
  assert.deepEqual(rows.map((r) => [r.code, r.nodes.map((n) => n.id)]), [['L1', ['a']], ['L2', ['b', 'c']], ['L3', ['d']], ['??', ['e']]]);
  assert.equal(rows[1].name, 'Two');
  assert.deepEqual(sheetRows(sheet, layers, true)[1].nodes.map((n) => n.id), ['b', 'c', 'x']);
});

test('gridRefs numbers squares within their row, stable whether off-goal is shown or not', () => {
  const refs = gridRefs(sheet, layers);
  assert.equal(refs.a, 'L1·01');
  assert.equal(refs.c, 'L2·02');
  assert.equal(refs.x, 'L2·03');
  assert.equal(refs.e, '??·01');
});

test('alternates: first shaky, first gap with all prereqs solid, never the main pick or each other', () => {
  const byId = new Map(sheet.map((n) => [n.id, n]));
  const b = byId.get('b');
  assert.deepEqual(alternates(sheet, byId, st, b), { review: byId.get('c'), gap: byId.get('d') });
  assert.deepEqual(alternates(sheet, byId, st, byId.get('d')), { review: byId.get('c'), gap: b });
  assert.deepEqual(alternates([], new Map(), st, null), { review: null, gap: null });
});

test('prereqRoute is transitive and survives cycles', () => {
  const byId = new Map([...sheet, { id: 'p', prereqs: ['q'] }, { id: 'q', prereqs: ['p'] }].map((n) => [n.id, n]));
  assert.deepEqual([...prereqRoute('c', byId)].sort(), ['a', 'b']);
  assert.deepEqual([...prereqRoute('p', byId)].sort(), ['q']);
  assert.equal(prereqRoute('nope', byId).size, 0);
});

test('statusCounts counts in-scope nodes and off-goal apart', () => {
  assert.deepEqual(statusCounts(sheet, st), { untested: 1, gap: 2, shaky: 1, solid: 1, total: 5, off: 1 });
});

test('isFirstRun: no nodes, or nothing measured yet', () => {
  assert.equal(isFirstRun([], st), true);
  assert.equal(isFirstRun([{ id: 'a' }, { id: 'b', status: 'untested' }], st), true);
  assert.equal(isFirstRun(sheet, st), false);
  assert.equal(isFirstRun([{ id: 'a' }, { id: 'b', in_scope: false }], st), false, 'an approved plan is not a first run');
});

test('gridMove: left/right wrap in a row, up/down keep the column (clamped), unknown key null', () => {
  const rows = [{ nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }, { nodes: [{ id: 'd' }] }];
  assert.equal(gridMove(rows, 'a', 'ArrowRight'), 'b');
  assert.equal(gridMove(rows, 'c', 'ArrowRight'), 'a');
  assert.equal(gridMove(rows, 'a', 'ArrowLeft'), 'c');
  assert.equal(gridMove(rows, 'c', 'ArrowDown'), 'd');
  assert.equal(gridMove(rows, 'd', 'ArrowUp'), 'a');
  assert.equal(gridMove(rows, 'a', 'ArrowUp'), null);
  assert.equal(gridMove(rows, 'd', 'ArrowDown'), null);
  assert.equal(gridMove(rows, 'a', 'Home'), null);
  assert.equal(gridMove(rows, 'zz', 'ArrowRight'), null);
});

import { evidenceParts } from '../public/map-logic.js';

test('evidenceParts lifts the learner\'s quoted words and drops a dated prefix', () => {
  assert.deepEqual(
    evidenceParts('Placement 2026-10-24: picked /24 over /26 for 10.0.5.77.'),
    { quote: null, note: 'picked /24 over /26 for 10.0.5.77.' },
  );
  assert.deepEqual(
    evidenceParts('Predicted no frames, saying "without IP address the package don\'t know where to go" (believes X).'),
    { quote: 'without IP address the package don\'t know where to go', note: 'Predicted no frames, saying … (believes X).' },
  );
  assert.deepEqual(evidenceParts('said "ok"'), { quote: null, note: 'said "ok"' }, 'short quoted bits stay in the note');
  assert.deepEqual(evidenceParts(''), { quote: null, note: '' });
});

test('topoSort: prereqs first, then layer order, then file order; cycles do not hang', async () => {
  const { topoSort } = await import('../public/map-logic.js');
  const layers = [{ id: 'a' }, { id: 'b' }];
  const ns = [
    { id: 'b1', layer: 'b' },
    { id: 'a2', layer: 'a', prereqs: ['a3'] },
    { id: 'a3', layer: 'a' },
    { id: 'x', layer: 'zz' },
    { id: 'a1', layer: 'a', prereqs: ['missing'] },
  ];
  assert.deepEqual(topoSort(ns, layers).map((n) => n.id), ['a3', 'a2', 'a1', 'b1', 'x']);
  const cyc = [{ id: 'p', layer: 'a', prereqs: ['q'] }, { id: 'q', layer: 'a', prereqs: ['p'] }];
  assert.deepEqual(topoSort(cyc, layers).map((n) => n.id), ['p', 'q']);
});
