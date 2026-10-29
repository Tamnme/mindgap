# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Engineers who find mindgap on GitHub, clone it, and run it on their own machine to learn a subject properly. They are technical enough to run `node server.mjs`, have Docker, and already pay for an AI CLI (Claude Code or agy). The shipped networking course targets engineers who run VPCs, clusters and hypervisors but never learned the wire underneath; generated courses can be on any subject. The maintainer uses it too but is not the design target: a stranger's first run matters as much as a returning learner's hundredth.

One learner per install and per data folder. No accounts, no teams.

## Product Purpose

mindgap finds what a learner does not actually understand and teaches into those gaps. A course is a lasting map of a subject (topics with prerequisites), written chapters, and optional labs. The tutor probes with prediction questions, marks each topic `gap`, `shaky` or `solid` with a note of what the learner said, and teaches each gap from first principles.

Success is that the learner can **derive** the idea, not recall it: "a security group is stateful because of conntrack", not "security groups are stateful". Map status is a proxy for that, not the goal itself.

## Positioning

Compared with its upstream, learnharness, and with generic AI tutors:

1. **Courses**: a lasting map of a whole subject plus chapters, not one-off chats.
2. **Labs**: real commands in a real Docker sandbox, predicted first, then run.
3. **CLI subscription**: no API keys; the learner's existing Claude Code / agy login does the work.
4. **Predict before reveal, with confidence**: wrong options are beliefs a smart person could hold, so a miss is evidence about the learner's model, not just a score.

## Operating Context

- Runs locally: `node server.mjs`, browser on `http://127.0.0.1:4810`. The server binds localhost only, so in practice the learner uses a desktop or laptop browser.
- Sessions are a mix: long focused sessions (30–90 min) reading chapters, running labs and talking to the tutor, and short sessions (10–20 min) answering a few questions or reviewing shaky topics.
- Every tutor turn shells out to the AI CLI. Turns take from a few seconds to about two minutes, and writing a chapter takes up to five. Waiting is a normal state of the product, not an edge case.
- Courses are created in the web UI from a topic, optional background, and optional sources (URLs, PDFs and other files converted via markitdown).

## Capabilities and Constraints

- Flows: course list → create course → course map → New goal (probe → plan → learner approves → map is drawn) → lessons (teach, practice shaky, debug drill) and chapters (checkpoints, labs, tutor drawer) → map updates with evidence.
- Terminology in use: course, map, topic/node, layer, `untested` / `gap` / `shaky` / `solid`, goal, plan, lesson, chapter, checkpoint, lab, sources, tutor.
- Node 22+, zero npm dependencies, plain ES modules in `public/`. `CONTRACTS.md` is the authority for API and data shapes; a UI redesign changes presentation, not contracts.
- The tutor never gets file, shell or network tools in lessons; sources are untrusted input. AI-generated code never runs with access to the page, server or host. Lab containers never get privileges the learner did not see and approve.
- Generated courses have no labs or simulators yet; the networking course has both.
- Chapters are written on demand, never all up front.
- Undecided: whether the app should ever be reachable from a phone (today it cannot be, by the localhost bind).

## Brand Commitments

- Name: **mindgap**, lowercase. Chosen to read as a learning tool to a stranger; the core move is finding gaps in what you know.
- Voice in shipped copy: plain, direct, second person, no hype ("Tell it what you want to learn. It probes what you already know, then teaches the gaps.").
- Credit learnharness (AGPL-3.0) wherever its prompts or method are adapted. License is AGPL-3.0.

## Evidence on Hand

- The shipped networking course: 33 topics from L1 to DNS, chapters, labs and simulators (`courses/networking/`).
- Screenshot of the course home on first run: `docs/img/home.png`.
- No user counts, testimonials, reviews or benchmarks exist. Do not invent any.

## Product Principles

1. **Understanding over coverage.** Every surface should push toward the learner explaining why, not toward ticking topics off.
2. **A wrong answer is information.** Prediction, confidence and reasoning are evidence about the learner's mental model; capture them cheaply and show them back.
3. **Always answer "what now?"** The learner arrives with one question; the product should answer it before offering everything else it can do.
4. **Waiting is normal.** AI turns are slow; the learner should keep reading, see progress, and be able to cancel.
5. **The learner's machine stays theirs.** Nothing runs or reaches out without their explicit approval.
