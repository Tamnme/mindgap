// Chapter 4.1: Ports and the 5-tuple. Authored content; the tutor gets this file as chapter_source.
// Labs run in netlab (Ubuntu 26.04, iproute2 6.19) on 2026-10-25; outputs described in the prose were observed.
// Sources: https://datatracker.ietf.org/doc/html/rfc9293 (TCP header carries a source port and a destination port; "a connection is defined by a pair of sockets"),
//   https://datatracker.ietf.org/doc/html/rfc768 (the UDP header has the same two port fields),
//   https://man7.org/linux/man-pages/man8/ss.8.html (-t, -a, -n, -p, -H flags as used in the labs),
//   https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-basics.html (55,000 simultaneous connections per IPv4 address to each unique destination of IP, port and protocol; NAT gateways use ports 1024-65535).
// Hedged, not sourced: Kubernetes Service and conntrack keying, and Proxmox DNAT port forwarding. Both are general knowledge here; chapter 4.7 tests them.
// Observed only in this kernel and these labs: the client port range, the bind results in lab 3 (SO_REUSEADDR was set on every socket).

const NEED = `ip netns list | grep -q n41s || { echo "Run the first lab first."; exit 1; }`;

export default {
  node: 'ports-sockets',
  number: '4.1',
  kicker: 'Layer 4',
  title: 'Ports and the 5-tuple',
  lede: 'An IP address gets a packet to a host. A port number gets it to one program on that host. But a port number only means something next to an address and a protocol.',
  sections: [
    {
      id: 'door',
      title: 'From a host to a program',
      blocks: [
        { md: `Once a packet has reached the right host (chapters 3.1 to 3.5), the IP header has done its job: it names a host and nothing finer. Yet a host runs many programs that all want network traffic. Something in the packet has to pick the program.

That something is in the transport header, which sits right after the IP header. Both TCP and UDP start with the same two 16-bit fields:

\`\`\`
+---------------+---------------+
| source port   | dest port     |   TCP and UDP: first 4 bytes
+---------------+---------------+
| ...rest of the TCP or UDP header...
\`\`\`

A server tells the kernel "deliver anything for port 8080 to me" by creating a **listening socket**. The lab builds a server namespace with a python listener on port 8080, plus two client namespaces on separate subnets: **n41a** on 10.41.1.0/24 and **n41b** on 10.41.2.0/24. The server owns .1 on each. After the build, \`ss\` lists what the server has open.` },
        {
          lab: {
            explain: 'Build server n41s and clients n41a, n41b; start a listener on 8080 and list the server sockets',
            cmd: `ip netns pids n41s 2>/dev/null | xargs -r kill 2>/dev/null; for n in n41s n41a n41b; do ip netns del $n 2>/dev/null; done; sleep 0.5
mk() { ip netns add $1; ip netns exec $1 sysctl -qw net.ipv6.conf.all.disable_ipv6=1 net.ipv6.conf.default.disable_ipv6=1; ip -n $1 link set lo up; }
mk n41s; mk n41a; mk n41b
ip link add eth1 netns n41s type veth peer name eth0 netns n41a
ip link add eth2 netns n41s type veth peer name eth0 netns n41b
ip -n n41s link set eth1 up; ip -n n41s link set eth2 up; ip -n n41a link set eth0 up; ip -n n41b link set eth0 up
ip -n n41s addr add 10.41.1.1/24 dev eth1; ip -n n41a addr add 10.41.1.2/24 dev eth0
ip -n n41s addr add 10.41.2.1/24 dev eth2; ip -n n41b addr add 10.41.2.2/24 dev eth0
ip netns exec n41s setsid python3 -c 'import socket
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1); s.bind(("0.0.0.0",8080)); s.listen(8)
keep=[]
while True: keep.append(s.accept()[0])' >/dev/null 2>&1 &
sleep 1
ip netns exec n41s ss -H -tanp | sed 's/,pid=[0-9]*,fd=[0-9]*//'`,
          },
        },
        { md: `One line: a \`LISTEN\` socket on \`0.0.0.0:8080\`, owned by python3. The \`0.0.0.0\` means "any local address", and the \`*\` for the peer means it isn't talking to anyone yet. The \`8\` in the Send-Q column matches the backlog I passed to \`listen()\`. The columns are from \`ss -tanp\`: TCP, all states, numeric, with the owning process.

Now three clients connect to that one port: **A opens two connections** to 10.41.1.1:8080 from n41a, and **B opens one** from n41b. Hold all three open, then list the server's sockets again.` },
        {
          checkpoint: {
            id: 'c1',
            prompt: 'All three connections are open and the python program called listen() once. How many sockets on the server have local port 8080?',
            options: [
              'Only the listener: one socket owns a port, and all three clients arrive on it',
              'Three, one per connection: the listener goes away once clients connect',
              'Listener plus one per connection: each connection gets its own socket',
              'Two, one per client host: connections from the same host share a socket',
            ],
            key: 2,
            why: 'The listening socket stays and only takes new connections. Each accepted connection becomes its own socket, still on local port 8080, so a listener plus three connections is four.',
          },
        },
        {
          checkpoint: {
            id: 'c2',
            prompt: "A's two connections both go from 10.41.1.2 to 10.41.1.1:8080. What must differ between them so the kernel keeps them apart?",
            options: [
              "The client's own port number: each connection gets a port of its own on the client",
              'A new server port: the server answers each connection from a fresh port',
              'Nothing: both land on one socket and the application sorts them out',
              'The sequence numbers: the kernel matches segments by sequence number',
            ],
            key: 0,
            why: 'The IPs, the protocol and the server port are identical, so the only field left to tell them apart is the client port. The kernel looks the segment up by the whole tuple.',
          },
        },
        {
          lab: {
            explain: 'A opens 2 connections, B opens 1; read the client port range, then list sockets on the server and on A',
            cmd: `${NEED}
echo "client range: $(ip netns exec n41a cat /proc/sys/net/ipv4/ip_local_port_range)"
timeout 3 ip netns exec n41a nc 10.41.1.1 8080 </dev/null &
timeout 3 ip netns exec n41a nc 10.41.1.1 8080 </dev/null &
timeout 3 ip netns exec n41b nc 10.41.2.1 8080 </dev/null &
sleep 1
echo "--- server"; ip netns exec n41s ss -H -tanp | sed 's/,pid=[0-9]*,fd=[0-9]*//'
echo "--- client a"; ip netns exec n41a ss -H -tan
wait`,
          },
        },
      ],
    },
    {
      id: 'tuple',
      title: 'Reading the sockets',
      blocks: [
        { md: `The server shows four sockets with local port 8080: the \`LISTEN\` one and three \`ESTAB\` ones. Two of the \`ESTAB\` lines have peer 10.41.1.2 with different peer ports, and one has peer 10.41.2.2. All three reply from \`:8080\`. The server did not invent a new port per client.

A's side shows two sockets, to the same \`10.41.1.1:8080\`, and the only difference is A's own port. The lab's first line printed the range for those ports: \`32768 60999\`. The kernel picked a number from that range for each connection; these are **ephemeral ports**. Nothing configured them.

The next lab is about the port number itself. It binds port 9000 several ways in the server namespace, and you predict which binds succeed.` },
        {
          checkpoint: {
            id: 'c3',
            prompt: 'TCP port 9000 is already bound on 10.41.1.1 in the server namespace. Which of these two binds succeed: UDP 9000 on 10.41.1.1, and TCP 9000 on 10.41.2.1?',
            options: [
              'Neither works: a port number is claimed once per machine',
              'Both work: protocol and local IP are part of the socket address',
              'Only the UDP one: protocol matters but the IP does not',
              'Only the second IP: the IP matters but the protocol does not',
            ],
            key: 1,
            why: 'A socket address is protocol + IP + port. Changing either the protocol or the local IP makes a different address, so both succeed. Repeating all three would fail.',
          },
        },
        {
          lab: {
            explain: 'Bind TCP 9000, UDP 9000 and TCP 9000 on another IP, then a duplicate; list the sockets',
            cmd: `${NEED}
ip netns exec n41s python3 -c '
import socket
def bind(kind, ip, port):
    s = socket.socket(socket.AF_INET, kind); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    name = "TCP" if kind == socket.SOCK_STREAM else "UDP"
    try:
        s.bind((ip, port)); print(name, ip, port, "bound")
        if kind == socket.SOCK_STREAM: s.listen(1)
    except OSError as e: print(name, ip, port, "FAILED:", e.strerror)
    return s
keep = [bind(socket.SOCK_STREAM, "10.41.1.1", 9000), bind(socket.SOCK_DGRAM, "10.41.1.1", 9000),
        bind(socket.SOCK_STREAM, "10.41.2.1", 9000), bind(socket.SOCK_STREAM, "10.41.1.1", 9000)]
print("---"); import subprocess
print(subprocess.run("ss -H -tuln sport = :9000", shell=True, capture_output=True, text=True).stdout, end="")'`,
          },
        },
        { md: `Three binds worked and the fourth failed with \`Address already in use\`: TCP 9000 on 10.41.1.1 a second time. \`ss\` lists three sockets on port 9000: one UDP and two TCP \`LISTEN\`, on 10.41.1.1 and 10.41.2.1. Same number, three sockets. That is what you tested, on this kernel and with \`SO_REUSEADDR\` set on every socket, so what you saw is "protocol and local IP changed the outcome", nothing broader.

That is why \`53/tcp\` and \`53/udp\` are two different things, and why "port 8080 is open" is an incomplete sentence: open on which IP, over which protocol?

Put the two labs together and a connection is named by five values, the **5-tuple**:

| Field | Connection 1 | Connection 2 |
|---|---|---|
| protocol | TCP | TCP |
| source IP | 10.41.1.2 | 10.41.1.2 |
| source port | one ephemeral port | another ephemeral port |
| dest IP | 10.41.1.1 | 10.41.1.1 |
| dest port | 8080 | 8080 |

> [!IMPORTANT]
> A connection is identified by the whole 5-tuple. A server's port is shared by every connection to it, and the client's ephemeral port is what keeps one client's connections apart.

RFC 9293 says it in older words: "a connection is defined by a pair of sockets", where a socket is an address plus a port. Whether the kernel lets two connections share a client port when only the destination differs is general knowledge, and I did not test it here.` },
      ],
    },
    {
      id: 'twins',
      title: "Where you've met this",
      blocks: [
        { md: `**AWS.** The NAT gateway docs state its limits in exactly these terms: each IPv4 address supports up to 55,000 simultaneous connections to each unique destination, and a unique destination is a destination IP, destination port and protocol. My reading, not stated on that page: the limit is the 5-tuple running out of distinct source ports for one destination. The same page says NAT gateways use ports 1024-65535. Adding more addresses to the gateway adds more source IPs, and so more tuples.

**Kubernetes.** A Service maps a ClusterIP and port to a pod IP and port, so the destination half of the tuple is rewritten on the way. conntrack tracks each connection by its tuple. That is general knowledge here, not something this chapter fetched; chapter 4.7 tests it.

**Proxmox.** A port forward on the host (iptables DNAT) rewrites the destination half of a connection's tuple and conntrack remembers the mapping, again from general knowledge and not tested here.` },
      ],
    },
    {
      id: 'keep',
      title: 'What to keep',
      blocks: [
        { md: `- Ports are two 16-bit fields at the start of the TCP and UDP headers. They select a program on a host the IP header already found.
- A listening socket takes new connections. Each accepted connection is its own socket on the same local port.
- The client's port is an ephemeral one the kernel picks (here from 32768-60999); it is what separates one client's connections to the same server port.
- A connection is the 5-tuple: protocol, source IP, source port, dest IP, dest port. A bare port number means nothing without the rest.
- \`ss -tanp\` lists the sockets, their states and the owning process.` },
      ],
    },
  ],
};
