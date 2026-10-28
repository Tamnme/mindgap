## Architecture
`server.mjs` (zero npm deps, `127.0.0.1:4810`) serves `public/` and calls the tutor CLI per turn through `lib/tutors/{claude,agy}.mjs`; mode prompts and JSON schemas live in `prompts/`.
Shipped courses are `courses/<slug>/` (`course.json`, `map.seed.json`, `prompt.md`, chapters); generated courses and all learner state live in `<MINDGAP_DATA_DIR>/courses/<slug>/` (default `learner/`).
Pure logic sits in `lib/` (course-session, chapters, courses, sources, labs) and is unit-tested in `test/`; labs run via `docker exec` in one container per course.
`CONTRACTS.md` is the authority for API and data shapes; the design is `docs/superpowers/specs/2026-10-26-mindgap-design.md`.

## Conventions
A shipped prompt never describes the learner: background lives in `state/goal.json` (`test/server.test.mjs` checks the networking prompt only). Credit learnharness (AGPL-3.0) in adapted prompts and PRs. Never commit `.planning/` or `learner.backup-2026-10-26/`.
Slices: plan → user approves → SDD in worktree `../netbench-mindgap-<slice>` on `feat/mindgap-<slice>` → real check → user clicks through it on a scratch server → PR; the user merges.
A UI slice is not ready for a PR until the user has looked: their look at PR #9 found three bugs (bold around code, invisible chosen option, submitted answer read as erased) that 284 tests and four agent real checks missed. (2026-10-28)
Before naming a new field, check it against existing data (node `sources` already held URLs, so tags became `source_sections`).
When a slice removes or renames a UI label, grep README.md and docs/ for the old label in the same commit: "Placement check" survived three PRs after 038de5e removed the button. (2026-10-27)

## You can
Run `node --test test/` (all must pass before a PR).
Real checks: `scripts/scratch-server.sh 48xx` (serves this checkout on a throwaway copy of `learner/`, prints URL and PID), drive it with `agent-browser`, and stop only that PID.
Busy, cancel and timeout states without a paid call: `scripts/scratch-server.sh 48xx --slow-tutor`. A hand-made fake must `exec sleep`: a plain `sh` wrapper leaves `sleep` running after the kill, holding the pipe, so cancel looks hung. (2026-10-28)

## Known traps
Never kill the user's server on 4810 or touch the real `learner/`; ask instead. (2026-10-27)
Green tests are not done: f2's Write chapter POST lacked a JSON content-type with 264 tests passing; only the real check caught it. The design pass's Cancel POST repeated it, so `test/client-fetch.test.mjs` now scans `public/*.js` for it. (2026-10-28)
SSH push/pull can fail on agent signing: fetch with `git -c credential.helper='!gh auth git-credential' fetch https://github.com/Tamnme/mindgap.git main`. Do not stash `.planning/`. (2026-10-27)
