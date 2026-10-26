// Chapter 4.3: TCP three-way handshake. Authored content; the tutor gets this file as chapter_source.
// Labs run in netlab (Ubuntu 26.04, iproute2 6.19) on 2026-10-25; outputs described in the prose were observed.
// Sources: https://datatracker.ietf.org/doc/html/rfc9293 (TCP header has sequence number, acknowledgment number and the SYN/ACK/FIN/RST bits; section 3.4.1 the 32-bit ISN generator, why ISNs are not simply zero, and why a three-way exchange is needed; section 3.4 SYN and FIN occupy sequence space; section 3.5 the handshake),
//   https://man7.org/linux/man-pages/man8/ss.8.html (ss -tan states such as SYN-SENT and ESTAB; the meaning of the LISTEN queue columns is NOT given there),
//   https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/security-group-connection-tracking.html (security groups track connections).
// Observed only on this kernel (Linux 7.2 in the OrbStack VM): the connect()/accept() timings with a 50 ms delay each way, the listen(1) queue behaviour in lab 3 (two connections completed without accept(), later SYNs unanswered), and the RST/ACK for a closed port.
// Hedged, not sourced: how kube-proxy and Cilium rewrite the SYN, and how the Proxmox firewall tracks state. Chapter 4.4 covers RST and silent drop in depth; this chapter shows the RST once.

const NEED = `ip netns list | grep -q n43c || { echo "Run the first lab first."; exit 1; }`;

export default {
  node: 'tcp-handshake',
  number: '4.3',
  kicker: 'Layer 4',
  title: 'TCP three-way handshake',
  lede: 'Before a TCP connection carries data, the two ends swap three small segments to agree on where each side’s byte count starts. That costs time, and the kernel does it without the application.',
  sections: [
    {
      id: 'open',
      title: 'Opening a connection',
      blocks: [
        { md: `Chapter 4.1 left you with a connection named by its 5-tuple, and a client that has never spoken to the server before. For data to flow, both kernels must create state for that tuple: what has been sent, what has been received, what to expect next. They can only get it by exchanging a few segments first.

TCP numbers every byte of the stream. Each segment's header carries a **sequence number** (where its data starts in the sender's stream) and an **acknowledgment number**, plus flag bits: SYN, ACK, FIN, RST and others (RFC 9293, section 3.1). Both numbers need a starting value, and each side chooses its own: the **initial sequence number** (ISN).

The lab builds client n43c (10.43.0.1) and server n43s (10.43.0.2) on one veth. In n43s, \`nc -l\` listens on port 8080. In n43c, \`tcpdump -S\` captures the connection (\`-S\` prints absolute sequence numbers instead of relative ones) while \`echo hi | nc\` connects, sends 3 bytes (\`hi\` and a newline) and closes. The listing is trimmed to the first six segments, and to the interesting columns: \`Flags [S]\` is a SYN, \`[S.]\` is SYN plus ACK, \`[.]\` is a bare ACK.

Look at the first two lines before you run it: the client's SYN carries \`seq X\` and no data.` },
        {
          checkpoint: {
            id: 'c1',
            prompt: "The client's SYN carries seq X and no data. What acknowledgment number does the server's SYN/ACK carry?",
            options: [
              "X itself: an ack echoes back the sequence number it received",
              "The server's own sequence number: the ack field carries the sender's position",
              "One past X: the SYN itself used up a sequence number",
              "Four past X (X+4): the ack counts the bytes of the whole handshake",
            ],
            key: 2,
            why: 'The ack field names the next sequence number expected. The SYN occupies one position in the sequence space even without data, so the next one expected is X+1.',
          },
        },
        {
          lab: {
            explain: 'Build n43c and n43s, listen on 8080, capture a connection with tcpdump -S; then one connect to a closed port',
            cmd: `for n in n43c n43s; do ip netns del $n 2>/dev/null; done; sleep 0.5
mk() { ip netns add $1; ip netns exec $1 sysctl -qw net.ipv6.conf.all.disable_ipv6=1 net.ipv6.conf.default.disable_ipv6=1; ip -n $1 link set lo up; }
mk n43c; mk n43s
ip link add eth0 netns n43c type veth peer name eth0 netns n43s
ip -n n43c link set eth0 up; ip -n n43s link set eth0 up
ip -n n43c addr add 10.43.0.1/24 dev eth0; ip -n n43s addr add 10.43.0.2/24 dev eth0
sleep 1
trim() { sed -E 's/^[0-9:.]+ IP //; s/, win [0-9]+//; s/, options \\[[^]]*\\]//; s/: HTTP.*//'; }
ip netns exec n43s timeout 5 nc -l 10.43.0.2 8080 &
ip netns exec n43c timeout 5 tcpdump -S -nl -i eth0 'tcp port 8080' 2>/dev/null | head -6 | trim &
sleep 1
echo hi | ip netns exec n43c nc -N -w2 10.43.0.2 8080
wait
echo "--- same client, port 8099 has no listener"
ip netns exec n43c timeout 4 tcpdump -S -nl -i eth0 'tcp port 8099' 2>/dev/null | head -2 | trim &
sleep 1
ip netns exec n43c nc -w1 10.43.0.2 8099; echo "nc exit: $?"
sleep 1; wait`,
          },
        },
        { md: `The capture has this shape (numbers differ each run; take the ones you see):

\`\`\`
client > server  [S]   seq X
server > client  [S.]  seq Y, ack X+1
client > server  [.]   ack Y+1
client > server  [P.]  seq X+1:X+4, ack Y+1, length 3
server > client  [.]   ack X+4
client > server  [F.]  seq X+4, ack Y+1
\`\`\`

In the run, X was 845383342 and the SYN/ACK acknowledged 845383343: X+1. The server's own ISN, Y, was a different number, 1947068774, unrelated to X, and the client's final ACK said \`ack 1947068775\`: Y+1. The data segment started at X+1, not at X. The server's ack for it was X+4, because 3 bytes were sent. Run it again and X and Y change; they are chosen per connection.

The acknowledgment number names the next sequence number the sender expects from its peer. Each SYN used up one sequence number, which is why each ack is one more than the ISN it answers. RFC 9293 (section 3.4) says that SYN and FIN are the only controls that occupy sequence space. The ISNs themselves are not zero: the RFC describes a 32-bit clock-driven generator, to keep segments from an earlier connection on the same 5-tuple from being mistaken for the new one, and notes that predictable ISNs are a security problem for off-path attackers. What this lab saw is only that X and Y looked unrelated and changed between runs.

> [!IMPORTANT]
> SYN, SYN/ACK, ACK. Each side picks its own ISN, and each ack is the peer's ISN plus one. No application data moves until the third segment has been sent.

The second half of the lab connected to port 8099, where nothing listens. The client's SYN got \`Flags [R.]\` with \`ack X+1\` in return, and \`nc\` exited with status 1. That is a **reset**, and chapter 4.4 puts it side by side with a silent drop. Step through both below.` },
        {
          widget: {
            id: 'w-handshake',
            kind: 'timeline',
            title: 'Handshake outcomes',
            lanes: ['client 10.43.0.1', 'server 10.43.0.2:8080'],
            scenarios: [
              {
                name: 'Port open',
                steps: [
                  { from: 0, to: 1, label: '[S] seq X', note: 'The client picks its ISN, X.' },
                  { from: 1, to: 0, label: '[S.] seq Y, ack X+1', note: 'The server picks its own ISN, Y, and acknowledges X+1.' },
                  { from: 0, to: 1, label: '[.] ack Y+1', note: 'Three segments exchanged; both ends now hold state for the connection.' },
                  { from: 0, to: 1, label: '[P.] seq X+1, 3 bytes', note: 'The first data starts at X+1, as in the capture.' },
                ],
              },
              {
                name: 'Nothing listening',
                steps: [
                  { from: 0, to: 1, label: '[S] seq X' },
                  { from: 1, to: 0, label: '[R.] seq 0, ack X+1', note: 'A reset: the client gets an answer at once and the connect fails. Chapter 4.4 compares this with a silent drop.' },
                ],
              },
            ],
            hint: 'Click Next through "Port open" and compare each line with your capture. Then switch to "Nothing listening".',
            takeaway: 'An open port takes three segments before data. A closed port answers the first segment with a reset, in this lab `[R.]`.',
          },
        },
      ],
    },
    {
      id: 'rtt',
      title: 'What the handshake costs',
      blocks: [
        { md: `The three segments cross the network one after another. The next lab gives each side's interface a **50 ms** delay with \`tc netem\`, so one round trip (RTT) is 100 ms. A python client records the time just before \`connect()\` and the time \`connect()\` returns, then sends one byte as soon as it can. A python server blocked in \`accept()\` records when \`accept()\` returns and when the byte arrives. Both processes run on the same machine, so their clocks are comparable.` },
        {
          checkpoint: {
            id: 'c2',
            prompt: 'The client calls connect() at t = 0 and writes one byte as soon as connect() returns. With 100 ms RTT, roughly when does connect() return on the client, and when does accept() return on the server?',
            options: [
              'Both at about 0 ms: the kernels set the connection up locally',
              'Client after one round trip, server about half a trip later',
              'Both after one round trip: the two ends finish together',
              'Client after two round trips: each SYN needs its own acknowledgement trip',
            ],
            key: 1,
            why: "connect() returns when the SYN/ACK arrives, one RTT after the SYN left. The server only finishes when the client's final ACK reaches it, half a trip after that.",
          },
        },
        {
          lab: {
            explain: 'Add 50 ms delay each way, time connect() on the client and accept() plus the first byte on the server',
            cmd: `${NEED}
for n in n43c n43s; do ip netns exec $n tc qdisc replace dev eth0 root netem delay 50ms; done
ip netns exec n43c ping -c1 -W1 -q 10.43.0.2 >/dev/null
ip netns exec n43s python3 -u -c '
import socket, time
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(("10.43.0.2", 8082)); s.listen(5)
c, _ = s.accept(); print(time.time(), "server: accept() returned")
c.recv(10); print(time.time(), "server: first data byte read")' &
sleep 1
ip netns exec n43c python3 -u -c '
import socket, time
s = socket.socket(); print(time.time(), "client: connect() called")
s.connect(("10.43.0.2", 8082)); print(time.time(), "client: connect() returned")
s.send(b"x"); print(time.time(), "client: send() returned"); time.sleep(0.5)' &
wait
for n in n43c n43s; do ip netns exec $n tc qdisc del dev eth0 root; done`,
          },
        },
        { md: `The raw lines print absolute times; read them relative to the first. In a typical run \`connect()\` returned a little over 100 ms after it was called, one RTT. \`accept()\` returned roughly 50 to 60 ms after that, about half a trip, and the first data byte was read at about the same moment. That fits the server finishing when the client's final ACK arrives, but it fits the first data segment arriving just as well, so this lab doesn't separate the two; both are half a trip after \`connect()\` returns. Nothing was sent by the application until \`connect()\` had returned, so **one RTT passes before the client's first byte can leave**.

Python's startup and scheduling add some milliseconds to the numbers, so the figures are approximate. The shape is what matters: it doesn't change with how much you send, only with the distance. This is why a short-lived connection to a faraway server feels slow, and why reusing connections matters.` },
      ],
    },
    {
      id: 'kernel',
      title: 'A server that never accepts',
      blocks: [
        { md: `In lab 2 the server was blocked in \`accept()\` when the SYN arrived. Now take that away. The next lab runs a server that calls \`listen(1)\` (a backlog of 1) and then **never calls \`accept()\`** for the rest of the lab. Four clients connect to it one after another, 0.2 s apart. After about a second and a half, \`ss\` lists the server's and the clients' sockets, and a capture on the client side counts the SYNs and SYN/ACKs per client port.` },
        {
          checkpoint: {
            id: 'c3',
            prompt: 'The server never calls accept(). What state are clients 1 and 2 in?',
            options: [
              'Established without accept(): the kernel completes the handshake without the application',
              'Turned away with a reset: with no accept() there is no one to take the connection',
              'Waiting for accept(): the SYN/ACK is only sent once the application accepts',
              'Only client 1 connects: a backlog of 1 means one waiting connection',
            ],
            key: 0,
            why: 'The listening socket belongs to the kernel, which answers SYNs and completes handshakes into a queue. accept() only collects connections that are already established.',
          },
        },
        {
          lab: {
            explain: 'listen(1) without accept(); four clients connect; list server and client sockets and count SYNs per client port',
            cmd: `${NEED}
ip netns exec n43s python3 -c '
import socket, time
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(("10.43.0.2", 8081)); s.listen(1)
time.sleep(7)' &
ip netns exec n43c timeout 5 tcpdump -nl -i eth0 'tcp port 8081' 2>/dev/null > /tmp/n43.cap &
sleep 1
for i in 1 2 3 4; do timeout 4 ip netns exec n43c nc 10.43.0.2 8081 </dev/null & sleep 0.2; done
sleep 1.5
echo "--- server"; ip netns exec n43s ss -H -tan sport = :8081
echo "--- client"; ip netns exec n43c ss -H -tan dport = :8081
sleep 3
echo "--- what the client saw on the wire"
python3 -c '
import re, collections
n = collections.defaultdict(lambda: [0, 0])
for line in open("/tmp/n43.cap"):
    m = re.search(r"IP (\\S+)\\.(\\d+) > \\S+\\.8081: Flags \\[S\\]", line)
    if m: n[m.group(2)][0] += 1
    m = re.search(r"IP \\S+\\.8081 > \\S+\\.(\\d+): Flags \\[S\\.\\]", line)
    if m: n[m.group(1)][1] += 1
for p in sorted(n): print("client port", p, ": SYN sent x%d, SYN/ACK received x%d" % tuple(n[p]))'
wait`,
          },
        },
        { md: `The server shows its \`LISTEN\` socket and **two** \`ESTAB\` sockets, though no code ever called \`accept()\`. The clients agree: two are \`ESTAB\`, and two are still \`SYN-SENT\`. The capture says why. The first two client ports each sent one SYN and received one SYN/ACK. The other two sent four SYNs within the capture and received no SYN/ACK. This lab didn't capture the server side, so it can't say whether those SYNs were dropped before or after reaching it; it shows only that they went unanswered.

So the handshake is the kernel's business. The listening socket answers SYNs and finishes handshakes on its own, and parks each completed connection in a queue until the application calls \`accept()\`. That queue is bounded by the \`listen()\` backlog. The observation: the listener passed a backlog of 1 and two connections completed, and the \`LISTEN\` row read \`2 1\` in its two queue columns. Why backlog 1 admitted two wasn't investigated here, and the \`ss\` man page doesn't define those columns; as in chapter 4.1, the numbers are noted as observed, not explained.

The cause of the unanswered SYNs is general knowledge, not something this lab captured: Linux drops new SYNs when the accept queue is full and \`tcp_abort_on_overflow\` is 0 (its default), which is why the clients kept retrying instead of being refused. The kernel documentation for \`tcp_abort_on_overflow\` is not cited here.

> [!IMPORTANT]
> An established connection can exist with nobody having called accept(). In this lab, clients beyond the queue saw SYNs that never got an answer, not a refusal.` },
      ],
    },
    {
      id: 'twins',
      title: "Where you've met this",
      blocks: [
        { md: `**AWS.** Security groups track connections, and the EC2 connection-tracking page says responses to allowed traffic flow back whatever the other direction's rules are. The likely reading, not stated on that page: the rule that matters is the one that admits the opening SYN. A missing inbound rule would then show up as a SYN that gets no answer, the same SYN-SENT you saw for clients 3 and 4 though from a different cause. Chapters 4.4 and 4.5 test this.

**Kubernetes / Cilium.** With a Service, the SYN is sent to the ClusterIP and rewritten to a backend pod by kube-proxy or Cilium, so the SYN/ACK comes from the pod's address and is translated back. This is general knowledge; chapter 4.7 tests conntrack-based rewriting.

**Proxmox.** The handshake is run by each guest's kernel, as in the lab. The Proxmox firewall tracks state per VM; its documentation wasn't checked here, so treat the detail as unverified.` },
      ],
    },
    {
      id: 'keep',
      title: 'What to keep',
      blocks: [
        { md: `- A connection opens with SYN, SYN/ACK, ACK. Each side picks its own ISN, and each ack is the peer's ISN plus one, because a SYN uses up one sequence number.
- The ISNs are per connection and look unrelated between runs; data starts at ISN+1.
- The client can send data only after the SYN/ACK has made one round trip. The server's accept() returned about half a trip after the client's connect() in the lab, but the lab doesn't say whether that tracks the final ACK or the first data.
- The kernel completes handshakes for a listening socket; accept() just collects them from a bounded queue.
- A closed port answers the SYN with a reset. A server that doesn't answer leaves the client in SYN-SENT, retrying.` },
      ],
    },
  ],
};
