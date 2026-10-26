// Chapter 2.8: ARP: IP → MAC. Authored content; the tutor gets this file as chapter_source.
// Labs run in netlab (Ubuntu 26.04, iproute2 6.19) on 2026-10-25; outputs described in the prose were observed.
// Sources: https://datatracker.ietf.org/doc/html/rfc826 (request is broadcast to everybody on the cable; the reply is sent to the requester's hardware address;
//   the receiver of a request merges <sender IP, sender MAC> into its table before looking at the opcode, and updates an existing entry),
//   https://man7.org/linux/man-pages/man8/ip-neighbour.8.html (state meanings: stale "valid but suspicious", incomplete "not (yet) validated/resolved", delay, probe, failed "max number of probes exceeded"),
//   https://man7.org/linux/man-pages/man7/arp.7.html (base_reachable_time_ms default 30000 ms, entry valid between half and 1.5 times that; delay_first_probe_time default 5 s).
// Hedged, not sourced: the term "gratuitous ARP" and its shape (a request whose sender and target IP are equal) are general knowledge, not RFC 826's wording; Linux's exact REACHABLE -> STALE -> DELAY
//   transitions are described from the lab output only. The arping tool is not installed, so the gratuitous frame in the last lab is built by hand with python3.

const NEED = `ip link show br28 >/dev/null 2>&1 || { echo "Run the first lab (build br28) first."; exit 1; }`;
// Trim a tcpdump -e ARP line to the parts we discuss.
const TRIM = `sed -E 's/^[0-9:.]+ //; s/ethertype ARP \\(0x0806\\), //; s/, length [0-9]+//g'`;

export default {
  node: 'arp',
  number: '2.8',
  kicker: 'Layer 2',
  title: 'ARP: IP → MAC',
  lede: 'A host that wants to send to an IP address on its own segment has to learn that address\'s MAC first. ARP is how it asks, and the answer lands in a small table you can read.',
  sections: [
    {
      id: 'ask',
      title: 'Asking the segment',
      blocks: [
        { md: `Chapter 2.2 ended on a split: the switch holds MAC → port, and the hosts hold IP → MAC. This chapter is the second table.

A host has a packet for \`10.28.0.2\` and a NIC that can only send Ethernet frames, which need a destination MAC. It doesn't have one. The only thing it can do is ask the segment, and ARP is that question: "who has 10.28.0.2?"

The lab builds a segment, \`br28\`, with three hosts. **A** is \`10.28.0.1\`, **B** is \`10.28.0.2\`, and C sits there silent for now. A's neighbour table (\`ip neigh\`) starts empty. A then pings B once while \`tcpdump -e\` watches A's NIC, which prints MAC addresses. Afterwards, both A's and B's tables are listed.

The same segment has a router namespace at \`10.28.0.254\`, with a second subnet \`10.28.1.0/24\` behind it, for the later labs. The tcpdump filter is just \`arp\`.` },
        {
          checkpoint: {
            id: 'c1',
            prompt: 'A has never talked to B. In the capture, how do the ARP request and the ARP reply travel at Ethernet level?',
            options: [
              'Both broadcast: everyone on the segment hears the answer too',
              'Request to ff:ff:ff:ff:ff:ff, reply straight to A\'s MAC',
              'Both unicast: the switch already told A where B is',
              'Request broadcast, reply multicast: to every ARP-speaking host',
            ],
            key: 1,
            why: 'A cannot unicast a request, because the MAC is exactly what it is missing. The reply can be unicast, because the request already carried A\'s MAC as its source.',
          },
        },
        {
          lab: {
            explain: 'Build br28 (A, B, C, a router and a host behind it), ping B from A while capturing ARP, then read both neighbour tables',
            cmd: `for n in n28a n28b n28c n28r n28x; do ip netns del $n 2>/dev/null; done
ip link del br28 2>/dev/null; for v in v28a v28b v28c v28r v28x; do ip link del $v 2>/dev/null; done; sleep 0.5
ip link add br28 type bridge && ip link set br28 up
mk() { ip netns add $1; ip netns exec $1 sysctl -qw net.ipv6.conf.all.disable_ipv6=1 net.ipv6.conf.default.disable_ipv6=1; }
for n in a b c r; do mk n28$n; ip link add v28$n type veth peer name eth0 netns n28$n; ip link set v28$n master br28 up; ip -n n28$n link set eth0 up; done
mk n28x; ip link add eth1 netns n28r type veth peer name eth0 netns n28x; ip -n n28r link set eth1 up; ip -n n28x link set eth0 up
ip -n n28a addr add 10.28.0.1/24 dev eth0; ip -n n28b addr add 10.28.0.2/24 dev eth0
ip -n n28r addr add 10.28.0.254/24 dev eth0; ip -n n28r addr add 10.28.1.254/24 dev eth1; ip netns exec n28r sysctl -qw net.ipv4.ip_forward=1
ip -n n28x addr add 10.28.1.1/24 dev eth0; ip -n n28x route add default via 10.28.1.254
ip -n n28a route add default via 10.28.0.254
sleep 1
echo "A's table before: [$(ip -n n28a neigh show)]"
ip netns exec n28a timeout 4 tcpdump -nel -i eth0 arp 2>/dev/null | ${TRIM} &
sleep 1; ip netns exec n28a ping -c1 -W1 10.28.0.2 >/dev/null; wait
echo "--- A's table:"; ip -n n28a neigh show
echo "--- B's table:"; ip -n n28b neigh show`,
          },
        },
        { md: `The request goes to \`ff:ff:ff:ff:ff:ff\`, a broadcast, so every port on the segment gets it. The reply goes to A's MAC only. RFC 826's algorithm says the same thing: the request is broadcast to everybody on the cable, and the reply is sent to the hardware address of the requester.

Look at B's table. B never asked anyone, and it already holds an entry for A. RFC 826 has the receiver merge the sender's IP and MAC into its table *before* it looks at the opcode, so any host that is the target of a request learns the asker for free. When B later answers A's pings, no second ARP exchange is needed.

> [!IMPORTANT]
> ARP request: broadcast, "who has IP X, tell IP Y". ARP reply: unicast, "X is at this MAC". Both ends end up with an entry.` },
      ],
    },
    {
      id: 'gateway',
      title: 'Who gets asked when the destination is far away',
      blocks: [
        { md: `A's routing table is the one from the lab: \`10.28.0.0/24\` is on-link, and everything else goes to the default gateway \`10.28.0.254\`. The host \`10.28.1.1\` is on the far side of the router, and it's the destination of the next ping. A's table (and B's, so B has no reason to ask about A) is flushed first, so nothing is cached. Another \`tcpdump -e arp\` runs on A's NIC.` },
        {
          checkpoint: {
            id: 'c2',
            prompt: 'A pings 10.28.1.1, behind the router. What does A\'s ARP request ask for?',
            options: [
              'who-has 10.28.1.1: the remote host itself, so A can address it directly',
              'who-has 10.28.1.254: the router\'s address on the far side',
              'who-has 10.28.0.254: the router\'s address on A\'s segment',
              'No ARP at all: the default route already supplies a MAC',
            ],
            key: 2,
            why: 'A\'s routing decision picks the next hop, 10.28.0.254. The frame only has to reach the next hop, so that is the only address A needs a MAC for. The remote host\'s MAC would be useless to A: it isn\'t on A\'s segment.',
          },
        },
        {
          lab: {
            explain: 'Flush A\'s and B\'s tables, ping the host behind the router, capture ARP on A, then read A\'s table',
            cmd: `${NEED}
ip -n n28a neigh flush all; ip -n n28b neigh flush all
ip netns exec n28a timeout 4 tcpdump -nel -i eth0 arp 2>/dev/null | ${TRIM} &
sleep 1; ip netns exec n28a ping -c1 -W1 10.28.1.1 | sed -n 2p; wait
echo "--- A's table:"; ip -n n28a neigh show
echo "--- router eth0 MAC: $(ip -n n28r -br link show eth0 | awk '{print $3}')"`,
          },
        },
        { md: `One request, for \`10.28.0.254\`, and one reply from the router's MAC. A's table holds only the router. The ping to \`10.28.1.1\` worked (the output's first line), and A never learned that host's MAC. Every frame A sent for it carried the router's MAC as its destination and \`10.28.1.1\` inside the IP header.

A can only use a gateway it can ARP for, so the gateway has to be on A's own segment. ARP stops at the edge of the broadcast domain, because a broadcast does.

Next: what happens to an entry as time passes.` },
      ],
    },
    {
      id: 'states',
      title: 'An entry has a life',
      blocks: [
        { md: `A neighbour entry isn't permanent. The MAC behind an IP can change (a VM migrates, a NIC is replaced), so Linux keeps each entry with a state and re-checks it. \`ip neigh\` prints the state at the end of each line.

The default timers are slow: \`base_reachable_time_ms\` is 30000 and \`delay_first_probe_time\` is 5 s, per arp(7). The lab shortens them on A's NIC to 2000 ms and 1 s so the whole life fits in seconds. A pings B, waits 5 s with no traffic, then pings B again. Then A pings \`10.28.0.99\`, an address nobody owns.` },
        {
          checkpoint: {
            id: 'c3',
            prompt: 'A pinged B, then did nothing for 5 s (timers shortened). What is the entry for B now?',
            options: [
              'Still REACHABLE: a confirmed entry stays confirmed until it is deleted',
              'Gone: the entry expired and was removed from the table',
              'FAILED: B stopped answering, so the entry is marked dead',
              'STALE: kept, but no longer confirmed',
            ],
            key: 3,
            why: 'Nothing proved B was still there, so the confirmation ran out. Linux keeps the MAC (it is probably still right, and throwing it away would force a broadcast) but marks it stale until traffic uses it again.',
          },
        },
        {
          lab: {
            explain: 'Shorten the timers on A, then watch B\'s entry age, get used again, and the entry for an address nobody owns',
            cmd: `${NEED}
ip -n n28a neigh flush all
ip netns exec n28a sysctl -qw net.ipv4.neigh.eth0.base_reachable_time_ms=2000 net.ipv4.neigh.eth0.delay_first_probe_time=1
ip netns exec n28a ping -c1 -W1 10.28.0.2 >/dev/null
echo "right after the ping: $(ip -n n28a neigh show 10.28.0.2 | awk '{print $NF}')"
sleep 5
echo "5 s later:            $(ip -n n28a neigh show 10.28.0.2 | awk '{print $NF}')"
ip netns exec n28a ping -c1 -W1 10.28.0.2 >/dev/null; sleep 0.3
echo "after using it again: $(ip -n n28a neigh show 10.28.0.2 | awk '{print $NF}')"
ip netns exec n28a ping -c1 -W1 10.28.0.99 >/dev/null
echo "1 s into pinging .99: $(ip -n n28a neigh show 10.28.0.99 | awk '{print $NF}')"
sleep 4
echo "5 s in:               $(ip -n n28a neigh show 10.28.0.99 | awk '{print $NF}')"`,
          },
        },
        { md: `The entry for B goes REACHABLE, then STALE after the quiet period. ip-neighbour(8) calls stale "valid but suspicious". When A uses it again, the entry moves to DELAY, and arp(7) describes \`delay_first_probe_time\` as the delay before the first probe once a neighbour is judged stale.

The address nobody owns takes a different path. The entry is INCOMPLETE while A's requests go unanswered, then FAILED after the probes run out. FAILED is what a missing neighbour looks like on your own segment: nobody answered the question.

> [!IMPORTANT]
> STALE is not broken. STALE means "re-verify before trusting". FAILED means ARP got no answer at all.

One last case: the owner of an IP changes while entries are cached. A's entry for \`10.28.0.2\` points at B's MAC. The lab moves \`10.28.0.2\` to C, then C sends a **gratuitous ARP**: a request in which the sender's IP and the target IP are the same address, broadcast without anyone asking. The \`arping\` tool isn't installed in netlab, so the lab builds that one frame by hand with a few lines of python. A listens, and its table is printed before and after.` },
        {
          lab: {
            explain: 'Move 10.28.0.2 from B to C and send a hand-built gratuitous ARP from C; compare A\'s entry before and after',
            cmd: `${NEED}
mac() { ip -n $1 -br link show eth0 | awk '{print $3}'; }
ip -n n28b addr del 10.28.0.2/24 dev eth0 2>/dev/null; ip -n n28c addr del 10.28.0.2/24 dev eth0 2>/dev/null
ip -n n28a neigh replace 10.28.0.2 lladdr $(mac n28b) dev eth0 nud reachable
echo "A thinks .2 is: $(ip -n n28a neigh show 10.28.0.2 | awk '{print $5}')   (B=$(mac n28b)  C=$(mac n28c))"
ip -n n28c addr add 10.28.0.2/24 dev eth0
ip netns exec n28a timeout 3 tcpdump -nl -e -i eth0 arp 2>/dev/null | ${TRIM} &
sleep 1
ip netns exec n28c python3 -c '
import socket, struct
m = bytes.fromhex("'$(mac n28c | tr -d :)'"); ip = bytes([10,28,0,2]); bc = b"\\xff"*6
arp = struct.pack("!HHBBH", 1, 0x0800, 6, 4, 1) + m + ip + bc + ip  # request, sender IP = target IP
s = socket.socket(socket.AF_PACKET, socket.SOCK_RAW); s.bind(("eth0", 0)); s.send(bc + m + b"\\x08\\x06" + arp)'
wait
echo "A now thinks .2 is: $(ip -n n28a neigh show 10.28.0.2 | awk '{print $5, $NF}')"`,
          },
        },
        { md: `A saw one broadcast frame, from C's MAC, asking "who has 10.28.0.2, tell 10.28.0.2". A never asked, and its entry for \`10.28.0.2\` changed from B's MAC to C's, with the state STALE. That's RFC 826's merge rule again: a packet whose sender IP is already in the table updates that entry.

This is how an IP address fails over on a real L2 segment. The new owner announces itself, and every cache on the segment that already holds that IP switches to the new MAC at once, with no timer to wait for. It's what VRRP and keepalived rely on, and it needs a segment where a broadcast reaches everyone. That last condition is the subject of the next chapter.` },
      ],
    },
    {
      id: 'twins',
      title: "Where you've met this",
      blocks: [
        { md: `**Proxmox.** VMs on one \`vmbr0\` ARP across the bridge as in the lab, and the bridge floods the request like any broadcast. The PVE wiki's routed example turns on \`proxy_arp\` on the host NIC, so the host answers ARP on behalf of addresses behind it; chapter 2.9 uses that idea.

**AWS.** Instances do hold a neighbour table with the subnet's router as gateway. AWS documents that broadcast isn't supported in a VPC; it doesn't publish how ARP requests get answered, so treat \`ip neigh\` on an instance as the evidence, not a theory of the SDN.

**Kubernetes.** A pod ARPs for its gateway on its veth. How the CNI answers that is CNI-specific and not verified here for Cilium; \`ip neigh\` inside a pod shows what the pod learned.` },
      ],
    },
    {
      id: 'keep',
      title: 'What to keep',
      blocks: [
        { md: `- ARP request: broadcast, "who has X". Reply: unicast to the asker. The target learns the asker from the request.
- You ARP only for the next hop on your own segment: the destination if it's on-link, otherwise the gateway.
- Entries age: REACHABLE, then STALE, and DELAY or PROBE when used. INCOMPLETE then FAILED means nobody answered.
- A gratuitous ARP updates every cache that holds the IP. It's an L2 broadcast, so it only works inside the segment.` },
      ],
    },
  ],
};
