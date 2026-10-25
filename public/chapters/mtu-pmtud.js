// Chapter 3.9: MTU and path MTU discovery. Authored content; the tutor gets this file as chapter_source.
// Labs run in netlab (Ubuntu 26.04, iproute2 6.19, iputils ping/tracepath, nft) on 2026-10-25; outputs described in the prose were observed.
// Sources: https://datatracker.ietf.org/doc/html/rfc1191 (a source sends datagrams with DF set; a router that cannot forward one without fragmenting "is required to return" ICMP destination unreachable, "fragmentation needed and DF set", and MUST include the next-hop MTU),
//   https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/network_mtu.html (all EC2 types support 1500; jumbo 9001; limit 1500 over an internet gateway, VPN and between Regions without a transit gateway, 8500 over inter-region peering; over-limit packets are fragmented or dropped if DF is set; IPv4 type 3 code 4; IPv6 has Packet Too Big, type 2),
//   https://man7.org/linux/man-pages/man8/tracepath.8.html (tracepath prints "pmtu N" and a final "Resume: pmtu ...").
// Hedged, not sourced: the VXLAN overhead figure in the widget (1450 = 1500 minus the usual 50 bytes of outer headers) and what Cilium, Proxmox and a firewall do with it. The text tells the reader to look at the real interface.
// Observed, not quoted from a spec: Linux ping sets DF by default when no path MTU is cached, and the route cache entry (`mtu 1400`) that the ICMP creates.

const NEED = `ip netns list | grep -q n39a || { echo "Run the first lab (build the A-R-B chain with the 1400 link) first."; exit 1; }`;

export default {
  node: 'mtu-pmtud',
  number: '3.9',
  kicker: 'Layer 3',
  title: 'MTU and path MTU discovery',
  lede: 'Every link has a largest packet it can carry. This chapter follows what happens to a packet that is too big for one of them.',
  sections: [
    {
      id: 'limit',
      title: 'A size limit on every link',
      blocks: [
        { md: `Each link has an **MTU** (maximum transmission unit), a size limit that belongs to that link alone. Ethernet's usual value is 1500.

The lab builds the chain you know from chapter 3.7: A, R and B. The difference is that R's link toward B is set to MTU 1400, while A's link to R stays at 1500. A will send a single echo request with \`ping -M do -s N\`: \`-M do\` sets the DF ("don't fragment") flag on the packet, and \`-s N\` chooses the size. The lab tries two values of N that sit right either side of the limit.` },
        {
          checkpoint: {
            id: 'c1',
            prompt: 'With DF set, which is the largest `-s` that gets through the 1400-byte link?',
            options: [
              'Limit applies to data only (-s 1400): the limit applies to the data in the request',
              'IP and ICMP headers count (-s 1372): the limit covers the whole IP packet',
              'Ethernet header counts too (-s 1358): the limit covers the whole frame',
            ],
            key: 1,
            why: 'MTU measures the IP packet: 20 bytes of IP header, 8 of ICMP header, then the data. 1400 - 28 = 1372. The Ethernet header is not part of the MTU.',
          },
        },
        { md: `The MTU is the largest IP packet a link carries, headers included, and the path's MTU is that of its smallest link. \`ping -s\` counts only the data in the echo request, which follows an 8-byte ICMP header and a 20-byte IP header.` },
        {
          lab: {
            explain: 'Build A-R-B with a 1400 link, send DF pings of -s 1372 and -s 1373, show the ICMP that came back and the route A cached',
            cmd: `for n in n39a n39b n39r; do ip netns del $n 2>/dev/null; done; sleep 0.5
mk() { ip netns add $1; ip netns exec $1 sysctl -qw net.ipv6.conf.all.disable_ipv6=1 net.ipv6.conf.default.disable_ipv6=1; ip -n $1 link set lo up; }
mk n39a; mk n39r; mk n39b
ip link add eth0 netns n39a type veth peer name eth0 netns n39r
ip link add eth1 netns n39r type veth peer name eth0 netns n39b
for p in "n39a eth0" "n39r eth0" "n39r eth1" "n39b eth0"; do set -- $p; ip -n $1 link set $2 up; done
ip -n n39r link set eth1 mtu 1400; ip -n n39b link set eth0 mtu 1400
ip -n n39a addr add 10.39.1.2/24 dev eth0; ip -n n39r addr add 10.39.1.1/24 dev eth0
ip -n n39r addr add 10.39.2.1/24 dev eth1; ip -n n39b addr add 10.39.2.2/24 dev eth0
ip netns exec n39r sysctl -qw net.ipv4.ip_forward=1
ip -n n39a route add default via 10.39.1.1; ip -n n39b route add default via 10.39.2.1
sleep 1
echo "MTUs: A eth0 $(ip netns exec n39a cat /sys/class/net/eth0/mtu), R eth0 $(ip netns exec n39r cat /sys/class/net/eth0/mtu), R eth1 $(ip netns exec n39r cat /sys/class/net/eth1/mtu), B eth0 $(ip netns exec n39b cat /sys/class/net/eth0/mtu)"
ip netns exec n39a timeout 8 tcpdump -nl -i eth0 icmp >/tmp/n39.cap 2>/dev/null &
sleep 0.5
for s in 1372 1373; do echo "-s $s: $(ip netns exec n39a timeout 4 ping -M do -s $s -c1 -W1 10.39.2.2 2>&1 | grep -E 'bytes from|Frag' | head -1)"; done
sleep 0.5; kill %1 2>/dev/null; wait 2>/dev/null
grep -v 'echo re' /tmp/n39.cap | cut -c16-
echo "A's route to B: $(ip -n n39a route get 10.39.2.2 | tr '\\n' ' ' | grep -o 'cache.*')"`,
          },
        },
        { md: `The two sizes behave differently. \`-s 1372\` makes a 1400-byte packet (20 + 8 + 1372), exactly the limit, and it gets an answer. \`-s 1373\` is 1401 bytes and A gets \`Frag needed and DF set (mtu = 1400)\` instead, from \`10.39.1.1\`, which is R. The capture on A shows what R sent: \`ICMP 10.39.2.2 unreachable - need to frag (mtu 1400)\`. That is the type 3, code 4 message from chapter 3.7. RFC 1191 requires the router to put the next-hop MTU in it, so A learns the number, not just that something failed.

A kept that number. The last line of the lab shows a cached entry on A's route to B with \`mtu 1400\` and an expiry time. Linux normally sizes later packets to that destination from such an entry (general behaviour; the labs below clear it before each test instead of relying on it).

The first line of the lab printed the MTUs: 1500 on A and on R's A-side, 1400 on R's B-side and on B. Those numbers decided every result in this chapter, and on a real host or pod \`ip link\` is where to start.

> [!IMPORTANT]
> A packet's size is the whole IP packet, headers included. The router that can't forward an oversize DF packet drops it and returns ICMP type 3 code 4 carrying the MTU to use.` },
      ],
    },
    {
      id: 'df',
      title: 'What DF changes',
      blocks: [
        { md: `Now the same oversize packet with the DF flag turned off: \`ping -M dont -s 1472\`, a 1500-byte packet, with A's cached MTU cleared first. B watches with \`tcpdump -v\` so the lab can print the headers of whatever arrives.` },
        {
          checkpoint: {
            id: 'c2',
            prompt: 'A sends a 1500-byte packet with DF off toward the 1400-byte link. What does the capture on B show?',
            options: [
              'Dropped silently: R has no way to shrink a packet',
              'Refused with frag-needed: R rejects anything oversize',
              'One whole 1500-byte packet: MTU is only a hint',
              'Two smaller pieces: R splits the packet',
            ],
            key: 3,
            why: 'With DF off, R is allowed to fragment. It cuts the packet into pieces that fit 1400 and B puts them back together. With DF on, the same packet would have been dropped and answered with frag-needed.',
          },
        },
        {
          lab: {
            explain: 'Clear A\'s cached MTU, ping with DF off and -s 1472, capture on B; then ping -s 1472 with no -M option at all',
            cmd: `${NEED}
ip -n n39a route flush cache
ip netns exec n39b timeout 6 tcpdump -nvl -i eth0 'icmp and src host 10.39.1.2' >/tmp/n39f.cap 2>&1 &
sleep 0.7
echo "-M dont -s 1472: $(ip netns exec n39a timeout 4 ping -M dont -s 1472 -c1 -W1 10.39.2.2 2>&1 | grep -E 'bytes from|Frag' | head -1)"
sleep 0.5; kill %1 2>/dev/null; wait 2>/dev/null
grep ttl /tmp/n39f.cap | grep -o -E 'id [0-9]+, offset [0-9]+, flags \\[[^]]*\\]|length [0-9]+'
ip -n n39a route flush cache
echo "no -M, -s 1472: $(ip netns exec n39a timeout 4 ping -s 1472 -c1 -W1 10.39.2.2 2>&1 | grep -E 'bytes from|Frag' | head -1)"`,
          },
        },
        { md: `With DF off, the ping succeeds and B's capture shows **two** fragments of one packet. They share an \`id\`. The first has \`flags [+]\` (more fragments follow) and \`offset 0\` with length 1396, the second has \`offset 1376\` and length 124. R did the splitting, and B reassembled them before answering.

The last line is a Linux detail worth knowing: with no \`-M\` option at all, the same 1472-byte ping got \`Frag needed and DF set\`. On this machine, ping sets DF unless you turn it off, so a plain \`ping -s\` tests the path MTU the way real TCP traffic will.

This is **path MTU discovery**, in four steps. The sender sends with DF on. A link that is too small drops the packet and returns the next-hop MTU. The sender lowers its packet size to that and tries again. The path's smallest MTU is found without anyone being configured with it. TCP traffic works the same way, which is why a large transfer can "just work" over a path with an odd link. Try the sizes in the widget. Its path has a tunnel hop with a smaller MTU, the way a pod's traffic crosses a VXLAN tunnel.` },
        {
          widget: {
            id: 'w-pmtu',
            kind: 'mtu',
            title: 'Where does the big packet die?',
            hint: 'Start at 1500 with DF on and find the last size that is delivered. Then untick DF, then tick "ICMP blocked" with DF off and on.',
            takeaway: 'With DF on, an oversize packet is dropped and the sender is told the limit. With DF off, the tunnel fragments it (two pieces at 1500). "ICMP blocked" only matters when DF is on.',
            hops: [{ name: 'pod', mtu: 1500 }, { name: 'VXLAN tunnel', mtu: 1450 }, { name: 'server', mtu: 1500 }],
            size: 1500,
            minSize: 576,
            maxSize: 9000,
            df: true,
            icmpBlocked: false,
          },
        },
        { md: `tracepath automates the discovery. It sends probes and prints the path MTU as it learns it. Run it from A, with the cache cleared:` },
        {
          lab: {
            explain: 'Clear the cached MTU and run tracepath -n from A to B; show only the pmtu and reached lines',
            cmd: `${NEED}
ip -n n39a route flush cache
ip netns exec n39a timeout 12 tracepath -n 10.39.2.2 2>&1 | grep -E 'pmtu|reached'`,
          },
        },
        { md: `It starts with \`pmtu 1500\`, A's own interface. On the next hop it prints \`pmtu 1400\`, learned from R's message, and it ends with \`Resume: pmtu 1400 hops 2 back 2\`. That's the number to configure a tunnel or a VM NIC to, or to compare against what the path is meant to carry.

The widget's caption notes the IPv6 rule: IPv6 routers never fragment. They always drop an oversize packet and send ICMPv6 Packet Too Big (type 2, per the AWS page). For IPv6, the ICMP message is the only way to learn, so the next section matters even more there.` },
      ],
    },
    {
      id: 'blackhole',
      title: 'When the message goes missing',
      blocks: [
        { md: `Everything above depends on one packet getting back to the sender. Firewalls that "drop all ICMP" are common. The lab puts an nft rule on R that drops the frag-needed messages R itself sends: \`icmp type destination-unreachable icmp code frag-needed drop\`. The rule matches nothing else, so R still forwards normally. The lab deletes the table at its start and at its end, clears A's cached MTU, then pings B twice with DF set, once with \`-s 1000\` and once with \`-s 1400\`.` },
        {
          checkpoint: {
            id: 'c3',
            prompt: 'R now swallows its own frag-needed messages. What does A see for the two pings?',
            options: [
              'Both fail: with ICMP blocked, ping is blocked',
              'Both succeed: A retries without DF after a timeout',
              'The 1000 works; the 1400 gets no answer and no error',
              'The 1400 fails at once with a "message too long" error',
            ],
            key: 2,
            why: 'The 1000-byte packet fits every link, so nothing is dropped and no ICMP is needed. The 1400-byte one (a 1428-byte packet) is dropped at the 1400 link, and the only message that would explain why is the one the rule eats.',
          },
        },
        {
          lab: {
            explain: 'Drop frag-needed on R with nft, clear A\'s cache, ping B with DF at -s 1000 and -s 1400, then remove the rule',
            cmd: `${NEED}
ip netns exec n39r nft delete table inet t39 2>/dev/null
ip netns exec n39r nft add table inet t39
ip netns exec n39r nft add chain inet t39 out '{ type filter hook output priority 0 ; }'
ip netns exec n39r nft add rule inet t39 out icmp type destination-unreachable icmp code frag-needed drop
ip netns exec n39r nft list table inet t39 | grep drop
ip -n n39a route flush cache
echo "-s 1000: $(ip netns exec n39a timeout 4 ping -M do -s 1000 -c1 -W1 10.39.2.2 2>&1 | grep -E 'bytes from|Frag|packet loss' | head -1)"
echo "-s 1400: $(ip netns exec n39a timeout 6 ping -M do -s 1400 -c2 -W1 10.39.2.2 2>&1 | grep -E 'bytes from|Frag|packet loss' | head -1)"
echo "A's route to B after: $(ip -n n39a route get 10.39.2.2 | tr '\\n' ' ')"
ip netns exec n39r nft delete table inet t39`,
          },
        },
        { md: `The 1000-byte ping answers. The 1400-byte one reports \`100% packet loss\` and no error message at all. A's route to B afterwards still has no cached \`mtu\`: A was never told anything. A sends the same oversize packet, it is dropped again, and nothing ever changes.

This is the **black hole**. It is nasty because small packets work: ping, DNS, the TCP handshake and the first bytes of a connection all fit. A transfer or a TLS handshake with large packets then stalls. What you see is a connection that opens and then hangs, and nothing in the logs says why.

The widget below has the same failure with ICMP blocked on the path. Two fixes: let ICMP type 3 code 4 (and ICMPv6 type 2) through the firewalls on the path, or set the MTU of the tunnel or interface so that nothing oversize is sent in the first place.` },
        {
          widget: {
            id: 'w-hole',
            kind: 'mtu',
            title: 'The black hole',
            hint: 'With ICMP blocked and DF on, slide the size from 576 up to 1500 and note where delivered turns into a silent drop. Then untick "ICMP blocked".',
            takeaway: 'Blocking ICMP does not change which packets are too big. It only removes the message that tells the sender, so small packets still work and big ones vanish.',
            hops: [{ name: 'client', mtu: 1500 }, { name: 'VPN tunnel', mtu: 1400 }, { name: 'server', mtu: 1500 }],
            size: 1450,
            minSize: 576,
            maxSize: 1500,
            df: true,
            icmpBlocked: true,
          },
        },
      ],
    },
    {
      id: 'twins',
      title: "Where you've met this",
      blocks: [
        { md: `**AWS.** The EC2 MTU page says every instance type supports 1500, and many support jumbo frames (9001). Traffic over an internet gateway, over VPN connections and between Regions (unless a transit gateway is used) is limited to 1500, and inter-region VPC peering to 8500. Over-limit packets are fragmented, or dropped if DF is set. The page names the IPv4 message as type 3 code 4 and the IPv6 one as Packet Too Big (type 2), so ICMP filtering on the path has to let those through. Your own security group and NACL rules for ICMP aren't covered by this chapter; check them for these types.

**Kubernetes / Cilium.** An overlay wraps each packet in outer headers, so the pod's usable MTU is smaller than the node's. The widget's 1450 is the node MTU minus VXLAN's usual 50 bytes of outer headers, which is general knowledge, not a Cilium-documented figure. How Cilium sets the pod MTU depends on its mode and configuration, so read the real value from the pod's interface (\`ip link\`) instead of trusting a number. "Small requests work, large transfers hang" is the black-hole shape from the lab.

**Proxmox.** A guest MTU larger than the path it uses will fail the same way: oversize packets with DF set are dropped. Match the bridge, the guest NIC and the physical path. A Linux bridge forwards frames without reading IP, so by itself it shouldn't send ICMP errors (general knowledge; no lab here used a bridge), and you shouldn't expect it to report the problem.` },
      ],
    },
    {
      id: 'keep',
      title: 'What to keep',
      blocks: [
        { md: `- MTU is per link and counts the whole IP packet. The path MTU is the smallest link on the path.
- With DF set, a router that can't fit the packet drops it and sends ICMP type 3 code 4 with the next-hop MTU. With DF off, it fragments instead.
- PMTUD is the sender using that message to shrink its packets. \`tracepath\` shows the result as \`pmtu\`.
- If the ICMP never arrives, the sender never learns: small packets work, big ones vanish. That is a black hole.
- Allow ICMP type 3 code 4 (IPv6: type 2) through firewalls, and set tunnel and VM MTUs from the real path.` },
      ],
    },
  ],
};
