# mindgap f2 follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four known limits left by f2 and PR #9:
- A lesson start whose context build throws leaves no orphan meta.
- Two tabs approving plans on the same course cannot both apply.
- CONTRACTS describes what a refused approval actually writes.
- Generated courses get "connect to what you know" `links` from the learner's background.

**Architecture:** Changes go in `server.mjs` (`startLesson`, `advance`), `lib/course-session.mjs` (`checkDrawn`, `applyPlan`), `prompts/course-schema.json`, `prompts/course.md` and `CONTRACTS.md`. There is no UI change, because `public/map.js:286` already renders `links`.

**Tech Stack:** Node ≥ 22, zero npm dependencies, `node --test --test-timeout=60000 test/` (286 tests at 4049a31).

**Spec:** `docs/superpowers/specs/2026-10-26-mindgap-design.md` §b, line 92:
- `twins` becomes an optional `links` list.
- Generated courses fill `links` at plan time from the background, if one was given.
- A background only changes which links the tutor leads with.

**Verified facts** (read at 4049a31):
- `startLesson` (server.mjs:~392-414) writes meta (:398 course, :409 node) **before** `courseContext` (:399) and `contextFor` (:411). `advanceOrDrop` (:378-385) only covers `advance`.
- `advance` loads the map (:319) and runs the stale `checkPlan` (:~327) **outside** the `updateMap` chain (:153-163). It reads and modifies course.json outside the chain (:338-343) and writes it at :366, then writes goal.json at :367. `applyPlan` does not dedupe. `busy` is per lesson_id, so two course lessons on one slug are not serialized.
- When an approval is refused as stale, `node_updates`, propositions, transcript and meta are still written. CONTRACTS.md:83 says "nothing is written".
- `prompts/course-schema.json` `new_nodes` items are strict: `additionalProperties: false`, and every property is in `required`.
- `checkDrawn` is at lib/course-session.mjs:12 and `applyPlan` at :121. Both copy a whitelist of node fields.

## Global Constraints

- **The a–f2 constraints hold:**
  - No npm dependencies, and the server binds only to `127.0.0.1`.
  - The tutor gets no tools and runs in a fresh, empty temp cwd.
  - Source text is untrusted.
  - Never touch the real `learner/`. Checks use `MINDGAP_DATA_DIR=<tmp copy>` on a port other than 4810.
  - Never kill the 4810 server.
- **A shipped prompt never describes the learner.** The background comes only from `state/goal.json` at runtime, and the existing test enforces this.
- **Credit learnharness (AGPL-3.0)** in the PR body.
- **Commits** end with `Co-Authored-By: <your model> <noreply@anthropic.com>`.

## Planner's calls (check these while reading)

1. **A refused stale approval keeps the turn's evidence.** `node_updates`, propositions, transcript and meta are written; the plan, layers and goal are not. The learner's answers on that turn are real evidence, so dropping them would lose learning data. The fix is to CONTRACTS, not the code.
2. **The race fix is "loser refused", not "second tab blocked".** The `checkPlan` re-check, the `applyPlan`, and the course.json and goal.json writes all move inside one `updateMap` callback, so they serialize with each other. The losing tab gets the existing stale-refusal path. There is no up-front 409 for a second course session. Single-process stays, matching the existing `busy` and `mapChains` caveat.
3. **Orphan meta: the context is built before meta is written.** The early meta write moves below the context build, so a throw leaves nothing behind. The learner sees the plain error the server already returns. There is no special "corrupt file" message.
4. **`links` shape and limits:**
   - On `new_nodes`, `links: [{label, text}]` is required by the schema and may be `[]`.
   - At most 3 links per node. `label` is free text, 1–40 chars; `text` is 1–300 chars.
   - Filled at plan time only. A background added later does not regenerate links.
   - Per node only, not per layer.
   - Leading with links is tutor-prompt behaviour only. There is no UI reordering.
5. **The generic teach prompt gets one line** telling the tutor to lead with the target node's `links` that match `learner.background`, when both exist. This makes generated-course lessons use links the way networking's prompt.md already does. The line is subject-neutral and does not describe the learner.

## Review Focus

- Task 2: is any read of map, course.json or goal.json that feeds the approval decision still outside the chain? Are layers deduped by id?
- Task 3: does every rejection path in `checkDrawn` for `links` return a problem string the way the other field checks do?
- No shipped prompt describes a learner.

### Task 1: No orphan meta when the context build throws

**Files:** `server.mjs` (`startLesson`), `test/server.test.mjs`.

- [ ] In both branches of `startLesson`, build the context message first, then `writeAtomic(metaPath(...))`, then `advanceOrDrop`. Check that nothing reads the meta file between the write and `advance`, including the cancel path and `loadMeta`. If something does, report it rather than working around it.
- [ ] Test (node mode): corrupt `state/propositions.jsonl` (or make the context read fail another way that `contextFor` actually hits), then POST /api/lesson. Expect a non-2xx, and no `*.meta.json` in the course's lessons directory.
- [ ] Test (course mode): the same, through `courseContext`.
- [ ] Full suite green.

### Task 2: Two-tab approval race

**Files:** `server.mjs` (`advance`), `test/server.test.mjs`, `CONTRACTS.md` (lines ~83 and ~106).

- [ ] Inside one `updateMap(c, fn)` callback, on the freshly read map:
  1. Re-run `checkPlan(map, meta.pending_plan, …)`.
  2. If it fails, take the existing refusal path (`approved=false`, `lesson_done=false`, SERVER note `approval refused: the plan no longer fits the map (<problem>); present a fresh plan`). Skip `applyPlan` and skip the course.json and goal.json writes.
  3. If it passes, run `applyNodeUpdates` and `applyPlan`. Read course.json fresh, append new layers deduped by id, and write it. Write goal.json.

  `node_updates` apply in both cases (Planner's call 1).
- [ ] Keep the existing ordering note: a crash between the map write and course.json leaves nodes on an unknown layer. Keep its ponytail comment accurate.
- [ ] Test: two course lessons on one generated course, each holding a pending plan that adds the same node id. Fire both approval turns concurrently, with fake tutor replies released together. Expect:
  - exactly one copy of each new node in `state/map.json`
  - no duplicate layer ids in course.json
  - one turn `approved: true`
  - the other turn `approved: false` with the SERVER note queued in its meta
- [ ] Update CONTRACTS.md:
  - Line 83 must say what is and isn't written on a refusal (Planner's call 1), and that the check runs inside the map write chain.
  - Line 106 must give the write order on accept.
- [ ] Full suite green.

### Task 3: `links` on drawn nodes

**Files:** `prompts/course-schema.json`, `lib/course-session.mjs`, `prompts/course.md`, the generic teach prompt (`prompts/teacher.md` or whichever file the teach mode uses; find it from `MODES` in server.mjs), `test/course-session.test.mjs`, `test/server.test.mjs`, `CONTRACTS.md` (the node shape and new_nodes).

- [ ] Schema: add `links` to `new_nodes` items: an array of `{label, text}` with `additionalProperties: false`, both strings required. Add `links` to `required`. Description: "1-3 counterparts from learner.background; [] when no background is on record".
- [ ] `checkDrawn`:
  - `links` must be an array of at most 3 items.
  - Each item must be an object with exactly `label` (1–40 chars after trim) and `text` (1–300 chars after trim).
  - A violation returns a problem string like the other checks.
  - A missing `links` is treated as `[]`, so older replies stay valid.
- [ ] `applyPlan`: copy `links` onto the added node only when it is non-empty, so nodes stay `links`-less otherwise. This matches seed nodes that have none.
- [ ] `prompts/course.md` plan section: when `learner.background` is set, give each new node 1–3 `links` naming what the learner already knows that maps onto it; otherwise `[]`. Never invent a background.
- [ ] Generic teach prompt: one subject-neutral line (Planner's call 5).
- [ ] Tests:
  - accept a valid `links`
  - reject 4 links
  - reject an empty `label`
  - reject an extra key
  - treat a missing `links` as `[]`
  - server: an approved drawn plan persists `links` into `state/map.json`
- [ ] The existing "no shipped prompt describes the learner" test still passes.
- [ ] Full suite green.

### Task 4: Real check on a copy of the data (controller runs this)

- [ ] Copy `learner/` to a scratch directory, and start `PORT=4861 MINDGAP_DATA_DIR=<copy> nohup node server.mjs &`, recording the PID.
- [ ] Use agent-browser with Claude as the tutor:
  1. Create a course with a background.
  2. Run New goal through to approval.
  3. Confirm the drawn nodes in the copy's `state/map.json` carry `links`.
  4. Confirm the map side panel shows them.
  5. Start a teach lesson on a linked node and confirm the tutor leads with a matching link.
- [ ] Two-tab check: open two New goal sessions on one course, get both to a presented plan, and approve both. Exactly one applies, and the other's next turn presents a fresh plan.
- [ ] Stop only the recorded PID.

## Done means

- All four limits are closed, with tests.
- The full suite is green (286 + new).
- The real check passed on a data copy.
- CONTRACTS matches the code.
- A PR is open against main, and the user merges it.
