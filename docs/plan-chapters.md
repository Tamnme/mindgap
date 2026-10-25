# Plan: probe entry, widget kit, and chapters for every map node

Spec: `../_plan/task_plan.md` (decisions D6–D17) and `CONTRACTS.md`. The chapter format and voice are fixed by the approved pilot `public/chapters/switch-mac-table.js` and by `docs/CHAPTER_GUIDE.md`.

## Global Constraints

- Zero npm dependencies. Node ≥ 22 built-ins only. Browser code is vanilla ES modules, no build step. Tests use `node --test test/*.mjs`.
- Security: model text and authored markdown go only through `renderMarkdown` (`public/md.js`). All other DOM text uses `textContent`. Never assign `innerHTML` from data, except the output of `renderMarkdown`.
- Styling goes in `public/app.css` using the existing tokens (`--bg`, `--fg`, `--muted`, `--panel`, `--border`, `--accent`, `--tutor-bg`, `--code-bg`, `--code-fg`, `--st-*`). It must look right in both light and dark (`prefers-color-scheme`). There must be no page-level horizontal scroll at 390 px width.
- Widget module contract: `public/widgets/<kind>.js` exports `mount(host, config) → { destroy() }`, `validate(config) → string[]` (an empty array means valid), and the pure logic functions its tests use. `mount` must work when called again after `destroy` (the card's Reset does that). It renders at the card's full width and must still read well when the card is in Focus mode (fixed overlay, wider).
- Accessibility: every input has a label, every control works from the keyboard, and colour is never the only signal.
- Commits: add files by name (never `git add -A` / `git add .`). End every commit message with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never modify `learner/map.json` status/evidence fields; the tutor owns them. Never touch `learner/sessions/`.
- A running server on :4810 serves the working tree. Static files are re-read per request, so no restart is needed for front-end changes. Do not kill it.

## Task 1: Probe entry point

Files: `public/map.js`, `public/lesson.js` (only if needed), `test/server.test.mjs` (only if a gap is found).

The server already accepts `POST /api/lesson {node_id, mode: "probe"}` (system prompt `prompts/prober.md`), but no page calls it. Add the UI:

1. In the node side panel (`renderSide` in `public/map.js`): when the node's status is `untested`, add a button **Quick check** (`data-action="probe"`) next to the existing teach button. It calls `startLesson(n.id, 'probe')`, which must go to the conversation lesson page (`lesson.html`), not the chapter. The existing chapter redirect applies only to mode `teach`, so keep it that way.
2. In the toolbar (`public/index.html` + `refreshToolbar`): add a button `id="btn-probe"` labelled **Placement check (N untested)**. It starts a probe lesson on the first untested node in topological order (`state.topo`), and is disabled when N is 0.
3. Check that `public/lesson.js` shows the mode chip "probe" and behaves well for a probe lesson: probe turns usually carry a `question` and rarely a lab or sim. If something breaks for this mode, fix it minimally.
4. Update the side panel copy so the difference is clear: **Read the chapter** teaches; **Quick check** measures what you already know without teaching (a few questions; updates the map).

No new tests are required unless you change server behaviour. Run the full suite before committing.

## Task 2: Widget registry and the `subnet` widget

Files: `public/chapter.js`, `public/widgets/README.md` (new), `public/widgets/sim.js` (new adapter), `public/widgets/subnet.js` (new), `public/app.css`, `test/widgets.test.mjs` (new), `test/chapter.test.mjs`, `CONTRACTS.md`.

1. **Registry.** A chapter widget block is `{ id, kind, title, hint, takeaway, ...config }`. `kind` defaults to `"sim"` when absent, so the pilot chapter keeps working unchanged. In `chapter.js`, `widgetCard` dynamically imports `/widgets/${kind}.js` and calls `mount(host, block)`. `public/widgets/sim.js` adapts the existing simulator: `mount(host, cfg)` → `switch-sim.js` `mount(host, cfg.sim)`; `validate(cfg)` checks that `cfg.sim` is a key of `SCENARIOS`.
2. **Explored badge.** Set it on the first `click` on a button, *or* the first `input`/`change` event inside the widget host (sliders count).
3. **`subnet` widget** config: `{ ip: "10.0.1.77", prefix: 26, minPrefix: 8, maxPrefix: 32, aws: false }`. UI:
   - a text input for the IPv4 address (invalid input shows an inline error and keeps the last valid readout)
   - a range slider for the prefix length between `minPrefix` and `maxPrefix`, with a visible `/N` label
   - a readout: subnet mask; network address; broadcast address; first and last usable; usable host count
   - a 32-bit binary view of the address, network bits visually separated from host bits (not by colour alone, e.g. a gap and an underline)
   - Rules: `/31` → 2 usable, point-to-point, RFC 3021. `/32` → 1 address, the host itself. Otherwise `2^(32-p) − 2`.
   - When `aws: true`, also show "AWS reserves 5 per subnet: network, +1 VPC router, +2 DNS, +3 reserved, broadcast" with usable `2^(32-p) − 5`. Only `/16`–`/28` are allowed in a VPC: outside that range, show "not a valid VPC subnet size" instead of counts.
   - Pure exports: `parseIPv4(str) → number|null`, `formatIPv4(n)`, `subnetInfo(ipNumber, prefix, { aws }) → { mask, network, broadcast, first, last, usable, note }`.
4. **`public/widgets/README.md`:** document every kind's config with one JSON example each (`sim` and `subnet` now; later tasks append theirs).
5. **Tests:**
   - `test/widgets.test.mjs`: the subnet pure functions — /24, /26, /31, /32, /0 edge, AWS /28 = 11 usable, AWS /29 invalid, invalid IP strings.
   - `test/chapter.test.mjs`: replace the `SCENARIOS[b.widget.sim]` assertion with: import `../public/widgets/${kind}.js` and assert `validate(widget)` returns `[]`.
6. **`CONTRACTS.md`:** chapters section — change the widget block shape to `{id, kind?, title, hint, takeaway, ...config}` and point to `public/widgets/README.md`.

## Task 3: `routes` widget (route table decision)

Files: `public/widgets/routes.js`, `public/widgets/README.md`, `public/app.css`, `test/widgets.test.mjs`.

Config: `{ routes: [{ prefix: "10.0.0.0/16", target: "local" }, { prefix: "0.0.0.0/0", target: "igw-1" }], dest: "10.0.3.4", presets: ["10.0.3.4", "8.8.8.8"], caption?: "Subnet route table" }`.

UI:
- a destination input, plus preset buttons
- the table of routes: prefix, length, target, and a status column per row: "matches /16", "no match", or "**winner**". The winner row is highlighted and marked with a text label, not colour alone.
- a verdict line: "→ `<target>` via `<prefix>` (longest of N matching)", or "No matching route: dropped (no default route)".

Rules:
- Matching is bitwise on the prefix length.
- Ties on the same prefix length are a config error, reported by `validate`.
- Invalid prefixes are a `validate` error too.

Pure exports: `parseCidr(str) → { net, len } | null`, `lpm(routes, destNumber) → { matches: [{ index, len }], winner: index | null }`.

Tests: overlapping /8 /16 /24 /32, the default route only, no match, a host /32 beating a /24, and `validate` catching a duplicate length on overlapping equal prefixes and a malformed prefix.

## Task 4: `timeline` widget (sequence diagram stepper)

Files: `public/widgets/timeline.js`, `public/widgets/README.md`, `public/app.css`, `test/widgets.test.mjs`.

Config:
```json
{ "lanes": ["client 10.0.0.1:51514", "server 10.0.0.2:80"],
  "scenarios": [
    { "name": "Port open", "steps": [
      { "from": 0, "to": 1, "label": "SYN seq=100" },
      { "from": 1, "to": 0, "label": "SYN/ACK seq=300 ack=101" },
      { "from": 0, "to": 1, "label": "ACK ack=301", "note": "connected after 1 RTT" } ] },
    { "name": "Port closed", "steps": [
      { "from": 0, "to": 1, "label": "SYN" },
      { "from": 1, "to": 0, "label": "RST/ACK", "note": "connect() fails at once: Connection refused" } ] },
    { "name": "Firewall drops", "steps": [
      { "from": 0, "to": 1, "label": "SYN", "drop": true, "at": "0 s" },
      { "from": 0, "to": 1, "label": "SYN (retry)", "drop": true, "at": "+1 s" },
      { "from": 0, "to": 1, "label": "SYN (retry)", "drop": true, "at": "+3 s", "note": "…until the timeout: Connection timed out" } ] } ] }
```

UI:
- scenario buttons (`aria-pressed` on the active one)
- Prev / Next buttons and a step counter "2 / 3"
- an SVG sequence diagram with two vertical lanes, labelled at the top. Arrows are drawn for the steps up to the current one, each with its label and an optional `at` time on the left. A `drop: true` step draws an arrow that stops halfway and ends in an ✕ with the text "dropped".
- the current step's `note` shown below the diagram as text.

The diagram height grows with the step count. Switching scenario resets to step 1.

Pure exports: `clampStep(i, n)`, `layoutSteps(steps, width) → [{ x1, x2, y, dropX? }]`.

Tests: the step clamping, and that the layout puts a drop arrow's end between the two lanes.

## Task 5: `mtu` widget (path MTU)

Files: `public/widgets/mtu.js`, `public/widgets/README.md`, `public/app.css`, `test/widgets.test.mjs`.

Config: `{ hops: [{ name: "pod", mtu: 1500 }, { name: "VXLAN tunnel", mtu: 1450 }, { name: "server", mtu: 1500 }], size: 1500, minSize: 576, maxSize: 9000, df: true, icmpBlocked: false }`.

UI:
- a packet-size slider (IP packet size, bytes)
- a "DF (don't fragment)" checkbox and an "ICMP blocked on the path" checkbox
- the hops drawn left to right with their MTU, and the packet's fate at the first hop whose MTU is less than the size

Outcomes:
- Fits everywhere: "delivered".
- DF off: "fragmented into N at `<hop>`". Use IPv4 rules: payload per fragment = floor((mtu − 20) / 8) × 8, and N = ceil((size − 20) / that).
- DF on, ICMP allowed: "dropped at `<hop>`; ICMP frag-needed (type 3 code 4, next-hop MTU `<mtu>`) sent back. The sender lowers its size and retries."
- DF on, ICMP blocked: "dropped at `<hop>` silently. The sender never learns: black hole (small requests work, large responses hang)."

Pure exports: `mtuOutcome(hops, size, df, icmpBlocked) → { kind: 'delivered'|'fragmented'|'frag-needed'|'black-hole', hop?, fragments?, pathMtu }`.

Tests: delivered; fragmented counts (1500 over a 1450 hop = 2; 9000 over 1500 = 7); frag-needed; black-hole; the reported `pathMtu` = min over the hops.

## Chapter tasks (6–18): shared instructions

Each chapter task writes the listed chapters as `public/chapters/<node_id>.js` and appends each id to `public/chapters/index.json`, keeping the existing order and adding the new ids in chapter-number order.

**Read first:**
- `docs/CHAPTER_GUIDE.md`, in full. It is binding.
- `public/chapters/switch-mac-table.js`: the voice and structure to match.
- `public/widgets/README.md`: the widget configs.
- Each node's entry in `learner/map.json` (`truth`, `twins`, `lab`, `sources`, `evidence`, `status`, `prereqs`).

**Chapter numbers** (use exactly these):

| # | node | # | node | # | node |
|---|---|---|---|---|---|
| 1.1 | l1-links-nics | 3.1 | ip-subnet-math | 4.5 | stateful-vs-stateless-filtering |
| 2.1 | frames-mac | 3.2 | default-gateway | 4.6 | sg-vs-nacl |
| 2.3 | unknown-unicast-flooding | 3.3 | router-vs-switch | 4.7 | nat-pat-conntrack |
| 2.4 | broadcast-domain | 3.4 | longest-prefix-match | 5.1 | encapsulation-vxlan |
| 2.5 | vlan-access | 3.5 | routing-table-next-hop | 5.2 | k8s-pod-network-model |
| 2.6 | vlan-trunk-8021q | 3.6 | aws-route-table-implied-router | 5.3 | cilium-datapath |
| 2.7 | linux-bridge-vlan-aware | 3.7 | icmp | 6.1 | dhcp |
| 2.8 | arp | 3.8 | ttl-traceroute | 6.2 | dns-resolution |
| 2.9 | vpc-no-l2-broadcast | 3.9 | mtu-pmtud | 6.3 | dns-search-ndots |
| | | 4.1 | ports-sockets | 6.4 | debug-method |
| | | 4.2 | udp | | |
| | | 4.3 | tcp-handshake | | |
| | | 4.4 | rst-vs-silent-drop | | |

Kickers: 1.x `Physical`, 2.x `Layer 2`, 3.x `Layer 3`, 4.x `Layer 4`, 5.x `Overlays`, 6.x `Services`.

**netlab tools** present: traceroute, tracepath, nc (OpenBSD), ss, conntrack, nft, iptables (nf_tables), dig, host, ethtool, tcpdump, python3, curl, ip, bridge. **Missing:** dnsmasq, arping, socat. The VM has internet. If a chapter truly needs a missing tool, add it to `PACKAGES` in `labs/setup-netlab.sh`, run that script once, and say so in the report. A lab must never install anything itself.

**Done when:**
- `node --test test/*.mjs` passes.
- Every lab in the task's chapters ran twice in order, with the described output, and the report pastes the observed output of each lab (trimmed).
- Every cloud/product claim is sourced in the header or hedged.
- One commit per chapter: `chapter <n>: <title>`.

## Task 6: Chapters 1.1 and 2.1

- **1.1 l1-links-nics.**
  - What a link and a NIC are; a veth pair is a virtual cable whose two ends sit in different namespaces; link state and carrier (`NO-CARRIER`/`LOWERLAYERDOWN` when the peer is down).
  - Anh's earlier answer: pod traffic first hits "the node's physical NIC (e.g. ens5)". It actually first reaches the host-side veth (`lxc…` under Cilium). Use that as a distractor.
  - Twins: AWS ENI, pod veth/lxc, Proxmox tap + vmbr.
  - Labs: a veth between two netns; set one end down and read the other end's state; ping.
- **2.1 frames-mac.**
  - Go deeper than the switch chapter's first section: the Ethernet header fields (dst, src, EtherType 0x0800/0x0806/0x86DD/0x8100; the FCS is stripped before tcpdump sees it), MAC structure (OUI, the I/G multicast bit, the U/L locally-administered bit), broadcast `ff:ff:ff:ff:ff:ff`, and the NIC filtering on destination MAC unless promiscuous.
  - Labs: `tcpdump -e` showing MACs and EtherType; the locally-administered bit in a veth's random MAC.

## Task 7: Chapters 2.3 and 2.4

- **2.3 unknown-unicast-flooding.**
  - Don't repeat the switch chapter's basic flood rule; link back to it in one sentence.
  - Angle: *when and why flooding keeps happening in real networks*. Entries ageing out while a host stays silent; asymmetric paths (ARP cache lifetime longer than MAC ageing → unicast flooding); MAC table exhaustion (state it as a concept, no attack instructions); the term BUM traffic; Linux per-port `flood`/`learning` controls (verify the `bridge link set` flags in netlab).
  - Lab: set `ageing_time` low on a lab bridge (a few seconds), watch an entry disappear, and see the next frame flood again (tcpdump on a third host).
  - Widget: `sim` `switch-flood`.
- **2.4 broadcast-domain.**
  - Placement evidence: Anh said broadcasts go "to the router". Use it as a distractor.
  - A broadcast reaches every port of the L2 segment, and the router is just one more receiver. It stops at the router's interfaces and is never forwarded.
  - Lab: two bridges joined by a router netns (`net.ipv4.ip_forward=1`); an ARP broadcast from one side is seen on the same bridge and not on the other side.

## Task 8: Chapters 2.5 and 2.6

- **2.5 vlan-access.**
  - Placement evidence: Anh had VLAN isolation wrong.
  - A VLAN splits one switch into separate broadcast domains. An access port has an untagged PVID, and the hosts don't know about it. Traffic between VLANs needs a router.
  - Lab: a VLAN-filtering bridge with PVIDs per port, showing ping within a VLAN works and across VLANs fails, plus `bridge vlan show`. `labs/smoke.sh` has a working pattern.
  - Widget: `sim` `vlan-broadcast`.
- **2.6 vlan-trunk-8021q.**
  - The 802.1Q tag (TPID 0x8100, PCP, DEI, 12-bit VID, usable 1–4094); a trunk carries several VLANs tagged; the native/untagged VLAN.
  - Lab: two VLAN-aware bridges joined by a trunk veth; `tcpdump -e` on the trunk shows `vlan 10`.
  - Widget: `sim` `vlan-trunk`.

## Task 9: Chapters 2.7, 2.8 and 2.9

- **2.7 linux-bridge-vlan-aware.**
  - Proxmox `vmbr0` with `bridge-vlan-aware yes` / `bridge-vids`, versus the traditional setup of one bridge per VLAN (`vmbr0.N`). A VM NIC `tag=N` makes the tap an untagged member with PVID N. Source: the PVE Network Configuration wiki.
  - Lab: build a VLAN-aware bridge like vmbr0 with two "VM taps" (veths) on different tags, plus a tagged "uplink", and read `bridge vlan show`.
- **2.8 arp.**
  - Status is solid, so keep it tighter (around 1200 words) but complete: request by broadcast, reply by unicast; neighbour states (REACHABLE/STALE/FAILED); gratuitous ARP; you ARP for the gateway, not the remote host.
  - Labs: `ip neigh`, a `tcpdump arp` capture; a gratuitous ARP is optional because arping is missing (`ip neigh`-based demos are fine).
- **2.9 vpc-no-l2-broadcast.**
  - A VPC has no broadcast or multicast (cite the AWS doc; note that Transit Gateway multicast exists as a separate feature). ARP inside a VPC is answered by the AWS SDN; hedge the internals. What breaks: gratuitous-ARP failover (keepalived VRRP) doesn't work, so use secondary IP/ENI moves or route-table updates (cite).
  - Lab: Linux `proxy_arp` on a router netns answering ARP for addresses behind it, as a mental model of "something else answers ARP for you". Hedge that this is a model, not AWS's implementation.

## Task 10: Chapters 3.1, 3.2 and 3.3

- **3.1 ip-subnet-math.**
  - Solid, so keep it tight: the mask as a bit split, network/broadcast/usable, CIDR, the AWS 5 reserved addresses (cite).
  - Widget: `subnet` (once plain, once with `aws: true`).
  - Lab: `ip addr add 10.31.0.77/26` in a netns and read the kernel-generated connected route.
- **3.2 default-gateway.**
  - The on-link vs off-link decision; the host ARPs for the *gateway*, the frame's dst MAC = the gateway's MAC, and the dst IP stays the remote host's.
  - Lab: two subnets and a router netns; `tcpdump -e` on the sending side shows dst MAC = router while the IP dst = the remote host.
- **3.3 router-vs-switch.**
  - A router has an IP per interface, rewrites the L2 header at every hop, decrements TTL, and does not forward broadcasts. A switch does none of that.
  - Lab: `tcpdump -e -v` on both sides of a router netns showing the MACs change and TTL 64 → 63.

## Task 11: Chapters 3.4, 3.5 and 3.6

- **3.4 longest-prefix-match.**
  - Placement evidence: gap.
  - Widget: `routes` with overlapping routes.
  - Lab: overlapping routes in a netns, with `ip route get` showing the choice; add a /32 and watch the choice change.
- **3.5 routing-table-next-hop.**
  - Destination vs next hop; `via` vs connected (`dev`) routes; the next hop must be on-link; recursive resolution; `ip route get`; metrics as tie-breakers for the same prefix.
  - Lab: a three-netns chain with a `via` route.
- **3.6 aws-route-table-implied-router.**
  - The VPC router at subnet base +1 (cite). The `local` route covers the VPC CIDR. Each subnet is associated with one route table. Targets: igw, nat, tgw, pcx, vpce. More-specific routes than local are supported for middlebox inspection (cite the doc and date).
  - Widget: `routes` with an AWS-like table.
  - Labs: 0–1 (explain in the header).

## Task 12: Chapters 3.7, 3.8 and 3.9

- **3.7 icmp.**
  - ICMP is a control/error channel, not just ping. Key types: echo, dest-unreachable codes (net, host, port, admin-prohibited, frag-needed), time-exceeded. Who sends them: routers and the destination host.
  - Lab: routes of type `unreachable` / `prohibit` in a router netns, and the different errors ping shows; a tcpdump of the ICMP coming back.
- **3.8 ttl-traceroute.**
  - TTL decrements per hop; traceroute sends probes with rising TTL and listens for time-exceeded. UDP vs ICMP vs TCP traceroute; `*` means no reply, not loss.
  - Lab: a chain of 3 router netns; `traceroute -n`, plus a variant where one hop drops ICMP (nft), showing `* * *` while the path still works.
- **3.9 mtu-pmtud.**
  - Placement: shaky.
  - Widget: `mtu`, including a VXLAN hop and the black-hole case.
  - Labs: a path with a smaller-MTU link; `ping -M do -s` at sizes either side of the limit; then drop ICMP frag-needed with nft and show the black hole; `tracepath` showing the pmtu.

## Task 13: Chapters 4.1, 4.2 and 4.3

- **4.1 ports-sockets.**
  - The 5-tuple, ephemeral ports (`ip_local_port_range`, read it in netlab), a listening socket vs established sockets, `ss -tanp`.
  - Lab: an nc listener in one netns, two clients, and `ss` showing two 5-tuples on the same server port.
- **4.2 udp.**
  - Connectionless, no handshake, message boundaries; a closed port answers with ICMP port-unreachable, and UDP gives no delivery guarantee.
  - Labs: `nc -u` to a closed port, with tcpdump showing the ICMP; an open port showing nothing back unless the app replies.
- **4.3 tcp-handshake.**
  - SYN, SYN/ACK, ACK, the initial sequence numbers, the listen backlog, one RTT before data.
  - Widget: `timeline` (open scenario first).
  - Lab: `tcpdump -S` of an nc connection showing the flags and the ISNs.

## Task 14: Chapters 4.4 and 4.5

- **4.4 rst-vs-silent-drop.**
  - Placement evidence: gap. Read the node's `evidence` and build a distractor from it.
  - Closed port → RST → instant "Connection refused". DROP → retransmitted SYNs → "timed out". REJECT can send either a RST or ICMP port-unreachable.
  - Widget: `timeline` with three scenarios.
  - Labs: nc to a closed port (time it); an nft drop rule (time it with `timeout`); nft reject with tcp reset vs ICMP. Show the timings in the output.
- **4.5 stateful-vs-stateless-filtering.**
  - Solid, so keep it tighter. Conntrack states; return traffic allowed by `ct state established,related`; a stateless filter needs explicit return rules on ephemeral ports. AWS SG = stateful, NACL = stateless (cite).
  - Lab: nft stateless rules breaking return traffic, then fixed with ct state.

## Task 15: Chapters 4.6 and 4.7

- **4.6 sg-vs-nacl.**
  - All from AWS docs (cite):
    - SG: stateful, allow-only, attached to an ENI, all rules evaluated.
    - NACL: stateless, numbered rules evaluated in order with the first match winning, allow and deny, subnet boundary, return traffic on ephemeral ports.
  - Symptom mapping: an SG block usually looks like a timeout, and so does a NACL block.
  - Lab: emulate a NACL with ordered stateless nft rules in a router netns.
- **4.7 nat-pat-conntrack.**
  - Solid, so keep it tighter. SNAT/masquerade, port translation when two clients use the same source port, `conntrack -L` showing the original vs reply tuples, AWS NAT gateway (cite).
  - Lab: a masquerade router netns, two clients, and `conntrack -L`.

## Task 16: Chapters 5.1, 5.2 and 5.3

- **5.1 encapsulation-vxlan.**
  - The frame inside UDP inside IP; 50 bytes of overhead → inner MTU 1450 on a 1500 underlay; VNI.
  - Port facts to verify, not assume: the IANA port is 4789; Linux needs `dstport` (check what `ip link add … type vxlan` does without it in iproute2 6.19); Cilium's default VXLAN port (cite docs.cilium.io).
  - Widget: `mtu` with a VXLAN hop.
  - Lab: vxlan between two netns over a veth underlay, with tcpdump showing the outer UDP and the inner frame.
- **5.2 k8s-pod-network-model.**
  - Every pod gets its own IP; pod-to-pod communication works without NAT (cite kubernetes.io); a veth pair joins the pod netns to the node; the CNI's job.
  - Lab: emulate a node with two "pod" netns joined by veths with /32 routes (Cilium-like, no bridge) and show the routes.
- **5.3 cilium-datapath.**
  - eBPF programs on the lxc veth / tc hooks; tunnel (VXLAN/Geneve) vs native routing; kube-proxy replacement; identity-based policy (cite docs.cilium.io).
  - netlab has no Cilium, so 0–1 labs; explain in the header.
  - Widget: `mtu` with the tunnel overhead, or `routes`, where it truly helps.

## Task 17: Chapters 6.1, 6.2 and 6.3

- **6.1 dhcp.**
  - DORA; the client starts with no IP (src 0.0.0.0, dst 255.255.255.255) and needs a broadcast domain or a relay; leases; AWS DHCP option sets (cite).
  - Lab: decide whether dnsmasq is worth adding to netlab's packages (see the tool rule) and, if so, run a DORA capture between two netns.
- **6.2 dns-resolution.**
  - Stub resolver → recursive resolver → authoritative servers; `/etc/resolv.conf`; UDP 53 with TCP fallback; the AWS VPC resolver at base +2 and 169.254.169.253 (cite).
  - Labs: `dig +trace` (internet is available) and `dig` against a specific server.
- **6.3 dns-search-ndots.**
  - Solid, so keep it tighter: the search list, `ndots`, and Kubernetes' `ndots:5` (cite) causing extra queries for external names.
  - Lab: a netns-specific resolv.conf via `/etc/netns/<name>/resolv.conf`, with tcpdump on port 53 showing the expanded queries.

## Task 18: Chapter 6.4

- **6.4 debug-method.**
  - The capstone. Work the layers: L1 link/carrier → L2 neighbour/ARP → L3 route (`ip route get`) → L4 (`ss`, `nc`, refused vs timeout) → MTU → DNS → app.
  - A symptom→layer table that links the earlier chapters.
  - Checkpoints ask *which layer* a given symptom points to.
  - Labs: one setup lab builds a small topology with three planted faults (e.g. a wrong mask, a missing return route, an MTU black hole). Each following lab is one diagnostic step that reveals one fault, and a checkpoint before each asks what the step will show.
