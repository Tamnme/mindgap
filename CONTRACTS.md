# netbench contracts

Shared formats that every part builds against. Change them here first.

## Run
`node server.mjs` → http://localhost:4810. No npm dependencies. Node ≥ 22.

## Files
```
server.mjs                 # HTTP server (Phase 3)
prompts/turn-schema.json   # tutor output schema (fixed, see below)
prompts/teacher.md         # system prompt, mode=teach   (Phase 1)
prompts/practice.md        # system prompt, mode=practice (Phase 1)
prompts/prober.md          # system prompt, mode=probe   (Phase 1)
public/index.html          # map home (Phase 4)
public/lesson.html         # workbench (Phase 4)
public/app.css, public/map.js, public/lesson.js   (Phase 4)
public/sim/switch-sim.js   # browser simulator, ES module (Phase 5)
labs/setup-netlab.sh       # OrbStack VM (Phase 6)
learner/map.json           # knowledge map (Phase 2 seeds it; server updates it)
learner/propositions.jsonl # one proposition per line, appended by server
learner/sessions/<lesson_id>.jsonl      # transcript, one event per line
learner/sessions/<lesson_id>.meta.json  # {claude_session_id, node_id, mode, started}
```

## learner/map.json
```json
{ "nodes": [ {
  "id": "switch-mac-table",
  "title": "Switch: MAC → port",
  "layer": "L2",                       // one of L1 | L2 | L3 | L4 | overlay | services
  "prereqs": ["frames-mac"],
  "truth": "A switch forwards frames by destination MAC only; it learns MAC→port from each frame's source.",
  "twins": { "aws": "...", "k8s": "...", "proxmox": "..." },
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
claude -p --safe-mode --tools "" --model "$NETBENCH_MODEL" \
  --output-format json --json-schema "<contents of turn-schema.json>" \
  --system-prompt-file prompts/<mode>.md \
  [--resume <claude_session_id>] "<message>"
```
- stdout is a JSON object: use `.structured_output` (the turn), `.session_id`, `.is_error`, `.total_cost_usd`.
- `--safe-mode` keeps the user's CLAUDE.md/plugins/hooks out of the tutor. Auth still uses the subscription. Do NOT use `--bare` (it needs an API key).
- `NETBENCH_MODEL` defaults to `opus`.
- First message of a lesson = a JSON block containing: the mode, the target node, its prereqs with their statuses, every other node's id/title/status, and all propositions for those nodes. Later messages = the learner event as JSON.

## HTTP API
| Method | Path | Body → Response |
|---|---|---|
| GET | `/api/map` | → map.json |
| POST | `/api/lesson` | `{node_id, mode}` → `{lesson_id, turn}` (starts a claude session, first turn) |
| POST | `/api/turn` | `{lesson_id, event}` → `{turn}` |
| POST | `/api/lab` | `{lesson_id, cmd}` → `{stdout, stderr, code}`. Also appended to the transcript as a `lab` event. The next `/api/turn` should include it. |
| GET | `/api/lesson/:id` | → `{meta, events[]}` (for reload) |
| POST | `/api/chapter` | `{node_id}` → `{lesson_id, meta, events[]}`. Reuses the node's latest `chapter`-mode lesson or creates one **without** a tutor call; 404 when `public/chapters/<node_id>.js` doesn't exist. `/api/lesson` refuses mode `chapter`. |

Learner `event` shapes:
- `{type:"answer", choice?:string, text?:string, confidence?:1..5, reasoning?:string}`
- `{type:"lost", text?:string}` · `{type:"ask", text:string}` · `{type:"lab_output", cmd, stdout, stderr, code}`
- Chapter mode: `{type:"checkpoint", id, prompt, options, chosen, key, correct, confidence, reasoning?}` · `{type:"checkpoint", id, skipped:true}` · `{type:"ask", text, section}`

Chapter mode (`prompts/chapter.md`): the first `/api/turn` sends `CONTEXT` (including `chapter_source`, the chapter file) followed by the event. The learner record is written **before** the tutor call, so an answer survives a failed review.

Chapters: `public/chapters/<node_id>.js` exports `{node, number, kicker, title, lede, sections:[{id, title, blocks:[{md}|{checkpoint:{id, prompt, options, key, why}}|{widget:{id, sim, title, hint, takeaway}}|{lab:{explain, cmd}}]}]}`, listed in `public/chapters/index.json`. `test/chapter.test.mjs` checks every listed chapter.

After each turn the server applies `node_updates` to map.json (status + evidence = note) and appends `propositions` (with lesson_id, ts) to propositions.jsonl.

## Lab safety
`/api/lab` runs only: `orb -m netlab -u root bash -lc <cmd>`, with a 30 s timeout and output capped at 64 KB. It never runs on the host shell. The command only executes when the learner clicks Run.
