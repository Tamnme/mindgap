// Chapter 4.6: Security group vs network ACL. Authored content; the tutor gets this file as chapter_source.
// Labs run in netlab (Ubuntu 26.04, iproute2 6.19, kernel 7.2) on 2026-10-25; outputs described in the prose were observed.
// Sources (all fetched 2026-10-25):
//   https://docs.aws.amazon.com/vpc/latest/userguide/infrastructure-security.html (comparison table: SG instance level, allow rules only, evaluates all rules, return traffic automatic; NACL subnet level, allow and deny, ascending order until a match, return traffic explicit; layering diagram text),
//   https://docs.aws.amazon.com/vpc/latest/userguide/vpc-network-acls.html (subnet-level allow/deny; one NACL per subnet; rule numbers 1 to 32766; first match applies and later rules are not evaluated; evaluated when traffic enters and leaves the subnet, not as it is routed within a subnet; stateless),
//   https://docs.aws.amazon.com/vpc/latest/userguide/nacl-rules.html (lowest numbered rule first; applied regardless of any higher-numbered rule that contradicts it),
//   https://docs.aws.amazon.com/vpc/latest/userguide/custom-network-acl.html (the asterisk rule denies unmatched packets; a response rule is needed for every rule; ephemeral ranges by client type),
//   https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html (SG controls traffic to and from associated resources; stateful; quotas count security groups per network interface; some traffic such as instance metadata is not filtered).
// The lab emulates the behaviour AWS documents with nft in a router netns. It shows nothing about how AWS implements either filter, which AWS does not publish.
// Hedged, not sourced: Kubernetes/Cilium and Proxmox comparisons (general knowledge, not fetched), VPC Flow Logs and Reachability Analyzer as debugging aids (named, docs not fetched).
// Observed only on this kernel (Linux 7.2 in the OrbStack VM): every timeout, refusal and counter value below.
// 4.5 covers statefulness and the ephemeral range; this chapter links back to it and does not re-teach it.

const NEED = `ip netns list | grep -q n46r || { echo "Run the first lab first."; exit 1; }`;

export default {
  node: 'sg-vs-nacl',
  number: '4.6',
  kicker: 'Layer 4',
  title: 'Security group vs network ACL',
  lede: 'AWS gives you two packet filters that differ in more than statefulness: where they attach, how their rules combine, and whether they can say no. Each difference changes what you do when a connection hangs.',
  sections: [
    {
      id: 'where',
      title: 'Two filters, two places',
      blocks: [
        { md: `Chapter 4.5 split filters into stateless and stateful, and placed AWS's NACL and security group on either side of that line. This chapter takes the rest of the comparison apart, row by row.

Start with where each one sits. AWS's security group page says a security group "controls the traffic that is allowed to reach and leave the resources that it is associated with". The quota wording on the same page counts security groups per *network interface*, which fits a filter on the ENI. A **network ACL** is associated with a *subnet*, and a subnet has exactly one at a time.

The labs build the NACL half with nft, in three network namespaces: a client \`n46a\` (10.46.1.2), a router \`n46r\`, and a server \`n46s\` (10.46.2.2) that stands for an instance in the protected subnet. The router's forward chain plays the NACL. Rules tagged \`in\` match packets heading to the server, and rules tagged \`out\` match packets coming back from it. Every rule carries a number in its comment, as an AWS rule does. The last rule in each direction is a drop, standing in for the \`*\` rule that AWS says every NACL has: "if a packet doesn't match any of the other rules, it's denied".

This is an emulation of the behaviour AWS documents. It says nothing about how AWS implements it, and AWS doesn't publish that.

The first lab connects to the server's port 8443 with no filter, then installs a NACL with inbound rule 100 (allow tcp 8443) and no outbound rule at all.` },
        {
          lab: {
            explain: 'Build client, router and server; connect with no NACL, then with inbound rule 100 only; read the rule counters',
            cmd: `for n in n46a n46r n46s; do ip netns del $n 2>/dev/null; done; sleep 0.5
mk() { ip netns add $1; ip netns exec $1 sysctl -qw net.ipv6.conf.all.disable_ipv6=1 net.ipv6.conf.default.disable_ipv6=1; ip -n $1 link set lo up; }
mk n46a; mk n46r; mk n46s
ip link add eth0 netns n46a type veth peer name ra netns n46r
ip link add eth0 netns n46s type veth peer name rs netns n46r
for x in "n46a eth0" "n46r ra" "n46r rs" "n46s eth0"; do ip -n \${x% *} link set \${x#* } up; done
ip -n n46a addr add 10.46.1.2/24 dev eth0; ip -n n46r addr add 10.46.1.1/24 dev ra
ip -n n46s addr add 10.46.2.2/24 dev eth0; ip -n n46r addr add 10.46.2.1/24 dev rs
ip -n n46a route add default via 10.46.1.1; ip -n n46s route add default via 10.46.2.1
ip netns exec n46r sysctl -qw net.ipv4.ip_forward=1
cat > /tmp/conn46.py <<'PY'
import socket, sys, time
s = socket.socket(); s.settimeout(float(sys.argv[3])); t = time.time()
try: s.connect((sys.argv[1], int(sys.argv[2]))); r = "connected"
except socket.timeout: r = "timed out"
except OSError as e: r = e.strerror
print("%s:%s -> %s after %.1f s" % (sys.argv[1], sys.argv[2], r, time.time() - t), flush=True)
PY
cat > /tmp/lis46.py <<'PY'
import socket, sys, time
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("10.46.2.2", int(sys.argv[1]))); s.listen(5); time.sleep(float(sys.argv[2]))
PY
sleep 1
ip netns exec n46s python3 /tmp/lis46.py 8443 8 & LP=$!
sleep 0.5
echo "--- no NACL"
ip netns exec n46a python3 /tmp/conn46.py 10.46.2.2 8443 2
ip netns exec n46r nft -f - <<'NFT'
table inet nacl46 {
  chain acl {
    type filter hook forward priority 0; policy accept;
    oifname rs tcp dport 8443 counter accept comment "in 100"
    oifname rs counter drop comment "in *"
    iifname rs counter drop comment "out *"
  }
}
NFT
echo "--- NACL: inbound 100 allow tcp 8443, no outbound rule"
ip netns exec n46a python3 /tmp/conn46.py 10.46.2.2 8443 3
ip netns exec n46r nft list chain inet nacl46 acl | grep -o 'counter packets [0-9]* .*comment.*'
kill $LP 2>/dev/null; true`,
          },
        },
        { md: `With no filter the connect succeeded at once. With the NACL it timed out after 3.0 s. Inbound rule 100 counted 3 packets, so the SYN and its retransmissions all got in. The server answered, and the answers met the outbound \`*\` rule, which counted 4 drops. The inbound \`*\` rule counted 0. That is chapter 4.5 again, a stateless filter with no return rule, and the one default-rule counter that moved says which direction swallowed the traffic.

The second lab writes the missing outbound rule: allow source port 8443 to destination ports 32768-60999, the Linux ephemeral range from 4.5.` },
        {
          lab: {
            explain: 'Recreate the NACL with outbound rule 100 for the replies, then connect again (expect connected)',
            cmd: `ip netns list | grep -q n46r || { echo "Run the first lab first."; exit 1; }
ip netns exec n46s python3 /tmp/lis46.py 8443 6 & LP=$!
sleep 0.5
echo "--- add outbound 100: allow tcp sport 8443 tcp dport 32768-60999"
ip netns exec n46r nft delete table inet nacl46
ip netns exec n46r nft -f - <<'NFT'
table inet nacl46 {
  chain acl {
    type filter hook forward priority 0; policy accept;
    oifname rs tcp dport 8443 counter accept comment "in 100"
    oifname rs counter drop comment "in *"
    iifname rs tcp sport 8443 tcp dport 32768-60999 counter accept comment "out 100"
    iifname rs counter drop comment "out *"
  }
}
NFT
ip netns exec n46a python3 /tmp/conn46.py 10.46.2.2 8443 3
ip netns exec n46r nft list chain inet nacl46 acl | grep -o 'counter packets [0-9]* .*comment.*'
kill $LP 2>/dev/null; true`,
          },
        },
        { md: `The connection worked at once, and outbound rule 100 counted 2 packets. Both directions now have a rule, and the emulated NACL is a working baseline. Everything from here on is about what that baseline can do that the previous chapter did not cover.` },
      ],
    },
    {
      id: 'order',
      title: 'Which rule wins',
      blocks: [
        { md: `A filter with one rule per direction never has to choose. Real rule lists do. Put two rules in the inbound list of the emulated NACL, with the return rule from the last lab still in place. Rule 100 allows tcp port 8443 from anywhere. Rule 150 denies everything from the client's address, 10.46.1.2. The client at 10.46.1.2 connects to port 8443, so both rules match the SYN, and they disagree.` },
        {
          checkpoint: {
            id: 'c1',
            prompt: 'The NACL has inbound rule 100 (allow tcp 8443 from anywhere) and rule 150 (deny all from 10.46.1.2). The client 10.46.1.2 connects to port 8443. What happens?',
            options: [
              'Deny always wins: a deny rule overrides any allow that also matches',
              'Lowest number wins: rule 100 matches first, so the connect succeeds',
              'Most specific rule wins: rule 150 names one host, so it beats the allow-from-anywhere',
              'Order of creation decides: whichever rule was added first is applied',
            ],
            key: 1,
            why: 'A NACL checks rules from the lowest number upward and the first match decides; later rules are not consulted. Rule 100 matches and allows, so rule 150 never gets a look. If the numbers were swapped, the same two rules would block.',
          },
        },
        { md: `The next lab wraps the idea in a small helper that takes rules as lines of "number, allow or deny, match" and loads them into the router's chain. Case A numbers the deny rule 50, and case B numbers it 150. The allow is rule 100 both times, and the lines are typed in reverse order, so the order of the text is never the order of the numbers. The listener on 8443 and the client at 10.46.1.2 are the same as before.` },
        {
          lab: {
            explain: 'Load allow-100 plus deny-from-client as rule 50, then as rule 150; read which rule counted the packets',
            cmd: `ip netns list | grep -q n46r || { echo "Run the first lab first."; exit 1; }
cat > /tmp/nacl46.sh <<'SH'
# env IN / OUT: lines "NUM allow|deny MATCH". Sorted by NUM, then one drop rule for the implicit "*".
# inbound = leaving the router toward the server subnet (oifname rs); outbound = arriving from it (iifname rs)
v() { [ $1 = allow ] && echo accept || echo drop; }
{ echo "table inet nacl46 {"; echo "chain acl {"; echo "type filter hook forward priority 0; policy accept;"
  echo "$IN" | sort -n | while read n a m; do [ -n "$n" ] && echo "oifname rs $m counter $(v $a) comment \\"in $n\\""; done
  echo 'oifname rs counter drop comment "in *"'
  echo "$OUT" | sort -n | while read n a m; do [ -n "$n" ] && echo "iifname rs $m counter $(v $a) comment \\"out $n\\""; done
  echo 'iifname rs counter drop comment "out *"'
  echo "}"; echo "}"; } > /tmp/nacl46.nft
ip netns exec n46r nft delete table inet nacl46 2>/dev/null
ip netns exec n46r nft -f /tmp/nacl46.nft
SH
OUT="100 allow tcp sport 8443 tcp dport 32768-60999"
ip netns exec n46s python3 /tmp/lis46.py 8443 9 & LP=$!
sleep 0.5
echo "--- A: deny 10.46.1.2 is rule 50, allow 8443 is rule 100 (typed in reverse order)"
IN="100 allow tcp dport 8443
50 deny ip saddr 10.46.1.2" OUT="$OUT" bash /tmp/nacl46.sh
ip netns exec n46a python3 /tmp/conn46.py 10.46.2.2 8443 2
ip netns exec n46r nft list chain inet nacl46 acl | grep -o 'counter packets [0-9]* .*in .*'
echo "--- B: same two rules, deny is now rule 150"
IN="100 allow tcp dport 8443
150 deny ip saddr 10.46.1.2" OUT="$OUT" bash /tmp/nacl46.sh
ip netns exec n46a python3 /tmp/conn46.py 10.46.2.2 8443 2
ip netns exec n46r nft list chain inet nacl46 acl | grep -o 'counter packets [0-9]* .*in .*'
kill $LP 2>/dev/null; true`,
          },
        },
        { md: `Case A timed out after 2.0 s. Rule 50 counted 2 packets and dropped them, and rule 100 counted 0, even though the SYN matches it. Case B connected at once: rule 100 counted the traffic and rule 150 counted 0, even though the SYN matches that too. The rules were identical in both cases. Only the numbers changed.

AWS documents the same behaviour. The NACL rules page says "Rules are evaluated starting with the lowest numbered rule. As soon as a rule matches traffic, it's applied regardless of any higher-numbered rule that might contradict it." Rule numbers run from 1 to 32766, and AWS recommends creating rules in increments such as 10 or 100 so that later rules can be inserted between them.

> [!IMPORTANT]
> A NACL is an ordered list: lowest number first, the first match decides, and a deny is only as strong as its position. Specificity does not matter and neither does the order a rule was created in.

A security group has no numbers, and the comparison table on the infrastructure-security page says why. It contrasts the two like this:

| | Security group | Network ACL |
|---|---|---|
| Rule type | Allow rules only | Allow and deny rules |
| Rule evaluation | Evaluates all rules before deciding whether to allow traffic | Evaluates rules in ascending order until a match for the traffic is found |
| Return traffic | Automatically allowed (stateful) | Must be explicitly allowed (stateless) |

With allow rules only, no rule can contradict another, so a security group can grow the set of permitted traffic but never carve a hole out of it. Reordering rules could not change the answer, which is why there is nothing to number. That is reasoning from the table, not something this chapter's labs ran. The practical consequence is that "everything except this one address" is awkward to say in a security group and natural in a NACL, because only the NACL has a deny. The cost is the thing the labs just showed: in a NACL the deny has to sit at a lower number than any allow it should beat.` },
      ],
    },
    {
      id: 'symptoms',
      title: 'Reading the symptom',
      blocks: [
        { md: `Someone says a connection "just hangs". Two filters can be responsible, plus the possibility that nothing is listening. The last lab sets up all three at once, on four ports of the server at 10.46.2.2.

The router's NACL has inbound rules for 8443, 9002 and 8444, and an outbound rule for the replies. It has no inbound rule for 9001. The server has its own filter standing in for a security group: an nft input chain with \`policy drop\`, \`ct state established,related accept\`, and an accept for ports 8443 and 8444 only, followed by a bare counter. The server listens on 8443, 9001 and 9002. Nothing listens on 8444.

| Port | NACL inbound | Server filter | Listener |
|---|---|---|---|
| 8443 | allowed | allowed | yes |
| 9001 | no rule | no rule | yes |
| 9002 | allowed | no rule for it | yes |
| 8444 | allowed | allowed | no |

The client connects to each port with a 2 second timeout.` },
        {
          checkpoint: {
            id: 'c2',
            prompt: 'The client connects to 9001 (NACL has no rule), 9002 (server filter has no rule) and 8444 (both allow, no listener). What does it see on each?',
            options: [
              'Three different errors: each layer, and a closed port, reports in its own way',
              'All three time out: a drop anywhere on the path looks the same',
              'NACL and server filter both time out; the closed port is refused',
              'Server filter refuses: it answers with a reset while the NACL stays silent',
            ],
            key: 2,
            why: 'Both filters discard silently, so the client waits until its timeout. Port 8444 passes both and reaches the host, which has no listener and answers with a reset, so the client gets an immediate refusal.',
          },
        },
        {
          lab: {
            explain: 'Install the NACL and a server-side filter, then connect to 8443, 9001, 9002, 8444 and read the two drop counters',
            cmd: `ip netns list | grep -q n46r && [ -f /tmp/nacl46.sh ] || { echo "Run the first three labs first."; exit 1; }
IN="100 allow tcp dport 8443
110 allow tcp dport 9002
120 allow tcp dport 8444" OUT="100 allow tcp sport 1024-65535 tcp dport 32768-60999" bash /tmp/nacl46.sh
ip netns exec n46s nft delete table inet sg46 2>/dev/null
ip netns exec n46s nft -f - <<'NFT'
table inet sg46 {
  chain in {
    type filter hook input priority 0; policy drop;
    ct state established,related accept
    tcp dport { 8443, 8444 } accept
    counter
  }
}
NFT
PIDS=""; for p in 8443 9001 9002; do ip netns exec n46s python3 /tmp/lis46.py $p 12 & PIDS="$PIDS $!"; done
sleep 0.5
for p in 8443 9001 9002 8444; do ip netns exec n46a python3 /tmp/conn46.py 10.46.2.2 $p 2; done
echo "NACL inbound default rule:"; ip netns exec n46r nft list chain inet nacl46 acl | grep -o 'counter packets [0-9]* .*"in \\*"'
echo "SG chain end-of-chain counter:"; ip netns exec n46s nft list chain inet sg46 in | grep -o 'counter packets [0-9]*'
kill $PIDS 2>/dev/null; true`,
          },
        },
        { md: `8443 connected. 9001 and 9002 both timed out after 2.0 s, and 8444 was refused after 0.0 s.

From the client, the NACL block and the server-filter block are indistinguishable. Only the counters tell them apart: the router's inbound \`*\` rule counted 2 packets (toward 9001) and the server chain's end-of-chain counter counted 2 (toward 9002). Which layer dropped the packet is information the client's connect() never receives. The counters also show that the 9001 packets never reached the server chain: its counter holds only the 9002 attempts, because the NACL's inbound \`*\` rule had already dropped the 9001 SYNs.

The refusal on 8444 is also information. A packet that was refused got through the NACL inbound, through the server filter, and reached a host that answered. The host's reset then had to cross the outbound NACL rule on its way back, and it did, because outbound rule 100 covers that source port and the client's port. A refused connection therefore rules out both filters on that path. Chapter 4.4 covers the refused-versus-silent difference in detail.

> [!IMPORTANT]
> A timeout means a drop on the path, and the connect() call does not say where. An immediate refusal means the packet reached a host and was answered. In AWS, a security group and a NACL both produce the timeout.

AWS has tooling aimed at this question, such as VPC Flow Logs and Reachability Analyzer. Their documentation is not cited here, so treat them as pointers, not as claims about their output. Without them, the method is the one the lab used: check each layer separately, starting with whichever one you can inspect cheaply.` },
      ],
    },
    {
      id: 'twins',
      title: "Where you've met this",
      blocks: [
        { md: `Two instances sit in the same subnet, 10.0.2.0/24. The subnet's NACL has no rule that allows inbound tcp 8443, so the default \`*\` rule denies it. Instance two's security group allows tcp 8443 from instance one's security group. Instance one connects to instance two on port 8443.` },
        {
          checkpoint: {
            id: 'c3',
            prompt: 'Two instances share a subnet. The NACL does not allow inbound tcp 8443, but the target\'s security group does. Instance one connects to instance two on 8443. What happens?',
            options: [
              'NACL never sees it: the traffic stays inside the subnet',
              'Blocked at the subnet edge: the NACL checks every packet the subnet carries',
              'Blocked on the way back: the security group needs a NACL-style return rule',
            ],
            key: 0,
            why: 'AWS says NACL rules are evaluated when traffic enters and leaves the subnet, not as it is routed within a subnet. The security group on the target is the only filter in this path, and it allows the connection.',
          },
        },
        { md: `**AWS.** The VPC documentation says a NACL's rules are evaluated "when traffic enters and leaves the subnet, not as it is routed within a subnet". The comparison table's first row says the same thing in its own terms: security groups work at the "Instance level" and NACLs at the "Subnet level". The router in the lab stood for that boundary:

\`\`\`
 outside         subnet 10.46.2.0/24
 client --> router --[NACL]--+--[SG]-- instance
\`\`\`

In the lab, "in" meant crossing the boundary toward the server and "out" meant crossing it on the way back. That is why a NACL cannot restrict traffic between two instances of the same subnet. A security group sits on the instance, so it still can. The infrastructure-security page shows the layering: traffic from an internet gateway is routed to a subnet using the route table, the subnet's NACL decides what may enter, and the instance's security group decides what may reach the instance. It also says you can secure instances with security groups alone, and add NACLs as an extra layer.

Two details from the NACL pages are worth carrying with you. Each NACL has an asterisk rule that denies anything unmatched, and it cannot be deleted. IPv4 and IPv6 are evaluated separately, so an IPv4 rule does not cover IPv6 traffic. The ephemeral-port table from 4.5 applies to the return rules just as it did in lab 2.

The security group page adds that some traffic is not filtered by security groups at all, such as instance metadata and the Amazon Time Sync Service.

**Kubernetes / Cilium.** A Kubernetes NetworkPolicy is usually described as per-workload, allow-style and stateful, which makes it resemble a security group more than a NACL. The Kubernetes and Cilium documentation is not cited here, so treat that as general knowledge. If the nodes sit in a VPC, the node's security group and subnet NACL still apply underneath it.

**Proxmox.** The Proxmox firewall applies rules per VM, closest to a security group in spirit. A subnet-level stateless filter with numbered allow and deny rules has no direct equivalent unless you build it on a router, which is what the lab did. The Proxmox documentation is not cited here either, so that is general knowledge.` },
      ],
    },
    {
      id: 'keep',
      title: 'What to keep',
      blocks: [
        { md: `- A security group attaches to the instance (the ENI), allows only, evaluates every rule, and is stateful. A NACL attaches to the subnet, allows and denies, is checked lowest number first, and is stateless. All of this is from AWS's comparison table.
- In a NACL the first match ends evaluation. The lab loaded the same two rules with different numbers and got both outcomes. Position decides, not specificity.
- A NACL sees traffic crossing the subnet boundary and not traffic inside the subnet, per AWS's documentation.
- A timeout from either filter looks the same to the client, and an immediate refusal means the packet reached a host. Telling the layers apart takes a counter, a log or a tool, not the connect() error.
- Return traffic through a NACL needs its own rule, covering the client's ephemeral ports (chapter 4.5).` },
      ],
    },
  ],
};
