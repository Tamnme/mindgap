// Chapter 3.2: Default gateway. Authored content; the tutor gets this file as chapter_source.
// Labs run in netlab (Ubuntu 26.04, iproute2 6.19) on 2026-10-25; outputs described in the prose were observed.
// Sources: https://datatracker.ietf.org/doc/html/rfc1122 (section 3.3.1.1, local/remote decision: if the destination's bits under the address mask match the source's, it is on a connected network and is sent directly to the host; otherwise it is reachable only through a gateway),
//   https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html (the VPC router is the subnet's base + 1 address, reserved by AWS).
// Hedged, not sourced: the Kubernetes and Proxmox remarks are general knowledge. "ARP stays inside the segment" and the unanswered who-has in the last lab are observed, not quoted.

const NEED = `ip link show br32 >/dev/null 2>&1 || { echo "Run the first lab (build br32) first."; exit 1; }`;
// Keep the parts of a tcpdump -e line that this chapter discusses.
const TRIM = `sed -E 's/^[0-9:.]+ //; s/ethertype [A-Za-z0-9]+ \\(0x[0-9a-f]+\\), //; s/, length [0-9]+//g; s/, id [0-9]+, seq [0-9]+//'`;

export default {
  node: 'default-gateway',
  number: '3.2',
  kicker: 'Layer 3',
  title: 'Default gateway',
  lede: 'Before any ARP, a host decides from its routing table whether a destination is on its own segment or has to go through a gateway. That decision determines whose MAC goes on the frame.',
  sections: [
    {
      id: 'decision',
      title: 'On-link or not',
      blocks: [
        { md: `Chapter 3.1 ended with a host that could not send to \`10.31.0.130\`: no route matched. A default gateway is the route that matches everything else, \`0.0.0.0/0 via <gateway>\`. RFC 1122 describes the host's choice as a comparison: mask the destination and the host's own address; if the bits match, send directly to the destination host, otherwise send to a gateway.

So a host asks one question per packet, and the answer decides **which address it has to ARP for**.

The lab builds this: segment \`br32\` holds **A** (\`10.32.0.10/24\`, default gateway \`10.32.0.1\`), a neighbour **C** (\`10.32.0.30\`) and the router **R** (\`10.32.0.1\` on this segment). A second subnet \`10.32.1.0/24\` sits behind R, with host **B** (\`10.32.1.20\`) on it. R forwards between its two interfaces.` },
        {
          lab: {
            explain: 'Build br32 (A, C, router R) plus B behind R, then ask A\'s kernel for its route to C and to B',
            cmd: `for n in n32a n32b n32c n32r; do ip netns del $n 2>/dev/null; done
ip link del br32 2>/dev/null; for v in v32a v32c v32r; do ip link del $v 2>/dev/null; done; sleep 0.5
ip link add br32 type bridge && ip link set br32 up
mk() { ip netns add $1; ip netns exec $1 sysctl -qw net.ipv6.conf.all.disable_ipv6=1 net.ipv6.conf.default.disable_ipv6=1; }
for n in a c r; do mk n32$n; ip link add v32$n type veth peer name eth0 netns n32$n; ip link set v32$n master br32 up; ip -n n32$n link set eth0 up; done
mk n32b; ip link add eth1 netns n32r type veth peer name eth0 netns n32b; ip -n n32r link set eth1 up; ip -n n32b link set eth0 up
ip -n n32a addr add 10.32.0.10/24 dev eth0; ip -n n32c addr add 10.32.0.30/24 dev eth0
ip -n n32r addr add 10.32.0.1/24 dev eth0; ip -n n32r addr add 10.32.1.1/24 dev eth1; ip netns exec n32r sysctl -qw net.ipv4.ip_forward=1
ip -n n32b addr add 10.32.1.20/24 dev eth0
ip -n n32a route add default via 10.32.0.1; ip -n n32b route add default via 10.32.1.1
sleep 1
echo "--- A's routes:"; ip -n n32a route show
for d in 10.32.0.30 10.32.1.20; do echo "route to $d:"; ip -n n32a route get $d | head -1; done`,
          },
        },
        { md: `A's table has two lines: the connected \`10.32.0.0/24\` from chapter 3.1, and \`default via 10.32.0.1\`. \`route get\` shows the difference. \`10.32.0.30\` resolves to \`dev eth0\` with no \`via\`. \`10.32.1.20\` resolves to \`via 10.32.0.1\`.

A is going to ping each of them while \`tcpdump -e\` on A's NIC prints the Ethernet header and the IP header together. The capture only keeps echo requests, so you see what A *sent*. The lab also prints each host's eth0 MAC.` },
        {
          checkpoint: {
            id: 'c1',
            prompt: 'A pings B (10.32.1.20), which sits behind R. For the echo request leaving A, what are the frame\'s destination MAC and the packet\'s destination IP?',
            options: [
              'MAC of R, IP of B: the frame goes to the next hop, the packet to the destination',
              'MAC of B, IP of B: the frame is addressed to the final destination, end to end',
              'MAC of R, IP of R: A addresses the gateway, which then starts a new packet',
              'MAC of B, IP of R: the IP finds the gateway, the MAC finds the host',
            ],
            key: 0,
            why: 'The MAC only has to carry the frame one hop, so it is the next hop\'s. The IP header addresses the final destination and is not rewritten on the way.',
          },
        },
        {
          lab: {
            explain: 'Ping C then B from A while capturing echo requests on A\'s NIC; then list the MACs',
            cmd: `${NEED}
ip -n n32a neigh flush all
ip netns exec n32a timeout 5 tcpdump -nel -i eth0 'icmp[icmptype]==icmp-echo' 2>/dev/null | ${TRIM} &
sleep 1
ip netns exec n32a ping -c1 -W1 10.32.0.30 >/dev/null
ip netns exec n32a ping -c1 -W1 10.32.1.20 | sed -n 2p; wait
for n in a c r b; do echo "n32$n eth0 = $(ip -n n32$n -br link show eth0 | awk '{print $3}')"; done
echo "--- A's neighbour table:"; ip -n n32a neigh show`,
          },
        },
        { md: `Two frames left A, and the two lines are the same shape. For C the destination MAC is **C's own**, and the IP is C's. For B the destination MAC is **R's eth0 MAC**, and the IP is \`10.32.1.20\`, B's. Compare the MAC column with the list at the end to see whose is whose. The ping to B worked.

\`\`\`
on-link:   frame dst MAC = destination's MAC    packet dst IP = destination
off-link:  frame dst MAC = gateway's MAC        packet dst IP = destination
\`\`\`

The right-hand column is the same in both rows. Only the MAC, which matters for one hop, changes.

A's neighbour table holds C and R. B never appears in it: A never needed B's MAC, and couldn't have got it, since B isn't on A's segment.

> [!IMPORTANT]
> RFC 1122 says off-link traffic is routed "to a gateway on a connected network": the next hop is always something on your own segment.` },
      ],
    },
    {
      id: 'mask',
      title: 'When the mask lies',
      blocks: [
        { md: `Suppose A is reconfigured as \`10.32.0.10/16\` by mistake, with the same default gateway. A pings B again, with \`tcpdump\` on A's NIC capturing ARP.` },
        {
          checkpoint: {
            id: 'c2',
            prompt: 'With A at 10.32.0.10/16, A pings B (10.32.1.20). What happens?',
            options: [
              'It still works: the default gateway takes over for B whatever the mask says',
              'A ARPs for 10.32.0.1, the gateway, and R forwards the ping as before',
              'A ARPs for 10.32.1.20 directly, nobody answers and the ping fails',
              'The kernel refuses with Network is unreachable, since the /16 overlaps B',
            ],
            key: 2,
            why: 'The /16 makes B look on-link, so the kernel picks the connected route and ARPs for B itself. B is on another segment and R doesn\'t proxy for it, so the request goes unanswered and no echo request is ever sent.',
          },
        },
        {
          lab: {
            explain: 'Give A a /16, ping B with an ARP capture running, show the route and the neighbour entry, then put the /24 and the gateway back',
            cmd: `${NEED}
ip -n n32a neigh flush all; ip -n n32a addr flush dev eth0; ip -n n32a addr add 10.32.0.10/16 dev eth0
echo "route to B: $(ip -n n32a route get 10.32.1.20 | head -1)"
echo "R's proxy_arp on eth0: $(ip netns exec n32r sysctl -n net.ipv4.conf.eth0.proxy_arp)"
ip netns exec n32a timeout 4 tcpdump -nel -i eth0 arp host 10.32.1.20 2>/dev/null | ${TRIM} &
sleep 1
ip netns exec n32a ping -c1 -W2 10.32.1.20 | grep 'packet loss'
echo "--- A's entry for B:"; ip -n n32a neigh show 10.32.1.20; wait
ip -n n32a addr flush dev eth0; ip -n n32a addr add 10.32.0.10/24 dev eth0; ip -n n32a route add default via 10.32.0.1
echo "--- restored:"; ip -n n32a route get 10.32.1.20 | head -1`,
          },
        },
        { md: `A host trusts its own prefix completely. The on-link test uses nothing but A's address and mask: no router is asked and nothing is probed, so a wrong mask is a wrong decision.

\`route get\` for B shows \`dev eth0\` and no \`via\`: with the /16 the kernel treats B as on-link and never looks at the gateway. R's \`proxy_arp\` on eth0 is 0, so R doesn't answer ARP on behalf of hosts behind it. The capture shows A broadcasting \`who-has 10.32.1.20\` to \`ff:ff:ff:ff:ff:ff\`, repeated, with no reply line. The ping reports 100% packet loss, and A's entry for \`10.32.1.20\` has no MAC and is in state \`INCOMPLETE\` (it would turn \`FAILED\` if you looked later): the question was asked and nothing answered it.

This is why "ping the gateway works but nothing beyond it does" is worth checking against the mask first. The symptom, a stuck ARP, looks like a dead host but it's a routing decision.` },
      ],
    },
    {
      id: 'twins',
      title: "Where you've met this",
      blocks: [
        { md: `**AWS VPC.** The default gateway of an instance is the VPC router, the subnet's base + 1 address (\`10.0.0.1\` in \`10.0.0.0/24\`). The subnet-sizing page lists it among the five reserved addresses. The instance ARPs for it like A did for R.

**Kubernetes.** A pod ARPs for its gateway on its veth, like A did. How the CNI answers that ARP is CNI-specific, and this chapter does not cover it (not sourced here).

**Proxmox.** The \`gateway\` line in \`vmbr0\`'s stanza is the *host's* own default route. A VM uses whatever gateway its own OS is configured with, typically the physical router (general knowledge, not sourced).` },
      ],
    },
    {
      id: 'keep',
      title: 'What to keep',
      blocks: [
        { md: `- The host compares destination and own address under its mask: equal means on-link, so ARP for the destination; otherwise ARP for the gateway.
- Off-link: frame dst MAC is the gateway's, packet dst IP is still the remote host's.
- The next hop is always an address inside a connected prefix of the host.
- A wrong mask is a wrong decision: a /16 that is too wide ARPs for hosts that aren't on the segment.` },
      ],
    },
  ],
};
