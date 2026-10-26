// Acceptance rules for a course-session turn: which tutor-proposed fields the server keeps.
// Pure: no I/O, never mutates its inputs.

// The problem with a proposed plan, or null when it is usable.
export function checkPlan(map, plan) {
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
  return null;
}

// A copy of the map where out-of-scope nodes carry in_scope: false and in-scope nodes carry no in_scope key.
export function applyPlan(map, inScope) {
  const scope = new Set(inScope);
  const out = structuredClone(map);
  for (const node of out.nodes) {
    if (scope.has(node.id)) delete node.in_scope;
    else node.in_scope = false;
  }
  return out;
}

// event: the learner event this turn answers ({type}), or null on the first turn.
export function reviewTurn({ meta, turn, map, event = null }) {
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
    else why = checkPlan(map, out.plan);
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
