// Chapter 2.3: Unknown-unicast flooding. Authored content; the tutor gets this file as chapter_source.
// Labs run in netlab (Ubuntu 26.04, iproute2 6.19) on 2026-10-25; outputs described in the prose were observed.
// Sources: https://man7.org/linux/man-pages/man8/bridge.8.html (per-port `learning` and `flood` flags: what each controls, default on),
//   https://pve.proxmox.com/wiki/Network_Configuration (bridge-disable-mac-learning since PVE 7.3; PVE then adds guest MACs to the FDB by hand),
//   https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html (AWS: "We do not support broadcast in a VPC").
// Hedged, not sourced: the asymmetric-path and "ARP cache outlives MAC ageing" causes are general L2 behaviour (not run in a lab);
//   MAC-table exhaustion is described as a concept only; the AWS and Cilium unicast-delivery internals are not published.

const NEED_BR23 = `ip link show br23 >/dev/null 2>&1 || { echo "Run the first lab (build br23) first."; exit 1; }`;

export default {
  node: 'unknown-unicast-flooding',
  number: '2.3',
  kicker: 'Layer 2',
  title: 'Unknown-unicast flooding',
  lede: 'A switch floods a frame whenever it has no entry for the destination MAC. That happens more often than the first frame of a conversation, and each cause comes from something you can name.',
  sections: [
    {
      id: 'again',
      title: 'Flooding is not a one-off',
      blocks: [
        { md: `Chapter 2.2 gave you the rule: no entry for the destination, so the frame goes out every port except the one it came in on. You saw it happen once, to the first frame of a conversation, and then it stopped.

In an ordinary network you want it to stay that way. A flooded frame costs every port a copy, and every host on the segment gets to see traffic that wasn't meant for it. So the interesting question is the opposite one: **what puts a switch back into the "no entry" state?**

Three kinds of frame take the flood path, and the industry has a name for the group, **BUM**: **B**roadcast, **U**nknown unicast (no entry), **M**ulticast (on a plain switch, flooded like the others). This chapter is about the U.

Build a bridge, \`br23\`, with three hosts **n23a, n23b, n23c**. Its \`ageing_time\` is set to 3 seconds. What that setting does comes up in a moment. ARP is pinned between n23a and n23c, so the only frames you'll count are unicast ones. The table starts empty.` },
        {
          lab: {
            explain: 'Build br23 (ageing_time 300 = 3 s) with three hosts and pinned ARP; expect 0 learned entries',
            cmd: `for n in n23a n23b n23c; do ip netns del $n 2>/dev/null; done; ip link del br23 2>/dev/null
for i in 1 2 3; do ip link del v23$i 2>/dev/null; done; sleep 0.5
ip link add br23 type bridge ageing_time 300 && ip link set br23 up
i=1; for n in n23a n23b n23c; do
  ip netns add $n
  ip netns exec $n sysctl -qw net.ipv6.conf.all.disable_ipv6=1 net.ipv6.conf.default.disable_ipv6=1
  ip link add v23$i type veth peer name eth0 netns $n
  ip link set v23$i master br23 up
  ip -n $n link set eth0 up; ip -n $n addr add 10.23.0.$i/24 dev eth0
  i=$((i+1))
done
mac() { ip -n $1 -br link show eth0 | awk '{print $3}'; }
ip -n n23a neigh replace 10.23.0.3 lladdr $(mac n23c) dev eth0 nud permanent
ip -n n23c neigh replace 10.23.0.1 lladdr $(mac n23a) dev eth0 nud permanent
echo "$(ip -d link show br23 | grep -o 'ageing_time [0-9]*')"
echo "learned entries: $(bridge fdb show br br23 | grep -vc permanent)"`,
          },
        },
        { md: `Before you run anything, here is how you would catch flooding on a real bridge: put a capture on a port whose host is *neither* the sender nor the receiver. Normally it sees broadcasts and nothing else. If it sees unicast between two other hosts, the switch is flooding. n23b is that third host in every lab here.

Now one ping from n23a to n23c. Both hosts send a frame, so both MACs get learned. Then everybody goes quiet. The next lab prints the learned-entry count straight after the ping and again after 5 seconds of silence.

Then the setup for the checkpoint: after those 5 seconds, n23a sends **one more** unicast to n23c, with n23b listening on its port.` },
        {
          checkpoint: {
            id: 'c1',
            prompt: 'Both MACs were learned, then 5 quiet seconds passed. n23a sends one more unicast frame to n23c. How many copies does n23b see?',
            options: [
              'Still known: the switch remembers n23c and sends it out one port',
              'Forgotten: the table lost n23c, so the frame floods again',
              'Filtered: the NIC drops it before tcpdump can see it',
              'ARP only: a unicast frame never floods twice',
            ],
            key: 1,
            why: 'Learned entries are not permanent. After ageing_time without a frame from that MAC the bridge forgets it, and the next frame for it is an unknown unicast again.',
          },
        },
        {
          lab: {
            explain: 'Ping once, then watch the learned-entry count for 5 s of silence',
            cmd: `${NEED_BR23}
ip netns exec n23a ping -c1 -W1 -q 10.23.0.3 >/dev/null
echo "right after the ping: $(bridge fdb show br br23 | grep -vc permanent) learned"
sleep 5
echo "after 5 s of silence: $(bridge fdb show br br23 | grep -vc permanent) learned"`,
          },
        },
        { md: `Two entries, then none. That's **ageing**: every learned entry carries a timer that restarts each time a frame with that source MAC arrives. If the host stays silent for \`ageing_time\`, the entry is deleted. The unit is hundredths of a second, so \`ageing_time 300\` is 3 s. The default is 30000, which is 300 s (you read it in 2.2).

Now the real test. The lab below runs the ping twice, once with the pings 1 s apart and once with them 5 s apart, and counts how many echo requests n23b sees each time.` },
        {
          lab: {
            explain: 'Count echo requests seen on n23b: pings 1 s apart, then 5 s apart (expect 1 then 2)',
            cmd: `${NEED_BR23}
sleep 5
echo "== 3 pings, 1 s apart (entries stay fresh)"
ip netns exec n23b timeout 5 tcpdump -nl -i eth0 icmp 2>/dev/null | grep -c 'echo request' &
sleep 1; ip netns exec n23a ping -c3 -i1 -q 10.23.0.3 >/dev/null; wait
sleep 5
echo "== 2 pings, 5 s apart (entry expires in between)"
ip netns exec n23b timeout 7 tcpdump -nl -i eth0 icmp 2>/dev/null | grep -c 'echo request' &
sleep 1; ip netns exec n23a ping -c2 -i5 -q 10.23.0.3 >/dev/null; wait`,
          },
        },
        { md: `With pings 1 s apart n23b saw **1** request: the first one flooded, and the entries never expired afterwards. With pings 5 s apart it saw **2** of 2: every ping arrived at a table that had already forgotten n23c.

> [!IMPORTANT]
> Flooding returns whenever the entry for a destination is missing: the host has been quiet for longer than \`ageing_time\`, or the table was flushed.

Flushing is also the quick way to reproduce a flood on demand, which is why chapter 2.2 used \`fdb_flush\` to make the table forget everything. Ageing is the same forgetting, done by a timer instead of by you.` },
        {
          widget: {
            id: 'w-flood-again',
            sim: 'switch-flood',
            title: 'The same three frames, again',
            hint: 'Click through once. Then ask: if C were silent for longer than ageing_time between the second and third click, what would the third click do?',
            takeaway: 'The simulator keeps entries forever. A real switch deletes them after `ageing_time` of silence, and the third frame would flood like the first.',
          },
        },
      ],
    },
    {
      id: 'why',
      title: 'Why a table stays empty',
      blocks: [
        { md: `Picture two switches, S1 and S2, with a link between them. Host A hangs off S1 and host C off S2. Because of how the network is cabled, A's frames toward C pass through S1, but C's replies take a **different path** and never go through S1.` },
        {
          checkpoint: {
            id: 'c2',
            prompt: "A sends a steady stream of unicast frames to C through S1. C's replies never touch S1. What does S1 do with the frames for C?",
            options: [
              'Floods the first frame, then forwards the rest out one port once C is learned',
              'Drops them: with no entry for C it cannot know which port leads to C',
              'Floods every one of them, because S1 never sees a frame with source C',
              'Learns C from the destination field of the first frame and forwards from then on',
            ],
            key: 2,
            why: 'The switch learns only from source addresses. If no frame from C ever arrives at S1, the entry for C never appears, so every frame for C is an unknown unicast.',
          },
        },
        { md: `That's **asymmetric forwarding**: the forward and return paths differ, and the switch on the forward path never hears the return traffic. In table terms, S1 has *never seen C as a source*, which is a second way an entry stays missing, besides expiry. The flood is not a one-off here. It repeats for every frame. A host that never sends can never be learned, so a busy receiver that rarely transmits gets flooded to for as long as the sender keeps talking.

The classic way it appears is a mismatch of timers. A host's ARP cache can hold C's MAC for longer than a switch holds C's MAC-table entry. After the switch forgets C, A keeps sending unicast straight to C's MAC without any new ARP, and if C's replies don't pass through that switch, nothing ever refills the entry. This is general L2 behaviour; no lab here reproduces it, and the timers differ per system.

There is a related failure you should know by name: **MAC-table exhaustion**. A switch's table has a finite size. If it fills up, new MACs can't be stored, so frames for them are treated as unknown and flooded. A flood of frames with made-up source MACs can fill a table, which is why many switches limit how many MACs a port may learn. That's the concept only; the point for you is that "unknown" can mean "never stored" as well as "expired".

Linux bridges also give you per-port flags for this, \`learning\` and \`flood\`, set with \`bridge link set\`. You'll test \`flood\`. The lab sets \`flood off\` on n23b's port, \`v232\`, and prints the port's flags. After a few seconds the table is empty again. Then n23a pings n23c with ARP pinned, as before. In a second step, the neighbour entry for n23c is deleted, so n23a has to send an ARP broadcast to find it.` },
        {
          checkpoint: {
            id: 'c3',
            prompt: "With flood off on n23b's port: n23a sends an ARP request (a broadcast) for 10.23.0.3. Does n23b's NIC see it?",
            options: [
              'Blocked: flood off blocks everything toward the port',
              'Not forwarded: ARP is layer 3, so the bridge does not forward it',
              'Seen: flood off covers only unknown unicast, and broadcasts take their own flag',
              'Seen, then hidden: the bridge learns n23b and stops sending',
            ],
            key: 2,
            why: 'The flood flag covers only unicast frames whose destination is not in the table. The ARP request goes to ff:ff:ff:ff:ff:ff, and broadcast flooding is controlled separately by bcast_flood, which is still on.',
          },
        },
        {
          lab: {
            explain: 'flood off on n23b’s port: count the unknown-unicast echo, then the ARP request it still gets (expect 0, then 1)',
            cmd: `${NEED_BR23}
bridge link set dev v232 flood off
echo "v232 flags: $(bridge -d link show dev v232 | grep -o 'learning [a-z]* flood [a-z]* mcast_flood [a-z]* bcast_flood [a-z]*')"
sleep 4
echo "== unknown unicast to n23c (ARP pinned), echo requests seen on n23b:"
ip netns exec n23b timeout 3 tcpdump -nl -i eth0 icmp 2>/dev/null | grep -c 'echo request' &
sleep 1; ip netns exec n23a ping -c1 -W1 -q 10.23.0.3 >/dev/null; wait
echo "== ARP broadcast (neighbour entry removed), ARP requests seen on n23b:"
ip -n n23a neigh del 10.23.0.3 dev eth0
ip netns exec n23b timeout 3 tcpdump -nl -i eth0 arp 2>/dev/null | grep -c 'who-has' &
sleep 1; ip netns exec n23a ping -c1 -W1 -q 10.23.0.3 >/dev/null; wait
bridge link set dev v232 flood on`,
          },
        },
        { md: `The unknown-unicast ping stayed hidden from n23b (0), but the ARP request still arrived (1). \`flood off\` closes one door, and broadcast comes in through another.

From the man page of \`bridge link set\`:

- \`learning off\` stops the port learning source MACs from traffic. With it off, the bridge floods any traffic it has no entry for.
- \`flood off\` stops **unicast with no FDB entry** being sent toward this port. Broadcast and multicast have their own flags, \`bcast_flood\` and \`mcast_flood\`. All of them default to on.

The lab turns \`flood\` back on at the end, and it deletes n23a's pinned ARP entry, so run the build lab again before repeating it.` },
      ],
    },
    {
      id: 'twins',
      title: "Where you've met this",
      blocks: [
        { md: `**Proxmox.** \`vmbr0\` is a Linux bridge with all of the above. A VM that goes quiet ages out of the FDB, and until it sends again frames for it are flooded to every other VM's tap. Proxmox can switch MAC learning off per bridge with \`bridge-disable-mac-learning 1\` (since PVE 7.3); it then adds each guest's own MAC to the bridge's forwarding database by hand, so guests using their real MAC still get unicast delivery without learning ([Proxmox wiki](https://pve.proxmox.com/wiki/Network_Configuration)).

**AWS VPC.** AWS says it does not support broadcast in a VPC ([subnet sizing](https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html)). There is no MAC table for you to age out and no unknown-unicast flood to watch. AWS doesn't publish how it delivers a unicast frame; the safe mental model is that the destination is looked up in a mapping AWS programs, not learned from traffic.

**Kubernetes / Cilium.** In overlay mode the datapath doesn't rely on a learning switch between nodes, and this chapter does not rely on any Cilium internals. Flooding shows up only when some CNI uses a plain Linux bridge on a node, and then the FDB behaves like \`br23\`.` },
      ],
    },
    {
      id: 'keep',
      title: 'What to keep',
      blocks: [
        { md: `- BUM = broadcast, unknown unicast, multicast. The three take the flood path.
- A learned entry lives for \`ageing_time\` after the last frame *from* that MAC. Quiet hosts get flooded to again.
- Only sources are learned. When the return path skips a switch, that switch floods every frame, and a full table does the same for MACs it can't store.
- On a Linux bridge, \`learning\` and \`flood\` are per-port. \`flood off\` stops unknown unicast only; broadcast and multicast have their own flags.` },
      ],
    },
  ],
};
