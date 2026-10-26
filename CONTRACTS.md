# mindgap contracts

Shared formats that every part builds against. Change them here first.

## Run
`node server.mjs` → http://localhost:4810. No npm dependencies. Node ≥ 22.
Env: `MINDGAP_DATA_DIR` (default `learner/`), `MINDGAP_COURSES_DIR` (default `courses/`), `MINDGAP_MODEL` (default `opus`).

## Files
```
server.mjs                 # HTTP server
lib/courses.mjs            # course loader: listCourses, loadCourse, ensureState
prompts/turn-schema.json   # tutor output schema (fixed, see below)
prompts/teacher.md         # system prompt, mode=teach
prompts/practice.md        # system prompt, mode=practice
prompts/prober.md          # system prompt, mode=probe
prompts/chapter.md         # system prompt, mode=chapter
public/                    # UI (still on the pre-course API until the UI task lands)
labs/setup-netlab.sh       # OrbStack VM (Phase 6)
courses/<slug>/course.json           # {slug, title, layers:[{id,name}], lab}
courses/<slug>/map.seed.json         # clean knowledge map, committed; nodes use links
courses/<slug>/prompt.md             # course-specific text appended to every mode prompt (optional)
courses/<slug>/chapters/index.json   # ["<node_id>", ...] chapter ids (optional)
courses/<slug>/chapters/<node_id>.json  # chapter content, see Chapters below
<data>/courses/<slug>/state/map.json              # your map; copied from map.seed.json on first access
<data>/courses/<slug>/state/propositions.jsonl    # one proposition per line, appended by server
<data>/courses/<slug>/state/sessions/<lesson_id>.jsonl      # transcript, one event per line
<data>/courses/<slug>/state/sessions/<lesson_id>.meta.json  # {course, claude_session_id, node_id, mode, started, labs_sent}
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
  "lab": "One-line lab idea for OrbStack",
  "sim": "switch-learning",           // scenario name or null
  "sources": ["https://..."],
  "status": "gap",                     // untested | gap | shaky | solid
  "evidence": "Placement 2026-10-24: said a switch maps IP→MAC."
} ] }
```

## Tutor turn (claude -p output) — `prompts/turn-schema.json`
Fields: `say`, `question{kind,prompt,options,wants_confidence}|null`, `sim{scenario}|null`,
`lab{cmd,explain}|null`, `node_updates[{id,status,note}]`, `propositions[{claim,because,node}]`, `lesson_done`.
Sim scenarios: `switch-learning | switch-flood | vlan-broadcast | vlan-trunk`.

## How the server calls the tutor (verified 2026-10-25, claude 2.1.296)
```
claude -p --safe-mode --tools "" --model "$MINDGAP_MODEL" \
  --output-format json --json-schema "<contents of turn-schema.json>" \
  --system-prompt "<prompts/<mode>.md>" + "\n\n" + "<courses/<slug>/prompt.md, if present>" \
  [--resume <claude_session_id>] "<message>"
```
- stdout is a JSON object: use `.structured_output` (the turn), `.session_id`, `.is_error`, `.total_cost_usd`.
- `--safe-mode` keeps the user's CLAUDE.md/plugins/hooks out of the tutor. Auth still uses the subscription. Do NOT use `--bare` (it needs an API key).
- First message of a lesson = a JSON block containing: the mode, the target node, its prereqs with their statuses, every other node's id/title/status, and all propositions for those nodes. Later messages = the learner event as JSON.

## HTTP API
Binds 127.0.0.1 only. Unknown or invalid course slugs → 404. A malformed `course.json` → 500 (message logged).
| Method | Path | Body → Response |
|---|---|---|
| GET | `/api/courses` | → `[{slug, title}]` |
| GET | `/api/courses/:slug` | → `{...course.json, chapters: string[]}` (`chapters` = `chapters/index.json`, `[]` if absent) |
| GET | `/api/courses/:slug/map` | → state map.json (seeded on first access) |
| GET | `/api/courses/:slug/chapters/:id` | → chapter JSON, 404 if absent |
| POST | `/api/lesson` | `{course, node_id, mode}` → `{lesson_id, turn}` (starts a claude session, first turn) |
| POST | `/api/turn` | `{course, lesson_id, event}` → `{turn}` |
| POST | `/api/lab` | `{course, lesson_id, cmd}` → `{stdout, stderr, code}`. Also appended to the transcript as a `lab` event. The next `/api/turn` should include it. |
| POST | `/api/chapter` | `{course, node_id}` → `{lesson_id, meta, events[]}`. Reuses the node's latest `chapter`-mode lesson or creates one **without** a tutor call; 404 when `courses/<course>/chapters/<node_id>.json` doesn't exist. `/api/lesson` refuses mode `chapter`. |
| GET | `/api/lesson/:id?course=<slug>` | → `{meta, events[]}` (for reload). Missing or unknown course → 404. |

Lesson meta gains `course`. Lesson ids are `<node_id>-<timestamp>`.

Learner `event` shapes:
- `{type:"answer", choice?:string, text?:string, confidence?:1..5, reasoning?:string}`
- `{type:"lost", text?:string}` · `{type:"ask", text:string}` · `{type:"lab_output", cmd, stdout, stderr, code}`
- Chapter mode: `{type:"checkpoint", id, prompt, options, chosen, key, correct, confidence, reasoning?}` · `{type:"checkpoint", id, skipped:true}` · `{type:"ask", text, section}`

Chapter mode (`prompts/chapter.md`): the first `/api/turn` sends `CONTEXT` (including `chapter_source`, the chapter JSON text) followed by the event. The learner record is written **before** the tutor call, so an answer survives a failed review.

Chapters: `courses/<slug>/chapters/<node_id>.json`, listed in `courses/<slug>/chapters/index.json`. The server reads chapters only from the course folder. The chapter shape is `{node, number, kicker, title, lede, sections:[{id, title, blocks:[{md}|{checkpoint:{id, prompt, options, key, why}}|{widget:{id, kind?, title, hint, takeaway, ...config}}|{lab:{explain, cmd}}]}]}`. Widget kinds and their config are documented in `public/widgets/README.md`.

After each turn the server applies `node_updates` to the course's state/map.json (status + evidence = note) and appends `propositions` (with lesson_id, ts) to its propositions.jsonl.

## Lab safety
`/api/lab` runs only: `orb -m netlab -u root bash -lc <cmd>`, with a 30 s timeout and output capped at 64 KB. It never runs on the host shell. The command only executes when the learner clicks Run.
