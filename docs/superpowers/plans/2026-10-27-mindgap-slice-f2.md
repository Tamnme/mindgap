# mindgap slice f2 Implementation Plan: generated courses

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The learner creates a course on any subject from the home page (a title and an optional background). Sources are added on its map page exactly as in f1. **New goal** runs the e/f1 course session, and for a generated course its plan **draws** the map: it adds nodes and layers, not only choosing among existing ones. When the learner first opens a topic that has no chapter, the tutor writes one (JSON, schema-checked, citing source sections), and the chapter page shows it like a shipped one.

**Architecture:**
- Courses: `createCourse` in `lib/courses.mjs` writes a new course folder under `<data>/courses/<slug>/`. This is the same folder that already holds `state/` and `sources/`. The course starts with an empty map and `lab: null`.
- Course plans: in `lib/course-session.mjs`, a plan may carry `new_layers` and `new_nodes`, which are accepted only for generated courses.
- Chapters: a pure validator in `lib/chapters.mjs`, and a new tutor mode `write` (`prompts/writer.md` + `prompts/chapter-schema.json`) called by `POST /api/courses/:slug/chapters/:node/write`, with its own 300 s timeout.

**Tech Stack:** Node ≥ 22, zero npm dependencies, `node --test`, plain ES modules in the browser.

**Spec:** `docs/superpowers/specs/2026-10-26-mindgap-design.md`, section **f**, the bullets from "Then the probe → plan flow (e) runs and draws the map" onward. Section **b** gives the course folder layout. The anti-goals apply: no chapters written up front, the tutor gets no tools, and AI output is never code the browser runs.

**Verified facts** (`.planning/2026-10-26-mindgap-generalization/findings.md`, "Slice f2 facts"):
- **Chapter shape and validation:** chapters are `{node, number, kicker, title, lede, sections:[{id, title, blocks}]}`, about 13 KB each, and **no chapter schema or validator exists today**.
- **How a course loads:** `loadCourse` takes the first folder named `<slug>` from `courses/`, then from `<data>/courses/`. `ensureState` copies `map.seed.json`, so a generated course needs a seed, even an empty one.
- **Map layers:** `map.js` appends layers it doesn't know.
- **Home page:** `index.html` jumps straight to the map when exactly one course exists.
- **Chapter-writing spike** (real CLIs, same draft schema as Task 1): Claude opus took 126 s, agy low took 53 s. Both returned 5 sections and 3 checkpoints with no malformed blocks.
- **Labs:** none for generated courses in f2 (user decision 2026-10-27).

## Global Constraints

- **Everything in the a–f1 plans' constraints still holds:**
  - No npm dependencies, and the server binds only to `127.0.0.1`.
  - The tutor never gets tools, and every tutor call runs in a fresh, empty temp cwd.
  - Source text is untrusted.
  - Never touch the real `learner/` folder: checks use `MINDGAP_DATA_DIR=<tmp copy>`.
  - Never kill the user's server on port 4810.
- **Generated courses live only in learner data:** `<data>/courses/<slug>/`. Nothing in this slice writes under `courses/` (the repo).
- **A shipped course's map is never redrawn:** `new_nodes` and `new_layers` on a shipped course are refused with a `SERVER:` note. A course counts as generated when its folder is under `<data>/courses/`; `loadCourse` adds `generated: boolean`.
- **Trim still never deletes:**
  - Approval adds new nodes to `state/map.json` with `status: "untested"` and `evidence: ""`.
  - It never removes a node.
  - It never changes an existing node's `title`, `truth`, `prereqs` or `layer`.
  - `in_scope` and `source_sections` behave exactly as in f1.
- **Chapters are data, not code:**
  - Generated chapters contain only `md` and `checkpoint` blocks: no `lab`, no `widget`.
  - The server validates every chapter before writing it.
  - The chapter page renders them through the existing escaping Markdown renderer.
- **Exact values:**
  - `CHAPTER_TIMEOUT_MS = 300_000` for `write` calls; every other mode keeps `TUTOR_TIMEOUT_MS`.
  - A plan may add at most 40 nodes and 8 layers per turn.
  - Node and layer ids match `/^[a-z0-9][a-z0-9-]{0,47}$/`.
  - Course `title` is 1–80 chars after trimming; `background` is ≤ 2000 chars.
  - A chapter has 2–8 sections and 2–4 checkpoints; each checkpoint has 3–5 options, an integer `key` within range, and a non-empty `why`.
  - Section and checkpoint ids are unique within the chapter.

## Planner's calls (check these while reading)

1. **A course starts empty, and New goal draws it.**
   - The home page form creates `course.json` (`{slug, title, layers: [], lab: null}`), an empty `map.seed.json` (`{nodes: []}`) and `chapters/index.json` (`[]`). It also writes the background into `state/goal.json` as `{goal: null, background}`.
   - It then opens the map page, where an empty-map notice says to add sources (optional) and click **New goal**.
   - This reuses f1's Sources panel and e's session unchanged, instead of building a second, form-only creation flow.
2. **`new_nodes` add to the map; they never replace it.**
   - `plan.new_nodes` is `[{id, title, layer, prereqs, truth}]` and `plan.new_layers` is `[{id, name}]`. Both are `[]` when unused.
   - New ids must not collide with existing nodes or layers.
   - A new node's `prereqs` may name existing or new nodes, and the result must be acyclic.
   - A new node's `layer` must be an existing or new layer.
   - `in_scope` then selects among existing and new nodes, with f1's prereq-closure rule.
   - A later goal on the same course can grow the map, and the learner's evidence on earlier nodes survives.
   - Approval appends new layers to `course.json` `layers` and appends new nodes to `state/map.json`. `map.seed.json` stays as created; `state/map.json` is the course's map.
3. **One tutor call writes one chapter, with a fresh session and no resume.**
   - Mode `write` uses `prompts/writer.md`, which is adapted from `docs/CHAPTER_GUIDE.md` and stays subject-neutral. It is followed by the course's `prompt.md` if there is one.
   - The context: the course title, the learner's `{goal, background}`, the target node, its prereqs with their statuses, the titles of the other nodes, and the target node's tagged source excerpts (f1's `readSections`, capped at `EXCERPT_MAX`).
   - The model returns the schema's nullable form, where each block has `md` or `checkpoint` and the other is null.
   - The server normalises that to the stored shape (`{md}` or `{checkpoint}`). It adds `node`, `kicker` (the node's layer name) and `number` (1-based position in `chapters/index.json` after appending). It validates, writes `chapters/<node>.json` atomically, then appends the node to `index.json`.
   - An invalid chapter is not written, and the route returns 502 with the validator's first problem. The learner can click again.
4. **Writing is explicit and only for generated courses.**
   - The map side panel shows **Write chapter** for a node with no chapter in a generated course.
   - The button shows "Writing the chapter… this can take a few minutes."
   - It calls the write route, then opens `chapter.html` on success.
   - Shipped courses never offer it, and the route returns 409 for them.
   - A per-course-and-node in-memory lock returns 409 for a second concurrent write.
5. **Slug from title:** lowercase, with runs of non-`[a-z0-9]` replaced by `-` and trimmed, cut to 48 chars. If the result is empty, use `course`. If any course already uses the slug (shipped or data), append `-2`, `-3`, and so on.
6. **The home page always lists courses and shows the New course form.** The single-course auto-redirect is removed, so the form is reachable.

## Review Focus

1. **A shipped course cannot be redrawn.** A course session on `networking` whose plan carries `new_nodes` gets a refusal note, and `map.json` is unchanged after a later approval. → Task 2.
2. **Bad drawn plans are refused, never thrown.**
   - Cases: a cycle, an unknown prereq, an unknown layer, a duplicate id, an id that collides with an existing one, more than 40 nodes, and malformed entries.
   - Each gets a `SERVER:` note naming the problem. → Task 2.
3. **Approval preserves evidence.**
   - On a generated course with earlier nodes, a second approval that adds nodes leaves every existing node's fields other than `in_scope` and `source_sections` deep-equal.
   - New nodes are `untested`. → Task 3.
4. **An invalid chapter is never written.**
   - Cases: a missing `why`, a `key` out of range, 1 checkpoint, both `md` and `checkpoint` set, and a duplicate id.
   - Each gives a 502, and no file or index entry is created. → Tasks 1, 4.
5. **Path safety.** `POST /api/courses/<slug>/chapters/<node>/write` with an invalid node id, or a node not on the map, returns 400 or 404, and nothing is written. → Task 4.
6. **No chapter written up front.** Creating a course and approving a plan write zero chapter files. → Task 3.

---

### Task 1: Chapter schema and validator

**Files:**
- Create: `prompts/chapter-schema.json`, `lib/chapters.mjs`
- Test: `test/chapters.test.mjs`

**Interfaces:**
- `prompts/chapter-schema.json`: the model's output.
  - `{title, lede, sections: [{id, title, blocks: [{md: string|null, checkpoint: {id, prompt, options: string[], key: integer, why}|null}]}]}`.
  - Set `additionalProperties: false` and list every property in `required`, as in the turn schemas.
  - The spike's schema in findings.md is the starting point.
- `normalizeChapter(raw, {node, number, kicker}) → chapter`: turns each block into `{md}` or `{checkpoint}` and adds `node`, `number`, `kicker`. It is pure and does not validate.
- `checkChapter(chapter) → string|null`: returns the first problem, or `null`. It enforces every chapter rule in Global Constraints. Beyond those rules:
  - A block must be exactly one of `{md: non-empty string}` and `{checkpoint}`.
  - `title` and `lede` must be non-empty.
  - Any other block kind (`lab`, `widget`) is refused.
- Add a test that every shipped networking chapter fails `checkChapter` **only** for having lab or widget blocks. This proves the validator agrees with the real shape on everything else.

- [ ] **Step 1:** Write the tests.
  - A valid chapter returns `null`.
  - Each Review Focus 4 case returns a problem naming it.
  - Normalising the spike outputs (copy one into the test as a fixture, trimmed) gives a valid chapter.
  - The shipped-chapters check described above.
- [ ] **Step 2–4:** Run the tests and see them FAIL, implement, then see them PASS. Commit `chapters: schema and validator for written chapters`.

### Task 2: Drawn plans in the acceptance rules

**Files:**
- Modify: `prompts/course-schema.json`, `lib/course-session.mjs`, `lib/courses.mjs` (`generated` flag), `CONTRACTS.md`
- Test: `test/course-session.test.mjs`, `test/courses.test.mjs`, `test/server.test.mjs` (the schema test)

**Interfaces:**
- **Schema:** `plan` gains the required fields `new_layers: [{id, name}]` and `new_nodes: [{id, title, layer, prereqs: string[], truth}]`.
- **`checkPlan`:** becomes `checkPlan(map, plan, sectionIds, {generated, layers})`. An absent `new_*` field is treated as `[]`. When `generated` is false, a non-empty `new_*` is refused with "this course's map is fixed; choose from its nodes". Otherwise it validates Planner's call 2 and the Global Constraints limits. It runs the existing `in_scope` and `sources` checks against the map plus the new nodes.
- **`applyPlan`:** becomes `applyPlan(map, inScope, sources, newNodes = [])`. It appends the new nodes (`status: "untested"`, `evidence: ""`) **before** applying `in_scope` and tags. It stays pure.
- **Session rules:** `reviewTurn` passes the new arguments through. `loadCourse` returns `generated` (true when the owner folder is under `<data>/courses`).

- [ ] **Step 1:** Update the schema test so that `plan` has the two new fields.
  - Write pure tests for every Review Focus 2 case.
  - Add a valid drawn plan on an empty map.
  - Add a drawn plan whose `in_scope` misses a prereq of a new node (refused).
  - Add Review Focus 1 at the pure level.
  - Add an `applyPlan` test with new nodes plus the existing invariant.
  - Add a `courses` test for `generated`.
- [ ] **Step 2–4:** Run the tests and see them FAIL, implement, then see them PASS (full suite). Commit `course plans can draw new nodes on generated courses`.

### Task 3: Create a course, and approval grows the map

**Files:**
- Modify: `lib/courses.mjs` (`createCourse`), `server.mjs` (`POST /api/courses`, approval writes layers, `courseContext` passes `generated`), `CONTRACTS.md`, `README.md`
- Test: `test/courses.test.mjs`, `test/server.test.mjs`

**Interfaces:**
- **`createCourse`:** `createCourse(opts, {title, background}) → {slug}` follows Planner's calls 1 and 5. It validates `title` and `background` (400 on failure) and writes atomically. A concurrent create of the same title must not overwrite: create the folder with `mkdir` (not recursive) and retry the next suffix on `EEXIST`.
- **`POST /api/courses`:** takes `{title, background?}` and returns 201 with `{slug}`.
- **Approval** (in `advance`):
  - It passes `meta.pending_plan.new_nodes` to `applyPlan`.
  - When `new_layers` is non-empty, it appends them to `<course dir>/course.json` `layers` with an atomic rewrite.
  - It writes both the map and `course.json` before `goal.json`, keeping e's "nothing throws after the map write" order.
  - Thread `{generated, layers}` into `reviewTurn`.
- **Course CONTEXT:** gains `course.generated`, so the prompt can say "draw" or "choose".

- [ ] **Step 1:** Server tests with a scripted fake claude.
  - `POST /api/courses` creates the folder, files and goal background, and the home list shows it.
  - Title collision gives `-2`. A bad title gives 400.
  - A course session on the new course: a plan with 3 new nodes, 1 new layer and `in_scope` of all 3 is presented and then approved.
  - After approval, `map.json` has the 3 `untested` nodes, `course.json` has the layer, and there are no chapter files.
  - A second session adds 1 node and keeps the first 3 unchanged (Review Focus 3).
  - A `networking` session with `new_nodes` is refused (Review Focus 1, server level).
- [ ] **Step 2–4:** Run the tests and see them FAIL, implement, then see them PASS. Commit `create courses; approval grows a generated course's map`.

### Task 4: Write a chapter on demand

**Files:**
- Create: `prompts/writer.md`
- Modify: `server.mjs` (mode `write`, `callTutor` timeout parameter, route), `CONTRACTS.md`
- Test: `test/server.test.mjs`

**Interfaces:**
- **Registration:** `MODES.write = 'writer.md'` and `SCHEMAS.write = 'chapter-schema.json'`. `/api/lesson` must reject `mode: "write"`, the same way it rejects `chapter`.
- **`callTutor`:** becomes `callTutor(c, meta, message, timeoutMs = TUTOR_TIMEOUT_MS)`. Write calls pass `CHAPTER_TIMEOUT_MS` and a synthetic `meta = {mode: 'write', tutor_session_id: null}`. Nothing is persisted under `sessions/`.
- **`POST /api/courses/:slug/chapters/:node/write`:** follows Planner's calls 3 and 4.
  - 404: unknown node.
  - 400: invalid id.
  - 409: shipped course, a chapter that already exists, or a write already in flight.
  - 502: the tutor fails, or `checkChapter` reports a problem.
  - 201: success, returning `{node}`.
- **`prompts/writer.md`:**
  - CHAPTER_GUIDE's teaching rules, made subject-neutral: predict-first, 2–4 checkpoints placed before the text that answers them, and distractors from real misconceptions.
  - The output shape, where each block has `md` or `checkpoint` and the other null.
  - Cite source excerpts as "(source: <heading>)".
  - Write "the learner" with they/them.
  - The verbatim untrusted-source sentence from f1.
  - The learnharness credit comment.

- [ ] **Step 1:** Server tests with a fake claude that returns a valid chapter, and an invalid one when `FAKE_DIR/chapter-bad` exists.
  - 201 writes the file and the index entry, and `GET /api/courses/:slug/chapters/:node` returns it.
  - Its `number` and `kicker` are set.
  - The CONTEXT sent to the tutor holds the node's tagged excerpts. Check this by the fake recording its argv, as in existing tests.
  - The invalid chapter gives 502 and no file.
  - A second write of the same node gives 409.
  - A shipped course gives 409.
  - `..` or an unknown node gives 400 or 404.
  - Assert that the write call's `execFile` timeout is 300 s, by exporting the constant and checking it is passed; keep this lightweight.
- [ ] **Step 2–4:** Run the tests and see them FAIL, implement, then see them PASS. Commit `write a chapter on demand for generated courses`.

### Task 5: Course prompt for drawing a map

**Files:**
- Modify: `prompts/course.md`, `CONTRACTS.md` if it lists the fields

- [ ] **Step 1:** Phase 4 currently says "you cannot add, rename or re-link a node". Make it conditional on `course.generated`.
  - **Fixed map** (`generated: false`): unchanged.
  - **Generated course:** draw or extend the map with `new_layers` and `new_nodes`.
    - Each node is one idea, with an unconditional `truth` sentence, and the roots are truths the learner already holds or can accept.
    - Use kebab-case ids, and keep layers to a few ordered strands.
    - Prereqs are the true dependency edges, and `in_scope` includes every new node on the path to the goal.
    - Tag nodes with source sections when they rest on one.
    - Never restate the nodes in `say`.
    - With an empty map, the plan must draw one.
- [ ] **Step 2:** Update the "What you emit" list (`plan` = `{approach, in_scope, sources, new_layers, new_nodes}`) and the CONTEXT description (`course.generated`).
- [ ] **Step 3:** Run the full suite and see it PASS. Commit `course prompt: draw the map for generated courses`.

### Task 6: Home page and map page

**Files:**
- Modify: `public/index.html`, `public/map.html`, `public/map.js`, `public/app.css` only if needed

- [ ] **Step 1: Home page.**
  - Remove the auto-redirect.
  - Show the course list, then a **New course** form: title (required) and background (optional textarea, "What do you already know? Optional.").
  - On submit, POST and then go to `map.html?course=<slug>`.
  - Show errors in `#error`.
- [ ] **Step 2: Map page.**
  - With zero nodes, show a notice in the map area: "This course has no map yet. Add sources if you have any, then click **New goal** to draw it."
  - In a generated course, the side panel for a node with no chapter shows **Write chapter**. It runs Planner's call 4 with `#busy` / `#error` (reusing `setBusy`, `showError` and `courseApi`), and on success navigates to `chapter.html?course=…&node=…`.
  - Only render the button when `course.generated` is true. `courseInfo` must return `generated`.
- [ ] **Step 3:** If any logic is factored out into `map-logic.js`, add small tests for it. Run the full suite and see it PASS. Commit `home page: new course form; map page: empty-map notice and write chapter`.

### Task 7: Real check on a copy of the data

- [ ] **Step 1:** Copy `learner/`. Start the server on a free port other than 4810 with the copy and the default tutor (Claude). Record the PID.
- [ ] **Step 2:** In the browser:
  - Create the course "Sourdough baking" with a short background.
  - Add one real URL source about sourdough starters.
  - Click **New goal** and answer as the learner until a plan is presented.
  - Check that the plan draws nodes and the map page shows them, then approve.
  - Confirm that `chapters/` is still empty.
- [ ] **Step 3:**
  - Click **Write chapter** on a root node and record the time.
  - The chapter page renders it, with checkpoints before the text that answers them, and cites a source heading if the node is tagged.
  - Answer one checkpoint, and the chapter lesson tutor reviews it.
- [ ] **Step 4:** Repeat course creation, a plan and one chapter write with `MINDGAP_TUTOR=agy` on a second copy. Record the times.
- [ ] **Step 5:** Stop only the servers this task started. Record the results in the SDD ledger. Check that `learner/` is untouched.

## Done means

- All tests pass, including the Review Focus cases.
- Task 7 passed with real Claude and agy on data copies: a course was created, a map was drawn and approved, and one chapter was written and read for each tutor.
- No step wrote under `courses/` or the real `learner/`.
