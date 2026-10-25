// Chapter: Switch: MAC → port. Authored content; the tutor gets this file as chapter_source.
// Lab commands were run in netlab (Ubuntu 26.04, iproute2 6.19) on 2026-10-25 and produced the outputs described.

const NEED_SW0 = `ip link show sw0 >/dev/null 2>&1 || { echo "Run the first lab (build sw0) first."; exit 1; }`;

export default {
  node: 'switch-mac-table',
  number: '2.2',
  kicker: 'Layer 2',
  title: 'Switch: MAC → port',
  lede: 'A switch can see two things: the Ethernet header and the port a frame came in on. Everything it does follows from that.',
  sections: [
    {
      id: 'see',
      title: 'What a switch can see',
      blocks: [
        { md: `You already know ARP: before A sends anything to C on the same subnet, A has found C's MAC. So the frame that leaves A's NIC is fully addressed:

\`\`\`
+-----------+-----------+------+-------------------------------+
| dst MAC   | src MAC   | type | payload                       |
| cc:03     | aa:01     | IPv4 | IP packet 10.0.0.1 → 10.0.0.3 |
+-----------+-----------+------+-------------------------------+
\`\`\`

A switch is a box with ports. When a frame arrives, the switch has the frame and the number of the port it came in on, and nothing else. A plain switch has no IP address on its ports and never opens the payload. There is an IP packet in there, but the switch doesn't read it.

> [!IMPORTANT]
> A switch decides using two things only: the Ethernet header, and the port the frame arrived on.

Now put three hosts on a switch that has just booted, with an empty table: **A on port 1, B on port 2, C on port 3**. A sends one frame to C.` },
        {
          checkpoint: {
            id: 'c1',
            prompt: "After that one frame, what does the switch's table hold?",
            options: [
              'MAC_C → port 3: it records where the frame is going',
              'MAC_A → port 1: it records where the frame came from',
              '10.0.0.1 → MAC_A: it maps the sender’s IP to its MAC',
              'Nothing yet: it learns only once C replies',
            ],
            key: 1,
            why: 'The frame came in on port 1 with source aa:01, so aa:01 must live behind port 1. Nothing in it says where C is.',
          },
        },
        { md: `The frame can't tell the switch where C is. It is addressed *to* C, which says nothing about where C sits. But it proves one thing for certain: a frame with source \`aa:01\` just came in on port 1, so \`aa:01\` lives behind port 1. That is the whole learning rule.

> [!IMPORTANT]
> On every frame, the switch records **source MAC → ingress port**. It learns from senders, never from destinations.

Mapping IP → MAC is ARP's job, and the hosts do it. It's easy to blur the two tables because both hold MACs, so keep them apart:

| Table | Lives on | Maps | Filled by |
|---|---|---|---|
| ARP / neighbour cache | each host | IP → MAC | ARP replies |
| MAC table (FDB) | the switch | MAC → port | the source MAC of every frame |` },
        {
          widget: {
            id: 'w-learning',
            sim: 'switch-learning',
            title: 'Learning from source',
            hint: 'Predict which entry each frame adds, then click to check.',
            takeaway: 'Every entry comes from a frame’s **source**. A host that never sends never appears in the table.',
          },
        },
      ],
    },
    {
      id: 'flood',
      title: "When the switch doesn't know",
      blocks: [
        { md: `Back to the moment after A's first frame. The table has one entry, \`aa:01 → port 1\`. The frame the switch is holding is for \`cc:03\`, which is not in the table, and the switch has to do something with it now.` },
        {
          checkpoint: {
            id: 'c2',
            prompt: 'The table only knows A. What does the switch do with the frame for C?',
            options: [
              'Drops it: frames for unknown destinations are discarded',
              'Holds it and asks the hosts who owns cc:03',
              'Sends a copy out every port except port 1',
              'Sends a copy out every port, including port 1',
            ],
            key: 2,
            why: "With no idea where C is, the only way to reach C is to try every port. Port 1 is skipped because that's where the frame came from.",
          },
        },
        { md: `This is **flooding**, and you can reason it out yourself. Dropping the frame would break the first frame of every conversation. Asking would need a protocol, and ARP doesn't fit: it asks about IP addresses, and the hosts run it, not the switch. So the switch copies the frame to every other port. It skips port 1 because the frame came from there, and sending it back out would only deliver it to the segment it came from.

B gets a frame that isn't meant for it. B's NIC sees that the destination \`cc:03\` isn't its own MAC and drops it without telling anyone.

Then C replies to A. That frame's source \`cc:03\` arrives on port 3, so the switch learns it. Its destination \`aa:01\` is already known, so it goes out port 1 only. From then on, traffic between A and C uses one port each way, and B sees none of it.

> [!IMPORTANT]
> Unknown destination: flood out every port except the one it came in on. Known destination: out one port. Broadcast (\`ff:ff:ff:ff:ff:ff\`): always flood.` },
        {
          widget: {
            id: 'w-flood',
            sim: 'switch-flood',
            title: 'Unknown unicast vs known',
            hint: 'Click the buttons in order. Watch who receives the first frame, then the last one.',
            takeaway: 'The first frame to an unknown MAC reaches everyone. One reply later, the same flow uses a single port.',
          },
        },
      ],
    },
    {
      id: 'lab',
      title: 'Prove it on a real bridge',
      blocks: [
        { md: `A Linux bridge is a software switch with exactly these rules, and Proxmox's \`vmbr0\` is one. Build one in netlab, with three network namespaces as the hosts: **hA on p1, hB on p2, hC on p3**, all in 10.0.0.0/24.

IPv6 is turned off inside the namespaces. With it on, each host sends traffic of its own (router solicitations, duplicate-address checks) the moment its link comes up, and the table fills before you've done anything.` },
        {
          lab: {
            explain: 'Build switch sw0 with three hosts, then count learned entries (expect 0)',
            cmd: `for n in hA hB hC; do ip netns del $n 2>/dev/null; done; ip link del sw0 2>/dev/null
ip link add sw0 type bridge && ip link set sw0 up
i=1; for n in hA hB hC; do
  ip netns add $n
  ip netns exec $n sysctl -qw net.ipv6.conf.all.disable_ipv6=1 net.ipv6.conf.default.disable_ipv6=1
  ip link add p$i type veth peer name eth0 netns $n
  ip link set p$i master sw0 up
  ip -n $n link set eth0 up; ip -n $n addr add 10.0.0.$i/24 dev eth0
  i=$((i+1))
done
sleep 1
echo "learned entries: $(bridge fdb show br sw0 | grep -vc permanent)"`,
          },
        },
        { md: `Now hA pings hC once. Before ping can send anything, hA needs hC's MAC, so it sends an ARP request. That's a broadcast.` },
        {
          lab: {
            explain: "hA pings hC once; list each host's MAC, then the switch's learned entries",
            cmd: `${NEED_SW0}
ip netns exec hA ping -c1 -W1 10.0.0.3 | sed -n 2p
for n in hA hB hC; do echo "$n eth0 = $(ip -n $n -br link show eth0 | awk '{print $3}')"; done
echo; bridge fdb show br sw0 | grep -v permanent`,
          },
        },
        { md: `You should see two learned entries: hA's MAC on \`p1\` and hC's on \`p3\`. hB's MAC is missing. hB *received* the ARP broadcast, but receiving teaches the switch nothing. Only frames hB *sends* would, and hB hasn't sent any.

Next, make the switch forget everything and send unicast straight away. The lab pins each host's ARP entry for the other, so no broadcast happens, and then flushes the table. hB listens with \`tcpdump\` while hA pings hC three times.` },
        {
          checkpoint: {
            id: 'c3',
            prompt: 'With an empty table and no ARP, hA pings hC three times. How many of the echo requests does hB see?',
            options: ['0: they are unicast to hC', '1: only the first', '2: the first two', '3: all of them'],
            key: 1,
            why: "The first request's destination is unknown, so it floods to hB as well. hC's reply teaches the switch where hC is, so requests 2 and 3 go out p3 only.",
          },
        },
        {
          lab: {
            explain: 'Flush the table, pin ARP, and listen on hB while hA pings hC 3 times',
            cmd: `${NEED_SW0}
mac() { ip -n $1 -br link show eth0 | awk '{print $3}'; }
ip -n hA neigh replace 10.0.0.3 lladdr $(mac hC) dev eth0 nud permanent
ip -n hC neigh replace 10.0.0.1 lladdr $(mac hA) dev eth0 nud permanent
ip link set sw0 type bridge fdb_flush
echo "learned before: $(bridge fdb show br sw0 | grep -vc permanent)"
ip netns exec hB timeout 4 tcpdump -nl -i eth0 icmp 2>/dev/null &
sleep 1
ip netns exec hA ping -c3 -i0.5 -q 10.0.0.3 | tail -2
wait`,
          },
        },
        { md: `hB prints exactly one line, \`seq 1\`. That was the flooded request. Requests 2 and 3 went out \`p3\` only.

One detail: \`tcpdump\` puts hB's NIC into promiscuous mode. That's why it can show you a frame that hB's kernel would otherwise discard because the destination MAC isn't its own.` },
      ],
    },
    {
      id: 'twins',
      title: "Where you've met this",
      blocks: [
        { md: `**Proxmox.** \`vmbr0\` is a Linux bridge. Each VM's tap interface is a port on it, and \`bridge fdb show br vmbr0\` shows the same kind of table you just read. Learned entries expire after the bridge's \`ageing_time\`. A VM that has gone quiet stays in the table until its entry ages out, and once it's gone, frames for it are flooded again until it sends something. MAC learning can be switched off per bridge with \`bridge-disable-mac-learning\` (PVE 7.3+).

**AWS VPC.** Nothing in a VPC learns MACs from traffic. The VPC's software-defined network already knows which ENI owns each address and delivers to it directly, so there's no MAC table to fill and no unknown-unicast flooding. AWS doesn't publish the internals; the safe mental model is that the mapping is *programmed*, not *learned*.

**Kubernetes / Cilium.** In its default VXLAN mode, Cilium keeps its own endpoint-to-node map in eBPF maps instead of learning MACs. If a CNI does use a Linux bridge, that bridge has an FDB just like \`sw0\`.` },
        {
          lab: {
            explain: "Read sw0's ageing time (hundredths of a second)",
            cmd: `${NEED_SW0}
ip -d link show sw0 | grep -o 'ageing_time [0-9]*'`,
          },
        },
        { md: `It prints \`ageing_time 30000\`. The unit is hundredths of a second, so that's 300 s: a learned entry is kept for 5 minutes after the last frame from that MAC.` },
      ],
    },
    {
      id: 'keep',
      title: 'What to keep',
      blocks: [
        { md: `- A switch sees only the Ethernet header and the port a frame came in on. It never reads IP.
- On every frame it learns **source MAC → ingress port**.
- An unknown destination, or a broadcast, floods out every port except the ingress. A known destination goes out one port.
- ARP (IP → MAC) lives on the hosts. The FDB (MAC → port) lives on the switch.` },
      ],
    },
  ],
};
