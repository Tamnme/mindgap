// Chapter 4.7: NAT/PAT and conntrack. Authored content; the tutor gets this file as chapter_source.
// Labs run in netlab (Ubuntu 26.04, iproute2 6.19, kernel 7.2) on 2026-10-25; outputs described in the prose were observed.
// Sources (all fetched 2026-10-25):
//   https://wiki.nftables.org/wiki-nftables/index.php/Performing_Network_Address_Translation_(NAT) (stateful NAT uses conntrack; masquerade is a special case of SNAT that sets the source to the address of the output interface and only makes sense in a postrouting nat chain; the random and fully-random port flags exist),
//   https://datatracker.ietf.org/doc/html/rfc3022 (section 6.3: in a NAPT setup only the first fragment carries the TCP/UDP header needed to associate a packet with a session),
//   https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-basics.html (limits and supported protocols; up to 8 IPv4 addresses on a NAT gateway; 55,000 connections per address per unique destination, already covered in chapter 4.1),
//   https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html (public NAT gateway: private instances connect out, cannot receive unsolicited inbound connections; Elastic IP; route to the internet gateway).
// Observed only on this kernel (Linux 7.2 in the OrbStack VM): every address, port, conntrack row and refusal below. The rewritten source port differs from run to run, so the prose names the values seen across runs as examples.
// Hedged, not sourced: the term PAT (general knowledge), Kubernetes/Cilium and Proxmox comparisons (general knowledge, not fetched), AWS NAT gateway port selection (AWS does not say how it picks ports).
// Chapter 4.1 already sourced the 55,000-connection limit and computed the 28,232-port range; this chapter links there and does not repeat the arithmetic.

export default {
  node: 'nat-pat-conntrack',
  number: '4.7',
  kicker: 'Layer 4',
  title: 'NAT/PAT and conntrack',
  lede: 'NAT rewrites addresses in a packet header, and port translation rewrites ports as well. The router remembers every rewrite in its conntrack table so that the replies can be undone.',
  sections: [
    {
      id: 'rewrite',
      title: 'A private client behind a router',
      blocks: [
        { md: `Chapter 3.5 gave the rule for forwarding: a host sends a packet along a route it has, and a packet for a network it has no route to goes nowhere. Keep that in mind for this topology.

Two clients, \`n47a\` (10.47.1.2) and \`n47b\` (10.47.1.3), sit on a bridge inside the router \`n47r\`, whose inside address is 10.47.1.1. The router's WAN side is 198.51.100.1 and it faces a server \`n47s\` at 198.51.100.2, listening on port 8080. The server's only network is 198.51.100.0/24. Nothing tells it where 10.47.1.0/24 is. The router has one rule in the postrouting hook of an nft table of type nat, shown in the lab below.

Client A connects to 198.51.100.2 port 8080. The server prints the peer address of the connection it accepts.` },
        {
          checkpoint: {
            id: 'c1',
            prompt: 'Client A (10.47.1.2) connects to the server at 198.51.100.2:8080 through the router. What peer address does the server report?',
            options: [
              'Fails: the server has no route back to a private address, so no connection forms',
              'The router\'s WAN address, 198.51.100.1: the source field was rewritten on the way out',
              'The client\'s own address, 10.47.1.2: a router forwards packets without changing them',
            ],
            key: 1,
            why: 'The router rewrites the source address of the outgoing packets to its own WAN address, so the server sees 198.51.100.1 and replies to that, an address it can reach. The router then undoes the rewrite on the replies.',
          },
        },
        {
          lab: {
            explain: 'Build clients A and B, the router and the server; one client connects through the router; read the server\'s routes, the peer it sees and conntrack',
            cmd: `for n in n47a n47b n47r n47s; do ip netns del $n 2>/dev/null; done; sleep 0.5
mk() { ip netns add $1; ip netns exec $1 sysctl -qw net.ipv6.conf.all.disable_ipv6=1 net.ipv6.conf.default.disable_ipv6=1; ip -n $1 link set lo up; }
for n in n47a n47b n47r n47s; do mk $n; done
ip -n n47r link add br47 type bridge; ip -n n47r link set br47 up; ip -n n47r addr add 10.47.1.1/24 dev br47
for c in a b; do
  ip link add eth0 netns n47$c type veth peer name p$c netns n47r
  ip -n n47r link set p$c master br47 up; ip -n n47$c link set eth0 up
done
ip -n n47a addr add 10.47.1.2/24 dev eth0; ip -n n47b addr add 10.47.1.3/24 dev eth0
for c in a b; do ip -n n47$c route add default via 10.47.1.1; done
ip link add wan netns n47r type veth peer name eth0 netns n47s
ip -n n47r link set wan up; ip -n n47s link set eth0 up
ip -n n47r addr add 198.51.100.1/24 dev wan; ip -n n47s addr add 198.51.100.2/24 dev eth0
ip netns exec n47r sysctl -qw net.ipv4.ip_forward=1
ip netns exec n47r nft add table ip nat47
ip netns exec n47r nft add chain ip nat47 post '{ type nat hook postrouting priority 100; }'
ip netns exec n47r nft add rule ip nat47 post oifname wan masquerade
cat > /tmp/srv47.py <<'PY'
import socket, sys, time
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("198.51.100.2", 8080)); s.listen(5); s.settimeout(float(sys.argv[1])); keep = []
try:
    while True:
        c, peer = s.accept(); keep.append(c); print("server sees peer %s:%d" % peer, flush=True)
except socket.timeout: pass
PY
cat > /tmp/cli47.py <<'PY'
import socket, sys, time
# usage: cli47.py HOLD [SRC_PORT]
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
if len(sys.argv) > 2: s.bind(("", int(sys.argv[2])))
s.settimeout(3); s.connect(("198.51.100.2", 8080))
print("client %s bound %s:%d" % (sys.argv[3] if len(sys.argv) > 3 else "-", *s.getsockname()), flush=True)
time.sleep(float(sys.argv[1]))
PY
sleep 1
echo "--- routes on the server"; ip -n n47s route
echo "--- one client connects"
ip netns exec n47s python3 /tmp/srv47.py 4 & SP=$!
sleep 0.5
ip netns exec n47a python3 /tmp/cli47.py 2 &
sleep 1
echo "--- conntrack on the router"
ip netns exec n47r conntrack -L -p tcp 2>/dev/null | sed "s/ mark=0 use=1//; s/^tcp  *6 [0-9]* //"
wait $SP`,
          },
        },
        { md: `The server's routing table has one line, the connected network 198.51.100.0/24, so it has no route to 10.47.1.2, and it never needed one. The client reported its own socket as \`10.47.1.2\` with some port, and the server reported its peer as \`198.51.100.1\` with *the same port number*. The router changed the address and left the port alone.

The rule that did it is \`oifname wan masquerade\`. The nftables wiki describes masquerade as "a special case of SNAT, where the source address is automagically set to the address of the output interface", and adds that it only makes sense in a postrouting chain of type nat. So the router asks, per packet, "what is the address of the interface this leaves by?", and writes that into the source field. The alternative, \`snat to <address>\`, names a fixed address instead. That distinction between the two comes from the same wiki page.

The wiki also says stateful NAT "involves the nf_conntrack kernel engine", and the last lab line shows what that means. The row \`conntrack -L\` printed holds two tuples:

\`\`\`
src=10.47.1.2   dst=198.51.100.2 sport=P dport=8080   <- original
src=198.51.100.2 dst=198.51.100.1 sport=8080 dport=P   <- reply
\`\`\`

The first tuple is the packet as the client sent it. The second is the packet as it will come back, and its destination is 198.51.100.1, the router's WAN address. Without NAT the reply would be addressed to 10.47.1.2. That difference between the two tuples is the whole translation, written down. When the server's reply arrives, the router finds it by its tuple, rewrites the destination back to 10.47.1.2, and forwards it inside.

> [!IMPORTANT]
> NAT is a rewrite plus a table entry. The entry is what lets later packets and every reply be translated back.` },
      ],
    },
    {
      id: 'ports',
      title: 'Two clients, one source port',
      blocks: [
        { md: `The next lab sets up two connections that look alike. Both clients bind source port 40000 before connecting to 198.51.100.2:8080: A first, then B 0.3 s later. Inside the router the two connections are different, 10.47.1.2:40000 and 10.47.1.3:40000. Both stay open while the lab reads the server's view and \`conntrack -L\`. The lab flushes the conntrack table first, so only these two connections show.` },
        {
          checkpoint: {
            id: 'c2',
            prompt: 'Clients A and B both connect from source port 40000 to 198.51.100.2:8080. What does the server see as the peers?',
            options: [
              'Identical peers: the router swaps addresses only, so both arrive as 198.51.100.1:40000',
              'Second one rejected: the router refuses a source port that is already in use',
              'Same address, different ports: the router rewrites one source port to keep the pair unique',
              'Two addresses: the router gives each client its own WAN address',
            ],
            key: 2,
            why: 'The server tells connections apart by their tuple. Two flows from 198.51.100.1:40000 to the same destination would collide, so the router keeps one port and rewrites the other.',
          },
        },
        {
          lab: {
            explain: 'A and B both bind source port 40000 and connect to the server; read the peers the server sees and the conntrack rows',
            cmd: `ip netns list | grep -q n47r || { echo "Run the first lab first."; exit 1; }
ip netns exec n47r conntrack -F 2>/dev/null
ip netns exec n47s python3 /tmp/srv47.py 5 & SP=$!
sleep 0.5
ip netns exec n47a python3 /tmp/cli47.py 3 40000 A &
sleep 0.3
ip netns exec n47b python3 /tmp/cli47.py 2.5 40000 B &
sleep 1.2
echo "--- conntrack on the router"
ip netns exec n47r conntrack -L -p tcp 2>/dev/null | sed 's/ mark=0 use=1//; s/^tcp  *6 [0-9]* //'
wait $SP`,
          },
        },
        { md: `The server reported two peers, both at 198.51.100.1: one on port 40000, and one on a different port. Both clients sit behind one WAN address, so the server sees the same source address for every connection from either, and the source port is what tells two connections apart. Nothing stops two inside hosts from choosing the same port. The router has one WAN address, so the only field it has left to make the connections distinct is the port.

The conntrack rows show how it did it. Client A's row is unchanged: the original tuple has \`sport=40000\` and the reply tuple has \`dport=40000\`. Client B's row has \`sport=40000\` in the original, because that is what B sent, and a different number in the reply's \`dport\`. The original tuple is the packet before translation, and the reply tuple is the packet as the server sends it back. The router uses the reply tuple to find the row, so each reply tuple has to be unique. When B's connection arrived and 40000 was already taken, the router picked another port for the outside.

In the runs recorded for this chapter the second port was different each time. The values seen across runs of this lab included 4480, 5723, 12908, 46616, 52097 and 55023, and the first three are below the 32768-60999 ephemeral range from chapter 4.1. The wiki lists \`random\` and \`fully-random\` flags that randomise the source port mapping. This lab used neither, so the cause of the variation is not tested here. What the lab does show is that on this kernel a port is left alone while it is free and rewritten when it collides.

This is **port address translation**. The name is worth fixing: "PAT" is the common term for NAT that rewrites ports too (general knowledge, not fetched), and RFC 3022 calls the setup NAPT. Address-only NAT would need a separate outside address for each inside host that is talking at the same time (general reasoning, not tested here). Translating ports lets thousands of flows share one.

PAT has one structural weakness that RFC 3022 section 6.3 (a 2001 RFC; not tested here) spells out. It matches packets to sessions by the TCP or UDP header, and "only the first fragment contains the TCP/UDP header that would be necessary to associate the packet to a session". A later fragment has no port in it for the table to look up. The RFC describes the general problem for a port-translating NAT. This chapter does not say whether Linux masquerade behaves that way, because fragments were not run. Fragments come up in chapter 3.9, on MTU.

> [!IMPORTANT]
> PAT keeps every flow's outside tuple unique by rewriting the source port when it has to. The conntrack row stores both the original and the reply tuple, and replies are found through the reply tuple.` },
      ],
    },
    {
      id: 'inbound',
      title: 'What the table lets back in',
      blocks: [
        { md: `Client A's connection from port 40000 is still open, so the router's table holds a row that mentions port 40000 on the WAN side. The server now dials the router's WAN address, 198.51.100.1, on port 40000. A fresh connection, from a port the server picks.

The lab also captures on client A's interface, counting A's own packets as a control and any packet that arrives from the server's other ports during the attempt.` },
        {
          checkpoint: {
            id: 'c3',
            prompt: 'Client A has a live connection that uses WAN port 40000. The server opens a new connection to 198.51.100.1 port 40000. What happens?',
            options: [
              'Refused by the router: nothing matches this tuple, and nothing listens there',
              'Reaches A: the router already maps port 40000, so it forwards the packet inside',
              'Times out: NAT silently drops anything it has no mapping for',
            ],
            key: 0,
            why: 'The table is looked up by the whole tuple. The existing row expects replies from port 8080, and this SYN comes from another source port, so it matches nothing. It is addressed to the router itself, which has no listener, so the router is the one that can refuse it and the packet never goes inside.',
          },
        },
        {
          lab: {
            explain: 'With A\'s connection open, the server dials 198.51.100.1:40000; count A\'s own packets as a control and packets reaching A from other server ports (expect 0)',
            cmd: `ip netns list | grep -q n47r || { echo "Run the first lab first."; exit 1; }
ip netns exec n47r conntrack -F 2>/dev/null
ip netns exec n47s python3 /tmp/srv47.py 6 & SP=$!
ip netns exec n47a timeout 5 tcpdump -nl -i eth0 'tcp port 40000' 2>/dev/null > /tmp/a47.cap &
sleep 1
ip netns exec n47a python3 /tmp/cli47.py 4 40000 A &
sleep 1
echo "--- server dials the router's WAN address, port 40000"
ip netns exec n47s python3 -c "
import socket
s = socket.socket(); s.settimeout(2)
try: s.connect(('198.51.100.1', 40000)); print('connected')
except OSError as e: print(e.strerror)"
sleep 3
echo "control, A's own packets to the server in the capture: $(grep -c '10.47.1.2.40000 > 198.51.100.2.8080' /tmp/a47.cap)"
echo "packets A saw coming from the server's other ports: $(grep '> 10.47.1.2.40000' /tmp/a47.cap | grep -vc '198.51.100.2.8080 >')"
wait $SP`,
          },
        },
        { md: `The attempt was refused straight away. A's capture on the inside held 2 of A's own packets to the server, which shows the capture was running, and 0 packets arriving from any other server port. The SYN was addressed to the router's own WAN address, so the router is the only other box that could have answered it, and the capture shows nothing arrived inside. The lab did not capture the source of the reset, so "the router answered" is the inference that fits. Nothing reached the inside host, although that host was using port 40000 at the time.

The reason is the lookup. The row for A's connection will match a packet with source 198.51.100.2 port 8080 and destination 198.51.100.1 port 40000: that is its reply tuple. The new SYN has a different source port, so it matches no row. There is no mapping for "a new connection to port 40000", because mappings are created only by traffic from the inside. In this setup a connection can only enter through a row that an inside host created by connecting out.

That is a property of the table, not a filtering rule. Whether to count on it is a design choice. The lab shows the lookup, not a security guarantee.` },
      ],
    },
    {
      id: 'twins',
      title: "Where you've met this",
      blocks: [
        { md: `**AWS NAT gateway.** AWS describes a public NAT gateway as a service that lets instances in a private subnet reach the internet, while the instances "can't receive unsolicited inbound connections from the internet". You create it in a public subnet, give it an Elastic IP address, and route its traffic to the internet gateway. That is the lab's router, with the WAN address being the Elastic IP. Chapter 4.1 already covered the NAT gateway's per-destination connection limit and worked out the ephemeral range, so none of that is repeated here. The lab is consistent with there being such a limit: every flow needs its own outside tuple, and with one source address and one destination the source port is the only thing left to vary. Per the same page, a NAT gateway supports TCP, UDP and ICMP, and can have up to 8 IPv4 addresses (1 primary and 7 secondary), which multiplies the tuples available. AWS's documentation gives the range its ports come from (1024-65535) but doesn't publish how it picks a port within it, so the safe mental model is the one in the lab and nothing more specific.

**Kubernetes / Cilium.** Pod traffic leaving a cluster is commonly source-translated to the node's address, and Service virtual IPs are commonly destination-translated to a pod, with both translations recorded in conntrack. This chapter did not fetch Kubernetes or Cilium documentation, so treat that as general knowledge. The method carries over: \`conntrack -L\` on the node shows the original and reply tuples of a flow, and a mismatch between them is the translation.

**Proxmox.** A Proxmox host that gives VMs on a private bridge access to the outside commonly does it with a masquerade rule in the nat table's postrouting chain, which is exactly the rule in the lab (general knowledge, not fetched). \`conntrack -L\` on the host then lists the same rows.` },
      ],
    },
    {
      id: 'keep',
      title: 'What to keep',
      blocks: [
        { md: `- Masquerade is SNAT whose source address is the address of the output interface, applied in a postrouting nat chain. The server only ever saw the router's WAN address.
- Every NAT row in \`conntrack -L\` has an original tuple and a reply tuple, and the difference between them is the translation.
- When two inside flows would share an outside tuple, the router rewrites a source port. In the lab it kept a free port and changed a colliding one, to a different value in each run.
- A connection can enter through a row only if an inside host created it by connecting out. A new SYN to the same WAN port was refused and never appeared on the inside.
- AWS's NAT gateway gives private instances outbound access and no unsolicited inbound. Its connection limit is covered in chapter 4.1.` },
      ],
    },
  ],
};
