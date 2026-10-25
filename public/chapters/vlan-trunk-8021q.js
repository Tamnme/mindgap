// Chapter 2.6: VLAN trunk and 802.1Q. Authored content; the tutor gets this file as chapter_source.
// Labs run in netlab (Ubuntu 26.04, iproute2 6.19) on 2026-10-25; outputs described in the prose were observed.
// Sources: https://en.wikipedia.org/wiki/IEEE_802.1Q (tag = 4 bytes between source MAC and EtherType: TPID 0x8100, then TCI = PCP 3 bits + DEI 1 bit + VID 12 bits; max frame 1518 -> 1522 bytes),
//   https://man7.org/linux/man-pages/man8/bridge.8.html (bridge vlan add: pvid, untagged),
//   https://man7.org/linux/man-pages/man8/ip-link.8.html (vlan_default_pvid: "default PVID (native/untagged VLAN ID)"),
//   https://pve.proxmox.com/wiki/Network_Configuration (Proxmox: VLAN-aware bridge, trunk mode on a guest NIC needs configuration in the guest).
// Hedged, not sourced: "usable VIDs are 1-4094" (12 bits give 4096 values; 0 and 4095 being reserved is general knowledge, none of the fetched pages lists it),
//   https://docs.aws.amazon.com/directconnect/latest/UserGuide/create-private-vif.html (console step: "For VLAN, enter the ID number for your virtual local area network (VLAN)"),
//   the Kubernetes note; the Proxmox "bridge-vids 2-4094" example is from the PVE wiki page above but was not exercised here.

const NEED = `ip link show br26a >/dev/null 2>&1 || { echo "Run the first lab (build br26a and br26b) first."; exit 1; }`;
// Trim a tcpdump -e line to the parts we discuss.
const TRIM = `sed 's/^[0-9:.]* //; s/, length [0-9]*//; s/, id [0-9]*.*//'`;

export default {
  node: 'vlan-trunk-8021q',
  number: '2.6',
  kicker: 'Layer 2',
  title: 'VLAN trunk and 802.1Q',
  lede: 'Two switches, three groups of hosts, one cable between them. This chapter looks at what has to travel on that cable so the far switch can sort the frames back into the right VLANs.',
  sections: [
    {
      id: 'link',
      title: 'Two switches, one cable',
      blocks: [
        { md: `In chapter 2.5 each switch port belonged to one VLAN, and the hosts never knew. That works inside one box. Now a second switch is needed, in another rack, with more hosts in the same VLANs.

\`\`\`
  a  c  e                     b  d  f
  |  |  |                     |  |  |
 [10][20][1]                 [10][20][1]
 +----------+      t26a/t26b  +----------+
 |  br26a   |-----------------|  br26b   |
 +----------+  one cable      +----------+
\`\`\`

a and b are in VLAN 10, c and d in VLAN 20, e and f on ports that were never configured (VLAN 1 by default). Each pair has addresses in its own subnet: 10.26.10.0/24, 10.26.20.0/24 and 10.26.1.0/24. One veth pair joins the two bridges. Each switch has to put frames from a and c on that single cable, and the other switch has to hand each frame to the right VLAN again.

Build it. The two ports on the cable are configured as members of VLANs 10 and 20; the lab pings across it in all three VLANs.` },
        {
          lab: {
            explain: 'Build br26a and br26b joined by t26a<->t26b; ping a→b, c→d, e→f across the cable (expect 2 received each)',
            cmd: `for h in a b c d e f; do ip netns del n26$h 2>/dev/null; ip link del v26$h 2>/dev/null; done
for l in t26a t26b br26a br26b; do ip link del $l 2>/dev/null; done; sleep 0.5
for b in br26a br26b; do ip link add $b type bridge vlan_filtering 1; ip link set $b up; done
ip link add t26a type veth peer name t26b
ip link set t26a master br26a up; ip link set t26b master br26b up
for t in t26a t26b; do bridge vlan add dev $t vid 10; bridge vlan add dev $t vid 20; done
mk() { ip netns add n26$1
  ip netns exec n26$1 sysctl -qw net.ipv6.conf.all.disable_ipv6=1 net.ipv6.conf.default.disable_ipv6=1
  ip link add v26$1 type veth peer name eth0 netns n26$1
  ip link set v26$1 master br26$2 up
  if [ $3 != 1 ]; then bridge vlan del dev v26$1 vid 1; bridge vlan add dev v26$1 vid $3 pvid untagged; fi
  ip -n n26$1 link set eth0 up; ip -n n26$1 addr add 10.26.$3.$4/24 dev eth0; }
mk a a 10 1; mk b b 10 2; mk c a 20 1; mk d b 20 2; mk e a 1 1; mk f b 1 2
sleep 1
echo "a->b: $(ip netns exec n26a ping -c2 -W1 -q 10.26.10.2 | grep -o '[0-9]* received')"
echo "c->d: $(ip netns exec n26c ping -c2 -W1 -q 10.26.20.2 | grep -o '[0-9]* received')"
echo "e->f: $(ip netns exec n26e ping -c2 -W1 -q 10.26.1.2 | grep -o '[0-9]* received')"`,
          },
        },
        { md: `All three work. a's ping to b crosses the cable and arrives at b's port as an ordinary frame, as in chapter 2.5. But the cable is shared: the frame for VLAN 10 and the frame for VLAN 20 both go through the same pair of ports, and neither port belongs to a single VLAN.

The next lab captures on \`t26a\` with \`tcpdump -e\` (which prints the link-layer header) while a pings b and c pings d.` },
        {
          checkpoint: {
            id: 'c1',
            prompt: 'A frame from a arrives at br26b on the shared cable. What lets br26b put it in VLAN 10 and not VLAN 20?',
            options: [
              'Ingress port: br26b assigns every frame from a port to that port’s VLAN',
              'IP subnet: br26b reads the destination IP and picks the VLAN whose subnet matches',
              'Something in the frame itself: it says which VLAN it belongs to',
              'MAC table: br26b already knows which VLAN each host’s MAC belongs to',
            ],
            key: 2,
            why: 'The shared port cannot name a single VLAN, a switch does not read IP, and a MAC table is only searched after the VLAN is known (each VLAN has its own). The frame has to carry the VLAN ID itself.',
          },
        },
        {
          lab: {
            explain: 'tcpdump -e on t26a while a pings b and c pings d; then the first bytes of one frame in hex',
            cmd: `${NEED}
for h in a b c d e f; do ip -n n26$h neigh flush all; done
timeout 4 tcpdump -nel -i t26a -c 8 icmp 2>/dev/null | ${TRIM} &
sleep 1
ip netns exec n26a ping -c1 -W1 -q 10.26.10.2 >/dev/null
ip netns exec n26c ping -c1 -W1 -q 10.26.20.2 >/dev/null
wait
echo
timeout 3 tcpdump -nexx -c1 -i t26a icmp 2>/dev/null | sed -n 2,3p &
sleep 1
ip netns exec n26a ping -c1 -W1 -q 10.26.10.2 >/dev/null
wait`,
          },
        },
        { md: `Every line on the cable reads \`ethertype 802.1Q (0x8100): vlan 10, p 0, ethertype IPv4\` for a and b, and \`vlan 20\` for c and d. Where an untagged frame has an EtherType (here IPv4, 0x0800), these frames have 0x8100, and the real EtherType comes after it. The hex dump of one frame (from one run; your MACs will differ) shows the layout:

\`\`\`
e65d 4bbc 9d3d   dst MAC (6 bytes)
f69a 547b f54f   src MAC (6 bytes)
8100             TPID: "an 802.1Q tag follows"
000a             TCI: PCP 0, DEI 0, VID 0x00a = 10
0800             the original EtherType (IPv4)
4500 0054 ...    the IP packet
\`\`\`

That is the **802.1Q tag**: 4 bytes inserted between the source MAC and the EtherType. The first two (TPID) are 0x8100 for a standard 802.1Q tag (802.1ad service tags use 0x88a8, per the Wikipedia page). The next two (the TCI) split into **PCP**, a 3-bit priority; **DEI**, 1 bit marking a frame that may be dropped first under congestion; and the **VID**, 12 bits holding the VLAN ID ([IEEE 802.1Q](https://en.wikipedia.org/wiki/IEEE_802.1Q)). Here PCP and DEI are 0 and the VID is 10; the lab shows exactly this, and \`p 0\` in the tcpdump line is the priority.

Twelve bits give 4096 values. The usable VLAN IDs are 1 to 4094 (0 and 4095 are reserved; none of this chapter's sources lists that, so treat it as general knowledge). Because the tag adds 4 bytes, a tagged frame can be 1522 bytes where an untagged one tops out at 1518.

> [!IMPORTANT]
> A trunk link carries several VLANs by tagging each frame with its VLAN ID. Access ports (chapter 2.5) are where the tag is added and removed, so hosts never see it.` },
      ],
    },
    {
      id: 'native',
      title: 'The one VLAN with no tag',
      blocks: [
        { md: `e and f are on ports nobody configured, so they sit in VLAN 1, the bridge's default. The cable carries VLANs 10 and 20 tagged. e now pings f across the same cable, and the lab captures on \`t26a\` again.` },
        {
          checkpoint: {
            id: 'c2',
            prompt: 'e pings f across the cable. What does tcpdump -e on t26a show for those frames?',
            options: [
              'No tag at all: just an ordinary header with ethertype IPv4',
              'A tag with vlan 1: every frame on a trunk is tagged',
              'A tag with vlan 0: untagged frames get a priority-only tag',
              'Nothing: the frames never cross, because the cable carries only VLANs 10 and 20',
            ],
            key: 0,
            why: 'The trunk port’s default VLAN 1 is configured as the port’s untagged (native) VLAN, so VLAN 1 frames cross without a tag. The ping works because the far port treats an untagged frame as VLAN 1.',
          },
        },
        {
          lab: {
            explain: 'tcpdump -e on t26a while e pings f (expect no vlan field), then the trunk port’s VLAN table',
            cmd: `${NEED}
for h in a b c d e f; do ip -n n26$h neigh flush all; done
timeout 3 tcpdump -nel -i t26a -c 2 icmp 2>/dev/null | ${TRIM} &
sleep 1
ip netns exec n26e ping -c1 -W1 -q 10.26.1.2 >/dev/null
wait
echo; bridge vlan show dev t26a | grep -v port`,
          },
        },
        { md: `The ICMP frames cross untagged: \`ethertype IPv4 (0x0800)\`, no \`vlan\`. The trunk port's table shows why:

\`\`\`
t26a   1 PVID Egress Untagged
       10
       20
\`\`\`

VLANs 10 and 20 have no flags: they leave the port tagged. VLAN 1 has \`PVID\` and \`Egress Untagged\`, the same flags as an access port. Those two flags are the **native VLAN** of the trunk: untagged frames arriving on the port join it, and its frames leave without a tag. The bridge creates the default PVID itself (the \`ip-link\` man page calls \`vlan_default_pvid\` the "native/untagged VLAN ID"), and our lab never removed it from the trunk ports.

So *trunk* is not a different kind of port: it is a port that is a member of several VLANs, most of them tagged. An access port is the special case of one untagged VLAN.

In general both ends of a trunk must agree on which VLAN is native. If one switch sends VLAN 1 untagged and the other calls VLAN 5 the native one, the untagged frames land in different VLANs on each side. This lab used the default on both ends and did not test a mismatch.` },
        { md: `Last, the list of VLANs on a trunk. The build lab added \`vid 10\` and \`vid 20\` to both trunk ports. The next lab removes \`vid 20\` from \`t26b\` only, so br26a still sends VLAN 20 frames tagged and br26b's cable port no longer lists VLAN 20. Then c pings d, and a pings b.` },
        {
          checkpoint: {
            id: 'c3',
            prompt: 'VLAN 20 is removed from t26b only. c pings d across the cable. What happens?',
            options: [
              'Works: br26b accepts whatever tag arrives on its cable port',
              'Fails: br26b drops the VLAN 20 frames arriving on t26b',
              'Works, untagged: without a VLAN 20 entry the frames cross without a tag',
              'Works one way: c reaches d but the reply is lost',
            ],
            key: 1,
            why: 'A VLAN-aware bridge port accepts tagged frames only for VLANs it is a member of. With no VLAN 20 entry on t26b, the tagged frames from c are discarded there, so the ping gets no replies.',
          },
        },
        {
          lab: {
            explain: 'Remove vid 20 from t26b, ping c→d and a→b (expect 0 then 2), then restore it',
            cmd: `${NEED}
bridge vlan del dev t26b vid 20
for h in c d; do ip -n n26$h neigh flush all; done
echo "VLAN 20 removed from t26b: c -> d: $(ip netns exec n26c ping -c2 -W1 -q 10.26.20.2 | grep -o '[0-9]* received')"
echo "a -> b (VLAN 10): $(ip netns exec n26a ping -c2 -W1 -q 10.26.10.2 | grep -o '[0-9]* received')"
bridge vlan add dev t26b vid 20
echo "VLAN 20 restored:    c -> d: $(ip netns exec n26c ping -c2 -W1 -q 10.26.20.2 | grep -o '[0-9]* received')"`,
          },
        },
        { md: `c to d gets 0 replies while a to b still works, and after restoring the entry c to d works again. A trunk carries an **allowed list** of VLANs. Anything outside the list stops at that port, and here VLAN 20 was missing on the br26b end only. The lab shows the failure, not the cause: it did not capture on \`t26b\`, so the explanation that br26b discards the arriving tagged frames is the standard behaviour, not something this lab printed.` },
        {
          widget: {
            id: 'w-trunk',
            sim: 'vlan-trunk',
            title: 'Trunk carries two VLANs',
            hint: 'Click "A → B (across trunk)" and watch the log: the trunk hop is tagged, the access hops are not. Then try "C → D (VLAN 20)" and "A ARP broadcast".',
            takeaway: 'Between the switches the frame is **802.1Q tagged** with its VLAN. On access ports it is untagged, and a VLAN 10 broadcast never reaches C or D.',
          },
        },
      ],
    },
    {
      id: 'twins',
      title: "Where you've met this",
      blocks: [
        { md: `**Proxmox.** A VLAN-aware bridge's uplink to the physical switch is a trunk. The PVE wiki's example for a VLAN-aware \`vmbr0\` sets \`bridge-vids 2-4094\` on a bridge whose port is \`eno1\`. A guest NIC *without* a VLAN tag on a VLAN-aware bridge can carry several VLANs, but then the VLANs have to be handled inside the guest, as the wiki says of trunk mode. Whether your uplink looks like \`t26a\` in \`bridge vlan show\` depends on your own config; check it there.

**AWS VPC.** You never tag frames to AWS from an instance. A Direct Connect private virtual interface takes a VLAN ID when you create it ([create a private VIF](https://docs.aws.amazon.com/directconnect/latest/UserGuide/create-private-vif.html)). AWS doesn't document how that tag is carried, so treat it as the one place a VLAN number shows up in an AWS setup.

**Kubernetes / Cilium.** Pods don't see tags. A node's uplink to its top-of-rack switch can be a trunk with the VLANs the cluster uses; that is a switch-side arrangement, invisible to the pod.` },
      ],
    },
    {
      id: 'keep',
      title: 'What to keep',
      blocks: [
        { md: `- A trunk puts several VLANs on one link by inserting a 4-byte 802.1Q tag: TPID 0x8100, then PCP (3 bits), DEI (1 bit) and the 12-bit VID.
- Usable VLAN IDs are 1 to 4094. \`tcpdump -e\` on the trunk shows \`vlan 10\`; the access-port side shows no tag.
- The native VLAN is the one VLAN a trunk port sends and accepts untagged (\`PVID\` plus \`Egress Untagged\`). Both ends must agree on it.
- A trunk port only carries the VLANs in its list. A VLAN missing at one end is dropped there.` },
      ],
    },
  ],
};
