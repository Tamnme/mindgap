// Chapter 3.7: ICMP. Authored content; the tutor gets this file as chapter_source.
// Labs run in netlab (Ubuntu 26.04, iproute2 6.19) on 2026-10-25; outputs described in the prose were observed.
// Sources: https://datatracker.ietf.org/doc/html/rfc792 (ICMP message types: echo 8/0, destination unreachable 3, time exceeded 11; a message carries the original IP header plus 64 bits of data),
//   https://datatracker.ietf.org/doc/html/rfc1812 (routers send destination unreachable for missing routes, code 13 "communication administratively prohibited" for filtering, and may be configured not to send it),
//   https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/network_mtu.html (type 3 code 4 is what PMTUD relies on in IPv4).
// Hedged, not sourced: how security groups, NACLs, NetworkPolicy and the Proxmox firewall treat ICMP. The text says to test rather than assume.
// Observed, not quoted from a spec: which ICMP code each Linux route type produced. See the lab-2 prose.

const NEED = `ip netns list | grep -q n37a || { echo "Run the first lab (build the A-R-B chain) first."; exit 1; }`;

export default {
  node: 'icmp',
  number: '3.7',
  kicker: 'Layer 3',
  title: 'ICMP',
  lede: 'IP has no way to say "I could not deliver that". ICMP is the companion protocol that carries those messages back to the sender, and ping is one of its types.',
  sections: [
    {
      id: 'channel',
      title: 'A message back to the sender',
      blocks: [
        { md: `Chapter 3.5 followed a packet through a router: look up the route, pick the next hop, send. Now ask what happens when that lookup fails, or the packet can't go on. The router drops it. The sender has sent something and heard nothing, and IP itself has no field or packet type that could report a problem.

ICMP fills that gap. An ICMP message is an ordinary IP packet (protocol number 1) whose payload starts with a **type** and a **code**. The few you need:

| Type | Name | Sent by |
|---|---|---|
| 8, then 0 | Echo request, then echo reply | request: you; reply: the destination |
| 3 | Destination unreachable, with a code saying why | the device that could not deliver |
| 11 | Time exceeded | a router (chapter 3.8) |

Type 3 has several codes: network unreachable, host unreachable, protocol unreachable, port unreachable, and "fragmentation needed" (chapter 3.9). Linux and the RFCs add "administratively prohibited" for filtering. An error message also quotes the start of the packet that caused it, so the sender can tell which of its packets failed.

The lab builds a chain of three namespaces, A, R and B, with R forwarding between them. A and B each use R as default gateway. A pings B once while \`tcpdump\` runs on A, to show what ping really exchanges.` },
        {
          lab: {
            explain: 'Build the chain A-R-B, then ping B once while tcpdump listens on A for icmp',
            cmd: `for n in n37a n37b n37r; do ip netns del $n 2>/dev/null; done; sleep 0.5
mk() { ip netns add $1; ip netns exec $1 sysctl -qw net.ipv6.conf.all.disable_ipv6=1 net.ipv6.conf.default.disable_ipv6=1; ip -n $1 link set lo up; }
mk n37a; mk n37r; mk n37b
ip link add eth0 netns n37a type veth peer name eth0 netns n37r
ip link add eth1 netns n37r type veth peer name eth0 netns n37b
for p in "n37a eth0" "n37r eth0" "n37r eth1" "n37b eth0"; do set -- $p; ip -n $1 link set $2 up; done
ip -n n37a addr add 10.37.1.2/24 dev eth0; ip -n n37r addr add 10.37.1.1/24 dev eth0
ip -n n37r addr add 10.37.2.1/24 dev eth1; ip -n n37b addr add 10.37.2.2/24 dev eth0
ip netns exec n37r sysctl -qw net.ipv4.ip_forward=1
ip -n n37a route add default via 10.37.1.1; ip -n n37b route add default via 10.37.2.1
sleep 1
ip netns exec n37a timeout 4 tcpdump -nl -i eth0 icmp 2>/dev/null &
sleep 0.5
ip netns exec n37a timeout 5 ping -c1 -W1 10.37.2.2 | awk 'NR==2'
wait`,
          },
        },
        { md: `The capture shows two lines: \`ICMP echo request\` from A to B, then \`ICMP echo reply\` from B back to A. Ping is nothing more than those two messages, with the same \`id\` and \`seq\` on both. (Ping also prints \`ttl=63\`; that's chapter 3.8.)

Now the useful part. R gets three routes whose *type* isn't the usual "forward to a next hop". Linux calls them \`unreachable\`, \`prohibit\` and \`blackhole\`. A fourth destination, 10.37.5.1, has no route in R at all. A pings one address in each of the four.` },
        {
          checkpoint: {
            id: 'c1',
            prompt: 'R has `blackhole 10.37.7.0/24`. A pings 10.37.7.1. What does ping report?',
            options: [
              'Destination Net Unreachable: R has no way to reach that network',
              'Packet filtered: R refuses the packet on purpose',
              'Nothing: ping times out and R sends no ICMP at all',
              'Destination Host Unreachable: R reports that it dropped it',
            ],
            key: 2,
            why: 'A blackhole route discards the packet and says nothing. The other three route types each send an ICMP error. Ping only knows what comes back, so silence looks like plain loss.',
          },
        },
        {
          lab: {
            explain: 'Add unreachable, prohibit and blackhole routes on R, ping one address in each plus one with no route, and show the ICMP that came back',
            cmd: `${NEED}
ip -n n37r route replace unreachable 10.37.9.0/24
ip -n n37r route replace prohibit 10.37.8.0/24
ip -n n37r route replace blackhole 10.37.7.0/24
ip -n n37r route show | grep -E 'unreachable|prohibit|blackhole'
ip netns exec n37a timeout 14 tcpdump -nl -i eth0 icmp >/tmp/n37.cap 2>/dev/null &
sleep 0.5
for d in 10.37.9.1 10.37.8.1 10.37.7.1 10.37.5.1; do
  echo "ping $d: $(ip netns exec n37a timeout 6 ping -c1 -W2 $d 2>&1 | grep -E 'From|bytes from|100% packet' | head -1)"
done
sleep 0.5; kill %1 2>/dev/null; wait 2>/dev/null
echo; grep -v 'echo request' /tmp/n37.cap | cut -c16-`,
          },
        },
        { md: `R's three routes print as \`unreachable 10.37.9.0/24\`, \`prohibit 10.37.8.0/24\` and \`blackhole 10.37.7.0/24\`. What came back to A:

| Destination | Route on R | What ping printed | tcpdump on A |
|---|---|---|---|
| 10.37.9.1 | \`unreachable\` | Destination Host Unreachable, from 10.37.1.1 | \`ICMP host 10.37.9.1 unreachable\` |
| 10.37.8.1 | \`prohibit\` | Packet filtered, from 10.37.1.1 | \`unreachable - admin prohibited filter\` |
| 10.37.7.1 | \`blackhole\` | 100% packet loss | no ICMP line |
| 10.37.5.1 | none at all | Destination Net Unreachable, from 10.37.1.1 | \`ICMP net 10.37.5.1 unreachable\` |

Two details to take from the table. First, the \`From\` address is R's, not the destination's: the error comes from the device that gave up. Second, on this kernel the \`unreachable\` route type produced *host* unreachable, and the *net* unreachable message came from the missing route. Don't assume a route type maps to the code its name suggests; look at the capture.

> [!IMPORTANT]
> An ICMP error is sent by the device that dropped the packet, to the packet's source. A silent drop sends nothing, and the sender can only guess.` },
      ],
    },
    {
      id: 'hosts',
      title: 'Hosts send errors too',
      blocks: [
        { md: `Routers aren't the only senders. The last hop can fail as well. Two cases, both on the 10.37.2.0/24 side:

- A pings 10.37.2.99, an address on R's own subnet that no namespace has.
- A sends one UDP datagram to B (10.37.2.2) on port 9999. B is up and its kernel is running, but no program has that port open.

In each case the packet is delivered all the way to the last segment, and the question is what comes back and from where.` },
        {
          checkpoint: {
            id: 'c2',
            prompt: 'A sends UDP to B on port 9999, where nothing is listening. Which device sends the "port unreachable" error back to A?',
            options: [
              'The router R: it forwards the packet and sees the port is closed',
              'The destination B: its own kernel answers for the closed port',
              'The sender A: its own kernel gives up before the packet leaves',
              'None: UDP is connectionless, so nobody sends an error',
            ],
            key: 1,
            why: 'R only forwards by destination address and never reads the UDP header. The host that owns the port is the only one that knows nothing is listening, so B sends it.',
          },
        },
        {
          lab: {
            explain: 'Ping an unused address on R\'s subnet, then send one UDP datagram to B port 9999; show the ICMP that came back',
            cmd: `${NEED}
ip netns exec n37a timeout 14 tcpdump -nl -i eth0 icmp >/tmp/n37.cap 2>/dev/null &
sleep 0.5
echo "ping 10.37.2.99: $(ip netns exec n37a timeout 8 ping -c1 -W5 10.37.2.99 2>&1 | grep -E 'From|bytes from|100% packet' | head -1)"
ip netns exec n37a timeout 4 nc -u -z -w1 10.37.2.2 9999; echo "nc udp 9999: rc=$?"
sleep 0.5; kill %1 2>/dev/null; wait 2>/dev/null
echo; grep -v 'echo request' /tmp/n37.cap | cut -c16-`,
          },
        },
        { md: `The ping to 10.37.2.99 comes back \`Destination Host Unreachable\` from **10.37.1.1**, which is R. R accepted the packet and found the address on its connected subnet. The usual explanation is that R sent an ARP request (chapter 2.8) and got no answer, so it reported host unreachable. The lab didn't capture R's side, so that is general Linux behaviour, not something it printed.

The UDP datagram produced \`ICMP 10.37.2.2 udp port 9999 unreachable\`, and the sender is **10.37.2.2**: B itself. \`nc\` exited with 1. Linux normally turns such an ICMP message into a connection-refused error on the sender's socket, which would explain that, but the lab didn't show it. R forwarded the datagram and could not have known the port was closed.

TCP behaves differently (a closed port gets a RST, chapter 4.4). That is the contrast to remember: UDP has no handshake of its own, so ICMP is how a closed UDP port is reported.

> [!IMPORTANT]
> Routers report what they can see: routes and neighbours. Only the destination host can report a closed port or an unknown protocol.` },
      ],
    },
    {
      id: 'twins',
      title: "Where you've met this",
      blocks: [
        { md: `**AWS.** The EC2 MTU page says that in IPv4 an oversize packet with DF set is answered with an ICMP destination-unreachable, fragmentation-needed message (type 3, code 4), and that this is how a sender learns the path MTU. So blocking ICMP type 3 code 4 anywhere on that path breaks the mechanism. How security groups and NACLs treat other ICMP types is in their own documentation, which is not covered here. When ping fails but TCP works, check whether ICMP is allowed before blaming routing.

**Kubernetes / Cilium.** Whether a NetworkPolicy affects ICMP depends on the CNI. Test with \`ping\` from a debug pod instead of assuming.

**Proxmox.** The firewall can filter ICMP per VM or at the host. A Linux bridge forwards frames without looking at IP, so by itself it shouldn't generate ICMP errors (general knowledge; no lab here used a bridge). If a ping returns \`Destination Host Unreachable\`, the sender of that message is an L3 device, and the \`From\` address names which one.` },
      ],
    },
    {
      id: 'keep',
      title: 'What to keep',
      blocks: [
        { md: `- ICMP is IP's error and control channel. Echo (8/0) is ping; type 3 reports undeliverable packets; type 11 reports expired TTL.
- An error comes from the device that dropped the packet, goes to the packet's source, and quotes the start of the original packet.
- Routers report routes and neighbours (network, host, administratively prohibited). Only the destination host reports a closed UDP port.
- A silent drop (\`blackhole\`, a firewall with no reply) sends nothing. The sender sees loss, not an error.
- Read the \`From\` address in a ping error: it says who gave up.` },
      ],
    },
  ],
};
