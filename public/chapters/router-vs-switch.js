// Chapter 3.3: Router vs switch. Authored content; the tutor gets this file as chapter_source.
// Labs run in netlab (Ubuntu 26.04, iproute2 6.19) on 2026-10-25; outputs described in the prose were observed.
// Sources: https://datatracker.ietf.org/doc/html/rfc1812 (section 5.2.1 step 7: the forwarder decrements and checks the TTL, and step 10 finds the link-layer address of the next hop;
//   section 5.3.1: a router MUST decrement the TTL by at least one; section 5.3.4: a router MUST NOT forward a packet it received as a link-layer broadcast unless it is directed to an IP multicast address),
//   https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html (the VPC router sits at the subnet's base + 1, reserved by AWS).
// Hedged, not sourced: how AWS builds the VPC router internally, Cilium/Kubernetes behaviour and the Proxmox ip_forward remark are general knowledge. The "switch changes nothing" contrast is
//   observed only on a Linux bridge (capture on C below), not on other switches.

const NEED = `ip link show br33 >/dev/null 2>&1 || { echo "Run the first lab (build br33) first."; exit 1; }`;
// Join a tcpdump -e -v pair of lines and keep: src > dst MAC, ttl, src > dst IP.
const FLAT = `paste -d' ' - - | grep -a ttl | sed -E 's/^[0-9:.]+ ([0-9a-f:]+ > [0-9a-f:]+),.*ttl ([0-9]+),.*\\) +([0-9.]+ > [0-9.]+):.*/\\1  ttl \\2  \\3/'`;

export default {
  node: 'router-vs-switch',
  number: '3.3',
  kicker: 'Layer 3',
  title: 'Router vs switch',
  lede: 'A switch forwards frames inside one segment by MAC. A router forwards packets between segments by destination IP. The difference is in what each one does to the thing it forwards.',
  sections: [
    {
      id: 'boxes',
      title: 'Two boxes, two lookups',
      blocks: [
        { md: `Chapter 2.2 gave you the switch: it reads the Ethernet header and the ingress port, looks up the destination MAC in its table, and sends the frame out the matching port. The frame leaves exactly as it arrived.

A router has a different job: connect segments that are different subnets (chapter 3.1). Each of its interfaces sits on one segment and so has an IP address in that segment's prefix. The router looks at the **IP destination**, picks an outgoing interface and a next hop from its routing table, and sends the packet that way.

By the chapter 3.2 rule, a host sends to the router's MAC *because* the router is the gateway. So the frame is addressed to the router itself, and the router has to decide what to do with the packet inside.

The lab builds the topology: **A** (\`10.33.0.10\`) and **C** (\`10.33.0.30\`) on a Linux bridge \`br33\` with R's \`eth0\` (\`10.33.0.1\`). R's \`eth1\` is \`10.33.1.1\`, directly connected to **B** (\`10.33.1.20\`). R has \`net.ipv4.ip_forward=1\`.` },
        {
          lab: {
            explain: 'Build br33 (A, C and router R on it), R\'s eth1 to B on a second subnet; show R\'s addresses and forwarding switch',
            cmd: `for n in n33a n33b n33c n33r; do ip netns del $n 2>/dev/null; done
ip link del br33 2>/dev/null; for v in v33a v33c v33r; do ip link del $v 2>/dev/null; done; sleep 0.5
ip link add br33 type bridge && ip link set br33 up
mk() { ip netns add $1; ip netns exec $1 sysctl -qw net.ipv6.conf.all.disable_ipv6=1 net.ipv6.conf.default.disable_ipv6=1; }
for n in a c r; do mk n33$n; ip link add v33$n type veth peer name eth0 netns n33$n; ip link set v33$n master br33 up; ip -n n33$n link set eth0 up; done
mk n33b; ip link add eth1 netns n33r type veth peer name eth0 netns n33b; ip -n n33r link set eth1 up; ip -n n33b link set eth0 up
ip -n n33a addr add 10.33.0.10/24 dev eth0; ip -n n33c addr add 10.33.0.30/24 dev eth0
ip -n n33r addr add 10.33.0.1/24 dev eth0; ip -n n33r addr add 10.33.1.1/24 dev eth1
ip netns exec n33r sysctl -qw net.ipv4.ip_forward=1
ip -n n33b addr add 10.33.1.20/24 dev eth0
ip -n n33a route add default via 10.33.0.1; ip -n n33b route add default via 10.33.1.1
sleep 1
echo "--- R's interfaces:"; ip -n n33r -4 -br addr show | grep -v '^lo'
echo "R ip_forward = $(ip netns exec n33r sysctl -n net.ipv4.ip_forward)"
echo "bridge br33 ports: $(ls /sys/class/net/br33/brif | tr '\\n' ' ')"`,
          },
        },
        { md: `R has one address per interface, one in each subnet. The bridge \`br33\` has three ports, the veths facing A, C and R.

Now A pings C, which shares its segment, and then B, which doesn't. \`tcpdump -e -v\` runs at three points: on C's \`eth0\`, on R's \`eth0\` (A's side) and on R's \`eth1\` (B's side). Each prints source MAC > destination MAC, the packet's TTL, and the packet's source and destination IPs. A sends with TTL 64. The captures keep only echo requests.` },
        {
          checkpoint: {
            id: 'c1',
            prompt: 'A pings B through R. Compare R\'s eth0 capture (A\'s side) with R\'s eth1 capture (B\'s side). What differs?',
            options: [
              'Nothing: R just forwards, so the frame and the packet are identical on both sides',
              'The MACs, but not the TTL: only the Ethernet header is rebuilt',
              'The TTL, but not the MACs: R decrements it and passes the frame on',
              'Both the MACs and the TTL: a new frame, and a packet with TTL one lower',
            ],
            key: 3,
            why: 'R reads the frame addressed to it, takes the packet out, and builds a fresh frame with its own source MAC and B\'s MAC. The packet must have its TTL reduced by one, or loops would never end.',
          },
        },
        {
          lab: {
            explain: 'Ping C, then B, from A; capture echo requests on C eth0, R eth0 and R eth1, with MACs, TTL and IPs; list all MACs',
            cmd: `${NEED}
ip -n n33a neigh flush all; ip -n n33r neigh flush all
cap() { ip netns exec $1 timeout 4 tcpdump -nel -v -i $2 'icmp[icmptype]==icmp-echo' 2>/dev/null | ${FLAT} > /tmp/n33.$1.$2 & }
cap n33c eth0; cap n33r eth0; cap n33r eth1
sleep 1
ip netns exec n33a ping -c1 -W1 10.33.0.30 >/dev/null
ip netns exec n33a ping -c1 -W1 10.33.1.20 | sed -n 2p; wait
echo "--- on C eth0 (A pinged C):";  cat /tmp/n33.n33c.eth0
echo "--- on R eth0 (A pinged B):";  cat /tmp/n33.n33r.eth0
echo "--- on R eth1 (A pinged B):";  cat /tmp/n33.n33r.eth1
echo "--- MACs:"
for x in a:eth0 c:eth0 r:eth0 r:eth1 b:eth0; do echo "n33\${x%%:*} \${x##*:} = $(ip -n n33\${x%%:*} -br link show \${x##*:} | awk '{print $3}')"; done`,
          },
        },
        { md: `On C's \`eth0\` the frame from A has A's source MAC and C's destination MAC, with TTL 64: the bridge changed nothing. On R's side the same ping changes:

- On \`eth0\`: source = A's MAC, destination = R's \`eth0\` MAC, TTL 64.
- On \`eth1\`: source = R's \`eth1\` MAC, destination = B's MAC, TTL 63.

The IPs are \`10.33.0.10 > 10.33.1.20\` on both. The ping's reply line also shows \`ttl=63\`, which fits a reply that started at 64 and crossed R once.

That is RFC 1812's forwarding algorithm in the output: the forwarder decrements the TTL (step 7), and it determines the link-layer address of the next hop (step 10) to build the new frame.

> [!IMPORTANT]
> A switch forwards the *frame* unchanged. A router consumes the frame and sends a *new* one: new MACs on every hop, the IP addresses unchanged and the TTL one lower.` },
      ],
    },
    {
      id: 'bcast',
      title: 'Where broadcasts stop',
      blocks: [
        { md: `A switch floods a broadcast out every port. Chapter 2.4 called the set of ports that hear it a broadcast domain. A router's interfaces belong to different segments.

For this lab, A pings \`10.33.0.99\`, an address no host owns. A has to ARP for it, and that request goes to \`ff:ff:ff:ff:ff:ff\`. \`tcpdump\` on three NICs counts the ARP requests for \`10.33.0.99\`: C's \`eth0\` (same segment as A), R's \`eth0\` (A's side), and B's \`eth0\` (behind R).` },
        {
          checkpoint: {
            id: 'c2',
            prompt: 'A broadcasts an ARP request for 10.33.0.99. Does the request reach B, on the other side of R?',
            options: [
              'Yes: R forwards a broadcast out its other interface like any frame',
              'No: R receives it but does not pass it to the other segment',
              'Yes, as a new frame: R re-sends it with its own source MAC',
            ],
            key: 1,
            why: 'A router forwards packets by their destination IP and never forwards a link-layer broadcast onto another segment, so the broadcast ends at R. This is what makes each router interface the edge of a broadcast domain.',
          },
        },
        {
          lab: {
            explain: 'A pings an unused address; count the ARP requests seen on C eth0, R eth0 and B eth0 (expect B: 0)',
            cmd: `${NEED}
ip -n n33a neigh flush all
cnt() { ip netns exec $1 timeout 4 tcpdump -nl -i eth0 'arp and host 10.33.0.99' 2>/dev/null | grep -c 'who-has' > /tmp/n33.arp.$1 & }
cnt n33c; cnt n33r; cnt n33b
sleep 1
ip netns exec n33a ping -c1 -W2 10.33.0.99 >/dev/null; wait
for n in n33c n33r n33b; do echo "$n saw $(cat /tmp/n33.arp.$n) ARP request(s)"; done`,
          },
        },
        { md: `C and R each count 3 requests. B counts 0. The request was heard by every NIC on A's segment, including R's, and went no further. RFC 1812 §5.3.4 puts it as a rule: a router MUST NOT forward a packet it received as a link-layer broadcast (unless it is directed to an IP multicast address).

This is why a router is also a **fault boundary**: a broadcast storm or a flood of unknown unicast stays inside one segment (general knowledge; the lab shows only the single broadcast).` },
      ],
    },
    {
      id: 'twins',
      title: "Where you've met this",
      blocks: [
        { md: `**AWS VPC.** The router is the VPC router at the subnet's base + 1, reserved by AWS (subnet-sizing page). There is no switch object in a VPC. How AWS builds the VPC router internally isn't published, so the safe mental model is the one you just saw: from an instance's side, a gateway MAC with the destination IP unchanged.

**Kubernetes / Cilium.** A node's kernel routes between the pod network and the outside, with Cilium in the datapath. In overlay mode the tunnel makes remote pods look adjacent, and that is a Cilium design point, not something this lab demonstrates (not sourced here).

**Proxmox.** \`vmbr0\` is the switch, as in chapter 2.2. The upstream router is the router. Setting \`ip_forward\` on the Proxmox host would make it a router too, the same sysctl you saw on R (general knowledge, not sourced).` },
      ],
    },
    {
      id: 'keep',
      title: 'What to keep',
      blocks: [
        { md: `- A switch uses the Ethernet header and the ingress port, has no IP on the path, and forwards the frame unchanged.
- A router has an IP in every segment it joins, forwards by destination IP, and builds a new frame for each hop: new source and destination MAC.
- The router decrements the TTL on every hop: 64 became 63 across R.
- A router doesn't forward broadcasts, so each of its interfaces ends a broadcast domain.` },
      ],
    },
  ],
};
