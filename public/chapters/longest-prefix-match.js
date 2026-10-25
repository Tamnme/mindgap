// Chapter 3.4: Longest-prefix match. Authored content; the tutor gets this file as chapter_source.
// Labs run in netlab (Ubuntu 26.04, iproute2 6.19) on 2026-10-25; outputs described in the prose were observed.
// Sources: https://docs.aws.amazon.com/vpc/latest/userguide/route-tables-priority.html (AWS uses the most specific matching route, "longest prefix match", e.g. 10.10.2.15/32 over 10.10.2.0/24; then static routes, prefix-list routes, propagated routes),
//   https://docs.aws.amazon.com/vpc/latest/userguide/subnet-route-tables.html (example table: 172.31.0.0/16 to a peering connection and 0.0.0.0/0 to an internet gateway; "we use the most specific route that matches the traffic"),
//   https://man7.org/linux/man-pages/man8/ip-route.8.html (ip route get, via, metric: lower values are preferred).
// Hedged, not sourced: the Kubernetes remark is general knowledge about node routing tables and depends on the CNI. Everything about the kernel's choice is from the lab output.

const NEED = `ip link show br34 >/dev/null 2>&1 || { echo "Run the first lab (build br34) first."; exit 1; }`;

export default {
  node: 'longest-prefix-match',
  number: '3.4',
  kicker: 'Layer 3',
  title: 'Longest-prefix match',
  lede: 'A routing table can hold several routes that all contain the same destination address. The kernel still has to choose exactly one next hop for each packet, and how it chooses is what this chapter pins down.',
  sections: [
    {
      id: 'overlap',
      title: 'Two routes that both fit',
      blocks: [
        { md: `From chapter 3.1, a prefix is a set of addresses. \`10.34.5.0/24\` is every address from \`.0\` to \`.255\` in that block. \`10.34.5.64/26\` is only \`.64\` to \`.127\`, a block of 64 inside it. So \`10.34.5.77\` belongs to both.

Host **H** (\`10.34.0.10/24\`) has a connected route for its own segment and a default route via \`10.34.0.1\`. Two neighbours on the same segment can forward for it: **X** (\`10.34.0.11\`) and **Y** (\`10.34.0.12\`). An admin adds two routes, in this order:

\`\`\`
1st   10.34.5.0/24    via 10.34.0.11   (X)
2nd   10.34.5.64/26   via 10.34.0.12   (Y)
\`\`\`

Then H sends a packet to \`10.34.5.77\`.` },
        {
          checkpoint: {
            id: 'c1',
            prompt: 'Both routes contain 10.34.5.77. Which next hop does H use for it?',
            options: [
              'Top of the table: the /24 was added first, so it is read first',
              'Biggest network: the /24 covers more addresses, so it is the safer match',
              'Narrowest range: the /26 describes 10.34.5.77 more tightly',
              'Shared: X and Y each get a share of the traffic',
            ],
            key: 2,
            why: 'Both routes match, so the kernel needs a tie-break among matches, and it takes the one with the longest prefix. The /26 is longer than the /24, so Y carries 10.34.5.77 even though the /24 was added first.',
          },
        },
        { md: `The lab builds H, X, Y and a bridge \`br34\`, adds the two routes in the order above, and asks the kernel with \`ip route get\` about four destinations. \`route get\` runs the same lookup a real packet would.` },
        {
          lab: {
            explain: 'Build H, X and Y on br34, add the /24 then the /26, print the table, then ask the kernel for four destinations',
            cmd: `for n in n34h n34x n34y; do ip netns del $n 2>/dev/null; done
ip link del br34 2>/dev/null; for v in v34h v34x v34y; do ip link del $v 2>/dev/null; done; sleep 0.5
ip link add br34 type bridge && ip link set br34 up
for n in h x y; do
  ip netns add n34$n
  ip netns exec n34$n sysctl -qw net.ipv6.conf.all.disable_ipv6=1 net.ipv6.conf.default.disable_ipv6=1
  ip link add v34$n type veth peer name eth0 netns n34$n
  ip link set v34$n master br34 up; ip -n n34$n link set eth0 up
  case $n in h) a=10;; x) a=11;; y) a=12;; esac
  ip -n n34$n addr add 10.34.0.$a/24 dev eth0
done
ip -n n34h route add 10.34.5.0/24 via 10.34.0.11
ip -n n34h route add 10.34.5.64/26 via 10.34.0.12
ip -n n34h route add default via 10.34.0.1
sleep 1
echo "--- H's table:"; ip -n n34h route show
for d in 10.34.5.77 10.34.5.10 10.34.5.200 10.34.9.9; do echo "get $d: $(ip -n n34h route get $d | head -1)"; done`,
          },
        },
        { md: `\`10.34.5.77\` goes via \`10.34.0.12\`, Y, the /26. \`10.34.5.10\` and \`10.34.5.200\` are in the /24 but outside the /26, so both go via \`10.34.0.11\`, X. \`10.34.9.9\` is in neither, so it falls through to the default via \`10.34.0.1\`.

Look at the default route: \`0.0.0.0/0\` matches all four destinations, including \`.77\`. It lost every time it had company. The listing is only the stored routes; nothing in it says which one wins. Only \`route get\` does.

> [!IMPORTANT]
> When several routes match, the route with the **longest prefix** wins. Position in the table and the order you added routes play no part.

Why does that make sense? A longer prefix pins more of the address bits, so it is a more specific statement about the destination. In the last octet, \`77\` is \`01001101\` and a /26 fixes its first two bits (\`01\`), which is what gives \`.64\` to \`.127\`. An admin who writes the /26 after the /24 is making an exception, and the exception has to beat the general rule or it would never take effect.

\`0.0.0.0/0\` is the extreme case: zero bits fixed, matches everything, wins only when nothing longer matches. That is what a default route is.` },
        {
          widget: {
            id: 'w-lpm',
            kind: 'routes',
            title: 'Which route wins?',
            hint: 'Start with 10.34.5.77 and see which rows match before reading the winner. Then try 10.34.5.200 and 10.34.9.9.',
            takeaway: 'For 10.34.5.77, three rows match and the /26 wins; for 10.34.5.200 two match and the /24 wins; for 10.34.9.9 only the default matches. Prefix length picks the winner each time.',
            caption: 'H\'s routing table',
            routes: [
              { prefix: '10.34.0.0/24', target: 'eth0 (connected)' },
              { prefix: '10.34.5.0/24', target: 'next hop 10.34.0.11' },
              { prefix: '10.34.5.64/26', target: 'next hop 10.34.0.12' },
              { prefix: '0.0.0.0/0', target: 'next hop 10.34.0.1' },
            ],
            dest: '10.34.5.77',
            presets: ['10.34.5.77', '10.34.5.200', '10.34.9.9', '10.34.0.30'],
          },
        },
      ],
    },
    {
      id: 'byhand',
      title: 'Doing the match by hand',
      blocks: [
        { md: `You can reproduce the kernel's choice with a mask and a comparison. A route matches when the destination, with the host bits zeroed by that route's mask, equals the route's network address. Take two destinations from the lab and test them against each route, last octet only:

| Route | Mask, last octet | \`.77\` becomes | \`.200\` becomes | Network |
|---|---|---|---|---|
| \`10.34.5.0/24\` | \`0\` | \`.0\` | \`.0\` | \`.0\` |
| \`10.34.5.64/26\` | \`192\` | \`.64\` | \`.192\` | \`.64\` |
| \`0.0.0.0/0\` | (no bits) | any | any | any |

\`.77\` is \`01001101\`; with mask \`11000000\` it keeps \`01000000\`, which is \`.64\`: a match. \`.200\` is \`11001000\`; the same mask leaves \`11000000\`, which is \`.192\`: no match. The /24 matches both, since its mask zeroes the whole last octet. Then of the routes that matched, the kernel keeps the one with the most mask bits. The default route's mask has none.

You can run this check in your head on any table, and it is the check the widget above does for each row. Cloud consoles show the same table without the arithmetic, so it is worth being able to do it when a route does something you did not expect.` },
      ],
    },
    {
      id: 'host',
      title: 'A route for one address',
      blocks: [
        { md: `Now one host, \`10.34.5.77\`, has to go through X after all. The admin adds a /32, a prefix with all 32 bits fixed, so it describes exactly one address:

\`\`\`
10.34.5.77/32   via 10.34.0.11   (X)
\`\`\`

The /24 and the /26 stay in the table. H then looks up \`10.34.5.77\` and its neighbour \`10.34.5.78\`.` },
        {
          checkpoint: {
            id: 'c2',
            prompt: 'With the /24, the /26 and the new /32 all in place, where do 10.34.5.77 and 10.34.5.78 go?',
            options: [
              'Each address on its own: .77 uses the /32, .78 still uses the /26',
              'The /32 takes the whole /26: both .77 and .78 now go to X',
              'Older route wins: the /26 was there first, so both still go to Y',
              '.78 drops to the /24: adding the /32 pushes the /26 aside',
            ],
            key: 0,
            why: 'Every packet gets its own lookup, and each lookup picks the longest match for that one destination. The /32 matches only .77. .78 is untouched by it, so its best match is still the /26.',
          },
        },
        {
          lab: {
            explain: 'Add the /32, look up .77 and .78, then delete the /26 and look them up again',
            cmd: `${NEED}
ip -n n34h route replace 10.34.5.0/24 via 10.34.0.11
ip -n n34h route replace 10.34.5.64/26 via 10.34.0.12
ip -n n34h route del 10.34.5.77/32 2>/dev/null
g() { for d in 10.34.5.77 10.34.5.78; do echo "get $d: $(ip -n n34h route get $d | head -1)"; done; }
echo "before:"; g
ip -n n34h route add 10.34.5.77/32 via 10.34.0.11
echo "after adding the /32:"; g
ip -n n34h route del 10.34.5.64/26
echo "after deleting the /26:"; g
ip -n n34h route replace 10.34.5.64/26 via 10.34.0.12
ip -n n34h route del default
echo "without a default, 10.34.9.9: $(ip -n n34h route get 10.34.9.9 2>&1 | head -1)"
ip -n n34h route add default via 10.34.0.1`,
          },
        },
        { md: `Before the /32, both go to Y. After it, \`10.34.5.77\` goes via X and \`10.34.5.78\` still goes via Y. A longer route does not replace the shorter ones around it; they coexist, and each destination finds its own best match. Delete the /26 and both addresses end up with X: \`.77\` through the /32, \`.78\` through the /24, the next-longest match left.

The lab ends by deleting the default route and asking about \`10.34.9.9\`, which now matches nothing: the kernel answers \`Network is unreachable\`. Matching is all or nothing. With no route that contains the destination, there is no next hop to fall back to, and the packet is never sent.

That fall-back is why you can carve exceptions out of a wide route and later remove them. This is the usual reason for overlapping routes on purpose. A wide route, say a /16 for \`10.34.0.0/16\` toward a firewall, can have a /24 inside it routed straight to a host, without splitting the /16 into pieces. The wide route stays simple and the exception is one line.

It is also how a broken route table misleads you: a stray long prefix quietly takes a slice of traffic from a route you are staring at.

To debug it, ask the kernel with \`ip route get <destination>\` rather than reading the table by eye.` },
      ],
    },
    {
      id: 'twins',
      title: "Where you've met this",
      blocks: [
        { md: `**AWS VPC.** AWS's route-priority page says it directs traffic using the most specific matching route, the longest prefix match, with \`10.10.2.15/32\` ranking above \`10.10.2.0/24\`. Its example table sends \`172.31.0.0/16\` to a peering connection and \`0.0.0.0/0\` to an internet gateway: traffic to the peer VPC takes the peering route although the default route matches it too. Prefix length is only the first rule. When two routes have the same destination, AWS then ranks static routes (internet gateway, peering and so on) above prefix-list routes above propagated routes.

**Kubernetes.** A node's routing table is the same kind of table and follows the same rule, so a pod-CIDR route there is longer than the default route and wins for pod addresses. Which routes a node actually has depends on the CNI, and this chapter did not check any (general knowledge, not sourced).

**Proxmox.** The host is a Linux machine, so \`ip route get <address>\` on it answers "which route would win" exactly as it did for H.` },
      ],
    },
    {
      id: 'keep',
      title: 'What to keep',
      blocks: [
        { md: `- A destination can match several routes. The kernel picks the one with the longest prefix, so \`/32\` beats \`/26\` beats \`/24\` beats \`/0\`.
- Order of entry and position in the listing do not matter.
- Every packet is looked up on its own, so a long route takes only its own slice and leaves its neighbours alone.
- Delete the long route and traffic falls back to the next-longest match.
- \`ip route get <address>\` shows the real decision.` },
      ],
    },
  ],
};
