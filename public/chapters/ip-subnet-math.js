// Chapter 3.1: IP addressing and subnet math. Authored content; the tutor gets this file as chapter_source.
// Labs run in netlab (Ubuntu 26.04, iproute2 6.19) on 2026-10-25; outputs described in the prose were observed.
// Sources: https://datatracker.ietf.org/doc/html/rfc4632 (CIDR prefix notation: a slash and the number of significant bits),
//   https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html (subnets /16 to /28; the first four and the last address of every subnet are reserved: network, VPC router, DNS, future use, broadcast),
//   https://man7.org/linux/man-pages/man8/ip-route.8.html (proto kernel: route installed by the kernel during autoconfiguration).
// Hedged, not sourced: the Kubernetes pod CIDR and ClusterIP remarks (iptables mode) and the Proxmox remark are general knowledge. The meaning of "scope link" in a route line is not quoted from a source;
//   the prose says only what the lab line shows (no "via", an interface and a src).

const NEED = `ip netns list | grep -q n31 || { echo "Run the first lab first."; exit 1; }`;

export default {
  node: 'ip-subnet-math',
  number: '3.1',
  kicker: 'Layer 3',
  title: 'IP addressing and subnet math',
  lede: 'A prefix length splits an address into a network part and a host part. Everything a host decides about "near" and "far" comes from that one split.',
  sections: [
    {
      id: 'split',
      title: 'One address, two parts',
      blocks: [
        { md: `An IPv4 address is 32 bits. A prefix \`/N\` says the first N bits name the network and the remaining 32−N bits name the host inside it. RFC 4632 writes it exactly that way: the slash and the number of significant bits.

Take \`172.16.5.200/27\`. The last octet is 200 = \`11001000\`. The /27 keeps 3 bits of it as network, so it splits as \`110|01000\`:

\`\`\`
network part (27 bits)                       host (5 bits)
10101100.00010000.00000101.110 | 01000
 172    . 16     . 5      . 200 = 11001000
\`\`\`

Zero the host bits and you get the **network address**, \`172.16.5.192\`. Set them all to 1 and you get the **broadcast address**, \`172.16.5.223\`. The block holds 2^5 = 32 addresses, and the 30 between those two are the ordinary host addresses.

> [!IMPORTANT]
> Two addresses are on the same subnet exactly when their first N bits are equal. Every "is it local?" question in this layer reduces to that comparison.` },
        {
          widget: {
            id: 'w-split',
            kind: 'subnet',
            title: 'Move the split',
            ip: '172.16.5.200',
            prefix: 27,
            minPrefix: 8,
            maxPrefix: 32,
            hint: 'Drag the prefix from /27 to /24, then to /30. Watch the highlighted network bits, and how the usable count changes.',
            takeaway: 'Each extra prefix bit halves the block: **2^(32−N)** addresses, minus the network and broadcast addresses.',
          },
        },
      ],
    },
    {
      id: 'kernel',
      title: 'What the kernel does with a prefix',
      blocks: [
        { md: `A host doesn't store "my subnet" anywhere you configure by hand. You give an interface an address *with* its prefix. The lab uses a fresh network namespace with a dummy interface \`d0\`. Its routing table starts empty, and it has no default route. Then it adds one address and nothing else.` },
        {
          checkpoint: {
            id: 'c1',
            prompt: 'After `ip addr add 10.31.0.77/26 dev d0` and no other command, what does `ip route show` list?',
            options: [
              'Nothing: an address adds no route, so you add one yourself',
              'Host route (10.31.0.77/32): a host route for the address itself',
              'Connected subnet (10.31.0.64/26): the whole subnet, on-link, added by the kernel',
              'Rounded-down block (10.31.0.0/26): the block that starts at the first octets you typed',
            ],
            key: 2,
            why: 'The /26 keeps 2 bits of the last octet. 77 = 01001101, so the block starts at 64 (01000000). The kernel installs that prefix as a connected route; nobody typed it.',
          },
        },
        {
          lab: {
            explain: 'Add 10.31.0.77/26 to a dummy interface in a new namespace; show the routing table before and after',
            cmd: `ip netns del n31 2>/dev/null; ip netns add n31
ip netns exec n31 sysctl -qw net.ipv6.conf.all.disable_ipv6=1 net.ipv6.conf.default.disable_ipv6=1
ip -n n31 link add d0 type dummy; ip -n n31 link set d0 up
echo "routes before: [$(ip -n n31 route show)]"
ip -n n31 addr add 10.31.0.77/26 dev d0
echo "--- routes after:"; ip -n n31 route show
echo "--- address line:"; ip -n n31 -4 -o addr show d0 | awk '{print $4,$5,$6}'`,
          },
        },
        { md: `The table was empty, and now it holds one line: \`10.31.0.64/26 dev d0 proto kernel scope link src 10.31.0.77\`. \`proto kernel\` means the kernel installed it itself (ip-route(8) says "installed by the kernel during autoconfiguration"). There's no \`via\`: the route has an interface and a source address and no gateway.

Now ask the kernel where it would send packets to two destinations, with no default route in the table.` },
        {
          checkpoint: {
            id: 'c2',
            prompt: 'With only that connected route, which of 10.31.0.100 and 10.31.0.130 can the host send to?',
            options: [
              'Both are local: they share the first three octets, so both are local',
              'Only 10.31.0.100: .130 matches no route at all',
              'Neither is reachable: without a gateway configured, nothing is reachable',
            ],
            key: 1,
            why: '.100 is inside 10.31.0.64/26 (64 to 127), so the connected route covers it. .130 is in the next block, 128 to 191, and with no default route nothing matches it.',
          },
        },
        {
          lab: {
            explain: 'Ask the kernel for the route to .100 and .130, then check the same arithmetic with python3',
            cmd: `${NEED}
for d in 10.31.0.100 10.31.0.130; do echo "route to $d:"; ip -n n31 route get $d 2>&1 | head -1; done
python3 -c "
import ipaddress as i
n = i.ip_interface('10.31.0.77/26').network
print(n, 'mask', n.netmask, 'broadcast', n.broadcast_address, 'addresses', n.num_addresses)
for d in ('10.31.0.100', '10.31.0.130'): print(d, 'in', n, ':', i.ip_address(d) in n)"`,
          },
        },
        { md: `\`.100\` resolves to \`dev d0 src 10.31.0.77\`. \`.130\` answers \`Network is unreachable\`: the kernel has no route to put it on, so it fails before anything is sent. python3's \`ipaddress\` module agrees with the bit arithmetic: network \`10.31.0.64/26\`, mask \`255.255.255.192\`, broadcast \`10.31.0.127\`, 64 addresses.

To reach \`.130\` the host needs one more route entry: a gateway. That's the next chapter.` },
      ],
    },
    {
      id: 'twins',
      title: "Where you've met this",
      blocks: [
        { md: `You create a /26 subnet in an AWS VPC and want to know how many addresses you can hand out.` },
        {
          checkpoint: {
            id: 'c3',
            prompt: 'You create a /26 subnet in an AWS VPC. How many addresses can you assign to instances?',
            options: [
              '64 (all of them): every address in the block is assignable',
              '62 (the usual rule): network and broadcast, as in any subnet',
              '60 (first four only): AWS reserves the first four, and no broadcast',
              '59 (five reserved): AWS reserves five per subnet',
            ],
            key: 3,
            why: 'AWS reserves the first four addresses and the last one in every subnet. That is 5, so 64 − 5 = 59.',
          },
        },
        { md: `The usual rule takes two addresses per subnet (network and broadcast). Cloud providers sometimes take more.

**AWS VPC.** The subnet-sizing page lists the reserved five for \`10.0.0.0/24\`: \`.0\` network, \`.1\` the VPC router, \`.2\` the DNS server, \`.3\` reserved for future use, and \`.255\` broadcast. AWS reserves the broadcast address even though a VPC doesn't support broadcast. Subnets can be anywhere from /16 to /28, which is why a /24 gives 251 usable and a /28 only 11. The router at \`.1\` is the default gateway of chapter 3.2.` },
        {
          widget: {
            id: 'w-aws',
            kind: 'subnet',
            title: 'The same math, AWS rules',
            ip: '10.0.1.77',
            prefix: 24,
            minPrefix: 16,
            maxPrefix: 28,
            aws: true,
            hint: 'Compare /24 and /28: how many addresses do you lose to reservations in each?',
            takeaway: 'AWS always takes **5** per subnet, so small subnets lose a large share: a /28 has 16 addresses and 11 usable.',
          },
        },
        { md: `**Kubernetes.** Not sourced here, so treat it as the usual shape rather than a guarantee: each node is typically handed a slice of the cluster's pod CIDR (often a /24, depending on the CNI and its settings), and pod addresses come from that slice. A Service ClusterIP is a different range; in iptables mode it exists only in rules, not on any interface, so no connected route like the one in the lab covers it (kube-proxy's IPVS mode differs; not sourced here).

**Proxmox.** The bridge's address and prefix go in \`/etc/network/interfaces\`, and the kernel derives the connected route exactly as in the lab. Proxmox reserves nothing for you, but the network and broadcast addresses of the block can't be used as host addresses (general knowledge, not sourced).` },
      ],
    },
    {
      id: 'keep',
      title: 'What to keep',
      blocks: [
        { md: `- \`/N\` fixes the first N bits as the network part. The block holds 2^(32−N) addresses; the all-zero host part is the network address and the all-one host part is the broadcast.
- Same subnet means equal first N bits. The kernel turns \`address/prefix\` into a connected route (\`proto kernel\`) with no gateway.
- A destination outside every route is "Network is unreachable" before any packet leaves.
- AWS reserves five addresses per subnet (4 at the bottom, 1 at the top), and allows /16 to /28 only.` },
      ],
    },
  ],
};
