// Acceptance rules for a course-session turn: which tutor-proposed fields the server keeps.
// Pure: no I/O, never mutates its inputs. Section ids known to the course's sources are passed in.
import { READ_MAX } from './sources.mjs';

// The problem with a proposed plan, or null when it is usable.
export function checkPlan(map, plan, sectionIds = new Set()) {
  if (!plan || typeof plan !== 'object') return 'plan must be an object';
  const scope = plan.in_scope;
  if (!Array.isArray(scope) || scope.some((id) => typeof id !== 'string')) {
    return 'in_scope must be an array of node ids';
  }
  if (scope.length === 0) return 'plan has no nodes in scope';
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const unknown = scope.filter((id) => !byId.has(id));
  if (unknown.length) return `unknown node: ${unknown.join(', ')}`;
  const dupes = scope.filter((id, i) => scope.indexOf(id) !== i);
  if (dupes.length) return `node listed twice: ${dupes.join(', ')}`;
  const inScope = new Set(scope);
  for (const id of scope) {
    for (const p of byId.get(id).prereqs ?? []) {
      if (!inScope.has(p)) return `${id} needs ${p}, which is not in scope`;
    }
  }
  const tags = plan.sources ?? [];
  if (!Array.isArray(tags)) return 'sources must be an array';
  const tagged = new Set();
  for (const t of tags) {
    if (!t || typeof t.node !== 'string' || !Array.isArray(t.sections) || t.sections.some((x) => typeof x !== 'string')) {
      return 'each sources entry needs a node and a list of section ids';
    }
    if (!inScope.has(t.node)) return `sources name ${t.node}, which is not in scope`;
    if (tagged.has(t.node)) return `sources list node twice: ${t.node}`;
    tagged.add(t.node);
    const unknownIds = t.sections.filter((x) => !sectionIds.has(x));
    if (unknownIds.length) return `unknown section: ${unknownIds.join(', ')}`;
  }
  return null;
}

// A copy of the map where out-of-scope nodes carry in_scope: false and in-scope nodes carry no in_scope key.
// In-scope nodes get source_sections = their listed section ids, or lose the key; out-of-scope nodes keep theirs.
export function applyPlan(map, inScope, sources = []) {
  const scope = new Set(inScope);
  const tags = new Map(sources.map((t) => [t.node, t.sections]));
  const out = structuredClone(map);
  for (const node of out.nodes) {
    if (scope.has(node.id)) {
      delete node.in_scope;
      if (tags.has(node.id)) node.source_sections = [...tags.get(node.id)];
      else delete node.source_sections;
    } else node.in_scope = false;
  }
  return out;
}

// event: the learner event this turn answers ({type}), or null on the first turn.
export function reviewTurn({ meta, turn, map, event = null, sectionIds = new Set() }) {
  const out = structuredClone(turn);
  const m = structuredClone(meta);
  const notes = [];
  const refuse = (field, why) => notes.push(`${field} refused: ${why}`);

  // 0. The tutor's output is untrusted: absent fields default, flags are strictly boolean.
  for (const k of ['goal', 'assessment', 'plan', 'question', 'sim', 'lab']) out[k] ??= null;
  out.approved = out.approved === true;
  out.lesson_done = out.lesson_done === true;
  if (!Array.isArray(out.node_updates)) out.node_updates = [];
  const carriedPlan = out.plan !== null;

  // Section ids the tutor wants read next turn: at most READ_MAX, all known; the kept list replaces any older one.
  const wanted = out.read_sections ?? [];
  const unknownReads = Array.isArray(wanted) ? wanted.filter((x) => typeof x !== 'string' || !sectionIds.has(x)) : [];
  let readWhy = null;
  if (!Array.isArray(wanted)) readWhy = 'must be an array of section ids';
  else if (wanted.length > READ_MAX) readWhy = `at most ${READ_MAX} ids`;
  else if (unknownReads.length) readWhy = `unknown section: ${unknownReads.join(', ')}`;
  if (readWhy) refuse('read_sections', readWhy);
  out.read_sections = readWhy ? [] : [...wanted];
  m.pending_reads = out.read_sections;

  // 1. Propositions are never kept; course mode carries no instruments.
  out.propositions = [];
  out.sim = null;
  out.lab = null;

  // Approval eligibility (the goal on record is checked after rule 2): a reply to a presented plan, carrying no plan.
  const replied = event?.type === 'ask' || event?.type === 'answer';
  const eligible = out.approved && meta.plan_presented === true && !carriedPlan && replied;

  // 2. A concrete goal is accepted when well formed, and never in the turn that approves.
  if (out.goal !== null) {
    const g = out.goal;
    let why = null;
    if (!g || typeof g !== 'object' || Array.isArray(g) || typeof g.text !== 'string' || g.text.trim() === '') {
      why = 'goal needs a non-empty text';
    } else if (g.background !== undefined && g.background !== null && typeof g.background !== 'string') {
      why = 'background must be a string or null';
    } else if (eligible) {
      why = 'cannot change the goal while approving';
    }
    if (why) {
      refuse('goal', why);
      out.goal = null;
    } else {
      out.goal = { text: g.text, background: g.background ?? null };
      m.goal = out.goal;
    }
  }

  // 3. The probe: one assessment, after the goal, with no question open.
  if (out.assessment !== null) {
    let why = null;
    if (out.question !== null) why = 'a question is still open';
    else if (m.assessment) why = 'the probe concludes once';
    else if (!m.goal) why = 'set the goal first';
    if (why) {
      refuse('assessment', why);
      out.assessment = null;
    } else {
      m.assessment = out.assessment;
    }
  }

  // 4. A plan: after the assessment, with no question open, and a sound plan.
  let acceptedPlan = false;
  if (out.plan !== null) {
    let why = null;
    if (!m.assessment) why = 'assess before planning';
    else if (out.question !== null) why = 'presenting a plan ends the turn';
    else why = checkPlan(map, out.plan, sectionIds);
    if (why) {
      refuse('plan', why);
      out.plan = null;
    } else {
      acceptedPlan = true;
      m.pending_plan = out.plan;
    }
  }

  // 5. Approval: only answers the learner's reply to a plan presented on the previous turn.
  const approvedOk = eligible && !!m.goal;
  if (out.approved && !approvedOk) refuse('approved', "approval must be the learner's reply to a plan presented on the previous turn, with a goal on record and no plan in this turn");
  out.approved = approvedOk;

  // 6. Track whether this turn presented a plan, for the next turn's rule 5.
  m.plan_presented = acceptedPlan;

  // 7. The session ends only at accepted approval.
  const wantsDone = out.lesson_done;
  out.lesson_done = approvedOk;
  if (wantsDone && !approvedOk) refuse('lesson_done', 'the session ends at approval');

  return { turn: out, notes, meta: m };
}
