// Chapter 2.4: Broadcast domain. Authored content; the tutor gets this file as chapter_source.
// Labs run in netlab (Ubuntu 26.04, iproute2 6.19) on 2026-10-25; outputs described in the prose were observed.
// Sources: https://datatracker.ietf.org/doc/html/rfc919 (section 6: a gateway must not forward a broadcast received on the network it is addressed to, and counts itself as a destination;
//   255.255.255.255 is a local-network broadcast that must not be forwarded),
//   https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html (AWS: the last subnet address is reserved as the "network broadcast address", "We do not support broadcast in a VPC").
// No widget: the only sim scenario for this topic, vlan-broadcast, belongs to chapter 2.5 (VLANs), and none of the others fits a router between two segments.
// Hedged, not sourced: the Proxmox and Cilium notes are general behaviour of a Linux bridge / overlay, labelled as such in the text.

const NEED_BR24 = `ip link show br24a >/dev/null 2>&1 || { echo "Run the first lab (build the two bridges) first."; exit 1; }`;

// One capture per listener; prints how many ARP requests each saw, then the requests.
const CAPTURE = (trigger) => `${NEED_BR24}
for n in n24a n24b n24c n24r; do ip -n $n neigh flush all; done
d=$(mktemp -d)
cap() { ip netns exec $1 timeout 3 tcpdump -nl -i $2 arp > $d/$3 2>/dev/null & }
cap n24c eth0 1_n24c
cap n24r ethA 2_router_ethA
cap n24r ethB 3_router_ethB
cap n24b eth0 4_n24b
sleep 1
${trigger}
wait
for f in $d/*; do echo "$(basename $f): $(grep -c Request $f) request(s)"; grep Request $f | sed 's/^[0-9:.]* /    /; s/, length.*//'; done
rm -rf $d`;

export default {
  node: 'broadcast-domain',
  number: '2.4',
  kicker: 'Layer 2',
  title: 'Broadcast domain',
  lede: 'A broadcast is addressed to everyone, so what matters is who counts as "everyone". This chapter pins down where that set ends, and what a router does at its edge.',
  sections: [
    {
      id: 'frame',
      title: 'One frame, every port',
      blocks: [
        { md: `In chapter 2.3 you met the three kinds of frame that a switch floods. Broadcast is the one that floods *always*: its destination MAC is \`ff:ff:ff:ff:ff:ff\`, which never appears as a source, so it can never be in the table.

The most common broadcast is the one you already know: the ARP request. When n24a wants the MAC of 10.24.1.3, it can't address the frame to that MAC, because that's the thing it's asking for. So it sends:

\`\`\`
+-------------------+-----------+------+---------------------------+
| dst MAC           | src MAC   | type | payload                   |
| ff:ff:ff:ff:ff:ff | n24a      | ARP  | who-has 10.24.1.3?        |
+-------------------+-----------+------+---------------------------+
\`\`\`

Now the lab network. There are two bridges, **br24a** and **br24b**, and a router (a network namespace with IP forwarding switched on) with one leg on each. n24a and n24c are on br24a (10.24.1.0/24); n24b is on br24b (10.24.2.0/24). The router's legs are 10.24.1.254 on \`ethA\` and 10.24.2.254 on \`ethB\`, and every host uses its router leg as its default gateway.

\`\`\`
 n24a   n24c   router.ethA        router.ethB   n24b
   |      |        |                  |           |
 --+------+--------+--  br24a    br24b --+--------+--
\`\`\`

A router is a different box from a switch (chapter 3.3 covers that). For now, treat it as a host that has two NICs and forwards IP packets between them.` },
        {
          lab: {
            explain: 'Build br24a + br24b joined by router n24r (ip_forward=1), then ping across it (expect 1 received)',
            cmd: `for n in n24a n24b n24c n24r; do ip netns del $n 2>/dev/null; done
for l in v24a v24b v24c v24ra v24rb x24a; do ip link del $l 2>/dev/null; done; sleep 0.5
for b in br24a br24b; do ip link del $b 2>/dev/null; ip link add $b type bridge; ip link set $b up; done
for n in n24a n24b n24c n24r; do ip netns add $n
  ip netns exec $n sysctl -qw net.ipv6.conf.all.disable_ipv6=1 net.ipv6.conf.default.disable_ipv6=1; done
attach() { ip link add v$1 type veth peer name eth0 netns n$1
  ip link set v$1 master $2 up; ip -n n$1 link set eth0 up
  ip -n n$1 addr add $3 dev eth0; ip -n n$1 route add default via $4; }
attach 24a br24a 10.24.1.1/24 10.24.1.254
attach 24c br24a 10.24.1.3/24 10.24.1.254
attach 24b br24b 10.24.2.2/24 10.24.2.254
ip link add v24ra type veth peer name ethA netns n24r; ip link set v24ra master br24a up
ip link add v24rb type veth peer name ethB netns n24r; ip link set v24rb master br24b up
ip -n n24r link set ethA up; ip -n n24r addr add 10.24.1.254/24 dev ethA
ip -n n24r link set ethB up; ip -n n24r addr add 10.24.2.254/24 dev ethB
ip netns exec n24r sysctl -qw net.ipv4.ip_forward=1
echo "router ip_forward = $(ip netns exec n24r sysctl -n net.ipv4.ip_forward)"
ip netns exec n24a ping -c1 -W1 -q 10.24.2.2 | grep -o '[0-9]* received'`,
          },
        },
        { md: `A common first answer to "where does a broadcast go?" is "to the router". Hold on to that, because the next lab tests it. n24a is about to ping n24c, which is on the same bridge, so n24a first has to ARP for it. The lab listens for ARP on four interfaces: n24c, the router's \`ethA\` and \`ethB\`, and n24b.` },
        {
          checkpoint: {
            id: 'c1',
            prompt: 'n24a broadcasts an ARP request for 10.24.1.3. Who gets a copy?',
            options: [
              'Only the router: broadcasts go to the gateway, which sends them on',
              'Every port on br24a, which includes n24c and the router’s ethA leg',
              'Every host on both bridges: the router passes the broadcast through',
              'Only n24c: the switch notices that 10.24.1.3 is the target and delivers it there',
            ],
            key: 1,
            why: 'A broadcast is flooded to every port of the bridge it arrived on except its own. The router’s leg is one of those ports, so it gets a copy as one receiver among several; nothing makes it the only recipient or sends the frame further.',
          },
        },
        {
          lab: {
            explain: 'n24a pings n24c (same bridge); count ARP requests on n24c, router ethA, router ethB, n24b',
            cmd: CAPTURE('ip netns exec n24a ping -c1 -W1 -q 10.24.1.3 >/dev/null'),
          },
        },
        { md: `n24c saw the request. So did the router's \`ethA\`, which is the router's leg on br24a. The router's \`ethB\` and n24b saw **0**. The router was no more special than n24c: it was one more port on the bridge and it got a copy because it was there.

The captures print only requests. The answer is a unicast reply. By the learning rule from chapter 2.2 the switch can send it out one port, because the request taught it n24a's MAC; this lab doesn't capture replies.

Now cross the router. n24a pings n24b at 10.24.2.2. n24b isn't in n24a's subnet, so n24a sends the packet to its default gateway, and before that it has to ARP for the *gateway's* MAC.` },
        {
          checkpoint: {
            id: 'c2',
            prompt: 'n24a pings n24b through the router. Which ARP requests does n24b’s NIC see?',
            options: [
              'n24a’s request for 10.24.1.254: the router forwarded it',
              'No ARP request reaches it: the router blocks everything broadcast, ARP included',
              'One from the router asking for 10.24.2.2, with the router’s own IP as sender',
              'One from n24a asking for 10.24.2.2 directly, as the router is transparent',
            ],
            key: 2,
            why: 'n24a’s request stays on br24a. When the router needs n24b’s MAC it sends its own, new ARP request out ethB, sender 10.24.2.254. That is a fresh broadcast on the second segment, not a forwarded one.',
          },
        },
        {
          lab: {
            explain: 'n24a pings n24b across the router; count ARP requests on all four listeners (expect 1 each on the A side and the B side)',
            cmd: CAPTURE("ip netns exec n24a ping -c1 -W1 -q 10.24.2.2 | grep -o '[0-9]* received'"),
          },
        },
        { md: `The A side saw \`who-has 10.24.1.254 tell 10.24.1.1\` on n24c and on \`ethA\`. The B side saw \`who-has 10.24.2.2 tell 10.24.2.254\` on \`ethB\` and on n24b. Two broadcasts, one on each segment, with different senders. n24b never saw n24a's request, and n24c never saw the router's.

> [!IMPORTANT]
> A broadcast reaches every port of its L2 segment and stops at the router's interface. The router is a receiver, never a relay. To get to the other side, a router writes a new frame.

That's the rule in [RFC 919](https://datatracker.ietf.org/doc/html/rfc919): a gateway that gets a broadcast on the network it's addressed to *should not* forward it, but should consider itself one of the destinations (the RFC's own example is a routing-table update). The same RFC says 255.255.255.255 is a local-network broadcast and must not be forwarded.

Why does \"to the router\" feel right? Because the router is the thing every host is configured to talk to when the destination isn't local, so it looks like the destination of anything unusual. But a broadcast isn't addressed to the gateway. Its destination is the all-ones MAC, which means \"every port\", and the gateway's leg is one of the ports. The default-gateway setting only matters for IP packets that leave the subnet; the ARP request in lab 2 was for an on-link host and never needed the gateway at all.

There is also a broadcast at the IP layer. 255.255.255.255 means \"everyone on this local network\", and RFC 919 says it must not be forwarded. Hosts put it inside a frame addressed to \`ff:ff:ff:ff:ff:ff\`, so it takes the same flood path. DHCP discovery works this way: a host with no address yet can only shout.

A broadcast *can* be meant for the router. RFC 919's example is that the datagram "might be a routing table update", and it says the gateway should consider itself a destination of the broadcast. The router reads it, as any receiver would. Per the RFC, it should not copy it to \`ethB\`: whatever it needs to say on the other side, it says in a frame of its own.

The RFC also covers a *directed* broadcast, one aimed at a different network's broadcast address. Such a datagram is routed like any other packet until it reaches a gateway attached to that network, and only that last gateway turns it into a link-layer broadcast. Whether a particular router does so today is a configuration choice that this chapter does not test.

So the router *is* where a broadcast ends, and that's the true kernel of "goes to the router". The router is one of the receivers, and the segment ends there. The set of ports a broadcast reaches is the **broadcast domain**.

Now change the cabling. Leave the router and every IP address alone, and add a plain cable (a veth pair) between br24a and br24b. Then n24a pings n24c again, and the lab listens on n24b.` },
        {
          checkpoint: {
            id: 'c3',
            prompt: 'With a cable joining br24a and br24b, n24a broadcasts an ARP request for 10.24.1.3. Does n24b (10.24.2.2/24) see it?',
            options: [
              'One segment via the cable: the cable makes the two bridges one L2 segment, whatever the IPs say',
              'Subnet filter: n24b is in 10.24.2.0/24, so it never receives anything for another subnet',
              'Router drops it: the router sits between them and drops the broadcast',
              'Target only: n24b sees it only because it is the one being asked for',
            ],
            key: 0,
            why: 'A broadcast domain is whatever the frame can reach by switching alone. IP subnets are labels the hosts apply; they do not filter anything at L2. The cable joins the two floods into one.',
          },
        },
        {
          lab: {
            explain: 'Cable the two bridges together, ping n24c from n24a, count ARP requests on n24b (expect 1), then remove the cable',
            cmd: `${NEED_BR24}
for n in n24a n24b n24c n24r; do ip -n $n neigh flush all; done
ip link add x24a type veth peer name x24b
ip link set x24a master br24a up; ip link set x24b master br24b up
sleep 2
d=$(mktemp -d)
ip netns exec n24b timeout 3 tcpdump -nl -i eth0 arp > $d/n24b 2>/dev/null &
sleep 1
ip netns exec n24a ping -c1 -W1 -q 10.24.1.3 >/dev/null
wait
echo "n24b (10.24.2.2) saw $(grep -c Request $d/n24b) request(s):"; grep Request $d/n24b | sed 's/^[0-9:.]* /    /; s/, length.*//'
ip link del x24a; rm -rf $d`,
          },
        },
        { md: `n24b received n24a's request for a host in a different IP subnet. Nothing at layer 2 looks at IP addresses. What decided who got the frame was the cabling, and that is why VLANs (next chapters) are a *layer 2* tool for splitting a broadcast domain: they change which ports a flood may reach, without touching IPs.

Every broadcast interrupts every host in the domain, because in general each NIC hands it up to the kernel to decide whether it cares. This also explains why big flat networks hurt. Every host receives every broadcast from every other host, so ARP, DHCP discovery and the rest add up as the segment grows.` },
      ],
    },
    {
      id: 'twins',
      title: "Where you've met this",
      blocks: [
        { md: `**Proxmox.** A bridge with no VLANs is one broadcast domain: guests on the same \`vmbr0\` get each other's broadcasts. That's general Linux bridge behaviour, as in the lab; with a VLAN-aware bridge it becomes one domain per VLAN (the VLAN chapters build that).

**AWS VPC.** AWS reserves the last address of each subnet as the "network broadcast address" and says it does not support broadcast in a VPC ([subnet sizing](https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html)). A VPC subnet is an IP range. It is not a broadcast domain you can reach with a frame, so the ARP flood of this chapter isn't something you can capture there. AWS doesn't publish how ARP is answered; treat it as handled by the platform, not by flooding.

**Kubernetes / Cilium.** Pods on different nodes don't share an L2 segment in overlay mode, so one pod's broadcast doesn't reach the pods on other nodes the way a switch fabric would. This is general overlay behaviour; the Cilium datapath is the subject of chapter 5.3.` },
      ],
    },
    {
      id: 'keep',
      title: 'What to keep',
      blocks: [
        { md: `- A broadcast (\`ff:ff:ff:ff:ff:ff\`) is flooded to every port of its L2 segment. A switch never has an entry for it.
- A router's interface is one of those ports. The router receives the broadcast as a destination and should not forward it (RFC 919). To reach the other side it sends a new frame.
- A broadcast domain is defined by L2 connectivity (cables, bridges, VLANs), not by an IP subnet.
- A VPC doesn't support broadcast, so a subnet there is an address range, not a broadcast domain.` },
      ],
    },
  ],
};
