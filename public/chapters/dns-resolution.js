// Chapter 6.2: DNS resolution. Authored content; the tutor gets this file as chapter_source.
// Labs run in netlab (Ubuntu 26.04, dig 9.20.24) on 2026-10-25; outputs described in the prose were observed. The labs query the real internet,
// so server names, addresses, record counts and timings vary between runs; the prose relies on the structure only. The netlab VM's resolver
// is OrbStack's (nameserver 0.250.250.200); a cloud instance or laptop will show a different one.
// Sources: https://datatracker.ietf.org/doc/html/rfc1035 (UDP messages of 512 octets or less; header flags QR, AA, TC, RD, RA),
//   https://man7.org/linux/man-pages/man5/resolv.conf.5.html (nameserver lines: up to 3, queried in the order listed),
//   https://docs.aws.amazon.com/vpc/latest/userguide/AmazonDNS-concepts.html (Route 53 Resolver at 169.254.169.253, fd00:ec2::253 and VPC base +2;
//     link-local queries are not visible on the network; 1024 packets per second limit shared with IMDS and NTP),
//   https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/ (kubelet writes each Pod's resolv.conf; ClusterFirst forwards other names upstream).
// Not sourced, so hedged: the name of the VPC attribute and its default, Proxmox behaviour.

export default {
  node: 'dns-resolution',
  number: '6.2',
  kicker: 'Services',
  title: 'DNS resolution',
  lede: 'Your program asks one server, the one in resolv.conf, and gets back an address or an error. What that server does to find the answer is a separate job, done by different machines.',
  sections: [
    {
      id: 'stub',
      title: 'Two jobs, not one',
      blocks: [
        {
          md: `When a program calls \`getaddrinfo("example.com")\`, the C library does very little. It reads \`/etc/resolv.conf\`, takes the \`nameserver\` addresses from it, and sends one UDP query to the first. The man page says up to three can be listed and that they are queried in the order given. That small client is the **stub resolver**. It has no idea where example.com lives. It knows only who to ask.

The server it asks is a **recursive resolver**: a machine that will go and find the answer, then cache it. Your stub sends one question and waits. The resolver does the legwork.

The first lab shows this split on the netlab VM: which server the stub is configured with, and what a query to it looks like. The VM sits behind OrbStack, so the nameserver you see belongs to OrbStack and is not one from your own network.`,
        },
        {
          lab: {
            explain: 'Show the stub configuration and one query as dig sees it (the SERVER line names who answered)',
            cmd: `grep -E '^(nameserver|search|options)' /etc/resolv.conf
echo "--- dig example.com"
dig example.com A | grep -E '^;; (SERVER|flags)|^example.com'`,
          },
        },
        {
          md: `You should see one \`nameserver\` line and a query that went to exactly that address on port 53 over UDP. The answer comes back with the flags \`qr rd ra\`. Note the last two: \`rd\` means the stub *desired recursion*, and \`ra\` means the server says recursion is *available*. The addresses in the answer depend on the name you ask for.

The stub asked one question and got an answer. It cannot tell from this whether the resolver already had it cached or went out and found it. The next question is what happens inside that resolver on a cold cache.

Put a resolver with an **empty cache** in front of the name \`example.com\`. It has no cached answer for \`com\` or for \`example.com\`, and the only DNS server addresses it has built in are a short fixed list.`,
        },
        {
          checkpoint: {
            id: 'c1',
            prompt: 'An empty-cache resolver is asked for the A record of example.com. In what order does it talk to servers?',
            options: [
              'The .com server directly, then example.com’s own server: resolvers ship with every TLD’s servers',
              'The root server, which holds the A record: the root zone lists every name',
              'The root server, then a .com server, then example.com’s own server: each one points to the next',
              'Its upstream resolver, which asks one server that holds the complete DNS database',
            ],
            key: 2,
            why: 'No single server holds all names. The root only knows who runs each top-level domain, the .com servers only know who runs each .com domain, and only the domain’s own server holds its records.',
          },
        },
        {
          md: `DNS is a tree of delegations, and a resolver walks it from the top. Each server along the way answers the question it can: "I don't have that, but these servers are responsible for the next label down." That reply is a **referral**. The final server, the one that owns the zone, gives the actual record and is called **authoritative** for it.

\`\`\`
resolver             root         .com         example.com's
   |--- example.com? -->|            |             own server
   |<-- ask .com: ... --|            |                |
   |--- example.com? ---------------->|               |
   |<-- ask example.com's servers: ---|               |
   |--- example.com? ------------------------------->|
   |<-- A 192.0.2.x (authoritative) -----------------|
\`\`\`

Once the resolver has the answer it caches it for the record's TTL and returns it to the stub. A second query from any client of that resolver is served from the cache without leaving it.

> [!IMPORTANT]
> The stub asks one server and gets one answer. The recursive resolver does the walk: root → TLD → authoritative, following referrals.`,
        },
      ],
    },
    {
      id: 'trace',
      title: 'Watch the walk',
      blocks: [
        {
          md: `\`dig +trace\` plays the resolver's part from your shell. It starts from the root, follows each referral itself and prints every step. The VM has internet access, so it runs against the real servers. Which root server answers, which addresses it uses and how long each step takes will differ from run to run, so look at the structure.`,
        },
        {
          lab: {
            explain: 'Walk example.com from the root, printing who answered each step and how many NS records each referral listed',
            cmd: `dig +trace +nodnssec example.com > /tmp/d62.trace
echo "answered by, in order (names vary):"
awk '/^;; Received/{n++; print "  step " n ": " $6}' /tmp/d62.trace
echo "NS records listed per zone (counts vary):"
awk '$4=="NS"{c[$1]++} END{for (z in c) print "  " z "  " c[z]}' /tmp/d62.trace | sort
echo "final answer lines: $(grep -cE '^example.com\\.[[:space:]]+[0-9]+[[:space:]]+IN[[:space:]]+A[[:space:]]' /tmp/d62.trace)"`,
          },
        },
        {
          md: `Read the steps in order. Step 1 is your configured resolver: \`dig +trace\` uses it only to get the list of root servers. The next three steps are the walk. A root server answers with the NS records of \`com.\`, a \`.com\` server (a \`gtld-servers.net\` name) answers with the NS records of \`example.com.\`, and the last server, one of the names listed in that last referral, returns the A records. In the run observed here the roots and \`com.\` each listed 13 servers; the number listed for \`example.com.\` was smaller. The counts are not a rule and can differ for the domain you try.

Neither of the first two servers had the A record, which is what the diagram showed. The count of final answer lines is the number of A records returned, and it varies with the domain.

Now compare how the *last* server answers with how your resolver answers, using the header flags that dig prints. The lab asks example.com's own nameserver directly, with recursion switched off, and then asks the configured resolver the same question.`,
        },
        {
          checkpoint: {
            id: 'c2',
            prompt: 'Which header flags come back from example.com’s own server, and from the configured resolver?',
            options: [
              'Both qr rd ra: every DNS server that answers also offers recursion',
              'Own server qr aa, resolver qr rd ra: only the zone’s owner is marked authoritative',
              'Own server qr rd ra, resolver qr aa: the resolver holds the copy the client trusts',
              'Own server refuses: authoritative servers only talk to recursive resolvers they know',
            ],
            key: 1,
            why: 'The owner of the zone sets aa (authoritative answer) and has no recursion to offer. The resolver answers from its own cache or from a walk, so it sets ra (recursion available) and echoes the client’s rd.',
          },
        },
        {
          lab: {
            explain: 'Ask an example.com nameserver directly without recursion, then ask the configured resolver (compare the flags)',
            cmd: `NS=$(dig +short NS example.com | sort | head -1)
echo "own server ($NS), recursion off:"
dig @$NS example.com A +norecurse +noall +comments +answer | grep -E '^;; flags|^example.com' | sed 's/^;; //'
echo "configured resolver:"
dig example.com A +noall +comments +answer | grep -E '^;; flags|^example.com' | sed 's/^;; //'`,
          },
        },
        {
          md: `The direct answer carries \`qr aa\`: a response (\`qr\`) from the authority for the zone (\`aa\`, authoritative answer), with no \`rd\` or \`ra\`. The answer from the configured resolver carries \`qr rd ra\` and no \`aa\`, because that server does not own the zone. It is passing on what it learned. RFC 1035 defines these header bits (QR, AA, TC, RD, RA).

The TTLs differ too: 300 from the authority and 275 from the resolver, in runs made minutes apart. A resolver that cached the record earlier would normally report a smaller remaining TTL, but this resolver reported the same 275 each time, so the lab does not explain the difference and no claim is made about it.

This is also why the two servers are different machines in practice. Authoritative servers answer questions about their own zones, and a resolver never owns the zones it looks up. The same program can play both roles, but the roles do not mix.`,
        },
      ],
    },
    {
      id: 'transport',
      title: 'Port 53 and message size',
      blocks: [
        {
          md: `You know UDP from the previous chapters. DNS uses port 53 and a query normally goes out as a single UDP datagram, with no handshake to pay for. RFC 1035 sets the size limit for UDP messages at 512 octets, and the dig output above showed a larger EDNS buffer size (\`udp: 1232\`) that the client advertises. Neither size is unbounded.

Now give dig a reason to need more room. The query asks for the root zone's DNSKEY records, which are large, and tells the server that this client only accepts 512 bytes (\`+bufsize=512\`). First the lab runs it with truncation ignored, so you see what the UDP reply looks like. Then it runs the default, while a capture counts what goes out on port 53.`,
        },
        {
          checkpoint: {
            id: 'c3',
            prompt: 'A DNS answer does not fit in the UDP size the client allowed. What does the client see and do?',
            options: [
              'The reply is marked truncated, and the client repeats the query over TCP',
              'The reply is cut off and the client uses the part that arrived: UDP has no way to ask again',
              'The reply is split over several UDP datagrams that the client reassembles',
            ],
            key: 0,
            why: 'DNS handles an oversized UDP answer itself: the server sets the TC (truncated) flag, and a client that sees TC retries the same question over TCP on port 53.',
          },
        },
        {
          lab: {
            explain: 'Truncated UDP reply, then the default retry; count TCP SYNs to port 53 in each (small query: 0, big query: 1)',
            cmd: `echo "UDP only (+ignore): the first reply"
dig +bufsize=512 +dnssec +ignore . DNSKEY | grep -E '^;; (flags|SERVER)' | sed 's/^;; //'
echo "--- default dig, same question:"
dig +bufsize=512 +dnssec . DNSKEY | grep -E 'Truncated|^;; (flags|SERVER)' | sed 's/^;; //'
cnt() {
  timeout 5 tcpdump -nl -i any 'udp port 53' > /tmp/d62.udp 2>/dev/null & P1=$!
  timeout 5 tcpdump -nl -i any 'tcp port 53' > /tmp/d62.tcp 2>/dev/null & P2=$!
  sleep 1; "$@" >/dev/null; sleep 1; kill $P1 $P2 2>/dev/null; wait $P1 $P2 2>/dev/null
  echo "  UDP queries: $(grep -c ' > .*\\.53: ' /tmp/d62.udp)   TCP SYNs: $(grep -c 'Flags \\[S\\],' /tmp/d62.tcp)"
}
echo "capture, small query (example.com A):"; cnt dig example.com A
echo "capture, big query (root DNSKEY, 512 buffer):"; cnt dig +bufsize=512 +dnssec . DNSKEY`,
          },
        },
        {
          md: `The first reply has the flags \`qr tc rd ra\`. \`tc\` is the truncation bit (RFC 1035), and the reply came over UDP. The default run prints \`Truncated, retrying in TCP mode\`, and its second \`SERVER\` line ends in \`(TCP)\`, now with the answer in full and no \`tc\`.

The capture closes the loop. A small query shows one UDP query and zero TCP SYNs. The UDP count there is the positive control: it proves the capture was running when the zero was printed. The big query shows the UDP query as well, and one TCP SYN to port 53: the retry.

In practice this means DNS needs both UDP **and** TCP on port 53. Every firewall, security group and network ACL in the path has to allow TCP/53, not only UDP/53, or large answers fail while small ones work. That conclusion is general knowledge built on what you just saw: the lab did not test any firewall.`,
        },
      ],
    },
    {
      id: 'twins',
      title: "Where you've met this",
      blocks: [
        {
          md: `**AWS VPC.** The resolver your instances use is the Route 53 Resolver, also called the Amazon DNS server. AWS documents it at three addresses: \`169.254.169.253\` (IPv4), \`fd00:ec2::253\` (IPv6) and the VPC's primary IPv4 CIDR **base plus two**, so \`10.0.0.2\` in a \`10.0.0.0/16\` VPC. Queries to it use a link-local path and, in AWS's words, "are not visible on the network", so you will not see them on a VPC packet capture beyond the instance's own interface. DNS is also bound by a limit of 1024 packets per second per network interface for link-local services, shared with instance metadata and the time service. Instances usually get this address through the DHCP option set (previous chapter). A VPC attribute turns DNS resolution on or off; the attribute's API name and its default were not checked for this chapter.

**Kubernetes.** The pod's \`resolv.conf\` is written by kubelet and points at the cluster DNS service (the Kubernetes docs show an example with \`nameserver 10.32.0.10\`). The docs describe the default \`ClusterFirst\` policy: names that do not match the cluster domain suffix are forwarded by the DNS server to an upstream nameserver, so the pod's stub asks one server, and that server is the one that recurses or forwards. The next chapter covers the search list that is also in that file.

**Proxmox.** Hosts and guests have their own \`resolv.conf\`, usually filled in by DHCP or set by hand to the router's address. This is general knowledge about Linux hosts and was not checked against Proxmox documentation.`,
        },
      ],
    },
    {
      id: 'keep',
      title: 'What to keep',
      blocks: [
        {
          md: `- The **stub resolver** in your libc sends one question to the \`nameserver\` in \`/etc/resolv.conf\` (up to three, in order) and waits.
- A **recursive resolver** answers from cache or walks the tree: root → TLD → the zone's authoritative server, following referrals, then caches by TTL.
- The header flags tell the roles apart: \`aa\` is the zone's owner answering, \`ra\` is a resolver offering recursion.
- DNS starts on UDP/53 and moves to TCP/53 when a reply is truncated (\`tc\`). Allow both.
- In AWS the resolver is at VPC base +2 and \`169.254.169.253\`, reached over a link-local path you cannot capture.`,
        },
      ],
    },
  ],
};
