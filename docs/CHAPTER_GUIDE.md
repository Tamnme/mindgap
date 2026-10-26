# Chapter guide

How to write an underlay chapter. The reference chapter is `public/chapters/switch-mac-table.js`: read it in full before writing. The learner approved its format, so match its voice, density and structure. The file format is in `CONTRACTS.md` ("Chapters").

## Who is reading

The learner is a cloud engineer: strong on AWS, Kubernetes, Cilium and Proxmox, and learning the networking underneath. They debug real systems, so they want *mechanisms* they can reason from, not definitions. Use "you". Use they/them if a third person is needed. A tutor reads the learner's checkpoint answers in a side drawer, so the chapter does not need to anticipate every confusion.

Each map node in `learner/map.json` has a `truth` (the one idea the chapter must lock in), `twins` (AWS, K8s and Proxmox angles), a `lab` idea, `prereqs`, and sometimes `evidence` from the placement test. A node with status `gap` and evidence that names a wrong belief: build a checkpoint whose distractor is exactly that belief.

## Shape

- `number`: from the table in the plan. `kicker`: the layer name (`Physical`, `Layer 2`, `Layer 3`, `Layer 4`, `Overlays`, `Services`). `title`: the map node's title exactly. `lede`: one or two sentences stating the core idea plainly.
- **3 to 5 sections.** The usual arc:
  1. Start from something the learner already holds (a prereq) and reason forward. Show the bytes or the table, not an abstraction.
  2. The mechanism, built so that the learner could have discovered it ("how could you have worked this out yourself?").
  3. Proof in netlab (labs).
  4. "Where you've met this": AWS, Kubernetes/Cilium and Proxmox.
  5. "What to keep": 3 to 5 bullets.
- **Prose:** 1200 to 2000 words across the chapter. Short paragraphs. One idea per paragraph. No filler, no "In this chapter we will".
- **Callouts:** use `> [!IMPORTANT]` for the one or two rules worth remembering, at most one per section.

## Checkpoints (the core of the method)

- **2 to 4 per chapter.** Put each one *before* the text that answers it. The page blurs everything after an open checkpoint, so the text above a checkpoint must not give its answer away.
- **3 or 4 options.** Each wrong option must be a belief a smart person could actually hold. Placement evidence names one where it exists. No joke options, no "all of the above".
- Option text reads `label: short reason` when a reason helps. The receipt shows only the part before `: `, so the label must stand alone.
- `key` is the 0-based index of the correct option. Vary its position across checkpoints.
- `why`: one or two sentences that make the answer inevitable. The tutor sees it as well.
- A checkpoint may ask the learner to predict a lab's output, with the lab placed *after* it (see `c3` in the reference chapter). This is the strongest kind: the prediction gets tested against reality.

**Spoiler traps (found in review, so check each one):**
- The text above a checkpoint sets up the *situation* only. Any rule, definition, man-page quote or worked example that decides the answer goes *after* it. Example: don't explain "admin state vs carrier" right before asking what a downed peer looks like.
- Don't give a worked example whose pattern matches the answer, e.g. decoding a MAC byte whose bits are exactly the ones the checkpoint asks about. Pick a byte with a different pattern.
- A wrong option's *label* (the part before `: `) must itself be wrong. If the label is literally what the lab prints (`DOWN`), the receipt marks a true statement wrong. Make the label carry the false belief.
- Labels must be **distinct** across a checkpoint's options. A bare number or a bare "Yes"/"No" label almost always collides with another option or with the true answer, so put the belief in the label ("Zero: the switch still knows n23c").
- Re-read every sentence above each checkpoint, asking "could the learner answer from this alone?" If yes, move it.

**Claims vs observation (found in review):**
- Claim only what a lab printed. "You could see it with tcpdump on b" needs a lab that runs tcpdump on b. An inference from a virtual interface (veth has no FCS) is not evidence about physical NICs; label general knowledge as such.
- Keep authoring process out of learner text: no "this chapter fetched", "not fetched", or similar. Say what is documented, what is general knowledge, and what wasn't checked.
- Don't put tool behaviour in a tool's mouth (e.g. `ip neigh` does not resolve vendors). If unsure, run it.

## Labs (run every one)

Labs run as root in the OrbStack machine `netlab` (Ubuntu 26.04, iproute2 6.19, tcpdump available) via `orb -m netlab -u root bash -lc '<cmd>'`.

- **Run every lab yourself, in the order the chapter presents them, and write the prose after a lab from the output you actually saw.** Never describe output you did not observe. Run the full sequence twice to prove it is repeatable.
- Each lab must finish in under 25 s and be under 4000 characters.
- **Names are per chapter, to avoid collisions in the shared VM.** Use the chapter number without the dot, e.g. chapter 3.4 → bridge `br34`, netns `n34a`, `n34b`, veths `v34a`. Interface names must be at most 15 characters. `switch-mac-table` uses `sw0`/`hA`; don't reuse those.
- The first lab builds the topology from scratch and must be idempotent: delete what it creates (`ip netns del … 2>/dev/null`, `ip link del … 2>/dev/null`), then create.
- Deleting a netns does not always remove the host-side veth at once, and a quick rebuild then fails with `RTNETLINK answers: File exists`. In the first lab, also `ip link del <host-veth> 2>/dev/null` for each veth, then `sleep 0.5`, before creating anything.
- Any later lab starts with a guard that prints a friendly message if the first lab hasn't run: `ip link show br34 >/dev/null 2>&1 || { echo "Run the first lab first."; exit 1; }`.
- Counting frames or table entries: disable IPv6 inside each netns before links come up (`sysctl -qw net.ipv6.conf.all.disable_ipv6=1 net.ipv6.conf.default.disable_ipv6=1`). Otherwise router solicitations and DAD fill tables and captures by themselves.
- Use background `tcpdump` plus `timeout`, never an unbounded wait. Record its PID (`TP=$!`) and `wait $TP`; don't rely on `wait %N`.
- **A zero count needs a positive control.** "0 packets seen" is also what a capture that never started prints. In the same capture, also count something known to be non-zero (e.g. the host's own handshake), and print both. Count with a pattern match (`grep -c`), never by counting lines; tcpdump output can contain blank lines. Use `-n`, `-l`, and a filter.
- `explain` is one line telling the learner what the lab does and, where useful, what to look for (e.g. "(expect 0)").
- Use 2 to 4 labs per chapter. A chapter with nothing to run (a pure AWS concept, say) may have 0 to 1 labs, but say why in the file's header comment.

## Widgets

Optional but encouraged: use 1 to 3 per chapter wherever a kind fits. Available kinds (the configs are documented in `public/widgets/README.md`):

- `sim`: the switch simulator. Scenarios: `switch-learning`, `switch-flood`, `vlan-broadcast`, `vlan-trunk`. The button names are fixed by the scenario.
- `subnet`: IP + prefix slider; shows network, broadcast, usable range and the binary split; optional AWS reserved addresses.
- `routes`: a route table plus a destination; shows every matching row and the longest-prefix winner.
- `timeline`: a two-lane sequence diagram you step through, with several scenarios (e.g. SYN → SYN/ACK → ACK vs SYN → RST vs SYN → nothing).
- `mtu`: hops with MTUs, a packet-size slider and DF/ICMP toggles; shows pass, fragment, frag-needed or black hole.

Every widget block has `id` (unique within the chapter), `kind`, `title`, `hint` (what to try) and `takeaway` (one sentence, markdown allowed). Hints and takeaways must match what the widget actually shows for its config, so open it in the browser if unsure.

## Cloud and product claims

- The "Where you've met this" section and any AWS, Kubernetes, Cilium or Proxmox claim must be either **sourced** or **hedged**.
- **Sourced** means you fetched the vendor or project documentation in this session and listed the URL in the file's header comment.
- **Hedged** means the text says plainly that it isn't publicly documented ("AWS doesn't publish the internals; the safe mental model is …").
- Reuse the map node's `twins` and `sources` as a starting point. They were researched, but re-check anything you build on.
- Never invent command flags, default values or version numbers. If a default matters, read it in netlab or cite it.

## Markdown that renders

`md` blocks support: paragraphs, **bold**, *italic*, `code`, `[links](https://…)`, `-` and `1.` lists, pipe tables with a `|---|` row, `> [!IMPORTANT]` callouts and other blockquotes, and fenced code blocks (for ASCII diagrams; keep them under 64 columns). No headings inside `md` (sections are the headings), no images, no HTML.

The file is a JS module, so inside template literals escape backticks as `` \` `` and never write a literal `${` unless you mean interpolation. Reuse shared shell snippets through a `const` at the top of the file, as the reference does with `NEED_SW0`.

## File header

Start each chapter with a comment like:

```js
// Chapter 3.4: Longest-prefix match. Authored content; the tutor gets this file as chapter_source.
// Labs run in netlab (Ubuntu 26.04, iproute2 6.19) on <date>; outputs described in the prose were observed.
// Sources: <url> (what it supports), <url> (…)
```

## Done means

- `node --test test/` passes (it validates every chapter listed in `public/chapters/index.json`).
- Every lab ran twice in sequence with the described output.
- The chapter id was appended to `public/chapters/index.json`.
- The checkpoint keys are correct. Re-read each one against the text that follows it.
