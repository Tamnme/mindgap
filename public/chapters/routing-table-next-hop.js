// Chapter 3.5: Routing table and next hop. Authored content; the tutor gets this file as chapter_source.
// Labs run in netlab (Ubuntu 26.04, iproute2 6.19) on 2026-10-25; outputs described in the prose were observed.
// Sources: https://man7.org/linux/man-pages/man8/ip-route.8.html (route syntax: via and dev; ip route get; metric: "routes with lower values are preferred"),
//   https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Route_Tables.html (each route specifies a destination and a target such as an internet gateway, NAT gateway, VPC peering connection or VPN connection).
// Hedged, not sourced: the Kubernetes, Proxmox and AWS-forwarding remarks are general knowledge. The gateway checks (accepted, refused, not recursive) are what this kernel and iproute2 printed in the labs, not a quoted rule.

const NEED = `ip netns list | grep -q n35a || { echo "Run the first lab (build the A-R-B chain) first."; exit 1; }`;

export default {
  node: 'routing-table-next-hop',
  number: '3.5',
  kicker: 'Layer 3',
  title: 'Routing table and next hop',
  lede: 'A route pairs a destination prefix with where to send the packet next: an interface, or a gateway address. Reading those lines correctly is most of what routing configuration, and debugging, comes down to.',
  sections: [
    {
      id: 'anatomy',
      title: 'Reading a route',
      blocks: [
        { md: `Chapter 3.2 showed whose MAC goes on the frame, and chapter 3.4 showed how one route is picked from several. This chapter is about what a route line says once it has been picked.

The lab builds a chain of three network namespaces, with a router in the middle:

\`\`\`
 A 10.35.1.2 ---- 10.35.1.1  R  10.35.2.1 ---- 10.35.2.2 B
      eth0            eth0       eth1               eth0
\`\`\`

R forwards between its two interfaces. B already knows the way back: \`10.35.1.0/24 via 10.35.2.1\`. A has only what the kernel put there when its address was configured. The lab prints A's table, asks for a route to B, then adds one route and asks again.` },
        {
          lab: {
            explain: 'Build the chain A-R-B, show A\'s table, ask for a route to B, add a via route, ask again, then ping',
            cmd: `for n in n35a n35b n35r; do ip netns del $n 2>/dev/null; done; sleep 0.5
mk() { ip netns add $1; ip netns exec $1 sysctl -qw net.ipv6.conf.all.disable_ipv6=1 net.ipv6.conf.default.disable_ipv6=1; ip -n $1 link set lo up; }
mk n35a; mk n35r; mk n35b
ip link add eth0 netns n35a type veth peer name eth0 netns n35r
ip link add eth1 netns n35r type veth peer name eth0 netns n35b
for p in "n35a eth0" "n35r eth0" "n35r eth1" "n35b eth0"; do set -- $p; ip -n $1 link set $2 up; done
ip -n n35a addr add 10.35.1.2/24 dev eth0; ip -n n35r addr add 10.35.1.1/24 dev eth0
ip -n n35r addr add 10.35.2.1/24 dev eth1; ip -n n35b addr add 10.35.2.2/24 dev eth0
ip netns exec n35r sysctl -qw net.ipv4.ip_forward=1
ip -n n35b route add 10.35.1.0/24 via 10.35.2.1
sleep 1
echo "--- A's table:"; ip -n n35a route show
echo "get B: $(ip -n n35a route get 10.35.2.2 2>&1 | head -1)"
ip -n n35a route add 10.35.2.0/24 via 10.35.1.1
echo "--- after adding 10.35.2.0/24 via 10.35.1.1:"; ip -n n35a route show
echo "get B: $(ip -n n35a route get 10.35.2.2 | head -1)"
echo "get R: $(ip -n n35a route get 10.35.1.1 | head -1)"
ip netns exec n35a ping -c1 -W1 10.35.2.2 | sed -n 2p`,
          },
        },
        { md: `A's first table is one line: \`10.35.1.0/24 dev eth0 proto kernel scope link src 10.35.1.2\`. The kernel added it when the address went on \`eth0\`; \`proto kernel\` says so. It has no \`via\`: there is no gateway to name, because the destination is on the wire itself. With only that line, \`route get\` for B answers \`Network is unreachable\`, which is chapter 3.1's "no route matched".

After the new route, \`10.35.2.2\` resolves to \`via 10.35.1.1 dev eth0 src 10.35.1.2\`, and the ping to B comes back. Two different lines now sit in the table:

| Line | Meaning |
|---|---|
| \`10.35.1.0/24 dev eth0 …\` | Connected: the destination itself is the next hop; ARP for the destination. |
| \`10.35.2.0/24 via 10.35.1.1 …\` | Gateway: the next hop is R; ARP for R. B's address appears nowhere in the line. |

\`route get 10.35.1.1\` shows \`dev eth0\` with no \`via\`: R itself is on the connected segment.

The \`src\` field is the address A will put in the packet. The reply path is B's own table: a route only describes one direction, so B needed \`via 10.35.2.1\` to answer.

> [!IMPORTANT]
> A route's \`via\` names the **next hop**, one step away. It does not name the destination, and it does not say what lies beyond R.` },
      ],
    },
    {
      id: 'gateway',
      title: 'Which gateways the kernel accepts',
      blocks: [
        { md: `A's table now has a connected route for \`10.35.1.0/24\` and the \`via 10.35.1.1\` route for \`10.35.2.0/24\`. B (\`10.35.2.2\`) is reachable *through* the second one. Nothing else is configured on A.

Now an admin on A tries to add a route for a new prefix, \`10.35.9.0/24\`, with the gateway \`10.35.7.7\`.` },
        {
          checkpoint: {
            id: 'c1',
            prompt: 'A runs: ip route add 10.35.9.0/24 via 10.35.7.7. What does the kernel do?',
            options: [
              'Accepts and looks up 10.35.7.7 per packet: it will resolve through whatever route matches then',
              'Refuses at add time: the gateway has to be on a network A is attached to',
              'Accepts but keeps it inactive: it turns on once a route to 10.35.7.7 appears',
              'Treats it as connected: the via address is ignored and 10.35.9.0/24 is assumed on eth0',
            ],
            key: 1,
            why: 'The kernel checks the gateway when the route is added. 10.35.7.7 is inside no prefix that A is directly attached to, so the add fails with "Nexthop has invalid gateway".',
          },
        },
        { md: `The lab tries three routes on A. First, one with a gateway that is inside A's connected prefix but that nobody owns, \`10.35.1.99\`. Then the \`10.35.7.7\` gateway from the question. Last, a gateway that A *can* reach, but only through the \`via 10.35.1.1\` route: B's address, \`10.35.2.2\`.` },
        {
          lab: {
            explain: 'Try three gateways on A: 10.35.1.99 (nobody home), 10.35.7.7 (no network), 10.35.2.2 (reachable only through R)',
            cmd: `${NEED}
ip -n n35a route del 10.35.9.0/24 2>/dev/null
echo "--- gateway 10.35.1.99:"
ip -n n35a route add 10.35.9.0/24 via 10.35.1.99 2>&1 && echo "accepted"
echo "get: $(ip -n n35a route get 10.35.9.9 | head -1)"
ip netns exec n35a ping -c1 -W1 10.35.9.9 | grep 'packet loss'
echo "neighbour: $(ip -n n35a neigh show 10.35.1.99)"
ip -n n35a route del 10.35.9.0/24
echo "--- gateway 10.35.7.7:"
ip -n n35a route add 10.35.9.0/24 via 10.35.7.7 2>&1 && echo "accepted"
echo "--- gateway 10.35.2.2 (B, reachable via R):"
ip -n n35a route add 10.35.8.0/24 via 10.35.2.2 2>&1 && echo "accepted"
echo "--- A's table now:"; ip -n n35a route show`,
          },
        },
        { md: `The first route was accepted, \`route get\` shows it, and the ping fails with 100% packet loss. The reason is in A's neighbour table: the entry for \`10.35.1.99\` is in state \`INCOMPLETE\` with no MAC, because A ARPed for the gateway and nobody answered. Accepting a route only means the gateway address fits a connected prefix. It doesn't prove anything lives there.

The \`10.35.7.7\` route is refused: \`Error: Nexthop has invalid gateway.\` The third is refused too, with the same message, although A can really reach \`10.35.2.2\`: it did a ping there in the first lab. On this kernel, A's \`via\` routes don't chain. The gateway must fall inside a connected prefix, not inside another \`via\` route.

That follows from what a next hop is for: the sender has to ARP for it (chapter 3.2), and ARP only works on the local segment. To reach a prefix beyond R, point at R, the one address A can actually frame a packet to. Other routing systems may resolve next hops recursively; that is general knowledge and was not tested here.

> [!IMPORTANT]
> A \`via\` address must lie inside a prefix the host is directly attached to. Accepted does not mean alive: nobody checks the gateway answers.` },
      ],
    },
    {
      id: 'metric',
      title: 'Two routes, one prefix',
      blocks: [
        { md: `Chapter 3.4 compared routes with *different* prefix lengths. What if two routes have the *same* prefix? An admin adds, on A, two gateways for \`10.35.4.0/24\`, in this order:

\`\`\`
1st   10.35.4.0/24   via 10.35.1.1    metric 100
2nd   10.35.4.0/24   via 10.35.1.99   metric 50
\`\`\`

Then A looks up \`10.35.4.4\`.` },
        {
          checkpoint: {
            id: 'c2',
            prompt: 'Both routes have the identical prefix. Which next hop does A pick for 10.35.4.4?',
            options: [
              'First added: the earlier route keeps the traffic until it is removed',
              'Highest metric: the larger number is the more important route',
              'Both alternate: traffic is spread across the two gateways',
              'Lowest metric: the smaller number is preferred',
            ],
            key: 3,
            why: 'Same prefix, so length cannot decide. The metric is the tie-breaker, and a lower value is preferred, so 10.35.1.99 at metric 50 is chosen.',
          },
        },
        {
          lab: {
            explain: 'Add the metric 100 route, then the metric 50 route; look up 10.35.4.4; delete the metric 50 route; look up again',
            cmd: `${NEED}
ip -n n35a route del 10.35.4.0/24 2>/dev/null; ip -n n35a route del 10.35.4.0/24 2>/dev/null
ip -n n35a route add 10.35.4.0/24 via 10.35.1.1 metric 100
ip -n n35a route add 10.35.4.0/24 via 10.35.1.99 metric 50
echo "--- both stored:"; ip -n n35a route show 10.35.4.0/24
echo "get 10.35.4.4: $(ip -n n35a route get 10.35.4.4 | head -1)"
ip -n n35a route del 10.35.4.0/24 metric 50
echo "after deleting metric 50: $(ip -n n35a route get 10.35.4.4 | head -1)"`,
          },
        },
        { md: `Both routes are stored, one line each, with their metrics. \`route get\` picks \`via 10.35.1.99\`, the metric 50 route that was added *second*, and falls back to \`via 10.35.1.1\` when it is deleted. The ip-route manual page says that routes with lower \`metric\` values are preferred. This is how a primary and a backup path are written: same prefix, different metrics.

The lab's primary is a gateway nobody owns, and the kernel doesn't know that. A route is chosen from the table; whether the gateway responds is a separate question.

Now add a third route, more specific than both: \`10.35.4.128/25 via 10.35.1.1 metric 500\`. The metric-50 route is back in the table, \`10.35.4.0/24 via 10.35.1.99\`. A looks up \`10.35.4.130\`, which both the /24 and the /25 contain.` },
        {
          checkpoint: {
            id: 'c3',
            prompt: 'The /24 has metric 50 and the /25 has metric 500. Both contain 10.35.4.130. Which wins?',
            options: [
              'Longer prefix first: the /25 wins and the metric never gets asked',
              'Lowest metric overall: 50 beats 500, so the /24 wins',
              'Oldest route: whichever was added first',
              'The packet is dropped: two conflicting matches make the kernel give up',
            ],
            key: 0,
            why: 'Prefix length is compared before anything else. The metric only separates routes with the same destination prefix, so the /25 wins even with the much higher number.',
          },
        },
        {
          lab: {
            explain: 'Restore the metric 50 route, add the /25 with metric 500, look up 10.35.4.130 and 10.35.4.5',
            cmd: `${NEED}
for m in 50 100 500; do ip -n n35a route del 10.35.4.0/24 metric $m 2>/dev/null; done; ip -n n35a route del 10.35.4.128/25 2>/dev/null
ip -n n35a route add 10.35.4.0/24 via 10.35.1.1 metric 100
ip -n n35a route add 10.35.4.0/24 via 10.35.1.99 metric 50
ip -n n35a route add 10.35.4.128/25 via 10.35.1.1 metric 500
echo "--- table:"; ip -n n35a route show | grep 10.35.4
for d in 10.35.4.130 10.35.4.5; do echo "get $d: $(ip -n n35a route get $d | head -1)"; done`,
          },
        },
        { md: `\`10.35.4.130\` goes via \`10.35.1.1\`, the /25, although its metric is 500. \`10.35.4.5\` is outside the /25, so it falls to the /24 and takes the metric 50 route, via \`10.35.1.99\`.

So there are two comparisons, in order: first the longest prefix, then, among routes with the same prefix, the lowest metric. Here is the whole decision as one sequence:

1. Keep only routes whose prefix contains the destination.
2. Keep the longest of those.
3. Among those left, take the lowest metric.
4. The winner gives \`via\` (ARP for the gateway) or \`dev\` only (ARP for the destination).

Step 3 is what this lab ran. For tie-breaks beyond metric (equal-cost multipath and the like) this chapter makes no claim.` },
      ],
    },
    {
      id: 'twins',
      title: "Where you've met this",
      blocks: [
        { md: `**AWS VPC.** AWS says each route in a table specifies a destination and a target, such as an internet gateway, NAT gateway, peering connection or VPN connection. The target does the job of the next hop. What you cannot see is the ARP step: AWS doesn't publish how its forwarding is built, so treat the table as the intent and the delivery as AWS's job. There is no \`ip route\` on a subnet.

**Kubernetes.** \`ip route\` on a node is the same table, and \`ip route get <pod-ip>\` shows the chosen next hop. What the table contains, whether pod CIDRs appear as \`dev\` routes or \`via\` other nodes, depends on the CNI (general knowledge, not sourced or tested here).

**Proxmox.** On the host, \`ip route\` shows the connected prefix on \`vmbr0\` and a default \`via\` the physical gateway, the same two kinds of line A had (general knowledge, not tested here).` },
      ],
    },
    {
      id: 'keep',
      title: 'What to keep',
      blocks: [
        { md: `- \`dev\` only: the destination is on the wire, so the next hop is the destination. \`via X\`: the next hop is X.
- \`via\` must be an address inside a prefix the host is directly attached to. This kernel refused gateways reachable only through another \`via\` route.
- The kernel checks the gateway when the route is added. It does not check that anything answers.
- Lookup order: longest prefix first, then lowest metric among routes with that prefix.
- \`ip route get <address>\` shows what the kernel will actually do.` },
      ],
    },
  ],
};
