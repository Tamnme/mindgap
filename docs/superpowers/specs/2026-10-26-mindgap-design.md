# mindgap: design

Date: 2026-10-26. Status: draft for approval.

## Intent

The repo (published as `Tamnme/underlay`, local folder `netbench`) is a local networking tutor: a knowledge map, predict-first chapters, labs in an OrbStack VM, and a Claude tutor driven through `claude -p`. It works for one learner on one Mac and one subject.

It becomes **mindgap**: a local learning tool for **any subject**. Its learner can add their own course by asking their AI to generate it from a topic and their own sources. It runs on **the AI CLI subscription they already pay for** (Claude Code, Codex or agy). Labs run in **Docker**, on any OS.

Why "mindgap": the name has to read as a learning tool to a stranger ("underlay" read as network jargon), and the tool's core move is finding the gaps in what you know.

### What sets it apart

The upstream project, [learnharness](https://github.com/amosblomqvist/learnharness) (AGPL-3.0), already teaches any subject with any API provider. mindgap does not compete on that. Its identity is three things learnharness does not do:

1. **Courses**: a lasting map of a whole subject plus written chapters, not one-off lessons.
2. **Labs**: real commands in a real sandbox, predicted first and then run.
3. **CLI subscription**: no API keys; the learner's existing Claude Code / Codex / agy login does the work.

## Goals

- Anyone can generate a course on any subject from a topic plus optional sources (URLs first; other files via `markitdown`).
- Course creation mimics learnharness's **probe → plan**: make the goal concrete, bracket each dependency strand, conclude with an assessment, propose a plan, get the learner's approval in chat.
- The tutor runs on Claude Code, agy or Codex, picked by one setting.
- The app runs on macOS and Linux; on Windows it runs inside WSL2 (decided: native Windows is out of scope). Labs run wherever Docker runs. Courses without labs work without Docker.
- The networking course keeps working and becomes the reference course.

## Non-goals

- learnharness's knowledge graph, API-key providers, desktop app, cost meter, dictation.
- Multiple learners or accounts per install.
- A separate command-line course builder (course creation lives in the web UI).
- Embeddings, vector search or any retrieval index.
- npm dependencies.

## Anti-goals (failure even if it works)

- The tutor gets file, shell or network tools during lessons. Sources and courses are untrusted input; a source must never be able to steer the tutor into acting on the learner's machine.
- AI-generated code runs with access to the mindgap page, the server or the host.
- A lab container gets privileges the learner never saw and approved.
- Generating a course writes every chapter up front (slow, costly, and wasted on topics the learner already holds).
- The learner's own progress or placement answers ship in the repo.

## Constraints

- Node 22+, zero npm dependencies (current rule, kept).
- Server binds `127.0.0.1` only (current).
- AGPL-3.0, crediting learnharness (current).
- One learner per data folder.
- No backwards compatibility after the one-time move of the existing learner's data (learnharness's rule, adopted).

## Decisions

### Build order (slices)

Each slice ships on its own and leaves the app working.

| Slice | What | Changes behaviour? |
|---|---|---|
| a | Rename to mindgap | No |
| b | Separate engine from content; networking moves to `courses/networking/` | No |
| c | Tutor setting: Claude and agy; Codex only if it passes the gate (see below) | No (Claude stays default) |
| d | Docker labs replace OrbStack | Lab runner only |
| e | Probe → plan for the networking course | Yes |
| f | Generate a course from a topic and sources | Yes (new) |
| g | AI-built interactive widgets for generated courses | Yes (new) |

Slices b to d restructure working code, so the existing test suite (91 tests) guards them. e to g are the new product.

### a. Rename

`underlay` → `mindgap` everywhere it appears today: UI titles, prompts, CONTRACTS, server banner, tests, README, setup script. Env vars become `MINDGAP_MODEL`, `MINDGAP_DATA_DIR`. The GitHub repo is renamed to `mindgap` (the learner did the last rename; this one can be done with `gh repo rename`). The README leads with "a learning tool for any subject" and the three differentiators, with networking as the shipped course.

### b. Courses: layout and format

A course is a folder. Shipped courses live in `courses/<slug>/` (committed). Generated courses live in `<data>/courses/<slug>/` (gitignored). Same format in both places:

```
course.json        # slug, title, goal, background (optional), layers (ordered ids + display names), lab spec or null
map.seed.json      # shipped courses: the clean map. Generated courses: written by the plan step.
chapters/<node>.json
sources/           # imported, converted sources (see f)
prompt.md          # course-specific tutor section (replaces today's "Networking workbench")
widgets/           # shipped courses: trusted widget JS. Generated courses: sealed HTML (see g)
```

Learner state per course lives in `<data>/courses/<slug>/state/`: `map.json`, `propositions.jsonl`, `sessions/`. The first-run copy from `map.seed.json` (already implemented) moves to per-course.

- **Chapters become JSON**, same shape as today's chapter objects, validated against a schema on save. The 33 networking chapters convert mechanically. Rationale: generated chapters must not be code the browser executes.
- **Layers become per-course data.** Today `public/map.js` hardcodes `LAYERS` and `LAYER_NAMES`; these move into `course.json`.
- **Twins generalise.** `twins: {aws, k8s, proxmox}` becomes an optional `links` list ("connect to what you already know"). *Designer's call:* the networking course keeps its AWS/K8s/Proxmox links in the committed seed as course content (they describe the cloud counterparts, not any learner). A learner's background only changes which links the tutor leads with; it is stored in that course's state, not the seed. Generated courses fill `links` at plan time from the background, if one was given.
- **Prompts split.** The shared method (teacher, practice, prober, chapter reviewer) stays in `prompts/` and becomes subject-neutral. The networking-specific "Networking workbench" section moves to `courses/networking/prompt.md`. **It currently contains the original learner's placement results** ("Their placement showed real strengths ... and specific wrong models ...") in teacher.md, practice.md and prober.md; the moved version drops those, since placement belongs in the learner's map, not in a shipped prompt.
- **One learner, many courses.** The home page lists courses; the map page shows one course.
- **The existing learner's data** (`learner/map.json`, `learner/propositions.jsonl`, `learner/sessions/`) is moved once into `learner/courses/networking/state/`. No code reads the old layout afterwards.

### c. Tutor backends

One global setting: `MINDGAP_TUTOR=claude|agy|codex` (default `claude`), plus `MINDGAP_MODEL` passed through to the chosen CLI (default: the CLI's own default, except `opus` for Claude as today).

Each turn needs four things from the CLI: non-interactive, JSON matching `prompts/turn-schema.json`, resume the same conversation next turn, no tools. Verified state:

| | Claude Code 2.1.296 | agy 1.4.6 | Codex 0.159.3 |
|---|---|---|---|
| Schema output | `--json-schema` → `.structured_output` (verified, in use) | `--json-schema` + `--output-format json` → `.structured_output` (verified) | `--output-schema <file>` (in help; **untested**) |
| Session id / resume | `.session_id`, `--resume` (verified) | `.conversation_id`, `--conversation <id>` (verified) | `thread_id` in `--json` events, `exec resume <id>` (in help; **untested**) |
| No tools | `--tools ""` (verified) | shell auto-denied headless (verified); a denied tool call yields **no** `structured_output` | `--sandbox read-only` blocks writes (**untested**); reads still possible |
| System prompt | `--system-prompt-file` | **no flag**: send in first message | **no flag**: send in first message |
| Gotchas | `--safe-mode` keeps user config out | `-p` must be last as `-p "<msg>"` or it swallows the next flag | hangs unless stdin is closed (`< /dev/null`) |

Design consequences:

- A backend is a small adapter: build argv for first turn and resume, parse stdout into `{turn, session_id, is_error, cost?}`. One adapter per CLI, one file.
- Tutor processes run with **cwd set to an empty per-turn temp folder** so any file-read capability sees nothing of value.
- A turn with no `structured_output` is a failed turn (the server already handles `is_error` this way).
- **Every backend passes a gate test before it ships** (*designer's call*, following the "no tools" anti-goal): schema answer, resume, and refusal of (1) a shell write, (2) reading a file **outside** the temp cwd by absolute path, and (3) a web fetch. A backend that can read outside its cwd or reach the web is not shipped, because a poisoned source could make it quote a secret into `say` or leak one through a URL. Current status: Claude passes (no tools at all); agy refuses shell and file reads (verified) but the web-fetch probe timed out after 2 min with no answer (inconclusive, needs a rerun); Codex is untested, and its `--sandbox read-only` mode is documented to allow reads, so it is expected to fail check (2) unless a config option disables its shell tool. **Decided:** if Codex fails any check, slice c ships Claude and agy only, and Codex is added later once a config option blocks its file reads. The Codex test could not run from the agent sandbox (no network); the learner runs it.
- Tests: one fake binary per backend in `test/`, mirroring today's fake `claude`.

### d. Labs in Docker

- `course.json` declares `lab: { image | base+packages, caps: [], network: false }` or `null`.
- One long-lived container per course, named `mindgap-<slug>`, created on first lab run, reused after. Commands run via `docker exec <container> bash -lc <cmd>` with today's limits (30 s timeout, 64 KB output, runs only on the learner's click).
- **Defaults: no network, no added capabilities, not privileged.** A course needing more declares it. Verified on Docker 29.8.2 (OrbStack): with `--network none --cap-add NET_ADMIN`, bridges, VLAN sub-interfaces and VXLAN work, but `ip netns add` fails (`mount --make-shared /run/netns failed`); adding `SYS_ADMIN` makes namespaces work. So networking declares `NET_ADMIN` + `SYS_ADMIN`; **decided:** acceptable, because the container has no network and the learner sees and confirms both before the first lab runs; the first time, mindgap shows exactly what is requested and asks the learner to confirm. The confirmation is stored per course.
- Shipped courses may ship a Dockerfile (trusted). Generated courses only pick a base image plus a package list; mindgap builds the image. No free-form Dockerfile from the AI.
- No Docker installed, or a course with `lab: null`: lab blocks are hidden; everything else works.
- **Done means (decided):** a script runs every networking chapter's lab commands, in chapter order, in one fresh course container on macOS (Docker via OrbStack), and every command exits as the chapter expects. Linux and Windows (WSL2) are documented as "should work, untested".
- OrbStack and `labs/setup-netlab.sh` are removed. On macOS, OrbStack still works as a Docker provider.

### e. Probe → plan (networking course)

Mimics learnharness (`docs/probe-teach-split.md`, prober `10-probe-doctrine.md`, teacher `10-planning.md`):

1. **Goal concrete.** The prober asks until the goal is specific. Background is asked, optional.
2. **Strands.** From the goal, the dependency strands the lesson rests on.
3. **Bracket each strand.** Floor and ceiling via graded questions with confidence and reasoning; enter near the top; dig into misconceptions.
4. **Assessment.** The prober concludes exactly once (refused while a question is open) with one entry per strand: floor, ceiling, misconceptions, build-from.
5. **Plan.** The teacher proposes the map: the minimal tree from what the learner holds to the goal, unconditional truths at the roots, roots stress-tested. Presented as a few sentences of approach plus the map. The turn ends.
6. **Approval in chat.** The learner replies; the teacher revises and re-presents until the learner says go. No approve button. *Designer's call on trust:* the tutor signals approval with a turn field, but the server only accepts it when the previous tutor turn presented a plan and the learner's message is the reply to it; the server also validates the plan against the map schema before writing. Approval never grants lab privileges: those always go through the separate confirmation in (d).
7. **The map keeps moving** during teaching when evidence contradicts it.

For a **shipped** course with a seed map, step 5 trims the seed map to the goal (and marks what the learner already holds `solid`) instead of drawing a new one. The existing `prober.md` already follows steps 2 to 3; the additions are goal-setting, the one-shot assessment, and the plan/approval turn.

*Designer's calls:*
- **"Trim" never deletes.** Off-goal nodes get `in_scope: false` in the learner's `state/map.json` and are hidden on the map; a later goal can bring them back. Existing statuses and evidence notes survive; the probe only overwrites a node's status when it produced fresh evidence for that node. The original learner's evidence is never lost.
- **A course-level session type.** Probe → plan is a new session kind (`course` scope: no `node_id`, its own context block with the whole map, sources TOC and background). It runs when a course is created and whenever the learner clicks **New goal**. It replaces the map page's **Placement check** button. The per-node **Quick check** stays, using the node-level prober as today.

### f. Generate a course

From a **New course** form in the web UI: topic, optional background, optional sources (URLs, or uploaded files).

- **Sources are imported by the server, not the tutor.** URLs are fetched by the server and converted with `markitdown`; uploaded PDF/DOCX/etc. go through `markitdown` too. The tutor sees only the converted text and never gets tools. (agy refuses shell commands headless, so asking the tutor to run `markitdown` would not work across backends anyway.)
- `markitdown` is needed only for sources. If missing, adding a source shows `pip install 'markitdown[all]'`. A course with no sources needs nothing extra.
- **Fitting sources into prompts:** each converted source is split into sections by heading, each with an id. The probe sees a table of contents plus the sections relevant to its current question. The plan step tags each map node with the section ids it rests on. Chapter and lesson turns include only the tagged sections, up to a size cap.
- Then the probe → plan flow (e) runs and **draws** the map (no seed). The approved plan is written as `map.seed.json` + `course.json`.
- **Chapters are written on demand**: the first time the learner opens a topic, the tutor writes that chapter (JSON, schema-validated, same shape as shipped chapters), citing source sections. Checkpoints follow `docs/CHAPTER_GUIDE.md` (2 to 4 per chapter, distractors drawn from real misconceptions, placed before the text that answers them).
- If the course has labs, the plan step picks the lab spec (base image + packages).

### g. Interactive widgets (generated courses)

Wanted, never required; ships last.

- **Built-in widgets stay** (`sim`, `subnet`, `routes`, `timeline`, `mtu`): trusted JS shipped with the networking course, loaded as today.
- **Generated widgets** follow learnharness's demo builder: when writing a chapter, the tutor may add one or two widget briefs. A separate builder call turns each brief into one self-contained HTML document (all JS inline), stored in the course's `widgets/`.
- They render in an iframe with `sandbox="allow-scripts"` (opaque origin: no access to the page, cookies or storage) and a CSP allowing only inline code, no network.
- No headless browser is available (no npm deps), so instead of testing before delivery, the iframe reports script errors to the page via `postMessage`. A broken widget is replaced by "This demo failed to load" plus the brief as text, and the error is logged for a rebuild. The chapter works without it.

## Verified facts this design rests on

- `markitdown` installed at `~/.local/bin/markitdown`; converts a file or stdin to Markdown.
- Docker 29.8.2 is available on the dev machine through the OrbStack context, so slice d can be tested here.
- agy 1.4.6: schema output and resume verified; headless shell and `read_file` denial verified (and it then returns no `structured_output`); web fetch inconclusive (2 min timeout, no answer).
- Docker labs: `NET_ADMIN` covers bridge/VLAN/VXLAN; `ip netns` additionally needs `SYS_ADMIN` (tested with `--network none`).
- Claude Code 2.1.296: current server invocation verified end to end from a fresh clone (placement turn in 19 s).
- Codex 0.159.3: flags present in `--help`; behaviour **untested** (network blocked in the agent sandbox).
- learnharness probe/plan design read from its repo (files above); demos are single-file HTML in `sandbox="allow-scripts"` iframes, tested headlessly before delivery.
- Current coupling points: `public/map.js` (`LAYERS`, `LAYER_NAMES`), `server.mjs` (`orb -m netlab`, chapter loading from `public/chapters/`), prompts' "Networking workbench" sections (teacher.md:255, practice.md:251, prober.md:147).

## Left to the builder

- Exact JSON schemas for `course.json`, chapters and the assessment, within the shapes above.
- Adapter interface details and file names.
- Size cap for source excerpts per turn, and how "relevant to the current question" is picked during the probe (heading match is fine).
- UI layout of the course list and New course form, following the existing `app.css` style.
- How the per-course lab confirmation is shown and stored.
- Test strategy per slice, keeping the existing self-check style (`node --test`, fake binaries, no frameworks).
