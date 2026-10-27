// Self-check for lib/course-session.mjs: which tutor-proposed fields the server accepts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewTurn, checkPlan, applyPlan } from '../lib/course-session.mjs';

const map = {
  nodes: [
    { id: 'a', title: 'A', layer: 'L1', prereqs: [], truth: 'a is true', status: 'untested', evidence: [] },
    { id: 'b', title: 'B', layer: 'L1', prereqs: ['a'], truth: 'b is true', status: 'gap', evidence: ['x'] },
    { id: 'c', title: 'C', layer: 'L1', prereqs: ['b'], truth: 'c is true', status: 'shaky', evidence: [] },
    { id: 'd', title: 'D', layer: 'L1', prereqs: [], truth: 'd is true', status: 'solid', evidence: ['y'] },
  ],
};

function turn(overrides = {}) {
  return {
    say: '',
    question: null,
    sim: null,
    lab: null,
    node_updates: [],
    propositions: [],
    lesson_done: false,
    goal: null,
    assessment: null,
    plan: null,
    approved: false,
    read_sections: [],
    ...overrides,
  };
}

function meta(overrides = {}) {
  return { goal: null, assessment: null, pending_plan: null, plan_presented: false, ...overrides };
}

const GOAL = { text: 'explain learning switches', background: null };
const ASSESSMENT = { strands: [{ strand: 'switching', assessment: 'floor: frames; ceiling: none' }], summary: 'start at b' };
const ANSWER = { type: 'answer' };
const PLAN = (inScope) => ({ approach: 'a few sentences', in_scope: inScope });

function assessedMeta() {
  return meta({ goal: GOAL, assessment: ASSESSMENT });
}

test('assessment with an open question is refused', () => {
  const r = reviewTurn({
    meta: meta({ goal: GOAL }),
    turn: turn({ assessment: ASSESSMENT, question: { kind: 'free', prompt: 'p', options: [], wants_confidence: false } }),
    map,
  });
  assert.equal(r.turn.assessment, null);
  assert.equal(r.meta.assessment, null);
  assert.ok(r.notes.some((n) => n.startsWith('assessment refused')));
});

test('assessment before any goal is refused; goal then assessment in one turn are both accepted', () => {
  const refused = reviewTurn({ meta: meta(), turn: turn({ assessment: ASSESSMENT }), map });
  assert.equal(refused.turn.assessment, null);
  assert.equal(refused.meta.assessment, null);

  const both = reviewTurn({ meta: meta(), turn: turn({ goal: GOAL, assessment: ASSESSMENT }), map });
  assert.deepEqual(both.turn.goal, GOAL);
  assert.deepEqual(both.meta.goal, GOAL);
  assert.deepEqual(both.meta.assessment, ASSESSMENT);
});

test('a second assessment is refused and the first is kept', () => {
  const first = { strands: [{ strand: 'one', assessment: 'first' }], summary: null };
  const second = { strands: [{ strand: 'two', assessment: 'second' }], summary: null };
  const r = reviewTurn({ meta: meta({ goal: GOAL, assessment: first }), turn: turn({ assessment: second }), map });
  assert.equal(r.turn.assessment, null);
  assert.deepEqual(r.meta.assessment, first);
  assert.ok(r.notes.some((n) => n.startsWith('assessment refused')));
});

test('plan before assessment is refused', () => {
  const r = reviewTurn({ meta: meta({ goal: GOAL }), turn: turn({ plan: PLAN(['a']) }), map });
  assert.equal(r.turn.plan, null);
  assert.equal(r.meta.pending_plan, null);
  assert.equal(r.meta.plan_presented, false);
  assert.ok(r.notes.some((n) => n.startsWith('plan refused')));
});

test('plan with missing prereqs is refused, note names c and b', () => {
  const r = reviewTurn({ meta: assessedMeta(), turn: turn({ plan: PLAN(['c']) }), map });
  assert.equal(r.turn.plan, null);
  assert.equal(r.meta.plan_presented, false);
  const note = r.notes.find((n) => n.startsWith('plan refused'));
  assert.ok(note && note.includes('c') && note.includes('b'));
});

test('plan with an unknown id is refused, note names zz', () => {
  const r = reviewTurn({ meta: assessedMeta(), turn: turn({ plan: PLAN(['zz']) }), map });
  assert.equal(r.turn.plan, null);
  assert.ok(r.notes.some((n) => n.startsWith('plan refused') && n.includes('zz')));
});

test('empty plan is refused', () => {
  const r = reviewTurn({ meta: assessedMeta(), turn: turn({ plan: PLAN([]) }), map });
  assert.equal(r.turn.plan, null);
  assert.equal(r.meta.pending_plan, null);
});

test('valid plan is accepted and sets plan_presented', () => {
  const r = reviewTurn({ meta: assessedMeta(), turn: turn({ plan: PLAN(['a', 'b', 'c']) }), map });
  assert.deepEqual(r.meta.pending_plan, PLAN(['a', 'b', 'c']));
  assert.equal(r.meta.plan_presented, true);
});

test('plan and approved in one turn: plan accepted, approval refused, lesson_done false', () => {
  const r = reviewTurn({
    meta: assessedMeta(),
    turn: turn({ plan: PLAN(['a', 'b']), approved: true, lesson_done: true }),
    map,
  });
  assert.deepEqual(r.meta.pending_plan, PLAN(['a', 'b']));
  assert.equal(r.turn.approved, false);
  assert.equal(r.turn.lesson_done, false);
  assert.ok(r.notes.includes('lesson_done refused: the session ends at approval'));
});

test('after an accepted plan, the next turn approved: true is accepted and lesson_done true', () => {
  const planned = reviewTurn({ meta: assessedMeta(), turn: turn({ plan: PLAN(['a', 'b']) }), map });
  const r = reviewTurn({ meta: planned.meta, turn: turn({ approved: true, lesson_done: true }), map, event: ANSWER });
  assert.equal(r.turn.approved, true);
  assert.equal(r.turn.lesson_done, true);
  assert.equal(r.meta.plan_presented, false);
});

test('approval after a turn with no plan is refused', () => {
  const planned = reviewTurn({ meta: assessedMeta(), turn: turn({ plan: PLAN(['a', 'b']) }), map });
  const quiet = reviewTurn({ meta: planned.meta, turn: turn({ say: 'ok' }), map });
  assert.equal(quiet.meta.plan_presented, false);
  const r = reviewTurn({ meta: quiet.meta, turn: turn({ approved: true, lesson_done: true }), map });
  assert.equal(r.turn.approved, false);
  assert.equal(r.turn.lesson_done, false);
});

test('propositions are always cleared', () => {
  const r = reviewTurn({
    meta: meta(),
    turn: turn({ propositions: [{ claim: 'c', because: ['a'], node: 'b' }] }),
    map,
  });
  assert.deepEqual(r.turn.propositions, []);
});

test('applyPlan marks out-of-scope nodes, leaves other fields and the input untouched', () => {
  const before = structuredClone(map);
  const out = applyPlan(map, ['a', 'b']);
  assert.deepEqual(map, before);
  for (const node of out.nodes) {
    if (node.id === 'c' || node.id === 'd') assert.equal(node.in_scope, false);
    else assert.equal('in_scope' in node, false);
    const { in_scope, ...rest } = node;
    const orig = before.nodes.find((n) => n.id === node.id);
    assert.deepEqual(rest, orig);
  }
  const full = applyPlan(out, ['a', 'b', 'c', 'd']);
  for (const node of full.nodes) assert.equal('in_scope' in node, false);
});

test('approval with meta lacking plan_presented is refused with booleans', () => {
  const r = reviewTurn({
    meta: { goal: GOAL, assessment: ASSESSMENT, pending_plan: null },
    turn: turn({ approved: true, lesson_done: true }),
    map,
  });
  assert.equal(r.turn.approved, false);
  assert.equal(r.turn.lesson_done, false);
  assert.ok(r.notes.some((n) => n.startsWith('approved refused')));
});

test('malformed in_scope is refused, not thrown', () => {
  for (const bad of [{ approach: 'x', in_scope: 'a' }, { approach: 'x', in_scope: [1] }]) {
    const r = reviewTurn({ meta: assessedMeta(), turn: turn({ plan: bad }), map });
    assert.equal(r.turn.plan, null);
    assert.equal(r.meta.plan_presented, false);
    assert.ok(r.notes.some((n) => n.startsWith('plan refused')));
  }
});

test('checkPlan returns null for a valid plan', () => {
  assert.equal(checkPlan(map, PLAN(['a', 'b'])), null);
});

test('a turn with no course fields is normalised: goal kept, no spurious notes', () => {
  const t = { say: 'hi', node_updates: 'x' };
  const r = reviewTurn({ meta: assessedMeta(), turn: t, map });
  assert.deepEqual(r.meta.goal, GOAL);
  assert.deepEqual(r.notes, []);
  assert.equal(r.turn.goal, null);
  assert.equal(r.turn.approved, false);
  assert.deepEqual(r.turn.node_updates, []);
});

test('a non-object or empty goal is refused', () => {
  for (const bad of ['learn it', { text: '' }, { text: 'x', background: 5 }, ['x']]) {
    const r = reviewTurn({ meta: meta(), turn: turn({ goal: bad }), map });
    assert.equal(r.turn.goal, null);
    assert.equal(r.meta.goal, null);
    assert.ok(r.notes.some((n) => n.startsWith('goal refused')));
  }
  const ok = reviewTurn({ meta: meta(), turn: turn({ goal: { text: 'x' } }), map });
  assert.deepEqual(ok.meta.goal, { text: 'x', background: null });
});

function presented(over = {}) {
  return reviewTurn({ meta: assessedMeta(), turn: turn({ plan: PLAN(['a', 'b']) }), map, ...over }).meta;
}

test('approval with no goal on record is refused', () => {
  const m = { ...presented(), goal: null };
  const r = reviewTurn({ meta: m, turn: turn({ approved: true, lesson_done: true }), map, event: ANSWER });
  assert.equal(r.turn.approved, false);
  assert.equal(r.turn.lesson_done, false);
});

test('a refused revised plan with approved: true does not approve the previous plan', () => {
  const r = reviewTurn({ meta: presented(), turn: turn({ plan: PLAN(['zz']), approved: true }), map, event: ANSWER });
  assert.equal(r.turn.approved, false);
  assert.deepEqual(r.meta.pending_plan, PLAN(['a', 'b']));
});

test('a goal change on an approving turn is refused, approval still accepted', () => {
  const r = reviewTurn({
    meta: presented(), turn: turn({ goal: { text: 'other', background: null }, approved: true, lesson_done: true }), map, event: ANSWER,
  });
  assert.ok(r.notes.includes('goal refused: cannot change the goal while approving'));
  assert.deepEqual(r.meta.goal, GOAL);
  assert.equal(r.turn.approved, true);
});

test('sim and lab are always nulled in course mode', () => {
  const r = reviewTurn({ meta: meta(), turn: turn({ sim: { a: 1 }, lab: { b: 1 } }), map });
  assert.equal(r.turn.sim, null);
  assert.equal(r.turn.lab, null);
});

test('approval only answers a learner reply (ask/answer)', () => {
  for (const event of [{ type: 'lost' }, null]) {
    const r = reviewTurn({ meta: presented(), turn: turn({ approved: true, lesson_done: true }), map, event });
    assert.equal(r.turn.approved, false);
    assert.equal(r.turn.lesson_done, false);
  }
  const ask = reviewTurn({ meta: presented(), turn: turn({ approved: true }), map, event: { type: 'ask' } });
  assert.equal(ask.turn.approved, true);
});

// Slice f1: sources.
const IDS = new Set(['s1-1', 's1-2', 's1-3']);
const SPLAN = (sources) => ({ approach: 'x', in_scope: ['a', 'b'], sources });

test('read_sections: unknown id is refused and named; six ids refused; known ids kept in pending_reads', () => {
  const bad = reviewTurn({ meta: meta(), turn: turn({ read_sections: ['s1-1', 'zz-9'] }), map, sectionIds: IDS });
  assert.deepEqual(bad.meta.pending_reads, []);
  assert.deepEqual(bad.turn.read_sections, []);
  assert.match(bad.notes.join('\n'), /read_sections refused.*zz-9/);
  const six = reviewTurn({ meta: meta(), turn: turn({ read_sections: ['s1-1', 's1-1', 's1-1', 's1-1', 's1-1', 's1-1'] }), map, sectionIds: IDS });
  assert.deepEqual(six.meta.pending_reads, []);
  assert.match(six.notes.join('\n'), /read_sections refused/);
  const ok = reviewTurn({ meta: meta({ pending_reads: ['s1-3'] }), turn: turn({ read_sections: ['s1-2', 's1-1'] }), map, sectionIds: IDS });
  assert.deepEqual(ok.meta.pending_reads, ['s1-2', 's1-1']);
  assert.deepEqual(ok.notes, []);
  const none = reviewTurn({ meta: meta({ pending_reads: ['s1-3'] }), turn: turn({}), map, sectionIds: IDS });
  assert.deepEqual(none.meta.pending_reads, []);
  const absent = turn(); delete absent.read_sections;
  assert.deepEqual(reviewTurn({ meta: meta(), turn: absent, map, sectionIds: IDS }).meta.pending_reads, []);
});

test('plan.sources: node outside in_scope, duplicate node, unknown section, non-array are refused', () => {
  assert.equal(checkPlan(map, SPLAN([{ node: 'a', sections: ['s1-1'] }]), IDS), null);
  assert.equal(checkPlan(map, PLAN(['a', 'b']), IDS), null);
  assert.match(checkPlan(map, SPLAN([{ node: 'c', sections: ['s1-1'] }]), IDS), /c/);
  assert.match(checkPlan(map, SPLAN([{ node: 'a', sections: [] }, { node: 'a', sections: [] }]), IDS), /twice/);
  assert.match(checkPlan(map, SPLAN([{ node: 'a', sections: ['nope'] }]), IDS), /nope/);
  assert.ok(checkPlan(map, SPLAN('x'), IDS));
  assert.ok(checkPlan(map, SPLAN([{ node: 'a' }]), IDS));
  const r = reviewTurn({ meta: assessedMeta(), turn: turn({ plan: SPLAN([{ node: 'a', sections: ['nope'] }]) }), map, sectionIds: IDS });
  assert.equal(r.turn.plan, null);
  assert.match(r.notes.join('\n'), /nope/);
});

test('applyPlan tags listed in-scope nodes, clears unlisted in-scope tags, keeps off-scope tags, changes nothing else', () => {
  const tagged = structuredClone(map);
  tagged.nodes[0].source_sections = ['old-1'];
  tagged.nodes[1].source_sections = ['old-2'];
  tagged.nodes[2].source_sections = ['keep-3'];
  for (const n of tagged.nodes) n.sources = ['https://example.com/' + n.id];
  const before = structuredClone(tagged);
  const out = applyPlan(tagged, ['a', 'b'], [{ node: 'a', sections: ['s1-1', 's1-2'] }]);
  assert.deepEqual(tagged, before);
  const by = Object.fromEntries(out.nodes.map((n) => [n.id, n]));
  assert.deepEqual(by.a.source_sections, ['s1-1', 's1-2']);
  assert.equal('source_sections' in by.b, false);
  assert.deepEqual(by.c.source_sections, ['keep-3']);
  for (const n of out.nodes) assert.deepEqual(n.sources, ['https://example.com/' + n.id]);
  for (const n of out.nodes) {
    const { in_scope, source_sections, ...rest } = n;
    const { in_scope: i2, source_sections: s2, ...orig } = before.nodes.find((x) => x.id === n.id);
    assert.deepEqual(rest, orig);
  }
});
