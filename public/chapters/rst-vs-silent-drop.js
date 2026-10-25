// Chapter 4.4: RST vs silent drop (refused vs timed out). Authored content; the tutor gets this file as chapter_source.
// Labs run in netlab (Ubuntu 26.04, iproute2 6.19, kernel 7.2) on 2026-10-25; outputs described in the prose were observed.
// Sources: https://datatracker.ietf.org/doc/html/rfc9293 (section 3.5.2 reset generation: a SYN that matches no connection is answered with a RST; section 3.5.3 a RST that acknowledges the SYN aborts a SYN-SENT connection),
//   https://www.kernel.org/doc/html/latest/networking/ip-sysctl.html (tcp_syn_linear_timeouts: with an initial RTO of 1 s and a value of 4, SYN RTOs are 1, 1, 1, 1, 1, 2, 4, ...; tcp_syn_retries default 6, final timeout of an active connection attempt about 131 s),
//   https://wiki.nftables.org/wiki-nftables/index.php/Quick_reference-nftables_in_10_minutes and https://wiki.nftables.org/wiki-nftables/index.php/Rejecting_traffic (default reject is ICMP port-unreachable; reject with tcp reset and reject with icmp type admin-prohibited exist),
//   https://pve.proxmox.com/wiki/Firewall (input/output policy can be DROP or REJECT; rules inspectable with iptables-save),
//   https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/security-group-connection-tracking.html and https://aws.amazon.com/vpc/faqs/ (traffic not explicitly allowed is denied; neither page says how a deny looks on the wire).
// Observed only on this kernel (Linux 7.2 in the OrbStack VM): the 0.00 s refusal, the SYN retransmit times 0, 1, 2, 3, 4, 5, 7, 11 s with the connect cut off at 12 s, the nft counter reading 8 on the server, and the errno the app got for each reject variant.
// Hedged, not sourced: what AWS security groups and NACLs do on the wire when they deny, how a Kubernetes Service without endpoints answers, and whether the Proxmox firewall's REJECT sends a RST or an ICMP error.
// Not run: the full default connect() timeout (the lab stops at 12 s); the sourced figure is the kernel documentation's.
// Chapter 4.3 shows the RST once (tcp-handshake.js); this chapter goes through timings, the reject variants and what the application sees.

const NEED = `ip netns list | grep -q n44c || { echo "Run the first lab first."; exit 1; }`;

export default {
  node: 'rst-vs-silent-drop',
  number: '4.4',
  kicker: 'Layer 4',
  title: 'RST vs silent drop (refused vs timed out)',
  lede: 'A failed connect() usually ends in one of two messages. They look like two flavours of the same failure, but each is produced by a different event, and reading them correctly narrows a network problem quickly.',
  sections: [
    {
      id: 'two',
      title: 'Two ways a connect() fails',
      blocks: [
        { md: `Chapter 4.3 ended with a single reset: a SYN sent to a port with no listener came straight back with \`[R.]\`. This chapter puts that next to the other way a connection attempt can die, because the two look nothing alike from the application's side, and people read them wrongly in both directions.

Anyone who has run \`curl\` or \`nc\` against a service that will not talk has seen both messages:

- \`Connection refused\`, and the prompt comes back at once.
- \`Connection timed out\`, after a long pause.

The first lab builds the same two-namespace setup as before: a client \`n44c\` (10.44.0.1) and a server \`n44s\` (10.44.0.2), joined by a veth pair, with no firewall rules anywhere. A small Python script calls \`connect()\` on port 8099, where nothing is listening, and prints what the application got and how long it took. \`tcpdump\` on the client records the packets, and each line is printed with its time relative to the first packet.

Before running it, consider the message the application is about to print: \`Connection refused\` on a server that is up and reachable.` },
        {
          checkpoint: {
            id: 'c1',
            prompt: 'An application reports "Connection refused" for a host that is up. What does that message tell you?',
            options: [
              'Only a firewall refuses: a closed port would simply ignore the packet',
              'The program on that port said no: the app chose to turn the client away',
              'Something answered: a reset or an ICMP error came back to the client',
              'The SYN was lost: the packet died somewhere along the path',
            ],
            key: 2,
            why: 'The client\'s kernel reports a refusal only when a packet comes back that ends the attempt (a RST, or an ICMP error). Silence cannot produce it, and the packet does not say who sent it: a stack with a closed port does exactly this too.',
          },
        },
        {
          lab: {
            explain: 'Build n44c and n44s, then connect() to port 8099 where nothing listens; print what the app got and the packets with relative times',
            cmd: `for n in n44c n44s; do ip netns del $n 2>/dev/null; done; sleep 0.5
mk() { ip netns add $1; ip netns exec $1 sysctl -qw net.ipv6.conf.all.disable_ipv6=1 net.ipv6.conf.default.disable_ipv6=1; ip -n $1 link set lo up; }
mk n44c; mk n44s
ip link add eth0 netns n44c type veth peer name eth0 netns n44s
ip -n n44c link set eth0 up; ip -n n44s link set eth0 up
ip -n n44c addr add 10.44.0.1/24 dev eth0; ip -n n44s addr add 10.44.0.2/24 dev eth0
sleep 1
cat > /tmp/probe44.py <<'PY'
import socket, sys, time, errno
s = socket.socket(); s.settimeout(float(sys.argv[2])); t = time.time()
try:
    s.connect(("10.44.0.2", int(sys.argv[1]))); r = "connected"
except socket.timeout: r = "timed out"
except OSError as e: r = "%s (%s)" % (errno.errorcode[e.errno], e.strerror)
print("app saw: %s after %.2f s" % (r, time.time() - t))
PY
cat > /tmp/listen44.py <<'PY'
import socket, sys, time
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("10.44.0.2", 8080)); s.listen(5); time.sleep(float(sys.argv[1]))
PY
cat > /tmp/show44.sh <<'SH'
awk '/Flags|ICMP/ { if (!t0) t0 = $1; l = $0; sub(/^[^ ]+ IP /, "", l); sub(/, (seq|length|win|options).*/, "", l); printf "+%5.2f s  %s\\n", $1 - t0, l }' "$1"
SH
ip netns exec n44c timeout 4 tcpdump -nl -tt -i eth0 'tcp or icmp' 2>/dev/null > /tmp/c44a.cap &
sleep 0.5
echo "--- port 8099: nothing is listening"
ip netns exec n44c python3 /tmp/probe44.py 8099 3
sleep 0.5; wait
bash /tmp/show44.sh /tmp/c44a.cap
echo "packets captured: $(grep -c -E 'Flags|ICMP' /tmp/c44a.cap)"`,
          },
        },
        { md: `The application got \`ECONNREFUSED (Connection refused)\` after 0.00 s. The capture holds exactly two packets: the client's SYN at +0.00 s, and a \`Flags [R.]\` from 10.44.0.2 port 8099 at the same instant. The count comes from \`grep -c\` on lines containing \`Flags\` or \`ICMP\`, so a blank line can't inflate it.

That reset is the server's kernel answering for a socket that does not exist. RFC 9293 (section 3.5.2) says that if no connection exists, a reset is sent in response to any incoming segment except another reset, and that a SYN matching no connection is rejected this way. On the receiving side (section 3.5.3), a client in SYN-SENT accepts a RST if its ACK field acknowledges the SYN, aborts, and tells the application. That is the whole path from "no listener" to \`ECONNREFUSED\`: no application code runs on the server, because there is no application.

So "refused" has a precise meaning, and it is smaller than people assume. A packet came back and ended the attempt. The lab cannot tell you what sent it. Here the server's kernel did, because nothing listens, but the client would see the same packet from a firewall rule built to imitate that, or from a middlebox in the path.

> [!IMPORTANT]
> **Refused** is produced by a packet arriving (a RST, or an ICMP error). Whoever produced that packet is a separate question.` },
      ],
    },
    {
      id: 'silence',
      title: 'What silence looks like',
      blocks: [
        { md: `Now the other case. The server starts a listener on port 8080, so the port is open and a program is waiting. Then a single nft rule is added on the server in the input hook: \`tcp dport 8080 counter drop\`. The \`counter\` keeps a packet count on the rule. The client connects to 8080 with a 12-second timeout set by the application, and the capture runs for 15 seconds.

The client sends its SYN, and the rule's verdict for that packet is \`drop\`. What does the client's kernel do next?` },
        {
          checkpoint: {
            id: 'c2',
            prompt: 'A listener is up on 8080, and an nft rule drops every packet to that port. The client has a 12 s timeout. What does the capture on the client show?',
            options: [
              'The same SYN again and again, spaced out in time, with no reply ever',
              'One SYN, then nothing: TCP gives up after the first unanswered try',
              'Refused straight away: a filtered port is treated as closed',
              'An ICMP error from the server: the kernel reports what it dropped',
            ],
            key: 0,
            why: 'A dropped SYN produces no packet at all, so nothing can arrive to end the attempt. The client\'s own retransmission timer fires and the SYN is sent again, until the connect() gives up or the application\'s timeout fires.',
          },
        },
        {
          lab: {
            explain: 'Drop port 8080 on the server (listener running); connect with a 12 s timeout; show SYN times, replies and the rule counter',
            cmd: `${NEED}
ip netns exec n44s nft delete table inet f44 2>/dev/null
ip netns exec n44s nft add table inet f44
ip netns exec n44s nft add chain inet f44 in '{ type filter hook input priority 0; policy accept; }'
ip netns exec n44s nft add rule inet f44 in tcp dport 8080 counter drop
ip netns exec n44s python3 /tmp/listen44.py 16 & LP=$!
sleep 0.5
ip netns exec n44c timeout 15 tcpdump -nl -tt -i eth0 'tcp or icmp' 2>/dev/null > /tmp/c44b.cap &
sleep 0.5
echo "--- port 8080: a listener exists, but the drop rule comes first"
ip netns exec n44c python3 /tmp/probe44.py 8080 12
sleep 1
bash /tmp/show44.sh /tmp/c44b.cap
echo "SYNs sent: $(grep -c 'Flags \\[S\\]' /tmp/c44b.cap)   packets back from the server: $(grep -c ' > 10.44.0.1' /tmp/c44b.cap)"
ip netns exec n44s nft list chain inet f44 in | grep counter
ip netns exec n44c sysctl net.ipv4.tcp_syn_linear_timeouts net.ipv4.tcp_syn_retries
kill $LP 2>/dev/null; ip netns exec n44s nft delete table inet f44; true`,
          },
        },
        { md: `The application's result was \`timed out after 12.00 s\`. That is the application's own timer, not the kernel's. The capture shows eight SYNs from the same client port, at about +0, 1.0, 2.1, 3.1, 4.1, 5.1, 7.2 and 11.2 seconds, and **zero** packets back from the server. The server's rule counter reads 8 packets: all eight SYNs reached the server's input hook and died there, so in this lab the loss happened at the rule, not somewhere on the path. General knowledge, not measured here: the input hook runs before a packet is delivered to a socket, so the listener's program has no way to know anyone tried.

The spacing is the client's retransmission timer. It is not a doubling sequence from 1 s, which is what the textbook RTO backoff would give (1, 2, 4, 8). The lab printed \`tcp_syn_linear_timeouts = 4\` and \`tcp_syn_retries = 6\`, and the kernel documentation for the first one says that with an initial RTO of 1 s and a value of 4 the SYN RTOs are 1, 1, 1, 1, 1, 2, 4 and so on: linear for a few tries, then exponential. The capture matches that sequence. The same page says that with the default \`tcp_syn_retries\` of 6 the final timeout of an active connection attempt happens after 131 seconds. This lab cut the attempt off at 12 s, so the 131 s figure is the documentation's, not something it measured.

A drop produces a timeout that no packet ever announces. The "timed out" message comes from a timer inside the client. There is no error packet to catch, no code to look up, and no way to tell from the client alone whether the SYN was dropped by a firewall, lost on a broken link, or sent to an address that nobody owns. The lab can tell those apart only because it has the server's counter.

> [!IMPORTANT]
> **Timed out** is produced by a timer expiring. Nothing arrived, so nothing says why. Retransmitted SYNs with no reply are what it looks like on the wire.` },
      ],
    },
    {
      id: 'reject',
      title: 'Rejecting politely',
      blocks: [
        { md: `A firewall does not have to drop. nft has a second verdict, \`reject\`, which discards the packet and also sends something back to the sender. What it sends can be chosen: a TCP reset, or an ICMP error of a given type. The next lab flips the server's rule through three variants, one after another, each time with the listener still running, and each time records the app's result and the packets.

The variants are \`reject with tcp reset\`, plain \`reject\` (the nftables wiki says the default is an ICMP port-unreachable) and \`reject with icmp type admin-prohibited\`. Take the second one. The server sends an ICMP message about the SYN, not a TCP segment, to a client whose \`connect()\` is waiting for a SYN/ACK or a RST.` },
        {
          checkpoint: {
            id: 'c3',
            prompt: 'The server\'s rule is plain "reject" on port 8080 (ICMP port-unreachable, per the nftables wiki). What does the client application report?',
            options: [
              'Timed out: only a TCP reset can end a connect()',
              'No route to host: an ICMP error means the path is broken',
              'Connection reset by peer: the listener accepts and then aborts',
              'Connection refused: the stack treats this ICMP error like a reset',
            ],
            key: 3,
            why: 'The kernel maps an ICMP port-unreachable for a TCP connection attempt to the same error as a RST, ECONNREFUSED. Which packet came back differs; the application cannot tell.',
          },
        },
        {
          lab: {
            explain: 'Three reject variants on port 8080: tcp reset, default reject, admin-prohibited. For each, the app result and the packets',
            cmd: `${NEED}
ip netns exec n44s python3 /tmp/listen44.py 16 & LP=$!
sleep 0.5
for verdict in "reject with tcp reset" "reject" "reject with icmp type admin-prohibited"; do
  ip netns exec n44s nft delete table inet f44 2>/dev/null
  ip netns exec n44s nft add table inet f44
  ip netns exec n44s nft add chain inet f44 in '{ type filter hook input priority 0; policy accept; }'
  ip netns exec n44s nft add rule inet f44 in tcp dport 8080 $verdict
  ip netns exec n44c timeout 3 tcpdump -nl -tt -i eth0 'tcp or icmp' 2>/dev/null > /tmp/c44c.cap &
  sleep 0.5
  echo "=== nft rule: $verdict"
  ip netns exec n44c python3 /tmp/probe44.py 8080 2
  sleep 1; wait %2 2>/dev/null
  bash /tmp/show44.sh /tmp/c44c.cap
done
kill $LP 2>/dev/null; ip netns exec n44s nft delete table inet f44; true`,
          },
        },
        { md: `All three failed at once (0.00 s), and the packets differ:

| Server rule | Packet back | What the app saw |
|---|---|---|
| \`reject with tcp reset\` | \`[R.]\` from 10.44.0.2.8080 | \`ECONNREFUSED\` |
| \`reject\` (default) | \`ICMP ... tcp port 8080 unreachable\` | \`ECONNREFUSED\` |
| \`reject with icmp type admin-prohibited\` | an ICMP unreachable, shown by tcpdump as \`ICMP host 10.44.0.2 unreachable - admin prohibited filter\` | \`EHOSTUNREACH\` (No route to host) |

The first two give the same application error from different packets. A program, or a person reading its log line, cannot tell them apart; only a capture can. The first row is also indistinguishable on the wire from the closed port in the first lab: a \`[R.]\` is a \`[R.]\`, whether the kernel produced it for a missing socket or a firewall rule produced it on purpose.

The third row shows that "Connection refused" is not the only fast failure. An answer came back there too, and the application reported *No route to host* for a host that is perfectly reachable. The application sees a few distinct outcomes, and each one is a specific packet or the lack of one.

The widget replays all three situations from this chapter, with the retransmission timings read off the capture in the second lab. Step through the drop scenario and compare how long the client waits against the other two.` },
        {
          widget: {
            id: 'w-outcomes',
            kind: 'timeline',
            title: 'Refused, timed out, or rejected',
            lanes: ['client 10.44.0.1', 'server 10.44.0.2'],
            scenarios: [
              {
                name: 'Closed port',
                steps: [
                  { from: 0, to: 1, label: '[S] to port 8099', at: '0.00 s' },
                  { from: 1, to: 0, label: '[R.] reset', at: '+0.00 s', note: 'The server\'s kernel answers for a socket that does not exist. connect() fails with ECONNREFUSED.' },
                ],
              },
              {
                name: 'Firewall DROP',
                steps: [
                  { from: 0, to: 1, label: '[S] to port 8080', drop: true, at: '0 s' },
                  { from: 0, to: 1, label: '[S] retransmit', drop: true, at: '+1 s' },
                  { from: 0, to: 1, label: '[S] retransmit', drop: true, at: '+2 s' },
                  { from: 0, to: 1, label: '[S] retransmit', drop: true, at: '+3 s' },
                  { from: 0, to: 1, label: '[S] retransmit', drop: true, at: '+4 s' },
                  { from: 0, to: 1, label: '[S] retransmit', drop: true, at: '+5 s' },
                  { from: 0, to: 1, label: '[S] retransmit', drop: true, at: '+7 s' },
                  { from: 0, to: 1, label: '[S] retransmit', drop: true, at: '+11 s', note: 'No packet ever comes back. The application\'s own 12 s timer ends the wait: timed out.' },
                ],
              },
              {
                name: 'REJECT',
                steps: [
                  { from: 0, to: 1, label: '[S] to port 8080', at: '0.00 s' },
                  { from: 1, to: 0, label: 'ICMP port unreachable', at: '+0.00 s', note: 'Default reject: an ICMP error instead of a RST. The app still sees ECONNREFUSED. With "reject with tcp reset" the reply is a [R.]; with admin-prohibited the app sees EHOSTUNREACH.' },
                ],
              },
            ],
            hint: 'Click Next through "Firewall DROP" and read each time. Then switch to "Closed port" and "REJECT" and compare what comes back.',
            takeaway: 'A refusal is an arriving packet and ends at once. A timeout is the client\'s own timer, with the SYN sent again until it fires.',
          },
        },
      ],
    },
    {
      id: 'twins',
      title: "Where you've met this",
      blocks: [
        { md: `**Proxmox.** The Proxmox VE firewall page describes input and output policies that can each be DROP or REJECT, and says the resulting rules can be inspected with \`iptables-save\`. That fits the lab: a policy of DROP gives a client timeouts, and one of REJECT gives it a fast failure. The page does not say which packet its REJECT sends (RST or ICMP), so that detail is unverified here.

**AWS.** The VPC FAQ and the EC2 connection-tracking page say that traffic not explicitly allowed is denied. Neither page says how a deny looks on the wire. What follows is general experience, not documentation: a blocked port behind a security group usually shows up as a timeout, which is the "nothing came back" row. If you get *refused* from an instance, a packet came back, so the SYN reached something that could answer. That something is usually the instance's own stack with no listener, but this chapter did not test AWS itself.

**Kubernetes / Cilium.** A Service whose pods are all down often fails fast rather than hanging, but how fast, and with which packet, depends on the datapath. This chapter did not test it. Use \`curl -v\` and read whether it reports refused or timed out, rather than assuming.

**Using it.** Next time a connection fails, the first question is which of the two it was. Refused means a packet came back, so the path is working and the question is what answered. Timed out means nothing came back, so the question is where a SYN could have disappeared: a firewall, a missing route, a wrong address, or a host that is down. \`tcpdump\` on both ends splits that question in one run: SYNs arriving at the server and no answer leaving means a rule on the server, and no SYNs arriving at all means the path.` },
      ],
    },
    {
      id: 'keep',
      title: 'What to keep',
      blocks: [
        { md: `- Refused is an arriving packet: a RST, or an ICMP error that the kernel maps to the same error. It arrives as fast as the round trip.
- Timed out is a timer. The client resends the SYN, and in this lab saw eight SYNs in 11 s with no reply, until the application gave up at 12 s.
- A RST does not say who sent it. A closed port and \`reject with tcp reset\` produce the same \`[R.]\`.
- ICMP admin-prohibited gave \`EHOSTUNREACH\`, a third outcome, not a refusal.
- DROP and REJECT both block the SYN. They differ in what the client experiences: a wait of seconds or minutes for DROP, an immediate error for REJECT.` },
      ],
    },
  ],
};
