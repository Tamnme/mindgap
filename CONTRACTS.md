# mindgap contracts

Shared formats that every part builds against. Change them here first.

## Run
`node server.mjs` → http://localhost:4810. No npm dependencies. Node ≥ 22.
Env: `MINDGAP_DATA_DIR` (default `learner/`), `MINDGAP_COURSES_DIR` (default `courses/`), `MINDGAP_TUTOR` (`claude` default | `agy`; unknown → exit 1), `MINDGAP_MODEL` (default `opus` for claude, unset for agy), `MINDGAP_EFFORT` (default `low` for agy, unused by claude). Binaries: `DOCKER_BIN` (default `docker`), `CLAUDE_BIN` (default `claude`), `AGY_BIN` (default `agy`), `MARKITDOWN_BIN` (default `markitdown`, read per call; only sources need it).

## Files
```
server.mjs                 # HTTP server
lib/courses.mjs            # course loader: listCourses, loadCourse, ensureState
lib/chapters.mjs           # normalizeChapter / checkChapter for written chapters
prompts/writer.md          # system prompt, mode=write (one chapter per call)
prompts/chapter-schema.json # output schema of a write call
prompts/turn-schema.json   # tutor output schema (fixed, see below)
prompts/teacher.md         # system prompt, mode=teach
prompts/practice.md        # system prompt, mode=practice
prompts/prober.md          # system prompt, mode=probe
prompts/chapter.md         # system prompt, mode=chapter
prompts/course.md          # system prompt, mode=course
prompts/course-schema.json # course-session output schema (turn schema + goal, assessment, plan, approved, read_sections; `plan` = `{approach, in_scope, sources, new_layers, new_nodes}`)
lib/labs.mjs               # lab runner: one Docker container per course, approval, runLab/labStatus
lib/tutors/                # tutor CLI adapters (claude, agy), chosen by MINDGAP_TUTOR
scripts/                   # migrate-learner-v1.mjs (old layout), tutor-gate.mjs, lab-parity.mjs
public/                    # UI
courses/<slug>/course.json           # {slug, title, layers:[{id,name}], lab}
courses/<slug>/map.seed.json         # clean knowledge map, committed; nodes use links
courses/<slug>/prompt.md             # course-specific text appended to every mode prompt (optional)
courses/<slug>/chapters/index.json   # ["<node_id>", ...] chapter ids (optional)
courses/<slug>/chapters/<node_id>.json  # chapter content, see Chapters below
<data>/courses/<slug>/state/map.json              # your map; copied from map.seed.json on first access
<data>/courses/<slug>/state/goal.json                {goal, background, approved_at}, written when a course session's plan is approved
<data>/courses/<slug>/state/propositions.jsonl    # one proposition per line, appended by server
<data>/courses/<slug>/state/sessions/<lesson_id>.jsonl      # transcript, one event per line
<data>/courses/<slug>/state/sessions/<lesson_id>.meta.json  # {course, tutor, tutor_session_id, node_id, mode, started, labs_sent}
```
`<data>` is `MINDGAP_DATA_DIR`. A course is a folder under the courses dir (shipped) or under `<data>/courses/` (learner-made). The first folder with the slug wins.

## courses/<slug>/map.seed.json → state/map.json
```json
{ "nodes": [ {
  "id": "switch-mac-table",
  "title": "Switch: MAC → port",
  "layer": "L2",                       // one of the ids in course.json layers
  "prereqs": ["frames-mac"],
  "truth": "A switch forwards frames by destination MAC only; it learns MAC→port from each frame's source.",
  "links": [{ "label": "AWS", "text": "..." }],   // per-node notes
  "lab": "One-line lab idea for the Docker lab",
  "sim": "switch-learning",           // scenario name or null
  "sources": ["https://..."],
  "status": "gap",                     // untested | gap | shaky | solid
  "in_scope": false,                   // optional; only ever false, set by an approved course plan
  "source_sections": ["<sourceId>-<n>"], // optional; section ids the node rests on, written only by an approved plan (`plan.sources`); distinct from `sources` above
  "evidence": "Placement 2026-10-24: said a switch maps IP→MAC."
} ] }
```

## Tutor turn (adapter output, `structured_output`) — `prompts/turn-schema.json`
Fields: `say`, `question{kind,prompt,options,wants_confidence}|null`, `sim{scenario}|null`,
`lab{cmd,explain}|null`, `node_updates[{id,status,note}]`, `propositions[{claim,because,node}]`, `lesson_done`.
Sim scenarios: `switch-learning | switch-flood | vlan-broadcast | vlan-trunk`.

## Course session

The schema is per mode: `schemaFor(mode)` in `server.mjs` picks `prompts/course-schema.json` for `course`, else `turn-schema.json`.
`POST /api/lesson {course, mode:"course"}` starts a course-level probe → plan session. `node_id` is ignored. The lesson id is `course-<timestamp>` and its meta has `node_id: null` and, for course lessons, `goal, assessment, pending_plan, plan_presented, server_notes`. Every course-mode tutor turn (including the first) is reviewed by `reviewTurn` (`lib/course-session.mjs`) before node updates are applied and before anything is stored, so the transcript and the response hold the reviewed turn.

First message: `CONTEXT:` + JSON `{mode:"course", course:{slug,title,layers,generated}, learner:{goal,background}|null, nodes:[{id,title,layer,prereqs,truth,status,evidence,in_scope?,source_sections?}], propositions, sources}` (the last 200 lines of propositions.jsonl; `in_scope` appears only as `false`; `source_sections` only when non-empty; `sources` is the TOC, see Sources).

When the review refuses a field, it becomes a note in `meta.server_notes`. The next message starts with `SERVER:\n- <note>\n- <note>\n` then, if the previous turn's `read_sections` was accepted and non-empty, `SOURCES:\n<JSON of [{id, source, heading, text}]>\n` (see below), then the usual `EVENT:` text; the notes are cleared when that turn is stored (notes from reviewing it go to the message after).

| Field | Kept only when |
|---|---|
| `propositions` | never (always `[]`) |
| `sim`, `lab` | never (always `null` in course mode) |
| `goal` | a plain object with non-empty string `text` and `background` string or null; a goal change in the turn that approves is refused |
| `assessment` | no question open, none accepted before, goal set |
| `plan` | assessment accepted, no question open, `checkPlan` passes (known ids, no duplicates, prereqs in scope, non-empty) |
| `approved` | previous turn presented an accepted plan, this turn carries no plan field (even a refused one), the event it answers is `ask` or `answer` (never the first turn), and a goal is on record |
| `lesson_done` | only with accepted approval |

Stale approval: before applying an accepted approval, `advance` re-runs `checkPlan` on `meta.pending_plan` against the freshly loaded map. If it fails (another session grew the map meanwhile), nothing is written, the turn is stored and returned with `approved: false, lesson_done: false`, and the next message carries `SERVER:\n- approval refused: the plan no longer fits the map (<problem>); present a fresh plan`.

Instruments: in every mode, a course with `lab: null` always gets `turn.lab = null`, and a generated course always gets `turn.sim = null` (sims are networking scenarios).

Sources (course mode). `courseContext` always carries `sources: [{id, title, sections: [{id, heading, chars}]}]` (the TOC, no text, `[]` when none). The course schema has required `read_sections: string[]`: `reviewTurn` keeps it only when it is an array of at most `READ_MAX` (5) ids that all exist in this course's index, else it refuses with a `SERVER:` note naming the problem and keeps `[]`. The kept list is stored as `meta.pending_reads` every course turn (an empty list too), and the next message gets a `SOURCES:` block holding `readSections(...)` of it (capped at `EXCERPT_MAX` chars; unknown ids skipped); that turn's own `read_sections` replaces it, so each block is sent once. Source text is untrusted reference material, only ever inside JSON. `plan.sources` is required: `[{node, sections}]`; `checkPlan` refuses a node not in `in_scope`, a node listed twice, or an id not in the index (absent counts as `[]`).

Node-level modes (teach/practice/probe/chapter): `baseContext` adds `sources: [{id, source, heading, text}]` for the target node's `source_sections` tags, in tag order up to `EXCERPT_MAX` chars total, dangling ids skipped; the key is absent when the node has no tags or none resolve.

Drawn plans. `plan.new_layers: [{id, name}]` and `plan.new_nodes: [{id, title, layer, prereqs, truth, status, evidence}]` (`status` one of untested|gap|shaky|solid, `evidence` a string; `checkDrawn` refuses anything else) (both required in the schema, absent counts as `[]`) add to a map, never replace it. `checkPlan(map, plan, sectionIds, {generated, layers})` refuses a non-empty `new_*` on a shipped course (`generated` false, from `loadCourse`) with "this course's map is fixed; choose from its nodes". Otherwise it checks, in order: shape, at most 40 nodes / 8 layers, ids match `/^[a-z0-9][a-z0-9-]{0,47}$/`, no duplicate or collision with existing node/layer ids, each node's layer known, each prereq known (existing or new), no cycle. `in_scope` and `sources` are then checked against the map plus the new nodes. `applyPlan(map, inScope, sources, newNodes)` appends new nodes (copying only `id, title, layer, prereqs, truth, status, evidence`) before the scope/tag logic. `meta.pending_plan` always carries `new_layers` and `new_nodes`.

On accepted approval the server sets `in_scope: false` on every node outside the plan (in-scope nodes carry no `in_scope` key). In-scope nodes get `source_sections` = the ids `plan.sources` lists for them, or lose the key; off-scope nodes keep their `source_sections`. The URL list `sources` is never touched. Nothing else in the map changes. It also writes `<stateDir>/goal.json` = `{goal, background, approved_at}`. An abandoned session changes neither. `goal.json` may hold `goal: null` (background only); readers tolerate null. Node-level modes get `learner:{goal,background}|null` from it and list off-goal nodes in `other_nodes` with `in_scope: false`.

## How the server calls the tutor (adapters in `lib/tutors/`)
`MINDGAP_TUTOR` picks one adapter: `claude` (default) or `agy`. Each adapter exports `buildCall({systemPrompt, schemaText, message, sessionId, model, schemaFile}) -> {bin, args}` and `parseOutput(stdout) -> {turn, sessionId, error}`. Binaries come from `CLAUDE_BIN` / `AGY_BIN`.
- Every call runs with cwd = a fresh `mindgap-turn-*` temp dir (holds `turn-schema.json`), stdin closed, and the dir is removed afterwards. The tutor gets no tools.
- `claude`: `claude -p --safe-mode --tools "" --model <MINDGAP_MODEL|opus> --output-format json --json-schema <turn-schema.json> --system-prompt "<prompts/<mode>.md>\n\n<courses/<slug>/prompt.md, if present>" [--resume <tutor_session_id>] "<message>"`. Reads `.structured_output`, `.session_id`, `.is_error`.
- `agy`: `agy --output-format json --json-schema <schema> [--model <MINDGAP_MODEL>] [--effort <MINDGAP_EFFORT|low>] [--conversation <tutor_session_id>] -p "<message>"`. agy has no system-prompt flag, so the first turn prepends `SYSTEM INSTRUCTIONS:`, a no-tools line, then the prompt to the message. Reads `.structured_output`, `.conversation_id`, `.denied_actions`. When a turn has no `structured_output` and `denied_actions` is non-empty (agy 1.4.7 sometimes runs `pwd && ls -la` first, which print mode refuses), the server resumes that conversation once with a `SERVER:` nudge; a second refusal is a 502.
- Timeout 180 s, stdout cap 16 MB. A parse or tutor error is HTTP 502 with the adapter's error, plus `: <first 500 chars of stderr>` when stderr is present. A missing binary is 502 `<tutor> not found on PATH`.
- A lesson is bound to the tutor it started with (`meta.tutor`); a turn under a different `MINDGAP_TUTOR` is 409. Lessons with no `tutor` field count as `claude`.
- `--safe-mode` keeps the user's CLAUDE.md/plugins/hooks out of the tutor. Auth still uses the subscription. Do NOT use `--bare` (it needs an API key).
- First message of a lesson = a JSON block containing: the mode, the target node, its prereqs with their statuses, every other node's id/title/status (`in_scope: false` when off-goal), the learner's goal and background (or null), and all propositions for those nodes. Later messages = the learner event as JSON.

## Generated courses
A course whose folder is under `<data>/courses/` is generated (`loadCourse().generated`); only those may draw. On approval of a plan, the server (in this order) appends `plan.new_nodes` to `state/map.json` (with the `status` and `evidence` the plan gave them, existing nodes untouched apart from `in_scope` / `source_sections`), appends `plan.new_layers` (`{id, name}` only) to `layers` in `<data>/courses/<slug>/course.json` (other keys kept), then writes `state/goal.json`. No chapter files are written by creating a course or approving a plan. The course CONTEXT carries `course.generated`.

## HTTP API
Binds 127.0.0.1 only. Unknown or invalid course slugs → 404. A malformed `course.json` → 500 (message logged).
| Method | Path | Body → Response |
|---|---|---|
| GET | `/api/courses` | → `[{slug, title}]` |
| POST | `/api/courses` | `{title, background?}` → 201 `{slug}`. `title` 1-80 chars after trimming, `background` text up to 2000 chars (blank = none), else 400. Creates a generated course in `<data>/courses/<slug>/`: `course.json` `{slug, title, layers: [], lab: null}`, `map.seed.json` `{nodes: []}`, `chapters/index.json` `[]`, and `state/goal.json` `{goal: null, background}` only when a background is given. Slug = lowercase title with runs of non-`[a-z0-9]` as `-`, max 48 chars (`course` if empty); `-2`, `-3`, ... if a shipped or data course already has it. |
| GET | `/api/courses/:slug` | → `{...course.json, chapters: string[], lab, generated: boolean}` (`chapters` = `chapters/index.json`, `[]` if absent; `lab` = `{available, reason?, request:{caps, network}, approved}`, `reason` set when Docker is unavailable) |
| GET | `/api/courses/:slug/map` | → state map.json (seeded on first access) |
| GET | `/api/courses/:slug/chapters/:id` | → chapter JSON, 404 if absent |
| GET | `/api/courses/:slug/sources` | → `[{id, title, origin:{kind,value}, added, truncated, sections:[{id, heading, chars}]}]`, oldest first |
| POST | `/api/courses/:slug/sources` | `{url}` or `{filename, data_base64}` (exactly one of url / data_base64; filename required with data_base64) → 201 + the list shape above. Body limit `ceil(UPLOAD_MAX*4/3)+64 KB`. 400 bad input or non-http(s) URL, 413 over a cap, 422 `{error, stderr}` when markitdown fails, 502 fetch failed, 503 `{error: "markitdown is not installed", install: "pip install 'markitdown[all]'"}` |
| DELETE | `/api/courses/:slug/sources/:id` | → 204, or 404 for an unknown or non-`validId` id |
| POST | `/api/lesson` | `{course, node_id, mode}` → `{lesson_id, turn}` (starts a tutor session, first turn); `mode: "course"` needs no `node_id` |
| POST | `/api/turn` | `{course, lesson_id, event}` → `{turn}` |
| POST | `/api/courses/:slug/lab-approval` | `{caps, network}` (must equal the course's `lab.request` exactly) → 204, or 400 on mismatch. Writes `<stateDir>/lab-approval.json`. |
| POST | `/api/lab` | `{course, lesson_id, cmd}` → `{stdout, stderr, code}`. Also appended to the transcript as a `lab` event. The next `/api/turn` should include it. 503 `{error: reason}` when Docker is unavailable; 428 `{error: 'lab needs approval', request}` until the course's request is approved. |
| POST | `/api/courses/:slug/chapters/:node/write` | `{}` → 201 `{node}`. One tutor call (mode `write`, `prompts/writer.md` then the course's `prompt.md`; fresh session, no resume, nothing under `sessions/`; timeout `CHAPTER_TIMEOUT_MS` = 300 s, other modes 180 s) writes `chapters/<node>.json` and appends the node to `chapters/index.json`. First and only message `CONTEXT:` + `{mode:"write", course:{slug,title}, learner, target:{id,title,layer,layer_name,truth,prereqs}, prereqs:[{id,title,status,evidence}], other_nodes:[{id,title}], sources?}` (`sources` = the node's tagged excerpts, omitted when none). The reply (`prompts/chapter-schema.json`, blocks with `md`/`checkpoint`, the other null) is normalised by `lib/chapters.mjs` (`number` = string of the index length + 1, `kicker` = the node's layer name, id as fallback) and checked by `checkChapter`. A refused chapter gets ONE more fresh call (no resume) with the same CONTEXT plus `\nSERVER:\n- your previous chapter was refused: <problem>. Write the whole chapter again, following the output rules.`; refused twice is a 502 (the lock covers both calls, the timeout applies per call). 400 invalid node id, 404 unknown course or node, 409 shipped course / the node is already in `chapters/index.json` (the index decides; a file without an entry is overwritten) / another write is in flight for the course (one at a time per course); the index is parsed before the tutor call, so a malformed one is a 500 with nothing written; node id `index` is 400, 502 tutor failed or `chapter refused: <problem>` (nothing written). `/api/lesson` refuses mode `write`. |
| POST | `/api/chapter` | `{course, node_id}` → `{lesson_id, meta, events[]}`. Reuses the node's latest `chapter`-mode lesson or creates one **without** a tutor call; 404 when the chapter file doesn't exist (`courses/<course>/chapters/<node_id>.json` for a shipped course, `<data>/courses/<course>/chapters/<node_id>.json` for a generated one). `/api/lesson` refuses mode `chapter`. |
| GET | `/api/lesson/:id?course=<slug>` | → `{meta, events[]}` (for reload). Missing or unknown course → 404. |

Sources: one file per source at `<data>/courses/<slug>/sources/<id>.json`, never under the course dir. Shape `{id, title, origin:{kind:"url"|"file", value}, added, truncated, sections:[{id, heading, text}]}`. Ids: source `s<base36 ms>`, section `<sourceId>-<n>`. Caps (`lib/sources.mjs`): `FETCH_MAX` 10 MB, `FETCH_TIMEOUT_MS` 30 s, `UPLOAD_MAX` 20 MB decoded, `CONVERT_TIMEOUT_MS` 60 s, `TEXT_MAX` 1 MB of Markdown (longer is cut, `truncated: true`), `SECTION_MAX` 6000 chars, `EXCERPT_MAX` 20000 chars per tutor message, `READ_MAX` 5 ids. Only `http:`/`https:` URLs are fetched; text is converted by `markitdown -x <ext>` on stdin.

Lesson meta gains `course`, `tutor` and `tutor_session_id`. Lesson ids are `<node_id>-<timestamp>` (`course-<timestamp>` for course sessions).

Learner `event` shapes:
- `{type:"answer", choice?:string, text?:string, confidence?:1..5, reasoning?:string}`
- `{type:"lost", text?:string}` · `{type:"ask", text:string}` · `{type:"lab_output", cmd, stdout, stderr, code}`
- Chapter mode: `{type:"checkpoint", id, prompt, options, chosen, key, correct, confidence, reasoning?}` · `{type:"checkpoint", id, skipped:true}` · `{type:"ask", text, section}`

Chapter mode (`prompts/chapter.md`): the first `/api/turn` sends `CONTEXT` (including `chapter_source`, the chapter JSON text) followed by the event. The learner record is written **before** the tutor call, so an answer survives a failed review.

Chapters: `courses/<slug>/chapters/<node_id>.json`, listed in `courses/<slug>/chapters/index.json`. The server reads chapters only from the course folder. The chapter shape is `{node, number, kicker, title, lede, sections:[{id, title, blocks:[{md}|{checkpoint:{id, prompt, options, key, why}}|{widget:{id, kind?, title, hint, takeaway, ...config}}|{lab:{explain, cmd}}]}]}`. Widget kinds and their config are documented in `public/widgets/README.md`.

After each turn the server applies `node_updates` to the course's state/map.json (status + evidence = note) and appends `propositions` (with lesson_id, ts) to its propositions.jsonl.

## Lab safety (Docker)
- One container per course, named `mindgap-<slug>`, built from the course's `lab.dockerfile` on first use. Commands run with `docker exec … bash -lc <cmd>`, never on the host shell.
- Defaults: `--network none`, no added capabilities, not privileged.
- Extra capabilities and network come only from the course's request (`lab.caps`, `lab.network` in `course.json`). Nothing beyond the defaults runs until the learner approves exactly that request. The approval is stored in `<data>/courses/<slug>/state/lab-approval.json`.
- The container is labelled `mindgap.request` with the request it was made for. If the request changes, the container is removed and recreated.
- 30 s timeout (the docker client is killed; a process already running in the container is not), 64 KB output cap, 4000-character command cap.
- Commands run only when the learner clicks Run. The UI shows the approval prompt on the first Run that needs it, and "Labs need Docker: <reason>" with no Run button when `lab.available` is false.
