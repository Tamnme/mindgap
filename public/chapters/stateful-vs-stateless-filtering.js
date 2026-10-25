// Chapter 4.5: Stateful vs stateless filtering. Authored content; the tutor gets this file as chapter_source.
// Labs run in netlab (Ubuntu 26.04, iproute2 6.19, kernel 7.2) on 2026-10-25; outputs described in the prose were observed.
// Sources: https://wiki.nftables.org/wiki-nftables/index.php/Matching_connection_tracking_stateful_metainformation (ct state values new, established, related, invalid, untracked and what each means; the stateful firewall example),
//   https://wiki.nftables.org/wiki-nftables/index.php/Quick_reference-nftables_in_10_minutes (the "ct state established,related accept" pattern in a policy-drop input chain),
//   https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/security-group-connection-tracking.html (security groups track connections; responses are allowed regardless of rules in the other direction; untracked flows when both directions are fully open),
//   https://docs.aws.amazon.com/vpc/latest/userguide/infrastructure-security.html (comparison table: security group return traffic is automatically allowed, network ACL return traffic must be explicitly allowed),
//   https://docs.aws.amazon.com/vpc/latest/userguide/custom-network-acl.html (every rule needs a rule allowing response traffic; ephemeral port ranges by client type),
//   https://www.kernel.org/doc/html/latest/networking/ip-sysctl.html (ip_local_port_range default 32768-60999),
//   https://pve.proxmox.com/wiki/Firewall (with a DROP or REJECT policy, already established connections are still allowed).
// Observed only on this kernel (Linux 7.2 in the OrbStack VM): the timed-out connect under default-drop, the SYN/ACK count and rule counter, the stateless rule admitting a connection the client never asked for, and the conntrack entry.
// Hedged, not sourced: Cilium NetworkPolicy and conntrack (stated as general knowledge, not fetched), ICMP errors counting as related (general knowledge, not run).
// This chapter's labs use the input hook only; the output chain is left open. Chapter 4.6 compares security groups and NACLs side by side.

const NEED = `ip netns list | grep -q n45c || { echo "Run the first lab first."; exit 1; }`;

export default {
  node: 'stateful-vs-stateless-filtering',
  number: '4.5',
  kicker: 'Layer 4',
  title: 'Stateful vs stateless filtering',
  lede: 'A filter can judge each packet on the fields it carries, or it can also remember the flows it has already allowed. That difference decides what a return packet needs in order to get through.',
  sections: [
    {
      id: 'memory',
      title: 'A client behind a default-deny filter',
      blocks: [
        { md: `Chapter 4.1 gave every connection a 5-tuple, and a client a random **ephemeral port**. On this kernel the range is 32768 to 60999 (the \`ip_local_port_range\` default in the kernel documentation). So a client connecting to a server's port 8080 sends packets like this, and the server's replies mirror it:

\`\`\`
client -> server   src 10.45.0.1:48386   dst 10.45.0.2:8080
server -> client   src 10.45.0.2:8080    dst 10.45.0.1:48386
\`\`\`

The next lab builds a client \`n45c\` (10.45.0.1) and a server \`n45s\` (10.45.0.2), with a listener on the server's port 8080. First the client connects with no filter anywhere. Then the client gets an nft input chain with \`policy drop\`: everything arriving at the client is discarded unless a rule accepts it. The chain holds one rule, a bare \`counter\` with no verdict, which counts the packets that reach the end of the chain and fall to the policy. Outbound traffic from the client is unrestricted. The client connects out to the server's port 8080 again, with a 3 second timeout.` },
        {
          checkpoint: {
            id: 'c1',
            prompt: 'The client drops all inbound packets by default and allows all outbound. It connects out to the server\'s port 8080. What does connect() do?',
            options: [
              'Connects: the client opened the connection, so its replies are covered',
              'Times out: the server\'s answer arrives as an inbound packet and meets the drop',
              'Refused: the client answers the unwanted SYN/ACK with a reset',
              'Network unreachable: with inbound closed, there is no usable route',
            ],
            key: 1,
            why: 'The SYN leaves (outbound is open) and the server answers, but the SYN/ACK enters the client\'s input hook like any other inbound packet. A filter that does not remember the outgoing SYN has no reason to treat it differently, so it is dropped and the client keeps waiting.',
          },
        },
        {
          lab: {
            explain: 'Build n45c and n45s; connect with no filter, then with a default-drop input chain on the client; count SYN/ACKs sent and packets dropped',
            cmd: `for n in n45c n45s; do ip netns del $n 2>/dev/null; done; sleep 0.5
mk() { ip netns add $1; ip netns exec $1 sysctl -qw net.ipv6.conf.all.disable_ipv6=1 net.ipv6.conf.default.disable_ipv6=1; ip -n $1 link set lo up; }
mk n45c; mk n45s
ip link add eth0 netns n45c type veth peer name eth0 netns n45s
ip -n n45c link set eth0 up; ip -n n45s link set eth0 up
ip -n n45c addr add 10.45.0.1/24 dev eth0; ip -n n45s addr add 10.45.0.2/24 dev eth0
sleep 1
cat > /tmp/conn45.py <<'PY'
import os, socket, sys, time
# usage: conn45.py DST_IP DST_PORT TIMEOUT [SRC_PORT]; HOLD=n keeps a connection open n seconds
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.settimeout(float(sys.argv[3]))
if len(sys.argv) > 4: s.bind(("", int(sys.argv[4])))
t = time.time()
try: s.connect((sys.argv[1], int(sys.argv[2]))); r = "connected"
except socket.timeout: r = "timed out"
except OSError as e: r = e.strerror
print("%s:%s -> %s after %.1f s" % (sys.argv[1], sys.argv[2], r, time.time() - t), flush=True)
if r == "connected": time.sleep(float(os.environ.get("HOLD", "0")))
PY
cat > /tmp/lis45.py <<'PY'
import socket, sys, time
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind((sys.argv[1], int(sys.argv[2]))); s.listen(5); time.sleep(float(sys.argv[3]))
PY
ip netns exec n45s python3 /tmp/lis45.py 10.45.0.2 8080 10 & LP=$!
sleep 0.5
echo "--- no filter"
ip netns exec n45c python3 /tmp/conn45.py 10.45.0.2 8080 2
ip netns exec n45c nft add table inet f45
ip netns exec n45c nft add chain inet f45 in '{ type filter hook input priority 0; policy drop; }'
ip netns exec n45c nft add rule inet f45 in counter
ip netns exec n45s timeout 4 tcpdump -nl -i eth0 'tcp' 2>/dev/null > /tmp/s45.cap &
sleep 0.5
echo "--- client input chain: policy drop, no accept rules"
ip netns exec n45c python3 /tmp/conn45.py 10.45.0.2 8080 3
sleep 1
echo "SYN/ACKs the server sent: $(grep -c 'Flags \\[S\\.\\]' /tmp/s45.cap)"
ip netns exec n45c nft list chain inet f45 in | grep counter
kill $LP 2>/dev/null; true`,
          },
        },
        { md: `Without a filter the client connected at once. With the default-drop chain, the connect timed out after 3.0 s. The server's side of the story is in its own capture: it sent 4 SYN/ACKs in the 4 second capture, and the client's end-of-chain counter reads 4 packets. The lab does not separate answers to the client's retransmitted SYNs (chapter 4.4) from the server's own SYN/ACK retransmissions. Each SYN/ACK arrived and was dropped. The SYN itself left without trouble, because outbound was never filtered, which is why the server answered at all.

The connection died on the way back. The SYN/ACK entered the client's input hook as an inbound packet and fell to the default drop, so the client never completed the handshake. Default-deny inbound sounds like a rule about who may *start* a conversation, but it also breaks every outgoing TCP and UDP request on a machine unless some rule lets the replies in.` },
      ],
    },
    {
      id: 'stateless',
      title: 'A hand-written return rule',
      blocks: [
        { md: `The stateless fix is to write the return rule by hand. The reply from the server has source port 8080, so the client's input chain gets \`tcp sport 8080 accept\`.

The next lab flushes the chain, adds that rule (and the counter again), and starts two listeners: the server's on 8080 and, on the client, a listener on port 9000 that nobody should be able to reach. The client connects out to the server first. Then the server makes a connection of its own to the client's port 9000, with its source port forced to 8080, a connection the client never asked for.` },
        {
          checkpoint: {
            id: 'c2',
            prompt: 'The client has "tcp sport 8080 accept" as its only inbound rule. The server opens a connection to the client\'s port 9000, from source port 8080. Does that SYN get in?',
            options: [
              'Dropped as a non-reply: the rule is for replies, and this is not one',
              'Dropped on port 9000: that port has no rule of its own',
              'Accepted: the rule matches the source port, and nothing marks the packet as a reply',
              'Dropped as unsolicited: the client never sent anything to the server first',
            ],
            key: 2,
            why: 'The rule reads only the source port of each packet, and this SYN carries source port 8080. A stateless filter has no record of who spoke first, so it cannot reject the packet for being unsolicited.',
          },
        },
        {
          lab: {
            explain: 'Stateless rule "tcp sport 8080 accept": connect out (should work), then server source port 8080 -> client:9000 (unrequested)',
            cmd: `${NEED}
ip netns exec n45c nft flush chain inet f45 in
ip netns exec n45c nft add rule inet f45 in tcp sport 8080 accept
ip netns exec n45c nft add rule inet f45 in counter
ip netns exec n45s python3 /tmp/lis45.py 10.45.0.2 8080 3 & LP=$!
ip netns exec n45c python3 /tmp/lis45.py 10.45.0.1 9000 8 & LC=$!
sleep 0.5
echo "--- stateless rule: tcp sport 8080 accept"
echo "client -> server:8080 : $(ip netns exec n45c python3 /tmp/conn45.py 10.45.0.2 8080 2)"
sleep 3.5
echo "server (source port 8080) -> client:9000, a connection the client never asked for:"
ip netns exec n45s python3 /tmp/conn45.py 10.45.0.1 9000 2 8080
kill $LP $LC 2>/dev/null; true`,
          },
        },
        { md: `Both connections went through. The client's connect to the server worked, so the hand-written return rule does its job. The second line is the cost: the server, using source port 8080, reached a port on the client that the client had never contacted, and the handshake completed. The rule matched the *port*, and the filter had no way to know whether the packet was a reply.

A packet filter can read, in one packet, the IP addresses, the protocol, the ports and the TCP flags. A **stateless** filter decides from those fields alone, so a reply is just another inbound packet to it. A **stateful** filter also keeps a table of the connections it has seen, and can match a packet against that table.

That is the general weakness of stateless return rules. The reply to an outbound request is identified only by a property of its header, such as a source port or a range of destination ports. Anything else carrying those fields gets the same treatment. For a client that talks to many servers on different ports, the rule has to cover a whole range, and the range is often wide: the destination port of a reply is the *client's ephemeral port*, which the filter cannot predict.

> [!IMPORTANT]
> A stateless return rule admits every packet that matches its fields, replies or not. It also has to be written for the ports the *other side* picks.` },
      ],
    },
    {
      id: 'conntrack',
      title: 'Letting the kernel remember',
      blocks: [
        { md: `A stateful filter replaces the hand-written return rule with a lookup. Linux's connection tracking (conntrack) records each flow when its first packet passes, and each later packet is classified against that table. The nftables wiki lists the states a packet can have:

| ct state | Meaning (from the nftables wiki) |
|---|---|
| \`new\` | Packets seen so far in one direction only, at least one a valid start such as a SYN |
| \`established\` | Valid packets seen in both directions; for TCP, the handshake has completed |
| \`related\` | A new connection spawned by an existing one, such as an FTP data channel |
| \`invalid\` | Does not follow the expected behaviour of a connection |
| \`untracked\` | Explicitly excluded from conntrack |

A policy-drop chain then needs a single rule for returns, the same one used in the wiki's example firewall: \`ct state established,related accept\`. The last lab swaps the stateless rule for it. The client connects out while holding the connection open for two seconds, and \`conntrack -L\` is read during that time. Afterwards the server again tries to reach the client's port 9000 from source port 8080, and the chain counter shows how many packets fell through.` },
        {
          lab: {
            explain: 'Replace the rule with "ct state established,related accept"; connect out and read conntrack; repeat the unrequested connection from source port 8080',
            cmd: `${NEED}
ip netns exec n45c nft flush chain inet f45 in
ip netns exec n45c nft add rule inet f45 in ct state established,related accept
ip netns exec n45c nft add rule inet f45 in counter
ip netns exec n45s python3 /tmp/lis45.py 10.45.0.2 8080 3 & LP=$!
ip netns exec n45c python3 /tmp/lis45.py 10.45.0.1 9000 8 & LC=$!
sleep 0.5
echo "--- stateful rule: ct state established,related accept"
HOLD=2 ip netns exec n45c python3 /tmp/conn45.py 10.45.0.2 8080 2 &
sleep 0.7
echo "conntrack: $(ip netns exec n45c conntrack -L 2>/dev/null | grep 'dport=8080')"
sleep 2.5
echo "server (source port 8080) -> client:9000:"
ip netns exec n45s python3 /tmp/conn45.py 10.45.0.1 9000 2 8080
ip netns exec n45c nft list chain inet f45 in | grep counter
kill $LP $LC 2>/dev/null; true`,
          },
        },
        { md: `The outbound connection worked again, and \`conntrack -L\` showed one entry for it: \`tcp ... ESTABLISHED src=10.45.0.1 dst=10.45.0.2 sport=<ephemeral> dport=8080 src=10.45.0.2 dst=10.45.0.1 sport=8080 dport=<ephemeral> [ASSURED]\`. The entry stores the 5-tuple in both directions, which is exactly the information a stateless rule lacks: when the SYN/ACK arrives, its tuple is the reverse of an entry that exists, so it is \`established\`.

The unrequested connection now timed out. The server's SYN, with source port 8080, found no entry and so was not \`established\` or \`related\`. It fell to the default drop, and the counter read 2 packets: the SYN and one retransmission within the 2 second wait. The same source port that was admitted in the previous lab was refused here because the decision no longer looks at the port.

Nothing about the ports is written down in the rule. It works for a client that uses a different ephemeral port on each connection, and for a server on any port. The cost is memory in the kernel: each tracked flow occupies a table entry, with a timeout that also decides how long an idle connection is remembered. The Proxmox firewall page, for instance, lists \`nf_conntrack_max\` among its options.

Chapter 4.7 comes back to conntrack for NAT, where the same table does a second job.

> [!IMPORTANT]
> \`ct state established,related accept\` lets in replies to flows the host itself allowed, and nothing else. The rules that decide who may *start* a flow stay separate.` },
      ],
    },
    {
      id: 'twins',
      title: "Where you've met this",
      blocks: [
        { md: `Think of a web server in a VPC subnet that serves HTTPS on port 443, behind a network ACL with an inbound rule allowing TCP 443 from anywhere and an outbound rule allowing TCP 443 to anywhere. A Linux client on the internet connects to it.` },
        {
          checkpoint: {
            id: 'c3',
            prompt: 'The network ACL has inbound "allow TCP 443" and outbound "allow TCP 443", and nothing else. A Linux client opens an HTTPS connection to the server. What happens?',
            options: [
              'Reply blocked: it targets the client\'s ephemeral port, which no outbound rule allows',
              'Works: NACLs track connections the way security groups do',
              'SYN blocked: 443 alone is not enough inbound',
            ],
            key: 0,
            why: 'A NACL is stateless. The SYN is allowed in on 443, but the server\'s reply goes to the client\'s ephemeral port (32768-61000 on many Linux kernels, per AWS) and the only outbound rule covers port 443, so the reply is not allowed out.',
          },
        },
        { md: `**AWS.** The EC2 connection-tracking page says that security groups use connection tracking and are stateful: "responses to inbound traffic are allowed to flow out of the instance regardless of outbound security group rules, and vice versa". The infrastructure-security page puts it in a table: return traffic for a security group is "automatically allowed (stateful)", and for a network ACL it "must be explicitly allowed (stateless)". The custom-NACL page adds the practical consequence: for every rule you add there must be a rule that allows the response traffic, and the ephemeral range depends on the client. It lists 32768-61000 for many Linux kernels, 49152-65535 for Windows Server 2008 and later, and 1024-65535 for Elastic Load Balancing requests, NAT gateways and Lambda. So the correct return rule for a public NACL is wide, usually 1024-65535, which is the stateless problem from this chapter, in AWS clothing. Chapter 4.6 puts the two side by side.

The same connection-tracking page has a catch that explains why a security group sometimes seems to behave statelessly. A flow is not tracked if a rule allows all traffic (0.0.0.0/0) in one direction and a rule in the other direction allows all responses on any port. For an untracked flow the response is allowed by the rule, not by tracking information, and removing the rule interrupts the flow at once, while a tracked flow survives a rule change.

**Proxmox.** The Proxmox VE firewall page says that with the input or output policy set to DROP or REJECT, traffic for already established connections is still allowed. That is the same rule as \`ct state established,related accept\`, and the page says the firewall can be inspected with \`iptables-save\`. The page does not spell out the exact rule it generates, so the equivalence is the same behaviour, not a confirmed rule text.

**Kubernetes / Cilium.** Cilium's NetworkPolicy is generally described as stateful: allowing ingress to a pod lets its replies out. Cilium's documentation is not cited here, so treat that as general knowledge.` },
      ],
    },
    {
      id: 'keep',
      title: 'What to keep',
      blocks: [
        { md: `- A stateless filter reads one packet at a time, and a reply looks like any other inbound packet. Default-deny inbound alone breaks the client's own outgoing connections.
- A hand-written return rule matches header fields only. In the lab \`tcp sport 8080 accept\` also let in a connection the client never made.
- Conntrack records each flow, so \`ct state established,related accept\` admits replies to flows the host allowed and refuses the same ports when no flow exists.
- AWS security groups are stateful and NACLs are stateless, from AWS's own documentation. A NACL needs an explicit return rule for the client's ephemeral port range.
- Which side starts the flow still has to be decided by rules; state only decides what counts as a reply.` },
      ],
    },
  ],
};
