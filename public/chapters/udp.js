// Chapter 4.2: UDP. Authored content; the tutor gets this file as chapter_source.
// Labs run in netlab (Ubuntu 26.04, iproute2 6.19) on 2026-10-25; outputs described in the prose were observed.
// Sources: https://datatracker.ietf.org/doc/html/rfc768 (UDP header is source port, destination port, length, checksum; "delivery and duplicate protection are not guaranteed"; the protocol uses "a minimum of protocol mechanism"),
//   https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/security-group-connection-tracking.html (security groups track connections, including UDP, so a response to an allowed request is let back regardless of the other direction's rules),
//   https://docs.aws.amazon.com/vpc/latest/userguide/nat-gateway-basics.html (a NAT gateway supports TCP, UDP and ICMP).
// Observed, not quoted from a spec: everything in the labs. ECONNREFUSED on a connected socket and the silence on an unconnected one are the Linux python3 behaviour in this VM, not a claim about other systems.
// General knowledge, not tested: that losing one IP fragment loses the whole datagram.
// Hedged, not sourced: CoreDNS, VXLAN and WireGuard riding on UDP and Kubernetes UDP Services (general knowledge; chapters 5.1 and 6.2 go further), and what the Proxmox firewall does with UDP.

const NEED = `ip netns list | grep -q n42a || { echo "Run the first lab first."; exit 1; }`;

export default {
  node: 'udp',
  number: '4.2',
  kicker: 'Layer 4',
  title: 'UDP',
  lede: 'UDP puts a port pair and a length on a payload and sends it. Everything TCP adds on top, UDP leaves out.',
  sections: [
    {
      id: 'bare',
      title: 'A header and a payload',
      blocks: [
        { md: `Chapter 4.1 gave you the socket address: protocol, IP and port. UDP is the thinnest protocol that uses it. RFC 768 defines a header of four 16-bit fields:

\`\`\`
+-------------+-------------+
| source port | dest port   |
+-------------+-------------+
| length      | checksum    |
+-------------+-------------+
| payload ...               |
\`\`\`

Eight bytes, then your data.

The first lab builds two namespaces, **n42a** (10.42.0.1) and **n42b** (10.42.0.2), joined by one veth. In n42b, \`nc -u -l 9999\` listens on UDP port 9999. In n42a, \`tcpdump\` watches for UDP and ICMP while \`echo hello | nc -u\` sends one datagram.` },
        {
          checkpoint: {
            id: 'c1',
            prompt: 'A sends one datagram to B on UDP 9999, where nc is listening. What does tcpdump on A show coming back?',
            options: [
              'A UDP acknowledgement: the receiving kernel confirms every datagram',
              'A handshake first: UDP sets up a path before the data moves',
              'An ICMP "received" message: the receiving host reports delivery',
              'Only the datagram going out: nothing returns unless the application sends something',
            ],
            key: 3,
            why: 'UDP has no acknowledgement and no handshake of its own, and ICMP is for errors, not receipts. The one datagram out is the whole exchange unless the application replies.',
          },
        },
        {
          lab: {
            explain: 'Build n42a and n42b, listen on UDP 9999 in n42b, send "hello" from n42a while tcpdump watches udp and icmp',
            cmd: `for n in n42a n42b; do ip netns del $n 2>/dev/null; done; sleep 0.5
mk() { ip netns add $1; ip netns exec $1 sysctl -qw net.ipv6.conf.all.disable_ipv6=1 net.ipv6.conf.default.disable_ipv6=1; ip -n $1 link set lo up; }
mk n42a; mk n42b
ip link add eth0 netns n42a type veth peer name eth0 netns n42b
ip -n n42a link set eth0 up; ip -n n42b link set eth0 up
ip -n n42a addr add 10.42.0.1/24 dev eth0; ip -n n42b addr add 10.42.0.2/24 dev eth0
sleep 1
ip netns exec n42b timeout 4 nc -u -l 9999 &
ip netns exec n42a timeout 4 tcpdump -nl -i eth0 'udp or icmp' 2>/dev/null &
sleep 1
echo "send:"; echo hello | ip netns exec n42a nc -u -w1 10.42.0.2 9999; echo "nc exit: $?"
wait`,
          },
        },
        { md: `The listener printed \`hello\`, so the datagram arrived. tcpdump on A shows exactly one line, \`10.42.0.1.<port> > 10.42.0.2.9999: UDP, length 6\`: five letters plus the newline. Nothing came back, and \`nc\` on A exited with status 0.

That exit status says only that the datagram was handed to the network. A sender that wants to know it arrived has to build that itself: B's application replies, A's application waits for it, and both agree on what to do when it doesn't come.

RFC 768 says as much: the protocol uses "a minimum of protocol mechanism" and "delivery and duplicate protection are not guaranteed". Applications that need ordered, reliable delivery are pointed at TCP.

The one safety feature UDP does keep is the checksum. RFC 768 computes it over the header, the data and a pseudo header holding the source address, destination address, protocol and UDP length, which "gives protection against misrouted datagrams". The checksum detects damage and misdelivery; it repairs nothing.` },
      ],
    },
    {
      id: 'silence',
      title: 'A port with no listener',
      blocks: [
        { md: `A datagram aimed at a port with no socket behind it is a different case. Nobody is listening on UDP 9998 in n42b. This lab uses a small python client for what \`nc\` hides: a **connected** UDP socket (\`connect()\` just records the peer address, and sends nothing) that sends twice and waits up to a second for a reply each time, and an **unconnected** one that does the same with \`sendto\`. tcpdump on A watches again.` },
        {
          checkpoint: {
            id: 'c2',
            prompt: 'The connected UDP socket sends to port 9998, where nothing listens. What does the python program see when it waits for a reply?',
            options: [
              'Silence for the connected socket too: nothing in UDP can report a failure to the sender',
              'An error from the socket call (connection refused)',
              'A TCP-style reset: the closed port answers with RST',
              'An empty UDP reply: the closed port answers in UDP',
            ],
            key: 1,
            why: 'The receiving kernel answers with an ICMP port-unreachable, and Linux hands that to a connected socket as ECONNREFUSED. Nothing in the answer is UDP or a reset.',
          },
        },
        {
          lab: {
            explain: 'Send to closed UDP 9998 twice from a connected socket and twice from an unconnected one; tcpdump shows the replies',
            cmd: `${NEED}
ip netns exec n42a timeout 4 tcpdump -nl -i eth0 'udp or icmp' 2>/dev/null &
sleep 1
ip netns exec n42a python3 -c '
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(1); s.connect(("10.42.0.2", 9998))
for i in (1, 2):
    s.send(b"ping %d" % i)
    try: s.recv(100); print("send", i, "-> got a reply")
    except Exception as e: print("send", i, "->", type(e).__name__)
u = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); u.settimeout(1)
u.sendto(b"x", ("10.42.0.2", 9998)); u.sendto(b"x", ("10.42.0.2", 9998))
try: u.recvfrom(100)
except Exception as e: print("unconnected socket ->", type(e).__name__)
'
wait`,
          },
        },
        { md: `Every one of the four datagrams was answered, and tcpdump shows the answer: \`10.42.0.2 > 10.42.0.1: ICMP 10.42.0.2 udp port 9998 unreachable\`. It comes from B, which has no socket on UDP 9998 and says so. Chapter 3.7 listed port unreachable among the type-3 codes; here you see it from UDP's side. The reply is ICMP, not UDP, and quotes the start of your datagram: its length of 42 is 8 bytes of ICMP header, the 20-byte IP header and 8-byte UDP header of the original, and the 6 payload bytes (37 for the 1-byte datagrams).

What the program sees depends on the socket. The connected one raised \`ConnectionRefusedError\` on both waits. The unconnected one timed out and got no error, although its two datagrams drew the same two ICMP replies on the wire. That is what Linux and python3 did here; other systems and other socket options were not tested.

> [!IMPORTANT]
> A closed UDP port is not silent: the host answers with ICMP port-unreachable. An application sees it only if its socket is connected to the peer.

Now a different kind of nothing. n42b gets a firewall rule that drops UDP 9996, and a listener on that port. A sends one datagram while tcpdump watches.` },
        {
          lab: {
            explain: 'Drop UDP 9996 on n42b with iptables, send one datagram, show tcpdump on A and the rule counter',
            cmd: `${NEED}
ip netns exec n42b iptables -F INPUT; ip netns exec n42b iptables -A INPUT -p udp --dport 9996 -j DROP
ip netns exec n42b timeout 3 nc -u -l 9996 &
ip netns exec n42a timeout 3 tcpdump -nl -i eth0 'udp or icmp' 2>/dev/null &
sleep 1
echo hello | ip netns exec n42a nc -u -w1 10.42.0.2 9996; echo "nc exit: $?"
ip netns exec n42b iptables -L INPUT -v -n | tail -n +3
wait
ip netns exec n42b iptables -F INPUT`,
          },
        },
        { md: `tcpdump on A shows the datagram going out and nothing back: no ICMP, no reply. \`nc\` exits 0 again. The rule's counter in n42b reads \`1 34 DROP\`: one packet, 34 bytes (20 IP, 8 UDP, 6 payload), so the datagram reached B and the firewall ate it. A had no way to see that.

Compare the two silences. A closed port produces an ICMP answer on the wire. A dropped datagram produces nothing, and from A's side it looks the same as a lost packet or a listener that is busy. (4.4 puts TCP through the same two cases.)` },
      ],
    },
    {
      id: 'datagram',
      title: 'Reading what arrived',
      blocks: [
        { md: `One more experiment, on how the receiver sees what was sent. The next lab sends three messages of 1, 2 and 3 bytes (\`a\`, \`bb\`, \`ccc\`) back to back from n42a to n42b, once over UDP and once over TCP. The receiver waits half a second so that everything has arrived, then reads. UDP is read three times, one \`recvfrom\` each. TCP is read once with a 100-byte buffer.` },
        {
          checkpoint: {
            id: 'c3',
            prompt: 'After the wait, what does the first read return in each case?',
            options: [
              'Both give one message per read: both keep the sender’s boundaries',
              'Both give everything queued: a read drains the buffer',
              'UDP one datagram, TCP everything queued: only UDP keeps boundaries',
              'UDP everything queued, TCP one send: only TCP keeps boundaries',
            ],
            key: 2,
            why: 'A UDP socket returns one datagram per read, so message edges survive. A TCP socket is a byte stream: three sends can come back as one read.',
          },
        },
        {
          lab: {
            explain: 'Send a, bb, ccc over UDP and over TCP, read both; then send 3000, 65507 and 65508-byte datagrams and count IP packets',
            cmd: `${NEED}
ip netns exec n42b python3 -c '
import socket
r = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); r.bind(("10.42.0.2", 9997)); r.settimeout(2)
t = socket.socket(); t.bind(("10.42.0.2", 9997)); t.listen(1)
import subprocess
subprocess.Popen(["ip", "netns", "exec", "n42a", "python3", "-c", """
import socket, time
u = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
for m in (b"a", b"bb", b"ccc"): u.sendto(m, ("10.42.0.2", 9997))
c = socket.create_connection(("10.42.0.2", 9997))
for m in (b"a", b"bb", b"ccc"): c.sendall(m)
time.sleep(1)
"""])
import time; time.sleep(0.5)
print("UDP reads:", [r.recvfrom(100)[0] for _ in range(3)])
conn, _ = t.accept(); time.sleep(0.5)
print("TCP one read:", conn.recv(100))
'
ip netns exec n42a timeout 4 tcpdump -nl -i eth0 'ip proto 17' 2>/dev/null > /tmp/n42.cap &
ip netns exec n42b python3 -c '
import socket, subprocess
r = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); r.bind(("10.42.0.2", 9995)); r.settimeout(3)
subprocess.Popen(["ip", "netns", "exec", "n42a", "python3", "-c", """
import socket, time
time.sleep(1)
u = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
print("link MTU:", open("/sys/class/net/eth0/mtu").read().strip())
for n in (3000, 65507, 65508):
    try: u.sendto(b"x" * n, ("10.42.0.2", 9995)); print("sent", n, "bytes")
    except OSError as e: print("send", n, "->", e.strerror)
time.sleep(1)
"""])
print("receiver read", [len(r.recvfrom(70000)[0]) for _ in range(2)], "bytes per datagram")'
wait
awk 'NF == 0 { next } /UDP, length/ { if (n) print "UDP payload " len ": " n " IP packets"; len = $NF; n = 1; next } { n++ } END { print "UDP payload " len ": " n " IP packets" }' /tmp/n42.cap`,
          },
        },
        { md: `The UDP reads returned \`[b'a', b'bb', b'ccc']\`: three reads, three messages, each exactly as sent. The TCP read returned \`b'abbccc'\`: one read, all six bytes, with the edges gone. TCP delivers the same bytes in the same order, but it makes no promise to keep the sends separate. That is how it behaves in this lab, after a half-second wait.

The second half of the lab was about size. On the 1500-byte link, a 3000-byte datagram was accepted, and tcpdump counted **3 IP packets** for it, yet the receiver read one datagram of 3000 bytes. The kernel split it into IP fragments and the far end reassembled it before handing it up, which is the fragmentation from chapter 3.9. A payload of 65507 bytes was accepted too (45 IP packets: 65,515 bytes of UDP at 1,480 bytes per fragment is 44.3, rounded up to 45), and 65508 failed with \`Message too long\`. The limit is arithmetic: the IPv4 total-length field is 16 bits, so a packet is at most 65535 bytes, minus 20 for the IP header and 8 for the UDP header leaves 65507.

The lab doesn't test loss, so the next point is general knowledge: every fragment must arrive for the datagram to be reassembled, so losing any one loses the whole datagram, and UDP has no retransmission to repair it. Applications that care keep datagrams small enough to fit in one packet.

So a UDP application gets message boundaries for free and must handle loss, reordering and duplicates itself. A TCP application gets order and reliability and has to mark its own message boundaries.` },
      ],
    },
    {
      id: 'twins',
      title: "Where you've met this",
      blocks: [
        { md: `**AWS.** Security groups track connections, and the connection-tracking page covers UDP: a response to an allowed request is let back whatever the other direction's rules say. A NAT gateway supports TCP, UDP and ICMP. Both are in the vendor docs. How an SG or NACL drop looks to a UDP sender isn't covered here; test it in your own account instead of assuming the lab's silence carries over.

**Kubernetes.** From general knowledge: CoreDNS answers on UDP port 53, and VXLAN and Geneve tunnels ride on UDP. A UDP Service whose backend is gone may leave a client with timeouts instead of a refusal. That is the unconnected-socket pattern from lab 2, which this chapter did not test through a Service.

**Proxmox.** A firewall rule that drops UDP produces the lab-3 silence: a timeout and no error. The Proxmox firewall's own behaviour isn't covered here, so this is what the lab showed on a plain iptables rule, not a Proxmox claim.` },
      ],
    },
    {
      id: 'keep',
      title: 'What to keep',
      blocks: [
        { md: `- UDP is an 8-byte header (ports, length, checksum) in front of the payload. No handshake, acknowledgement, retransmission or ordering.
- A datagram that arrives is delivered whole, one per read. TCP gives a byte stream; UDP gives messages.
- A closed UDP port answers with ICMP port-unreachable. A connected socket turns it into an error; an unconnected one may not.
- A UDP payload is at most 65507 bytes on IPv4. Above the link MTU the datagram is fragmented, and losing any fragment loses it all.
- A firewall drop gives no answer at all, so the sender can't tell it from a lost packet.
- The \`nc -u\` exit status means "handed to the network", not "delivered".` },
      ],
    },
  ],
};
