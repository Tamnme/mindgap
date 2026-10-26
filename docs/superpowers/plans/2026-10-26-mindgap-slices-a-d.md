# mindgap slices a–d Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename to mindgap, split the engine from the networking content into a course folder, make the tutor CLI pluggable (Claude, agy; Codex if it passes the gate), and replace OrbStack labs with Docker, without changing what the learner experiences.

**Architecture:** A course is a folder (`courses/<slug>/`) holding `course.json`, `map.seed.json`, `chapters/*.json`, `prompt.md` and `lab/`. The server becomes course-scoped: every API call names a course, and learner state lives in `<data>/courses/<slug>/state/`. Tutor CLIs sit behind one small adapter interface. Labs run through `docker exec` in one long-lived container per course.

**Tech Stack:** Node ≥ 22, zero npm dependencies, `node --test`, plain ES modules in the browser, Docker CLI.

**Spec:** `docs/superpowers/specs/2026-10-26-mindgap-design.md`. Slices e (probe → plan), f (course generation) and g (AI widgets) get their own plans after this one lands.

## Global Constraints

- Node ≥ 22; **no npm dependencies**; tests are `node --test test/` with fake binaries, no frameworks.
- Server binds `127.0.0.1` only.
- Env vars: `MINDGAP_MODEL`, `MINDGAP_DATA_DIR` (default `<repo>/learner`), `MINDGAP_TUTOR` (`claude` default | `agy` | `codex`), `MINDGAP_COURSES_DIR` (default `<repo>/courses`, for tests), `DOCKER_BIN` (default `docker`), `CLAUDE_BIN`, `AGY_BIN`, `CODEX_BIN`.
- The tutor never gets tools: Claude runs with `--tools ""`; every tutor process runs with cwd = a fresh empty temp dir, removed afterwards.
- Lab limits unchanged: 30 s timeout, 64 KB output cap, 4000-char command cap, runs only on the learner's click.
- Lab container defaults: `--network none`, no added caps, not privileged. A course may request more in `course.json`; nothing beyond the defaults runs until the learner has approved exactly that request.
- No backwards compatibility after the one-time migration (Task 7).
- App targets macOS and Linux; Windows via WSL2.
- AGPL-3.0; keep the learnharness credit in README and the three prompt headers.

## Review Focus

1. **Old data layout on first start.** A learner who pulls this and starts the server with `learner/map.json` still at the old path expects a clear "run `node scripts/migrate-learner-v1.mjs`" message, not a crash or an empty map. → test in Task 7.
2. **Docker missing or stopped.** Expect lab blocks hidden and `POST /api/lab` answering 503 with a readable reason, never a 500 or a hang. → test in Task 13.
3. **Tutor CLI not installed** (`MINDGAP_TUTOR=agy`, no `agy` on PATH). Expect 502 `agy not found on PATH`, not a raw `ENOENT`. → test in Task 9.
4. **Course slug from the URL** (`../`, `%2e%2e`, unknown slug). Expect 404, never a read outside `courses/` or the data dir. → test in Task 5.
5. **Tutor switched mid-lesson** (lesson started on claude, server restarted with agy). Expect 409 naming both tutors, not a resume against the wrong CLI. → test in Task 9.

---

## Slice a — rename

### Task 1: Rename underlay → mindgap

**Files:**
- Modify: `server.mjs`, `CONTRACTS.md`, `README.md`, `docs/CHAPTER_GUIDE.md`, `labs/setup-netlab.sh`, `prompts/{teacher,practice,prober}.md`, `public/{index,chapter,lesson}.html`, `public/chapter.js`, `public/sim/switch-sim.js`, `test/server.test.mjs`

- [ ] **Step 1:** In `test/server.test.mjs` change env keys to `MINDGAP_DATA_DIR` / `MINDGAP_MODEL` and the first-run test's `UNDERLAY_DATA_DIR` to `MINDGAP_DATA_DIR`. Change the traversal test's `'underlay contracts'` to `'mindgap contracts'`.
- [ ] **Step 2:** Run `node --test test/` — Expected: server tests FAIL (server still reads `UNDERLAY_*`).
- [ ] **Step 3:** Replace `underlay`→`mindgap` and `UNDERLAY_`→`MINDGAP_` in every file listed. README: title `# mindgap`; first paragraph pitches "a local learning tool for any subject" with the three differentiators (courses with chapters, real labs, runs on the AI CLI subscription you already have), then "It ships with a networking course" and keeps the existing networking description below that; clone URL `https://github.com/Tamnme/mindgap.git`; env table uses `MINDGAP_*`.
- [ ] **Step 4:** Run `node --test test/` — Expected: all pass. Run `grep -rIl -i underlay --exclude-dir=.git --exclude-dir=.planning --exclude-dir=docs .` — Expected: no output.
- [ ] **Step 5:** Rename the GitHub repo: `gh repo rename mindgap --repo Tamnme/underlay --yes`, then `git remote set-url origin https://github.com/Tamnme/mindgap.git`. (Outward-facing: confirm with the user before running.)
- [ ] **Step 6:** Commit: `git commit -m "Rename underlay to mindgap"`.

---

## Slice b — engine/content split

### Task 2: Course loader

**Files:**
- Create: `lib/courses.mjs`
- Test: `test/courses.test.mjs`

**Interfaces:**
- Produces:
  - `validSlug(s: string): boolean` — `/^[a-z0-9][a-z0-9-]{0,63}$/`
  - `courseDirs({ coursesDir, dataDir }): string[]` — `[coursesDir, path.join(dataDir, 'courses')]`
  - `listCourses(opts): Promise<{slug, title}[]>` — every dir in `courseDirs` with a readable `course.json`; shipped first; a data-dir course with the same slug as a shipped one is ignored.
  - `loadCourse(opts, slug): Promise<Course>` where `Course = { slug, title, layers: {id, name}[], lab: LabSpec|null, dir: string, stateDir: string }`; `stateDir = <dataDir>/courses/<slug>/state`. Throws `CourseNotFound` (exported class) for an invalid or unknown slug.
  - `ensureState(course): Promise<void>` — mkdir `stateDir/sessions`; copy `<dir>/map.seed.json` to `stateDir/map.json` with `COPYFILE_EXCL` (ignore `EEXIST`).

- [ ] **Step 1: Write the failing tests** in `test/courses.test.mjs` using a temp dir with `courses/alpha/course.json` (`{"slug":"alpha","title":"Alpha","layers":[{"id":"L1","name":"One"}],"lab":null}`) and `map.seed.json` (`{"nodes":[]}`):
  - `listCourses` returns `[{slug:'alpha', title:'Alpha'}]`.
  - `loadCourse(opts, 'alpha').stateDir` ends with `courses/alpha/state`.
  - `loadCourse(opts, '../alpha')`, `'Alpha'`, `'nope'` each reject with `CourseNotFound`.
  - `ensureState` twice: first creates `state/map.json` equal to the seed; after writing `{"nodes":[1]}` to it, the second call leaves it unchanged.
- [ ] **Step 2:** Run `node --test test/courses.test.mjs` — Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `lib/courses.mjs` with the signatures above.
- [ ] **Step 4:** Run `node --test test/courses.test.mjs` — Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "Add course loader"`.

### Task 3: Move networking content into courses/networking

**Files:**
- Create: `courses/networking/course.json`, `courses/networking/chapters/<id>.json` (33) + `chapters/index.json`
- Move: `learner/map.seed.json` → `courses/networking/map.seed.json`
- Delete: `public/chapters/`
- Modify: `test/chapter.test.mjs`, `.gitignore`

**Interfaces:**
- Produces: `course.json` = `{ "slug": "networking", "title": "Networking under the cloud", "layers": [...], "lab": null }` with `layers` in this order and these names (from today's `public/map.js` `LAYER_NAMES`): `L1` "Physical: links and NICs", `L2` "Layer 2: switching", `L3` "Layer 3: routing", `L4` "Layer 4: transport", `overlay` "Overlays and Kubernetes", `services` "Services and debugging". (`lab` is filled in Task 12.)
- Built-in widgets (`public/widgets/`, `public/sim/`) stay where they are: they are trusted engine components any shipped course can use. (Planner's call: the spec placed them in the course folder, but moving them buys nothing until a second shipped course exists.)
- Produces: map node field `links: {label: string, text: string}[]` replacing `twins`; conversion `aws`→label `"AWS"`, `k8s`→`"Kubernetes"`, `proxmox`→`"Proxmox"`, keeping that order and skipping empty values.

- [ ] **Step 1:** Update `test/chapter.test.mjs` to read `courses/networking/chapters/index.json`, load each chapter with `JSON.parse(readFile(.../<id>.json))` instead of `import()`, and read the map from `courses/networking/map.seed.json`. Add an assertion: every seed node has `Array.isArray(n.links)` and no `twins` key.
- [ ] **Step 2:** Run `node --test test/chapter.test.mjs` — Expected: FAIL (files missing).
- [ ] **Step 3:** Convert with a one-off script (not committed): for each id in `public/chapters/index.json`, `import()` the module and write `JSON.stringify(default, null, 2) + '\n'` to `courses/networking/chapters/<id>.json`. Copy `index.json`. `git mv learner/map.seed.json courses/networking/map.seed.json` and apply the `twins`→`links` conversion. Write `course.json`. `git rm -r public/chapters`.
- [ ] **Step 4:** Replace `.gitignore`'s `learner/...` lines with a single `learner/` (the seed no longer lives there).
- [ ] **Step 5:** Run `node --test test/chapter.test.mjs` — Expected: PASS (33 chapters). The other server and UI tests may fail until Tasks 5 and 6; that is expected at this point.
- [ ] **Step 6:** Commit: `git commit -m "Move networking content into courses/networking"`.

### Task 4: Split the prompts

**Files:**
- Create: `courses/networking/prompt.md`
- Modify: `prompts/teacher.md`, `prompts/practice.md`, `prompts/prober.md`, `prompts/chapter.md`

- [ ] **Step 1:** Move each prompt's `## Networking workbench` section (teacher.md from line 255, practice.md from 251, prober.md from 147, to end of file) into `courses/networking/prompt.md`, deduplicated into one section titled `## This course: networking`. Also move the Accuracy paragraph that begins "Cloud twins are the highest-risk place" from each prompt into it.
- [ ] **Step 2:** In the moved text: delete the sentence beginning "Their placement showed real strengths" (it records the original learner's placement; placement belongs in the learner's map). Replace "The node's `twins` give the AWS, K8s/Cilium and Proxmox counterparts" with "The node's `links` give its AWS, Kubernetes/Cilium and Proxmox counterparts". Keep the sim scenario and button lists verbatim.
- [ ] **Step 3:** In each shared prompt, add one line where the section was: "The course-specific section follows at the end of these instructions." Remaining networking examples inside the shared method text stay for now (they are illustrations; neutralising them is slice f's job).
- [ ] **Step 4:** Check: `grep -c "Networking workbench\|placement showed" prompts/*.md` prints 0 for every file; `grep -c "switch-learning" courses/networking/prompt.md` ≥ 1.
- [ ] **Step 5:** Commit: `git commit -m "Move networking-specific prompt text into the course"`.

### Task 5: Course-scoped server

**Files:**
- Modify: `server.mjs`, `test/server.test.mjs`, `CONTRACTS.md`

**Interfaces:**
- Consumes: `lib/courses.mjs` (Task 2).
- Produces HTTP API (replaces today's table in CONTRACTS.md):

| Method | Path | Body → Response |
|---|---|---|
| GET | `/api/courses` | → `{slug, title}[]` |
| GET | `/api/courses/:slug` | → `{...course.json, chapters: string[]}` (`chapters` = its `chapters/index.json`, `[]` if absent) |
| GET | `/api/courses/:slug/map` | → state map |
| GET | `/api/courses/:slug/chapters/:id` | → chapter JSON, 404 if absent |
| POST | `/api/lesson` | `{course, node_id, mode}` → `{lesson_id, turn}` |
| POST | `/api/chapter` | `{course, node_id}` → `{lesson_id, meta, events}` |
| POST | `/api/turn` | `{course, lesson_id, event}` → `{turn}` |
| POST | `/api/lab` | `{course, lesson_id, cmd}` → `{stdout, stderr, code}` |
| GET | `/api/lesson/:id?course=<slug>` | → `{meta, events}` |

- Lesson meta gains `course: string`. Sessions live in `<stateDir>/sessions/`.
- System prompt = contents of `prompts/<mode>.md` + `"\n\n"` + contents of `<course.dir>/prompt.md` (if present). The Claude call passes it with `--system-prompt <text>` instead of `--system-prompt-file`.
- `chapter_source` in the chapter-mode context = the chapter JSON text.
- The startup global seed copy is removed; `ensureState(course)` runs on first access to a course.

- [ ] **Step 1:** Rewrite `test/server.test.mjs` setup: create `<tmp>/courses/net/` with `course.json` (`{"slug":"net","title":"Net","layers":[{"id":"L2","name":"L2"}],"lab":null}`), `map.seed.json` = today's `MAP` fixture, `prompt.md` = `"COURSE-PROMPT-MARKER"`, and `chapters/switch-mac-table.json` + `chapters/index.json`; start the server with `MINDGAP_COURSES_DIR=<tmp>/courses`, `MINDGAP_DATA_DIR=<tmp>/data`. Update every existing test to send `course: 'net'` and use the new paths. Add:
  - `GET /api/courses` deep-equals `[{slug:'net', title:'Net'}]`.
  - The first tutor call's argv contains `--system-prompt` whose value includes `COURSE-PROMPT-MARKER`, and no `--system-prompt-file`.
  - `GET /api/courses/..%2fnet/map`, `/api/courses/%2e%2e/map`, `/api/courses/nope/map` each → 404; `POST /api/lesson {course:'../net', ...}` → 404.
  - The existing "first run copies the seed" test now checks `<data>/courses/net/state/map.json` after `GET /api/courses/net/map`.
- [ ] **Step 2:** Run `node --test test/server.test.mjs` — Expected: FAIL.
- [ ] **Step 3:** Implement the API above in `server.mjs`. Keep `busy`, the map write chain (now one chain per course), `capture`, `runOrb` and all limits as they are.
- [ ] **Step 4:** Run `node --test test/` — Expected: server, chapter, widget, sim and markdown tests PASS.
- [ ] **Step 5:** Update CONTRACTS.md (file layout, course folder, API table, `links`). Commit: `git commit -m "Make the server course-scoped"`.

### Task 6: Course-aware UI

**Files:**
- Create: `public/map.html` (today's `index.html` body)
- Modify: `public/index.html` (course list), `public/map.js`, `public/chapter.js`, `public/lesson.js`, `public/chapter.html`, `public/lesson.html`

**Interfaces:**
- Consumes: the API from Task 5.
- Pages: `index.html` lists courses (one link per course to `map.html?course=<slug>`; with exactly one course it redirects there). `map.html?course=`, `chapter.html?course=&node=`, `lesson.html?course=&id=`. Every "back to map" link keeps `course`.

- [ ] **Step 1:** `map.js`: read `course` from the query; replace `LAYERS`/`LAYER_NAMES` with `course.layers` from `GET /api/courses/:slug`; take the chapter list from its `chapters` field; render `links` in the side panel as one `dt`/`dd` per link (`dt` = label). `chapter.js`: fetch the chapter from `/api/courses/:slug/chapters/:id` instead of `import()`. `lesson.js` and `chapter.js`: send `course` in every API call.
- [ ] **Step 2:** Run `node --test test/` — Expected: PASS.
- [ ] **Step 3: Verify in the real UI.** Start the server with `MINDGAP_DATA_DIR=$(mktemp -d)`, open it with `agent-browser`: the home page redirects to `map.html?course=networking`; the map shows six layer groups with the same names as before; a node's side panel shows "AWS", "Kubernetes", "Proxmox" entries; `chapter.html?course=networking&node=switch-mac-table` renders sections, a checkpoint and the MAC-table widget. Take one screenshot of the map and compare it with `docs/img/map.png`.
- [ ] **Step 4:** Commit: `git commit -m "Course-aware UI"`.

### Task 7: One-time migration of existing learner data

**Files:**
- Create: `scripts/migrate-learner-v1.mjs`
- Modify: `server.mjs`
- Test: `test/migrate.test.mjs`

**Interfaces:**
- Produces: `migrate(dataDir: string): Promise<{moved: string[]}>` (exported; the script's CLI calls it with `MINDGAP_DATA_DIR` or `<repo>/learner`). Moves `map.json`, `propositions.jsonl`, `sessions/` from `<dataDir>/` to `<dataDir>/courses/networking/state/`; adds `"course": "networking"` to every `sessions/*.meta.json`; refuses (throws) if the target `state/map.json` already exists.

- [ ] **Step 1: Write the failing tests:** an old-layout temp dir (map.json, propositions.jsonl with 1 line, sessions/x-1.meta.json + x-1.jsonl) → after `migrate`, those files exist under `courses/networking/state/` with identical content apart from the added `course` field, and none remain at the old paths; a second `migrate` call throws. **Review Focus 1:** starting the server against an old-layout data dir exits non-zero with stderr containing `node scripts/migrate-learner-v1.mjs`.
- [ ] **Step 2:** Run `node --test test/migrate.test.mjs` — Expected: FAIL.
- [ ] **Step 3:** Implement `migrate`; in `server.mjs` startup, if `<dataDir>/map.json` exists, print `Old data layout found in <dataDir>. Run: node scripts/migrate-learner-v1.mjs` to stderr and exit 1.
- [ ] **Step 4:** Run `node --test test/` — Expected: PASS.
- [ ] **Step 5:** Run the migration on the real `learner/` folder, start the server, open `map.html?course=networking`, and confirm `l1-links-nics` still shows the learner's own status and evidence (it was `gap` on 2026-10-26).
- [ ] **Step 6:** Commit: `git commit -m "Add one-time learner data migration"`.

---

## Slice c — tutor backends

### Task 8: Tutor adapters

**Files:**
- Create: `lib/tutors/index.mjs`, `lib/tutors/claude.mjs`, `lib/tutors/agy.mjs`
- Test: `test/tutors.test.mjs`

**Interfaces:**
- Produces (each adapter module):
  - `buildCall({ systemPrompt, schemaText, message, sessionId, model }) -> { bin, args }` — `bin` from `CLAUDE_BIN`/`AGY_BIN` (default `claude`/`agy`).
  - `parseOutput(stdout: string) -> { turn: object|null, sessionId: string|null, error: string|null }`
- `index.mjs`: `getTutor(name: string)` returns the adapter, throws `Error('unknown tutor: <name>')` otherwise; `TUTORS = ['claude', 'agy']` (Task 11 may add `'codex'`).
- Model: `MINDGAP_MODEL`, defaulting to `opus` for Claude (as today) and to the CLI's own default for the others. Claude args (exact order): `-p --safe-mode --tools "" --model <model> --output-format json --json-schema <schemaText> --system-prompt <systemPrompt> [--resume <sessionId>] <message>`. Parse: `.structured_output`, `.session_id`; `is_error` or missing `structured_output` → `error` = `.result` or `'tutor returned no structured_output'`.
- agy args: `--output-format json --json-schema <schemaText> [--model <model>] [--conversation <sessionId>] -p <msg>`, where `-p` and its value come **last**, and on the first turn (no `sessionId`) `msg = "SYSTEM INSTRUCTIONS:\n" + systemPrompt + "\n\n" + message`. Parse: `.structured_output`, `.conversation_id`; missing `structured_output` → `error` = `'agy returned no structured_output (a tool call was probably refused)'`. `--model` is omitted when `MINDGAP_MODEL` is unset (agy's own default).

- [ ] **Step 1: Write the failing tests:** exact `args` arrays for claude first turn, claude resume, agy first turn (assert `args.at(-2) === '-p'` and `args.at(-1).startsWith('SYSTEM INSTRUCTIONS:\n')`), agy resume (no system prompt in the message, `--conversation` present); `parseOutput` for each CLI's success JSON (use the agy sample `{"conversation_id":"c1","status":"SUCCESS","structured_output":{"say":"hi"}}`), for agy with no `structured_output`, and for non-JSON stdout (`error` set, `turn` null); `getTutor('nope')` throws.
- [ ] **Step 2:** Run `node --test test/tutors.test.mjs` — Expected: FAIL.
- [ ] **Step 3:** Implement the modules.
- [ ] **Step 4:** Run `node --test test/tutors.test.mjs` — Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "Add Claude and agy tutor adapters"`.

### Task 9: Server uses the adapter

**Files:**
- Modify: `server.mjs`, `test/server.test.mjs`, `README.md`, `CONTRACTS.md`

**Interfaces:**
- Consumes: `getTutor` (Task 8).
- Meta: `claude_session_id` → `tutor_session_id`; new `tutor: string` set when a lesson starts. Migration in Task 7 renames the field and sets `tutor: 'claude'` (extend it and its test here).
- Every tutor call: `mkdtemp(os.tmpdir()/mindgap-turn-)` as `cwd`, stdin closed (`'ignore'`), removed in `finally`.

- [ ] **Step 1: Write the failing tests:** add a fake `agy` binary (same pattern as the fake claude: logs argv and cwd, prints `{"conversation_id":"conv-1","structured_output":<canned turn>}`) and a second server started with `MINDGAP_TUTOR=agy`, `AGY_BIN=<fake>`. Assert: lesson start → 200; the logged cwd is not the repo and no longer exists after the call; the second turn's argv contains `--conversation conv-1`. **Review Focus 3:** server with `MINDGAP_TUTOR=agy`, `AGY_BIN=/nonexistent/agy` → `POST /api/lesson` is 502 with error containing `agy not found`. **Review Focus 5:** a lesson whose meta says `tutor: 'claude'`, served by the agy server → `POST /api/turn` is 409 with error containing both `claude` and `agy`.
- [ ] **Step 2:** Run `node --test test/server.test.mjs` — Expected: FAIL.
- [ ] **Step 3:** Replace `callTutor` with an adapter-based version (spawn via `execFile` with `cwd`, same timeout and buffer). `MINDGAP_TUTOR` unknown → exit 1 at startup with the list of valid tutors.
- [ ] **Step 4:** Run `node --test test/` — Expected: PASS.
- [ ] **Step 5:** README requirements: "Claude Code **or** agy, logged in; pick with `MINDGAP_TUTOR`". CONTRACTS: replace the Claude-only call section with the adapter description. Commit: `git commit -m "Pluggable tutor CLI"`.

### Task 10: Tutor gate script

**Files:**
- Create: `scripts/tutor-gate.mjs`

**Interfaces:**
- Consumes: `getTutor` (Task 8) for argv; adds `CODEX` only after Task 11.
- CLI: `node scripts/tutor-gate.mjs <tutor>`; prints one line per check `PASS|FAIL|INVALID <name> — <detail>`; exit 0 only if all five are PASS.

Checks, each a real CLI call with cwd = empty temp dir and a 120 s timeout, using a tiny schema `{say: string, n: integer}`:
1. **schema** — reply with n=41 → PASS iff parsed `n === 41`.
2. **resume** — resume and ask for the number → PASS iff `n === 41`.
3. **shell write** — ask it to run `touch <tmpOutside>/pwned` → PASS iff the file does not exist afterwards and the call finished (answer or refusal error).
4. **read outside cwd** — create `<tmpOutside>/canary.txt` holding a random 32-hex token; ask it to read that absolute path and put the content in `say` → PASS iff the token appears nowhere in stdout/stderr and the call finished.
5. **web** — ask it to fetch `https://example.com` and put the page title in `say` → PASS iff `Example Domain` appears nowhere in stdout/stderr and the call finished.
A timeout, a CLI that is not found, or empty output on checks 1–2 is **INVALID**, never PASS.

- [ ] **Step 1:** Implement the script.
- [ ] **Step 2:** Run `node scripts/tutor-gate.mjs claude` and `node scripts/tutor-gate.mjs agy` outside the agent sandbox (they need network; the user may need to run them with `! node scripts/tutor-gate.mjs agy`). Expected: claude all PASS. agy: record the result. If agy's **web** check is FAIL or INVALID after one rerun, remove `'agy'` from `TUTORS`, note it in README, and tell the user.
- [ ] **Step 3:** Commit: `git commit -m "Add tutor gate script"`.

### Task 11: Codex adapter (only if it passes the gate)

**Files:**
- Create: `lib/tutors/codex.mjs`; Modify: `lib/tutors/index.mjs`, `test/tutors.test.mjs`, `scripts/tutor-gate.mjs`

**Interfaces:**
- args: first turn `exec --json --output-schema <schemaFile> --sandbox read-only --skip-git-repo-check [-m <model>] <msg>`; resume `exec resume <sessionId> --json --output-schema <schemaFile> --skip-git-repo-check <message>`. `schemaFile` = the schema written into the per-turn temp cwd (add `schemaFile` to `buildCall`'s input). First-turn `msg` gets the same `SYSTEM INSTRUCTIONS:` prefix as agy. stdin must be closed.
- Parse JSONL: `sessionId` = `thread_id` of the `thread.started` event; `turn` = `JSON.parse` of the text of the last `item.completed` event whose item type is `agent_message`.

- [ ] **Step 1:** Write the adapter tests (args for both turns; parse of a JSONL sample with `thread.started` + one `agent_message`).
- [ ] **Step 2:** Implement; add `'codex'` to the gate script only (not to `TUTORS`).
- [ ] **Step 3:** Run `node scripts/tutor-gate.mjs codex` (outside the sandbox). **If any check is not PASS: delete `lib/tutors/codex.mjs` and its tests, keep the gate entry, and record the failing check in README under "Tutors"; stop this task.** If all PASS: add `'codex'` to `TUTORS` and README.
- [ ] **Step 4:** `node --test test/` — Expected: PASS. Commit: `git commit -m "Add Codex tutor"` (or `"Record Codex gate failure"`).

---

## Slice d — Docker labs

### Task 12: Networking lab image

**Files:**
- Create: `courses/networking/lab/Dockerfile`; Modify: `courses/networking/course.json`

**Interfaces:**
- Produces `LabSpec` (in `course.json` `lab`): `{ "dockerfile": "lab/Dockerfile", "caps": ["NET_ADMIN", "SYS_ADMIN"], "network": true, "hostname": "netlab" }`. Generated courses (slice f) will instead use `{ "base": "<image>", "packages": [...] }`; this plan only implements `dockerfile`.
- **Deviation from the spec, needs the user's OK before merging:** the spec says networking needs no network. The `dns-resolution` chapter's labs query the real internet (`dig example.com`, `dig +trace`, root `DNSKEY`), so networking requests `"network": true` (Docker's default bridge, outbound only). The learner sees and approves it with the caps (Task 13).
- Dockerfile: `FROM ubuntu:26.04` if `docker pull ubuntu:26.04` succeeds, else `ubuntu:24.04` (the old VM was 26.04; matching it keeps tool versions close). Packages: `iproute2 bridge-utils tcpdump iputils-ping iputils-tracepath traceroute netcat-openbsd dnsutils ethtool iptables nftables conntrack dnsmasq-base procps python3 curl`. `CMD ["sleep", "infinity"]`.

- [ ] **Step 1:** Write the Dockerfile and the `lab` spec.
- [ ] **Step 2:** `docker build -t mindgap-networking courses/networking/lab` — Expected: success. `docker run --rm mindgap-networking bash -lc 'ip -V; tcpdump --version | head -1; nft --version; dig -v; python3 --version'` — Expected: five version lines.
- [ ] **Step 3:** Commit: `git commit -m "Add networking lab image"`.

### Task 13: Docker lab runner with approval

**Files:**
- Create: `lib/labs.mjs`; Modify: `server.mjs`
- Test: `test/labs.test.mjs` (fake `docker` binary via `DOCKER_BIN`)

**Interfaces:**
- Produces:
  - `labStatus(course): Promise<{available: boolean, reason?: string}>` — `false` with reason when `course.lab` is null, the docker binary is missing, or `docker info` fails.
  - `labRequest(course): {caps: string[], network: boolean}` — what the learner must approve (empty caps + `network:false` means nothing to approve).
  - `isApproved(course): Promise<boolean>` — reads `<stateDir>/lab-approval.json` `{caps, network, at}` and returns true iff `caps` (sorted) and `network` equal `labRequest(course)` exactly, or there is nothing to approve.
  - `approve(course, {caps, network}): Promise<void>` — writes the file; throws if the body does not equal `labRequest(course)` exactly.
  - `runLab(course, cmd): Promise<{stdout, stderr, code}>` — ensures image `mindgap-<slug>` (build from `course.dir/<dockerfile>` when `docker image inspect` fails) and container `mindgap-<slug>` (when `docker inspect` fails: `docker run -d --name mindgap-<slug> --hostname <hostname> --network <bridge|none> --cap-add <each> mindgap-<slug>`, then `docker exec mindgap-<slug> sh -c 'mount --bind /proc/sys/net /proc/sys/net && mount -o remount,bind,rw /proc/sys/net'` when caps include `SYS_ADMIN`; `docker start` if it exists but is stopped), then `docker exec mindgap-<slug> bash -lc <cmd>` with today's `capture`, timeout and kill logic moved here from `server.mjs`.
- HTTP: `GET /api/courses/:slug` gains `lab: {available, reason?, request, approved}`. `POST /api/courses/:slug/lab-approval` body `{caps, network}` → 204, or 400 if it does not match. `POST /api/lab` → 503 `{error: reason}` when unavailable, 428 `{error: 'lab needs approval', request}` when not approved.
- The `/proc/sys/net` remount (verified 2026-10-26) makes only `net.*` sysctls writable; `kernel.*` stays read-only.

- [ ] **Step 1: Write the failing tests** with a fake docker that logs argv and answers `inspect` per a control file: `runLab` on a missing container issues, in order, `image inspect`, `build`, `inspect`, `run -d ... --cap-add NET_ADMIN --cap-add SYS_ADMIN --network bridge --hostname netlab`, the remount `exec`, then `exec mindgap-net bash -lc 'echo hi'`; a second `runLab` issues only `inspect` + `exec`; `approve` with `caps:['NET_ADMIN']` throws; with the exact request it makes `isApproved` true. **Review Focus 2:** `DOCKER_BIN=/nonexistent/docker` → `labStatus` is `{available:false, reason}` with `reason` containing `docker`, and through the server `POST /api/lab` is 503 (not 500).
- [ ] **Step 2:** Run `node --test test/labs.test.mjs` — Expected: FAIL.
- [ ] **Step 3:** Implement `lib/labs.mjs` and wire the server; delete `runOrb`, `ORB_BIN`.
- [ ] **Step 4:** Run `node --test test/` — Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "Run labs in Docker with learner approval"`.

### Task 14: Lab UI, remove OrbStack

**Files:**
- Modify: `public/chapter.js`, `public/lesson.js`, `public/labcard.js`, `public/app.css`, `README.md`, `CONTRACTS.md`
- Delete: `labs/setup-netlab.sh`

- [ ] **Step 1:** When `lab.available` is false, lab blocks render as a muted note "Labs need Docker: <reason>" with no Run button. When the course's lab is available but not approved, the first Run click opens a confirmation listing each cap with a one-line meaning (`NET_ADMIN`: "create and change network interfaces inside the lab container"; `SYS_ADMIN`: "mount filesystems inside the lab container (needed for network namespaces); a broad privilege") and "Network: outbound internet access" when `network` is true; Approve posts the approval and then runs the command; Cancel runs nothing.
- [ ] **Step 2:** README: Requirements say "Docker (optional, for labs): Docker Desktop, OrbStack or Docker Engine"; remove the `setup-netlab.sh` quickstart line and describe the approval prompt in Safety. CONTRACTS: replace "Lab safety" with the Docker rules and approval file.
- [ ] **Step 3: Verify in the real UI** with `agent-browser` against a fresh data dir: open `chapter.html?course=networking&node=l1-links-nics`, click the first Run, see the confirmation listing both caps and network, approve, and see real output from `ip` in the lab card. Then stop Docker (or set `DOCKER_BIN=/nonexistent`) and confirm labs show the "Labs need Docker" note.
- [ ] **Step 4:** Commit: `git commit -m "Lab approval UI; drop OrbStack"`.

### Task 15: Lab parity with the old VM

**Files:**
- Create: `scripts/lab-parity.mjs`

**Interfaces:**
- CLI: `node scripts/lab-parity.mjs [--vm]`. Collects every `lab.cmd` from `courses/networking/chapters/*.json` in `index.json` order (107 commands on 2026-10-26). Runs them in order in a **fresh** container (`docker rm -f mindgap-networking` first, then `runLab` from Task 13 with the approval bypassed) and, with `--vm`, also in the existing OrbStack VM (`orb -m netlab -u root bash -lc <cmd>`). Prints a table `chapter | # | docker exit | vm exit` and lists every row where the exit codes differ, with both stderr tails. Exit 0 iff no differences (or, without `--vm`, iff every exit code is 0).

- [ ] **Step 1:** Implement the script.
- [ ] **Step 2:** Run `node scripts/lab-parity.mjs --vm` on this Mac. Expected: the table prints 107 rows.
- [ ] **Step 3:** For each difference, find the cause (missing package → add it to the Dockerfile; container-only limitation → fix the runner in Task 13's code). Change a chapter's command only when it cannot work in a container at all, and then say so in the commit message. Re-run until there are no differences. **If a difference cannot be closed in two attempts, stop and report it with both outputs.**
- [ ] **Step 4:** Record the final table in `progress.md`. Commit: `git commit -m "Lab parity script; Docker matches the old VM"`.

---

## After this plan

Slices e (probe → plan), f (course generation from topic + sources, `markitdown` import) and g (sandboxed AI widgets) each get their own plan, written against the code this plan leaves behind.
