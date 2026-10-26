# underlay

Learn the networking underneath your cloud.

underlay is a local tutor for engineers who already run VPCs, clusters and hypervisors but never learned the wire underneath. It tests what you actually believe about frames, routes, NAT and overlays. It keeps a map of your gaps and teaches each one from the bytes up, then ties it back to AWS, Kubernetes and Proxmox.

The tutor's teaching method comes from [learnharness](https://github.com/amosblomqvist/learnharness), an agent harness for learning difficult things. See [Credits](#credits-and-license).

![The underlay map on first run: every topic untested, grouped by layer](docs/img/map.png)

## How it works

1. **Map.** 33 topics from L1 to DNS, each with its prerequisites. Every topic starts as `untested`.
2. **Placement check.** The tutor asks prediction questions and marks each topic `gap`, `shaky` or `solid`, with a note recording what you said.
3. **Chapters.** Each topic has a written chapter. Checkpoints ask you to commit to a prediction (with a confidence) before the page reveals the answer. Wrong options are beliefs a smart person could hold, so a miss tells the tutor something.
4. **Labs.** Chapters include commands that run in a real Linux VM (`ip`, `tcpdump`, `bridge`, `conntrack`, ...). You predict the output, then run it.
5. **Tutor.** Claude reads your answers in a side drawer, teaches into the gap it finds, and updates the map. You can also run teach, practice and debug-drill sessions from the map.

Each idea is meant to land as something you could have derived, not a fact to memorise: a security group is stateful *because* of conntrack, a pod reaches another node *because* of encapsulation.

## Requirements

- **Node.js 22 or newer.** No npm dependencies.
- **[Claude Code](https://claude.com/claude-code)**, logged in. The server calls `claude -p` for every tutor turn, on your subscription.
- **[OrbStack](https://orbstack.dev)** on macOS, for the labs. Optional: chapters and the tutor work without it, but lab commands won't run.

## Quickstart

```sh
git clone https://github.com/Tamnme/underlay.git
cd underlay
labs/setup-netlab.sh   # optional: creates the "netlab" Ubuntu VM and installs the tools
node server.mjs
```

Open http://localhost:4810 and start with **Placement check**.

On first run the server copies `learner/map.seed.json` to `learner/map.json`. Your progress lives in `learner/` and is gitignored.

| Variable | Default | |
|---|---|---|
| `UNDERLAY_MODEL` | `opus` | Model for the tutor (`sonnet` is cheaper and faster) |
| `UNDERLAY_DATA_DIR` | `learner/` | Where your map, propositions and transcripts live |
| `PORT` | `4810` | |

## Topics

- **Physical:** Links, NICs and virtual cables
- **Layer 2:** Ethernet frames and MAC addresses · Switch: MAC → port · Unknown-unicast flooding · Broadcast domain · VLAN access ports · VLAN trunk and 802.1Q · ARP: IP → MAC · Proxmox Linux bridge and VLAN-aware bridge · Why a VPC has no L2 broadcast
- **Layer 3:** IP addressing and subnet math · Default gateway · Router vs switch · Longest-prefix match · Routing table and next hop · AWS route table and the implied router · ICMP · TTL and traceroute · MTU and path MTU discovery
- **Layer 4:** UDP · Ports and the 5-tuple · TCP three-way handshake · RST vs silent drop · Stateful vs stateless filtering · Security group vs network ACL · NAT/PAT and conntrack
- **Overlays:** Encapsulation and VXLAN · Kubernetes pod network model · K8s pod network and the Cilium datapath
- **Services:** DHCP · DNS resolution · DNS search domains and ndots · Debug method: work the layers

## Safety

Lab commands run only inside the OrbStack VM (`orb -m netlab -u root bash -lc ...`), never on your host. They run only when you click **Run**, with a 30-second timeout and 64 KB of output. The server listens on `127.0.0.1` only. The tutor runs with `--safe-mode` and no tools, so it can't touch your files or your Claude Code config.

## Development

```sh
node --test test/
```

`CONTRACTS.md` defines the shared formats (map, tutor turn schema, HTTP API, chapter files). `docs/CHAPTER_GUIDE.md` explains how to write a chapter.

## Credits and license

underlay is built on [learnharness](https://github.com/amosblomqvist/learnharness) by [@amosblomqvist](https://github.com/amosblomqvist). The tutor prompts `prompts/teacher.md`, `prompts/practice.md` and `prompts/prober.md` are adapted from it. That includes their teaching method: measure what the learner holds first, establish foundations they can accept as-is, then derive everything else one motivated step at a time. underlay adds the networking curriculum, chapters, labs, simulator and web workbench around them.

learnharness is licensed AGPL-3.0, and underlay is released under the same license: see [LICENSE](LICENSE).
