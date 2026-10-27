## Architecture
`server.mjs` (zero npm deps, `127.0.0.1:4810`) serves `public/` and calls the tutor CLI per turn through `lib/tutors/{claude,agy}.mjs`; mode prompts and JSON schemas live in `prompts/`.
Shipped courses are `courses/<slug>/` (`course.json`, `map.seed.json`, `prompt.md`, chapters); generated courses and all learner state live in `<MINDGAP_DATA_DIR>/courses/<slug>/` (default `learner/`).
Pure logic sits in `lib/` (course-session, chapters, courses, sources, labs) and is unit-tested in `test/`; labs run via `docker exec` in one container per course.
`CONTRACTS.md` is the authority for API and data shapes; the design is `docs/superpowers/specs/2026-10-26-mindgap-design.md`.

## Conventions
A shipped prompt never describes the learner: background lives in `state/goal.json` (`test/server.test.mjs` checks the networking prompt only). Credit learnharness (AGPL-3.0) in adapted prompts and PRs. Never commit `.planning/` or `learner.backup-2026-10-26/`.
Slices: plan → user approves → SDD in worktree `../netbench-mindgap-<slice>` on `feat/mindgap-<slice>` → real check → PR; the user merges.
Before naming a new field, check it against existing data (node `sources` already held URLs, so tags became `source_sections`).
When a slice removes or renames a UI label, grep README.md and docs/ for the old label in the same commit: "Placement check" survived three PRs after 038de5e removed the button. (2026-10-27)

## You can
Run `node --test test/` (all must pass before a PR).
Real checks: `PORT=48xx MINDGAP_DATA_DIR=<scratch copy of learner/> nohup node server.mjs &`, drive it with `agent-browser`, and stop only that PID.

## Known traps
Never kill the user's server on 4810 or touch the real `learner/`; ask instead. (2026-10-27)
Green tests are not done: f2's Write chapter POST lacked a JSON content-type with 264 tests passing; only the real check caught it. (2026-10-27)
SSH push/pull can fail on agent signing: fetch with `git -c credential.helper='!gh auth git-credential' fetch https://github.com/Tamnme/mindgap.git main`. Do not stash `.planning/`. (2026-10-27)
