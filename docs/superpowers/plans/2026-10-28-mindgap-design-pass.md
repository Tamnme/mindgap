# mindgap design pass — implementation plan

Source: critique `.impeccable/critique/2026-10-28T13-54-33Z__public.md` (21/40). User choices: lesson/chapter correctness first; lift index, map and lesson to the chapter page's level; everything in scope including a11y; run in parallel.

## Global constraints
- Zero npm deps; vanilla JS/CSS in `public/`. Match surrounding code style.
- Every implementer reads `/Users/macos/.claude/plugins/cache/impeccable/impeccable/4.8.0/skills/impeccable/reference/craft-floor.md` before any UI edit.
- Contrast: body text and controls ≥ 4.5:1 in both light and dark themes; large text ≥ 3:1.
- Chapter page (`chapter.html`, `.prose`, `.cp*`) is the visual reference. Keep its identity.
- `node --test test/` passes before a task is reported done.
- Real check per track: `PORT=48xx MINDGAP_DATA_DIR=<scratch copy of learner/> nohup node server.mjs &`, drive with `agent-browser` at 1440 and 390 wide, stop only that PID. Never touch port 4810 or the real `learner/`. Do not trigger tutor turns, course generation, chapter writes or labs (paid CLIs); stub at the fetch layer if a state must be seen.
- If a UI label is removed or renamed, grep README.md and docs/ for it in the same commit.

## Parallelism
Task 1 runs first and alone: it owns `app.css` tokens and base rules that every page uses. Tasks 2, 3 and 4 then run in parallel, each in its own worktree branched from Task 1's head, and own disjoint files. CSS each track adds goes in that page's existing section of `app.css` (lesson/bubble rules, map rules, index rules), never in `:root` or base rules. The controller merges the three branches; app.css conflicts are expected to be adjacent-hunk and resolved by the controller. Task 5 runs after the merge.

| Track | Owns |
|---|---|
| T1 foundation | `app.css` `:root`, base element rules, `.primary`, inputs, disabled |
| T2 lesson+chapter | `lesson.html`, `lesson.js`, `chapter.html`, `chapter.js`, `md.js` (read-only unless needed), lesson/chapter CSS sections |
| T3 map | `map.html`, `map.js`, `map-logic.js`, map CSS section, `test/map-logic.test.mjs` |
| T4 index | `index.html`, `lib/courses.mjs`, the `/api/courses` GET in `server.mjs`, index CSS, `test/courses.test.mjs` |
| T5 cancel | `server.mjs` tutor/chapter call sites, `lesson.js`, `map.js` wiring, `test/server.test.mjs` |

## Task 1: Foundation tokens (serial)
- Type scale shared across pages: body 15–16px; h1 on index/map/lesson aligned with the chapter page's scale (clamp roughly 24–36px); clear steps ≥ 1.25.
- Dark-mode accent: primary buttons ≥ 4.5:1 (dark text on `--accent`, or a darker fill). Fixes `.toc-item.current .toc-num` too.
- Placeholder and muted link colours ≥ 4.5:1 on `--panel` in both themes.
- Style every text-entry input, not only `input[type="text"]` (index title input currently renders white). Also add `type="text"` to `index.html` `#title`.
- Disabled buttons: distinguishable from enabled beyond 0.5 opacity (e.g. muted fill + not-allowed cursor).
- Remove the `.w-head` accent left-stripe (app.css:341) for a non-stripe treatment.
- Verify: detector `impeccable detect --json public` shows no low-contrast or side-tab finding at :341.

## Task 2: Lesson and chapter correctness (parallel)
- Render question prompts as markdown: `lesson.js:173` (`q-prompt`), `chapter.js:77` and `:121` (`cp-q`) through the same renderer tutor bubbles use. Numbered sub-questions keep their line breaks.
- Replace `window.prompt` in "Ask something else" (`lesson.js:348`) with an inline text box in the question card, Enter or a button to send, Escape to close.
- One verb for committing an answer across lesson and chapter (pick "Submit"; update docs if "Commit" appears there).
- Confidence 1–5: visible end labels (1 = guessing, 5 = certain) and accessible names.
- Radio options grouped in a `fieldset` whose `legend` is the prompt (or `aria-labelledby`).
- Tutor drawer (`chapter.js:293-302`): `inert` when hidden, focus moves in on open, Escape closes, focus returns to the opener.
- Tutor FAB must not cover checkpoint text at 390 wide.
- Remove the duplicate "Tutor" label (panel label vs bubble label).
- Long turn waits: show elapsed seconds next to the existing busy text.
- Error messages lead with plain words; keep the HTTP code in a trailing parenthesis only.
- Lesson end: name the status change ("MTU: shaky → solid") if the data is available in the final turn; otherwise keep current copy.
- Tests: add/extend unit tests for any pure helper added (e.g. elapsed formatting, status-change text).

## Task 3: Map usability and a11y (parallel)
- Side panel: action buttons ("Read the chapter", "Practice", "Quick check / Teach") directly under the node title; evidence/AWS/Kubernetes/Proxmox/Lab blocks in `<details>` collapsed by default; panel `position: sticky` on desktop; on narrow screens scroll the panel into view on node select.
- "← Courses" link to `/` in the map header.
- Drop the CHAPTER tag from map nodes (every node has one).
- Legend: short key (glyph + word per status), hidden on an empty map.
- Hide "Practice shaky" when the count is 0 instead of showing "(0)".
- "Practice shaky" with >1 shaky node: let the learner pick (e.g. the button focuses the first and the side panel offers Practice) — or keep shaky[0] and record a ruling.
- Node search: a text filter that dims non-matching nodes and focuses the first match on Enter.
- A11y: remove `role="img"` from `#map` (map.html:31) and give the SVG an accessible structure (group label per layer, each node `role=button` with name + status); skip link to the side panel; focus order node → panel reachable.
- Chapter-write wait: elapsed seconds; keep reading/navigation enabled — disable only the buttons that would start another AI call (`map.js:351` currently disables every button).
- Human-readable node title shown instead of raw id wherever an id is displayed as a chip.
- Tests: extend `test/map-logic.test.mjs` for any pure logic added (filter matching, legend visibility).

## Task 4: Course list page (parallel)
- `/api/courses` GET adds per-course `{ solid, total, lastLesson: { id, nodeId, title } | null }` computed from the course's map/state; missing state → zeros/null. Contract change: update `CONTRACTS.md`.
- Index renders course cards: title, solid/total with a small progress bar, "Resume <node>" link when a last lesson exists, else "Open map".
- New-course form: label says what Title means ("What do you want to learn?"), helper text under Background; form visually secondary to the course list once at least one course exists.
- Empty state (no courses): the form is the hero with one sentence of guidance.
- Tests: `test/courses.test.mjs` for the progress fields; `test/server.test.mjs` for the GET shape.

## Task 5: Cancel a running AI call (serial, after merge)
- `server.mjs callTutor` keeps the child of an in-flight turn / chapter write per course; `POST /api/courses/:slug/cancel` kills it. The cancelled turn must leave lesson state as if the turn was never sent (pending learner answer kept for Retry, no partial tutor turn written). Chapter write: no partial chapter file.
- UI: a Cancel button beside the busy indicator in lesson and map.
- Tests: server test with a fake tutor bin that sleeps; cancel returns 200, state unchanged, a following turn works.

## Final
Whole-branch review; re-run `impeccable detect --json public` and `/impeccable critique`; real check on a scratch server; PR from `feat/mindgap-design-pass`.
