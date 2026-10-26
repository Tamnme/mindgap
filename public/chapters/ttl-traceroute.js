// Chapter 3.8: TTL and traceroute. Authored content; the tutor gets this file as chapter_source.
// Labs run in netlab (Ubuntu 26.04, iproute2 6.19, traceroute from the Ubuntu package) on 2026-10-25; outputs described in the prose were observed.
// Sources: https://datatracker.ietf.org/doc/html/rfc792 (time exceeded is type 11, code 0 "time to live exceeded in transit"; the gateway that finds TTL zero must discard the datagram),
//   https://datatracker.ietf.org/doc/html/rfc1812 (a router must decrement TTL by at least one, and must send time exceeded when it discards at zero),
//   https://docs.kernel.org/networking/ip-sysctl.html (icmp_errors_use_inbound_ifaddr: disabled = ICMP errors use the primary address of the exiting interface; enabled = address of the receiving interface),
//   https://man7.org/linux/man-pages/man8/traceroute.8.html (several probes are sent at once by default, -N 1 for one at a time; probes start at ttl 1 and rise until "port unreachable" or TCP reset; three probes per hop by default; default method is UDP, -I is ICMP, -T is TCP).
// Hedged, not sourced: the AWS, Kubernetes and Proxmox remarks. The map node itself says AWS documents nothing about whether the VPC router appears as a hop.
// Observed, not quoted from a spec: the reply address on each hop, the effect of icmp_ratelimit, and the nft drop. Those are what this kernel printed in the labs.

const NEED = `ip netns list | grep -q n38a || { echo "Run the first lab (build the A-R1-R2-R3-B chain) first."; exit 1; }`;

export default {
  node: 'ttl-traceroute',
  number: '3.8',
  kicker: 'Layer 3',
  title: 'TTL and traceroute',
  lede: 'Traceroute lists the routers between you and a destination without asking any of them for its address. This chapter shows what it sends, and what comes back.',
  sections: [
    {
      id: 'ttl',
      title: 'A counter that runs out',
      blocks: [
        { md: `Every IPv4 header has a **TTL** (time to live) field, a number the sender sets. The lab builds a path with three routers:

\`\`\`
 A ---- R1 ---- R2 ---- R3 ---- B
 .1.2  .1.1    .2.2    .3.2    .4.2      (10.38.x.y)
\`\`\`

Every namespace starts with a default TTL, which the lab prints. A pings B once, and ping prints the TTL of the reply it received from B.` },
        {
          checkpoint: {
            id: 'c1',
            prompt: 'B sends its echo reply with the default TTL. A receives it after three routers. What TTL does ping print?',
            options: [
              'Unchanged at the default: only the sender sets TTL',
              'Down by 3: one for each router',
              'Down by 4: one for each link the packet crossed',
              'Down to 3: ping prints the hop count',
            ],
            key: 1,
            why: 'Routers decrement; hosts and links do not. Three routers on the path means three decrements. Four links is a common miscount.',
          },
        },
        {
          lab: {
            explain: 'Build the A-R1-R2-R3-B chain, print the default TTL, the ICMP rate limit and the ICMP source-address sysctl, then ping B once',
            cmd: `for n in n38a n38b n38r1 n38r2 n38r3; do ip netns del $n 2>/dev/null; done; sleep 0.5
mk() { ip netns add $1; ip netns exec $1 sysctl -qw net.ipv6.conf.all.disable_ipv6=1 net.ipv6.conf.default.disable_ipv6=1; ip -n $1 link set lo up; }
for n in n38a n38r1 n38r2 n38r3 n38b; do mk $n; done
ln() { ip link add eth$2 netns $1 type veth peer name eth$4 netns $3; ip -n $1 link set eth$2 up; ip -n $3 link set eth$4 up; }
ln n38a 0 n38r1 0; ln n38r1 1 n38r2 0; ln n38r2 1 n38r3 0; ln n38r3 1 n38b 0
ip -n n38a addr add 10.38.1.2/24 dev eth0;  ip -n n38r1 addr add 10.38.1.1/24 dev eth0
ip -n n38r1 addr add 10.38.2.1/24 dev eth1; ip -n n38r2 addr add 10.38.2.2/24 dev eth0
ip -n n38r2 addr add 10.38.3.1/24 dev eth1; ip -n n38r3 addr add 10.38.3.2/24 dev eth0
ip -n n38r3 addr add 10.38.4.1/24 dev eth1; ip -n n38b addr add 10.38.4.2/24 dev eth0
for r in r1 r2 r3; do ip netns exec n38$r sysctl -qw net.ipv4.ip_forward=1; done
ip -n n38a route add default via 10.38.1.1
ip -n n38r1 route add default via 10.38.2.2
ip -n n38r2 route add 10.38.1.0/24 via 10.38.2.1; ip -n n38r2 route add 10.38.4.0/24 via 10.38.3.2
ip -n n38r3 route add default via 10.38.3.1
ip -n n38b route add default via 10.38.4.1
sleep 1
ip netns exec n38b sysctl net.ipv4.ip_default_ttl net.ipv4.icmp_ratelimit net.ipv4.icmp_errors_use_inbound_ifaddr
for n in n38a n38r1 n38r2 n38r3 n38b; do ip netns exec $n sysctl -qw net.ipv4.icmp_ratelimit=0; done
ip netns exec n38a timeout 5 ping -c1 -W1 10.38.4.2 | awk 'NR==2'`,
          },
        },
        { md: `The default TTL is 64, and the reply arrives with \`ttl=61\`. Three routers each took one.

RFC 1812 states the rule: a router *must* subtract at least one from the TTL when it forwards, and must discard the packet when the TTL reaches zero. That keeps a packet caught in a routing loop from circling forever. The router that discards it isn't silent: it sends ICMP type 11, *time exceeded* (chapter 3.7), back to the packet's source.

The lab also printed \`icmp_ratelimit = 1000\` for B, then set it to 0 in every namespace. Linux limits how fast it sends ICMP errors by default, and the traceroute man page warns that routers can throttle ICMP replies so that some are lost. The lab zeroes the limit so that replies don't depend on timing and every run prints the same thing.` },
      ],
    },
    {
      id: 'trace',
      title: 'Using the expiry as a probe',
      blocks: [
        { md: `Suppose you want the list of routers between A and B. You can't ask a router for its address, but every router that drops an expired packet sends a message from one of its own addresses. So send a packet that is *meant* to expire: set its TTL to 1 and the first router answers. Send another with TTL 2 and the second router answers. Keep raising it. That is all traceroute does. Its man page says the probes start with a TTL of one and rise by one, until the destination answers. By default it sends several probes at once to go faster; the labs pass \`-N 1\` so they go one at a time, as in the original traceroute.

Now the question that matters for reading the output. R2 has two interfaces: \`10.38.2.2\` (facing R1, A's side) and \`10.38.3.1\` (facing R3, B's side). A sends a probe with TTL 2 toward B. It crosses R1 and expires at R2.` },
        {
          checkpoint: {
            id: 'c2',
            prompt: 'Which source address does the time-exceeded reply from R2 carry?',
            options: [
              'R2’s far side (10.38.3.1): a router answers from the address nearest the destination',
              'R1 answering (10.38.2.1): R1 answers every probe that passes through it',
              'R2’s side facing A (10.38.2.2): the address on its interface toward the sender',
              'B itself (10.38.4.2): B answers for every hop it can see',
            ],
            key: 2,
            why: 'By default Linux sends an ICMP error from the primary address of the interface it sends the error out of, here R2’s interface toward A (in this chain also the one the probe arrived on). Traceroute prints whatever source address the reply carried.',
          },
        },
        {
          lab: {
            explain: 'Run traceroute -n from A (one probe per hop), then capture on B the TTL the probe had on arrival',
            cmd: `${NEED}
ip netns exec n38a timeout 10 traceroute -n -N 1 -q1 -w1 10.38.4.2
echo
ip netns exec n38b timeout 8 tcpdump -nvl -i eth0 udp >/tmp/n38.cap 2>&1 &
sleep 0.7
ip netns exec n38a timeout 10 traceroute -n -N 1 -q1 -w1 10.38.4.2 >/dev/null
sleep 0.5; kill %1 2>/dev/null; wait 2>/dev/null
echo "UDP probes that reached B: $(grep -c 'proto UDP' /tmp/n38.cap)"
grep -o -E 'ttl [0-9]+|> 10.38.4.2.[0-9]+' /tmp/n38.cap`,
          },
        },
        { md: `The trace has four lines. Hop 1 is \`10.38.1.1\` (R1), hop 2 \`10.38.2.2\`, hop 3 \`10.38.3.2\`, and hop 4 \`10.38.4.2\` (B). Each router showed the address of its interface *facing A*. The lab printed \`icmp_errors_use_inbound_ifaddr = 0\`; the kernel docs say that when it is disabled, ICMP errors are sent with the primary address of the interface they leave by, and when enabled, with the address of the interface the offending packet arrived on. This chain is symmetric, so here both rules give the same address and the lab can't tell them apart. Traceroute lists the addresses it was answered from, not router names, so the same router could appear under another address when traced from the other side.

On B's side, one UDP probe arrived, with \`ttl 1\`. That fits the fourth probe: TTL 4 minus three routers is 1 (the lab printed only the arriving value, so the sending TTL is inferred from the hop count). The first three expired on the way. That is true because of \`-N 1\`; with the default, probes sent in parallel with higher TTLs would also reach B.

That raises a question about hop 4. B didn't send time-exceeded: the packet arrived at its destination with TTL 1, and nothing expires there. Traceroute needs some other sign that the destination has been reached.` },
        {
          checkpoint: {
            id: 'c3',
            prompt: 'The default traceroute probes are UDP datagrams. What does B send back to tell traceroute "you have arrived"?',
            options: [
              'ICMP time-exceeded: the same message the routers use',
              'ICMP echo reply: the probe is treated like a ping',
              'Nothing: traceroute stops after the maximum hop count',
              'ICMP port unreachable: nothing is listening on that port',
            ],
            key: 3,
            why: 'The destination host receives a datagram for a UDP port nobody has open, and answers with the ICMP error from chapter 3.7. That error is the stop signal, because a router would have sent time-exceeded instead.',
          },
        },
        {
          lab: {
            explain: 'Run traceroute with UDP (default), ICMP (-I) and TCP (-T -p 80) and show what B sends back each time',
            cmd: `${NEED}
for m in "" "-I" "-T -p 80"; do
  ip netns exec n38a timeout 8 tcpdump -nl -i eth0 'src host 10.38.4.2' >/tmp/n38m.cap 2>/dev/null &
  sleep 0.5
  echo "== traceroute -n -N 1 -q1 -w1 $m"
  ip netns exec n38a timeout 10 traceroute -n -N 1 -q1 -w1 $m 10.38.4.2 | tail -1
  sleep 0.5; kill %1 2>/dev/null; wait 2>/dev/null
  cut -c16-110 /tmp/n38m.cap | head -2
done`,
          },
        },
        { md: `All three methods ended at hop 4 and B's address, but B's answers differ. For the default UDP method, B sent an ICMP *udp port … unreachable*. For \`-I\`, traceroute sent ICMP echo requests, and B replied with an *echo reply*. For \`-T -p 80\`, B (with nothing on port 80) sent a TCP packet with the \`R\` flag, a reset. The man page names the same endings: "port unreachable" or a TCP reset.

Why have three methods? Firewalls can treat them differently. As general knowledge (the lab doesn't test it), a path that drops UDP to high ports but allows TCP to port 80 could give a broken trace by default and a complete one with \`-T -p 80\`. The routers' time-exceeded replies are the same in all three; what a firewall lets through *to the destination* is not.` },
      ],
    },
    {
      id: 'stars',
      title: 'What a star means',
      blocks: [
        { md: `Traceroute prints \`*\` for a probe that got no reply within the timeout. The next lab sets up one specific cause: R2 gets an nft rule, in its output hook, that drops ICMP time-exceeded messages R2 itself sends. The lab runs traceroute with two probes per hop, pings B, then lists the rule. It deletes the table at the start and again at the end, so it can be re-run.` },
        {
          checkpoint: {
            id: 'c4',
            prompt: 'R2 drops its own time-exceeded messages but forwards everything else. What does traceroute to B print?',
            options: [
              'It ends at hop 1: no reply means the path stops there',
              'Hop 2 prints * *, then hops 3 and 4 answer normally',
              'Every hop from 2 onward prints * *, because the path is cut',
              'Hop 2 is left out: the lines are numbered 1, 3, 4',
            ],
            key: 1,
            why: 'R2 still forwards the probes that have TTL left, so hop 3 and B receive them and reply. Only R2’s own expiry message is missing, so only hop 2 is blank.',
          },
        },
        {
          lab: {
            explain: "Drop R2's own time-exceeded with nft, run traceroute (two probes per hop) and ping B, then remove the rule",
            cmd: `${NEED}
ip netns exec n38r2 nft delete table inet t38 2>/dev/null
ip netns exec n38r2 nft add table inet t38
ip netns exec n38r2 nft add chain inet t38 out '{ type filter hook output priority 0 ; }'
ip netns exec n38r2 nft add rule inet t38 out icmp type time-exceeded drop
ip netns exec n38r2 nft list table inet t38 | grep -E 'hook|drop'
ip netns exec n38a timeout 12 traceroute -n -N 1 -q2 -w1 10.38.4.2
ip netns exec n38a timeout 5 ping -c1 -W1 10.38.4.2 | awk 'NR==2'
ip netns exec n38r2 nft delete table inet t38`,
          },
        },
        { md: `Hop 2 prints \`* *\`. Hops 3 and 4 answer, and the ping to B succeeds with \`ttl=61\`. R2 forwards traffic fine, but it never sent the one message traceroute was listening for.

> [!IMPORTANT]
> A \`*\` means **no reply was seen**, which is not by itself evidence of packet loss. The router may filter or rate-limit its ICMP and still forward your traffic. Read the hops after the star: if they answer, the path works.

The reverse case is weaker evidence. A trace that is stars from some hop onward and never reaches the destination points to a drop at or after that hop, or to a destination that doesn't answer. Traceroute alone can't say which.` },
      ],
    },
    {
      id: 'twins',
      title: "Where you've met this",
      blocks: [
        { md: `**AWS.** AWS doesn't document whether the VPC's implied router shows up as a hop or decrements TTL, so test with \`traceroute\` from an instance instead of assuming. Read a star there the way you read it here: no reply, not necessarily a drop.

**Kubernetes / Cilium.** In overlay mode, traffic between pods on different nodes is carried inside a tunnel (chapter 5.1). A traceroute from a pod may then show few or no hops for the underlay between the nodes. The output depends on the CNI and its mode, so run it from a pod and look.

**Proxmox.** A Linux bridge works at layer 2 and doesn't touch the IP header, so it shouldn't appear as a hop. A real router upstream decrements TTL and shows up. This chapter's labs used routed namespaces, not a bridge, so that is general knowledge and not something the labs printed.` },
      ],
    },
    {
      id: 'keep',
      title: 'What to keep',
      blocks: [
        { md: `- Each router subtracts one from the TTL. At zero it discards the packet and sends ICMP time-exceeded (type 11) to the source. Hosts and links don't subtract.
- Traceroute sends probes with TTL 1, 2, 3 and so on. Each time-exceeded reply names one hop.
- The address printed is the one the reply carried. By default on Linux that is the address of the interface the error leaves by (toward the sender); \`icmp_errors_use_inbound_ifaddr\` changes it.
- The destination ends the trace with a different reply: port unreachable for UDP, echo reply for \`-I\`, a TCP reset for \`-T\`.
- \`*\` is no reply. Look past it: if later hops answer, the path works.` },
      ],
    },
  ],
};
