# mindgap contracts

Shared formats that every part builds against. Change them here first.

## Run
`node server.mjs` → http://localhost:4810. No npm dependencies. Node ≥ 22.
Env: `MINDGAP_DATA_DIR` (default `learner/`), `MINDGAP_COURSES_DIR` (default `courses/`), `MINDGAP_TUTOR` (`claude` default | `agy`; unknown → exit 1), `MINDGAP_MODEL` (default `opus` for claude, unset for agy). Binaries: `DOCKER_BIN` (default `docker`), `CLAUDE_BIN` (default `claude`), `AGY_BIN` (default `agy`).

## Files
```
server.mjs                 # HTTP server
lib/courses.mjs            # course loader: listCourses, loadCourse, ensureState
prompts/turn-schema.json   # tutor output schema (fixed, see below)
prompts/teacher.md         # system prompt, mode=teach
prompts/practice.md        # system prompt, mode=practice
prompts/prober.md          # system prompt, mode=probe
prompts/chapter.md         # system prompt, mode=chapter
prompts/course.md          # system prompt, mode=course
prompts/course-schema.json # course-session output schema (turn schema + goal, assessment, plan, approved)
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
  "evidence": "Placement 2026-10-24: said a switch maps IP→MAC."
} ] }
```

## Tutor turn (adapter output, `structured_output`) — `prompts/turn-schema.json`
Fields: `say`, `question{kind,prompt,options,wants_confidence}|null`, `sim{scenario}|null`,
`lab{cmd,explain}|null`, `node_updates[{id,status,note}]`, `propositions[{claim,because,node}]`, `lesson_done`.
Sim scenarios: `switch-learning | switch-flood | vlan-broadcast | vlan-trunk`.

## Course session

The schema is per mode: `schemaFor(mode)` in `server.mjs` picks `prompts/course-schema.json` for `course`, else `turn-schema.json`. Details: Task 3.

## How the server calls the tutor (adapters in `lib/tutors/`)
`MINDGAP_TUTOR` picks one adapter: `claude` (default) or `agy`. Each adapter exports `buildCall({systemPrompt, schemaText, message, sessionId, model, schemaFile}) -> {bin, args}` and `parseOutput(stdout) -> {turn, sessionId, error}`. Binaries come from `CLAUDE_BIN` / `AGY_BIN`.
- Every call runs with cwd = a fresh `mindgap-turn-*` temp dir (holds `turn-schema.json`), stdin closed, and the dir is removed afterwards. The tutor gets no tools.
- `claude`: `claude -p --safe-mode --tools "" --model <MINDGAP_MODEL|opus> --output-format json --json-schema <turn-schema.json> --system-prompt "<prompts/<mode>.md>\n\n<courses/<slug>/prompt.md, if present>" [--resume <tutor_session_id>] "<message>"`. Reads `.structured_output`, `.session_id`, `.is_error`.
- `agy`: `agy --output-format json --json-schema <schema> [--model <MINDGAP_MODEL>] [--conversation <tutor_session_id>] -p "<message>"`. agy has no system-prompt flag, so the first turn prepends `SYSTEM INSTRUCTIONS:` plus the prompt to the message. Reads `.structured_output`, `.conversation_id`.
- Timeout 180 s, stdout cap 16 MB. A parse or tutor error is HTTP 502 with the adapter's error, plus `: <first 500 chars of stderr>` when stderr is present. A missing binary is 502 `<tutor> not found on PATH`.
- A lesson is bound to the tutor it started with (`meta.tutor`); a turn under a different `MINDGAP_TUTOR` is 409. Lessons with no `tutor` field count as `claude`.
- `--safe-mode` keeps the user's CLAUDE.md/plugins/hooks out of the tutor. Auth still uses the subscription. Do NOT use `--bare` (it needs an API key).
- First message of a lesson = a JSON block containing: the mode, the target node, its prereqs with their statuses, every other node's id/title/status, and all propositions for those nodes. Later messages = the learner event as JSON.

## HTTP API
Binds 127.0.0.1 only. Unknown or invalid course slugs → 404. A malformed `course.json` → 500 (message logged).
| Method | Path | Body → Response |
|---|---|---|
| GET | `/api/courses` | → `[{slug, title}]` |
| GET | `/api/courses/:slug` | → `{...course.json, chapters: string[], lab}` (`chapters` = `chapters/index.json`, `[]` if absent; `lab` = `{available, reason?, request:{caps, network}, approved}`, `reason` set when Docker is unavailable) |
| GET | `/api/courses/:slug/map` | → state map.json (seeded on first access) |
| GET | `/api/courses/:slug/chapters/:id` | → chapter JSON, 404 if absent |
| POST | `/api/lesson` | `{course, node_id, mode}` → `{lesson_id, turn}` (starts a tutor session, first turn) |
| POST | `/api/turn` | `{course, lesson_id, event}` → `{turn}` |
| POST | `/api/courses/:slug/lab-approval` | `{caps, network}` (must equal the course's `lab.request` exactly) → 204, or 400 on mismatch. Writes `<stateDir>/lab-approval.json`. |
| POST | `/api/lab` | `{course, lesson_id, cmd}` → `{stdout, stderr, code}`. Also appended to the transcript as a `lab` event. The next `/api/turn` should include it. 503 `{error: reason}` when Docker is unavailable; 428 `{error: 'lab needs approval', request}` until the course's request is approved. |
| POST | `/api/chapter` | `{course, node_id}` → `{lesson_id, meta, events[]}`. Reuses the node's latest `chapter`-mode lesson or creates one **without** a tutor call; 404 when `courses/<course>/chapters/<node_id>.json` doesn't exist. `/api/lesson` refuses mode `chapter`. |
| GET | `/api/lesson/:id?course=<slug>` | → `{meta, events[]}` (for reload). Missing or unknown course → 404. |

Lesson meta gains `course`, `tutor` and `tutor_session_id`. Lesson ids are `<node_id>-<timestamp>`.

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
