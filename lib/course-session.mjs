// Acceptance rules for a course-session turn: which tutor-proposed fields the server keeps.
// Pure: no I/O, never mutates its inputs.

// The problem with a proposed plan, or null when it is usable.
export function checkPlan(map, plan) {
  const scope = plan.in_scope;
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

export function reviewTurn({ meta, turn, map }) {
  const out = structuredClone(turn);
  const m = structuredClone(meta);
  const notes = [];
  const refuse = (field, why) => notes.push(`${field} refused: ${why}`);

  // 1. Propositions are never kept.
  out.propositions = [];

  // 2. A concrete goal is accepted as it stands.
  if (out.goal !== null) m.goal = out.goal;

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
  const approvedOk = out.approved && meta.plan_presented && !acceptedPlan;
  if (out.approved && !approvedOk) refuse('approved', "approval must follow the learner's reply to a presented plan");
  out.approved = approvedOk;

  // 6. Track whether this turn presented a plan, for the next turn's rule 5.
  m.plan_presented = acceptedPlan;

  // 7. The session ends only at accepted approval.
  const wantsDone = out.lesson_done;
  out.lesson_done = approvedOk;
  if (wantsDone && !approvedOk) refuse('lesson_done', 'the session ends at approval');

  return { turn: out, notes, meta: m };
}
