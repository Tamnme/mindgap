# mindgap slice e Implementation Plan: probe → plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A course-level session that makes the learner's goal concrete, brackets each strand, records one assessment, proposes a plan (the seed map trimmed to the goal), and applies it only after the learner agrees in chat. It replaces the map page's **Placement check** with **New goal**.

**Architecture:** A new lesson mode `course` with no `node_id`, its own prompt (`prompts/course.md`) and its own output schema (`prompts/course-schema.json`: the turn fields plus `goal`, `assessment`, `plan`, `approved`). The tutor only *proposes*: a pure module (`lib/course-session.mjs`) decides which of those fields the server accepts, given the session's meta and the previous tutor turn. Refused fields are stripped from the turn and explained to the tutor in a `SERVER:` note on its next message. An accepted approval sets `in_scope` on map nodes and writes `state/goal.json`, and changes nothing else.

**Tech Stack:** Node ≥ 22, zero npm dependencies, `node --test`, plain ES modules in the browser.

**Spec:** `docs/superpowers/specs/2026-10-26-mindgap-design.md`, section **e** and its designer's calls. Its source is learnharness @ `3dc88472` (`docs/probe-teach-split.md`, `prober/10-probe-doctrine.md`, `teacher/10-planning.md`, `contracts/probe.ts`), digested in `.planning/2026-10-26-mindgap-generalization/findings.md`.

## Global Constraints

- Everything in the a–d plan's Global Constraints still holds (no npm deps, `127.0.0.1` only, the tutor never gets tools, cwd = fresh temp dir per call).
- **Trim never deletes.** Approval writes only `in_scope` on nodes. `status`, `evidence`, `prereqs` and every other field are byte-for-byte unchanged by it. Status changes come only through `node_updates`, as in every other mode.
- **Approval never grants lab privileges.** The course schema has no lab-request field, and nothing in this slice reads or writes `lab-approval.json`.
- The per-node **Quick check** (mode `probe`) is unchanged.
- Never run anything against the real `learner/` data dir. Manual and browser checks use a copy (`MINDGAP_DATA_DIR=<tmp copy>`). Never kill the user's server on port 4810; run test servers on another port.
- Keep the learnharness credit (`<!-- Adapted from amosblomqvist/learnharness (AGPL-3.0). -->`) on the new prompt.

## Planner's calls (check these while reading)

1. **One session, one prompt, two phases.** learnharness splits prober and teacher into two agents that share full history. Here agy has no system-prompt flag (the prompt goes in once, in the first message), so swapping prompts mid-session is not portable. `prompts/course.md` carries both phases and the history stays in one tutor session. This keeps learnharness's reason for sharing history ("the history holds subtleties an assessment summary would lose").
2. **Server notes instead of tool refusals.** learnharness's `probe_done` is a tool that can answer "refused". A JSON turn cannot be answered mid-turn, so the server strips a refused field and prefixes the next tutor message with `SERVER:` lines saying what was refused and why.
3. **Goal and background are written on approval, not before.** An abandoned session changes nothing on disk except its own transcript. `state/goal.json` = `{goal, background, approved_at}`.
4. **The networking learner's background moves out of the shipped prompt.** `courses/networking/prompt.md` still has the paragraph "**The learner** (they/them) is a cloud engineer…". That is learner data in a committed file, which spec b says belongs in course state. Task 5 removes it, every mode's context gains `learner: {goal, background}` from `goal.json`, and Task 7 seeds the real learner's `goal.json` with that text (with the user's OK, since it touches their data).
5. **`/api/lesson` takes `mode: "course"`** with no `node_id`, rather than a new endpoint. Lesson ids are `course-<timestamp>`.
6. **Off-goal nodes are hidden on the map, with a "Show off-goal topics (N)" toggle**, so a narrowed goal never makes the learner's earlier work invisible. Next lesson / Practice shaky ignore off-goal nodes.
7. **Course mode records no propositions** (nothing is taught). The server forces `propositions: []`, as learnharness's prober has no proposition tool.

## Review Focus

1. **Approval in the same turn as the plan.** The tutor emits `plan` and `approved: true` together. Expect: plan accepted, approval refused with a SERVER note, map untouched. → test in Task 2.
2. **Bad plan.** `in_scope` names an unknown node, is empty, or is not prereq-closed (a node in scope whose prereq is not). Expect: refused, the next tutor message starts with a `SERVER:` line naming the problem. → tests in Tasks 2 and 3.
3. **Approval preserves evidence.** After an accepted approval, every node's fields other than `in_scope` deep-equal what they were before. → test in Task 3.
4. **Abandoned session.** A course session that never reaches approval leaves `map.json` `in_scope` flags and `goal.json` unchanged. → test in Task 3.
5. **Assessment while a question is open, or twice.** Refused, and the first assessment stays the recorded one. → test in Task 2.
6. **Lab approval untouched.** A full session through approval leaves `lab-approval.json` absent (or unchanged). → test in Task 3.

---

### Task 1: Course schema, and the schema picked per mode

**Files:**
- Create: `prompts/course-schema.json`
- Modify: `server.mjs` (`SCHEMA_PATH` → a per-mode lookup), `CONTRACTS.md`
- Test: `test/server.test.mjs`

**Interfaces:**
- Produces `prompts/course-schema.json`: the exact `turn-schema.json` object (same seven fields, same definitions) plus four required properties:
  - `goal`: `{text: string, background: string|null} | null`. The goal as it now stands, once it is concrete; `null` while it is not.
  - `assessment`: `{strands: [{strand: string, assessment: string}] (minItems 1), summary: string|null} | null`. Descriptions copied from learnharness: `strand` = "a name the plan can hang a node on"; `assessment` = "floor, ceiling, misconceptions found, and what the lesson should build from, written from the evidence"; `summary` = "their goal and where the teaching should enter".
  - `plan`: `{approach: string, in_scope: string[]} | null`. `approach` = a few sentences: what, in what order, why, what is skipped because they hold it. `in_scope` = node ids on the path to the goal.
  - `approved`: `boolean`.
  - `additionalProperties: false` everywhere, as in the turn schema.
- Produces in `server.mjs`: `const SCHEMAS = { course: 'course-schema.json' }` and `schemaFor(mode)` → `prompts/<SCHEMAS[mode] ?? 'turn-schema.json'>`. `callTutor` uses `schemaFor(meta.mode)`. `MODES` gains `course: 'course.md'`. Create an empty placeholder `prompts/course.md` (`<!-- Adapted from amosblomqvist/learnharness (AGPL-3.0). -->` plus one line `Mode: course.`); Task 5 writes it.

- [ ] **Step 1:** Add a test to `test/server.test.mjs`: parse `prompts/course-schema.json`; assert its `required` is the turn schema's `required` plus `goal`, `assessment`, `plan`, `approved`, and that each of the turn schema's seven properties deep-equals the course schema's.
- [ ] **Step 2:** Run `node --test test/server.test.mjs` — Expected: FAIL (file missing).
- [ ] **Step 3:** Write the schema and the `schemaFor` change. In `CONTRACTS.md` add `prompts/course-schema.json` and `prompts/course.md` to Files, and a "Course session" heading stub that Task 3 fills in.
- [ ] **Step 4:** Run `node --test --test-timeout=60000 test/` — Expected: all pass.
- [ ] **Step 5:** Commit: `git commit -m "Add course-session schema, pick schema per mode"`.

### Task 2: The acceptance rules, as a pure module

**Files:**
- Create: `lib/course-session.mjs`
- Test: `test/course-session.test.mjs`

**Interfaces:**
- Produces `reviewTurn({ meta, turn, map }) -> { turn, notes, meta }`. Pure: no I/O, does not mutate its inputs. `meta` is the lesson meta (fields this module owns: `goal`, `assessment`, `pending_plan`, `plan_presented`). Returns the turn with refused fields set to `null` / `false`, the refusal notes (strings, each starting with the field name, e.g. `"assessment refused: a question is still open"`), and the new meta.
- Produces `checkPlan(map, plan) -> string | null`: the problem with the plan, or `null`. Problems: `in_scope` empty; an id not in `map.nodes`; duplicates; a node in scope whose prereq is not in scope (name both ids).
- Produces `applyPlan(map, inScope: string[]) -> map`: returns a new map where each node outside `inScope` has `in_scope: false` and each node inside has no `in_scope` key. No other field changes.

Rules for `reviewTurn`, in this order:
1. `propositions` → always `[]` (no note).
2. `goal` non-null → accepted: `meta.goal = turn.goal`.
3. `assessment` non-null → refused if `turn.question !== null` ("a question is still open"), if `meta.assessment` is set ("the probe concludes once"), or if no goal is set in `meta` or this turn ("set the goal first"). Else `meta.assessment = turn.assessment`.
4. `plan` non-null → refused if no `meta.assessment` ("assess before planning"), if `turn.question !== null` ("presenting a plan ends the turn"), or if `checkPlan` returns a problem (the note includes it). Else `meta.pending_plan = turn.plan`.
5. `approved: true` → refused unless `meta.plan_presented` was true **on entry** (the previous tutor turn presented an accepted plan, so this turn answers the learner's reply to it) and this turn has no accepted plan of its own ("approval must follow the learner's reply to a presented plan").
6. `meta.plan_presented` = whether rule 4 accepted a plan this turn.
7. `lesson_done` → `true` only if rule 5 accepted; else `false` (no note when the tutor sent `false`; note "lesson_done refused: the session ends at approval" when it sent `true`).

- [ ] **Step 1: Write the failing tests** in `test/course-session.test.mjs`, with a 4-node map (`a`; `b` prereqs `[a]`; `c` prereqs `[b]`; `d` no prereqs; each with `status` and `evidence` set) and a `turn(overrides)` helper that fills every schema field with its empty value:
  - assessment with `question` set → refused, note starts `assessment refused`, `meta.assessment` unset.
  - assessment before any goal → refused. Goal then assessment in the same turn → both accepted.
  - second assessment → refused; `meta.assessment` is still the first.
  - plan before assessment → refused. Plan `['c']` (missing prereqs) → refused, note names `c` and `b`. Plan `['zz']` → refused naming `zz`. Plan `[]` → refused. Plan `['a','b','c']` → accepted, `meta.plan_presented === true`.
  - plan and `approved: true` in one turn → plan accepted, approval refused, `lesson_done === false`.
  - after an accepted plan, next turn `approved: true` → accepted, `lesson_done === true`.
  - after an accepted plan, a turn with no plan, then a turn with `approved: true` → refused (the plan was not presented on the previous turn).
  - `propositions` non-empty → `[]`.
  - `applyPlan(map, ['a','b'])`: `c`, `d` have `in_scope: false`; for every node, every field except `in_scope` deep-equals the input; input map not mutated. Applying `['a','b','c','d']` to that result removes every `in_scope` key.
- [ ] **Step 2:** Run `node --test test/course-session.test.mjs` — Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `lib/course-session.mjs`.
- [ ] **Step 4:** Run `node --test test/course-session.test.mjs` — Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "Add course-session acceptance rules"`.

### Task 3: Server: start and run a course session

**Files:**
- Modify: `server.mjs`, `CONTRACTS.md`
- Test: `test/server.test.mjs`

**Interfaces:**
- Consumes: `reviewTurn`, `applyPlan` (Task 2); `schemaFor` (Task 1).
- `POST /api/lesson` with `{course, mode: "course"}` (no `node_id`) → `{lesson_id, turn}`. `lesson_id = course-<Date.now()>`. Meta: `{course, tutor, tutor_session_id, node_id: null, mode: "course", started, labs_sent: 0}`. `node_id` is ignored for this mode. Any other mode still requires `node_id`.
- First message: `CONTEXT:\n` + JSON of `courseContext(c, map)` = `{mode: "course", course: {slug, title, layers}, learner: {goal, background} | null (from goal.json), nodes: [{id, title, layer, prereqs, truth, status, evidence, in_scope}] (in_scope: false only when the node has it), propositions: <last 200 lines of propositions.jsonl>}`.
- In `advance()`, when `meta.mode === 'course'`: run `reviewTurn` **before** `applyNodeUpdates` and before persisting, so the transcript and the response hold the reviewed turn. Store `notes` in `meta.server_notes` (append). If approval was accepted: `updateMap(c, m => Object.assign(m, applyPlan(m, meta.pending_plan.in_scope)))` and write `state/goal.json` = `{goal: meta.goal.text, background: meta.goal.background, approved_at}` atomically.
- In `turn()`: when `meta.server_notes` is non-empty, the message becomes `SERVER:\n- <note>\n- <note>\n` + the `EVENT:` message, and `server_notes` is cleared when the turn is persisted.
- Add `learner: {goal, background} | null` from `goal.json` to `baseContext` (all node-level modes), and mark off-goal nodes in `other_nodes` with `in_scope: false`.

- [ ] **Step 1:** Extend `FAKE_CLAUDE` in `test/server.test.mjs`: if `<FAKE_DIR>/turn.json` exists, its content is the `structured_output` (otherwise behave as today). Write a `courseTurn(overrides)` helper that fills every course-schema field.
- [ ] **Step 2: Write the failing tests:**
  - `POST /api/lesson {course, mode:'course'}` → 200, `lesson_id` starts `course-`; the logged claude argv's `--json-schema` value has a `plan` property; the first message's CONTEXT has `mode: 'course'` and every map node.
  - Full happy path over three turns (goal+assessment; plan `['frames-mac','switch-mac-table']`; then `approved: true`): afterwards `GET /map` shows `vlan-basics.in_scope === false`, the other two have no `in_scope`, and every node minus `in_scope` deep-equals the map before the session (Review Focus 3); `goal.json` holds the goal; the last response has `lesson_done: true`; `lab-approval.json` does not exist (Review Focus 6).
  - Bad plan (`['switch-mac-table']` without its prereq): the response's `turn.plan` is `null`; the next claude call's message starts with `SERVER:\n- plan refused` and names `frames-mac` (Review Focus 2); the call after that has no `SERVER:` prefix.
  - Abandoned session (goal + assessment + plan, no approval): `map.json` and `goal.json` unchanged (Review Focus 4).
  - A teach lesson started after an approved session has `learner.goal` in its CONTEXT, and `vlan-basics` appears in `other_nodes` with `in_scope: false`.
  - `POST /api/lesson {course, mode:'teach'}` without `node_id` → still 400.
- [ ] **Step 3:** Run `node --test --test-timeout=60000 test/server.test.mjs` — Expected: the new tests FAIL.
- [ ] **Step 4:** Implement. Update `CONTRACTS.md`: the course session (mode, lesson id, context block, `SERVER:` notes, acceptance rules in one table, `goal.json`, the `in_scope` node field in the map section), and `learner` in the first-message description.
- [ ] **Step 5:** Run `node --test --test-timeout=60000 test/` — Expected: all pass.
- [ ] **Step 6:** Commit: `git commit -m "Run course-level probe-plan sessions"`.

### Task 4: Map and lesson pages

**Files:**
- Modify: `public/map.html`, `public/map.js`, `public/lesson.js`, `public/lesson.html`, `public/app.css` (only if a new class is needed)
- Test: `test/widgets.test.mjs` or a new `test/map-logic.test.mjs` for any pure logic you extract (follow how `public/chapter-logic.js` is tested)

**Interfaces:**
- Map page:
  - **New goal** button replaces **Placement check** (`btn-probe` → `btn-goal`), always enabled; it calls `/api/lesson` with `{course, mode: 'course'}` and opens `lesson.html` as `startLesson` does. The intro line in `map.html` becomes: "New here? Click **New goal** to say what you want to learn; mindgap measures what you know and proposes a plan."
  - Off-goal nodes (`in_scope === false`) are left out of the layout and the side list. A checkbox "Show off-goal topics (N)" (hidden when N = 0) brings them back, drawn faded. Edges to hidden nodes are dropped.
  - `nextLesson()` and the Practice shaky count skip off-goal nodes.
- Lesson page in mode `course`:
  - Banner title "New goal" instead of a node title; no status chip.
  - A tutor turn with an `assessment` renders one card after its `say`: one row per strand (`strand` bold, `assessment` text), then `summary`.
  - A turn with a `plan` renders a card: `approach` as markdown, then the in-scope nodes in prereq order with their status chips (titles from `GET /map`), and "N topics set aside" for the rest. Under it, one line: "Reply below to agree or ask for changes."
  - The learner replies with the existing **Ask** box (an `ask` event); no approve button.
  - `lesson_done` shows "Plan approved — back to map".
  - All model text through `renderMarkdown` or `textContent`, as the file's header says.

- [ ] **Step 1:** Extract any non-DOM logic you add (filtering off-goal nodes for layout/next lesson, ordering plan nodes) into a small module and write `node --test` tests for it first; run them, expect FAIL.
- [ ] **Step 2:** Implement until those tests pass.
- [ ] **Step 3:** Check rendering in a real browser without a tutor call, on a data copy (Task 6 Step 1 setup): write a `course-*.meta.json` + `.jsonl` transcript by hand into the copy (one assessment turn, one plan turn) and open `lesson.html?course=networking&id=<that id>`; then open the map with one node set `in_scope: false`. Screenshot both (`agent-browser`).
- [ ] **Step 4:** Run `node --test --test-timeout=60000 test/` — Expected: all pass.
- [ ] **Step 5:** Commit: `git commit -m "New goal button, off-goal map toggle, plan cards"`.

### Task 5: The course prompt

**Files:**
- Modify: `prompts/course.md` (replaces the placeholder), `courses/networking/prompt.md`
- Test: `test/server.test.mjs` (prompt sanity)

This is prose that steers the tutor. **Dispatch to `general-purpose` on sonnet, not `implementer`.** Base it on `prompts/prober.md` (bracketing, confidence, graded questions, voice, accuracy, formatting) and `prompts/teacher.md` "The plan" (minimal tree, roots stress-tested), adapted to the fields of `course-schema.json`. Keep it subject-neutral: no networking examples in the new text (slice f neutralises the old prompts).

Required content, in this order:
1. Credit header; the agent; mode **course**: you measure, then plan; you do not teach.
2. **Phase 1: the goal.** Ask until the goal is concrete ("I want to understand X" can mean ten things). Ask background once, as optional; a skipped background is fine. If they do not know the terrain, the goal starts with orientation. Emit `goal` once concrete, and again if it changes. `learner` in the context is their previous goal and background: confirm or replace, do not assume.
3. **Phase 2: strands and bracketing.** The prober's section 3 and 4 doctrine (enter near the top, strands inform each other, the four correct/hesitant/wrong/lost rules, a strand that never breaks is not done, no filler). Evidence goes into `node_updates` as in the prober; the probe only updates nodes it produced fresh evidence for.
4. **Phase 3: assessment.** Exactly one `assessment` with `question: null`: one entry per strand (name, floor, ceiling, misconceptions, build-from), plus `summary`. If the server refuses it, a `SERVER:` line says why.
5. **Phase 4: plan.** The minimal tree from what they hold to the goal, over the course's existing nodes (you cannot add nodes; you choose `in_scope`, which must include every prereq of every node in it). Stress-test the roots. `approach` = a few sentences; do not restate the node list in `say` (the page draws it). Presenting ends the turn: `question: null`.
6. **Phase 5: approval in chat.** The learner replies. Changes → revise and present a new `plan`. Clear agreement ("go", "looks good", "yes") → `approved: true` with a one-line `say`, nothing else; never approve in the same turn as presenting. Never approve on an ambiguous reply: ask.
7. **`SERVER:` lines** come from mindgap, not the learner: a refused field, with the reason. Fix it and continue; never mention them to the learner as their words.
8. Input/output section adapted from the prober's (the course context block, events, every field every turn, `propositions` always `[]`, `lesson_done` is set by the server).
9. Voice, Accuracy, thinking fields, Confidence, graded-question craft, Formatting: copy from `prompts/prober.md` with networking examples replaced by neutral ones.

In `courses/networking/prompt.md`, remove the paragraph starting "**The learner** (they/them) is a cloud engineer" and replace it with: "**The learner's background** is in the context block (`learner.background`) when they gave one. Lead with the `links` that match it." Keep everything else.

- [ ] **Step 1:** Add a test: `prompts/course.md` has the credit line, mentions every course-schema field name (`goal`, `assessment`, `plan`, `in_scope`, `approved`, `SERVER:`), and contains none of `switch`, `VLAN`, `MAC`, `AWS` (subject-neutral). Another: `courses/networking/prompt.md` does not contain "is a cloud engineer". Run — Expected: FAIL.
- [ ] **Step 2:** Write the prompt and the course prompt edit.
- [ ] **Step 3:** Run `node --test --test-timeout=60000 test/` — Expected: all pass.
- [ ] **Step 4:** Commit: `git commit -m "Course prompt; learner background moves to course state"`.

### Task 6: Real tutor, real UI, on a copy of the data

No code. This is the done check; the parent runs it, not an implementer.

- [ ] **Step 1:** `cp -R learner /tmp/mindgap-e-check` (via the scratchpad dir), then `MINDGAP_DATA_DIR=<copy> PORT=4811 node server.mjs` in the background. Record `md5` of `<copy>/courses/networking/state/map.json` minus `in_scope` (a `node -e` one-liner) for the later comparison.
- [ ] **Step 2:** With `agent-browser`, open `http://127.0.0.1:4811/map.html?course=networking`, click **New goal**, and play the learner through a real Claude session: give a concrete goal (e.g. "debug why a pod can't reach a service in another namespace"), answer the probe questions with confidence and reasoning, read the assessment card, ask for one change to the plan, then agree. Screenshot the assessment card, the plan card, the revised plan, and the map afterwards.
- [ ] **Step 3:** Check on disk: `goal.json` matches the goal; the map has `in_scope: false` on off-goal nodes and **only** `in_scope` and evidenced `status`/`evidence` changes against Step 1 (list every node whose status changed and confirm each has a new evidence note from this session); `lab-approval.json` is unchanged; the transcript shows no accepted `approved` before the learner's agreement.
- [ ] **Step 4:** Toggle "Show off-goal topics", open one off-goal node, confirm Quick check still works on it.
- [ ] **Step 5:** Optional, if agy is logged in: repeat Step 2 to the first plan with `MINDGAP_TUTOR=agy` on a fresh copy. Note whether agy returns the larger schema; failures go in the progress log, not blockers.
- [ ] **Step 6:** Stop only the 4811 server you started (by its PID). Write results and screenshots' paths into `.planning/2026-10-26-mindgap-generalization/progress.md`.

### Task 7: Seed the real learner's background (one-way door)

- [ ] **Step 1:** Ask the user before touching `learner/`. Proposed content for `learner/courses/networking/state/goal.json`: `{"goal": null, "background": "<the removed 'The learner…' paragraph, first two sentences>", "approved_at": null}`. Show it; write it only on a yes. `learner.backup-2026-10-26/` already exists as the backup.
- [ ] **Step 2:** Confirm `GET /api/courses/networking/map` and a teach lesson's CONTEXT (via the 4811 copy, re-copied after the write) show the background.

---

## Done means

- All tests pass (`node --test --test-timeout=60000 test/`).
- Task 6 ran end to end with real Claude in the browser on a data copy, with screenshots, and the on-disk checks in its Step 3 held.
- `CONTRACTS.md` describes the course session, `goal.json` and `in_scope`.
- PR opened from a branch (`feat/mindgap-e`), via `superpowers:finishing-a-development-branch` and `mattpocock-skills:pr`.
