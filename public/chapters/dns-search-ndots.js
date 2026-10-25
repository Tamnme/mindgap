// Chapter 6.3: DNS search domains and ndots. Authored content; the tutor gets this file as chapter_source.
// Labs run in netlab (Ubuntu 26.04, glibc resolver via getent, dnsmasq 2.92, tcpdump 4.99.6) on 2026-10-25; outputs described in the prose were observed.
// The labs use a private DNS server (dnsmasq in a namespace) with made-up names, so the output is repeatable and needs no internet.
// Sources: https://man7.org/linux/man-pages/man5/resolv.conf.5.html (search list, ndots meaning, default 1, cap of 15),
//   https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/ (kubelet-written pod resolv.conf with three search entries and ndots:5;
//     dnsConfig options),
//   https://docs.aws.amazon.com/vpc/latest/userguide/DHCPOptionSetConcepts.html (domain name field of a DHCP option set).
// Not sourced, so hedged: how a given OS turns the DHCP domain name into a search line, AAAA behaviour of dual-stack programs, Proxmox.

const NEED_63 = `ip netns list | grep -qw n63c || { echo "Run the first lab (build the DNS bench) first."; exit 1; }`;

// dnsmasq as a DNS-only server in n63s: it answers x.y and example.com, and says NXDOMAIN for everything else under test, y and cluster.local.
const START_DNS = `ip netns exec n63s dnsmasq --user=root --interface=v63s --bind-interfaces --no-resolv --no-hosts --pid-file=/tmp/n63.pid --local=/test/ --local=/y/ --local=/cluster.local/ --address=/x.y/10.63.0.9 --address=/example.com/10.63.0.9`;

// q NAME: capture port 53 on the client link while getent resolves NAME, then print each query with its reply.
const Q = `q() {
  ip netns exec n63c timeout 5 tcpdump -nl -i v63c udp port 53 > /tmp/n63.cap 2>/dev/null & TP=$!
  sleep 0.7
  ip netns exec n63c getent ahostsv4 "$1" >/dev/null
  sleep 0.5; kill $TP; wait $TP 2>/dev/null
  awk '/ A\\? /{match($0,/A\\? [^ ]+/); name=substr($0,RSTART+3,RLENGTH-3)} / NXDomain/{print "  " name "  NXDOMAIN"} / 1\\/0\\/0 /{print "  " name "  answered"}' /tmp/n63.cap
  echo "  (queries on the wire: $(grep -c ' A? ' /tmp/n63.cap), NXDOMAIN replies: $(grep -c NXDomain /tmp/n63.cap))"
}`;

export default {
  node: 'dns-search-ndots',
  number: '6.3',
  kicker: 'Services',
  title: 'DNS search domains and ndots',
  lede: 'The name your program asks for and the names that cross the wire can be different. One line in resolv.conf decides how many queries a single lookup costs.',
  sections: [
    {
      id: 'rule',
      title: 'The name on the wire',
      blocks: [
        {
          md: `The stub resolver from the last chapter reads more than \`nameserver\` from \`/etc/resolv.conf\`. Two more settings change what it sends:

- \`search\`: a list of domain suffixes the resolver may append to a name you typed.
- \`options ndots:n\`: a number that decides when those suffixes are used.

The search list exists so that people can type short names. If your hosts live in \`corp.example\`, typing \`db1\` is easier than typing \`db1.corp.example\`. The catch is that the resolver has to turn a short name into a real one by *trying* candidates against the server.

Build a bench to watch it. A client namespace has a \`resolv.conf\` of its own, and a small DNS server (dnsmasq) answers from a namespace next to it. Its client file reads:

\`\`\`
search a.test b.test
options ndots:3
nameserver 10.63.0.53
\`\`\`

The server knows one name, \`x.y\`, and answers NXDOMAIN ("no such name") for everything under \`test\`. The client looks up **x.y**. Predict the queries that appear on port 53.`,
        },
        {
          checkpoint: {
            id: 'c1',
            prompt: 'With that resolv.conf, in what order do queries go out when the client looks up x.y?',
            options: [
              'x.y only: a name that contains a dot is always tried as written',
              'x.y.a.test, then x.y.b.test, then x.y',
              'x.y.a.test only: the first suffix in the list is the one that gets used',
              'x.y.a.test and x.y.b.test together, then x.y: the resolver tries the whole list at once',
            ],
            key: 1,
            why: 'x.y has one dot, fewer than ndots:3, so the resolver treats it as probably incomplete: it tries each search suffix in order, and only after those fail does it try x.y as written.',
          },
        },
        {
          md: `Here is the bench and the queries. The lab captures with \`tcpdump\` on the client link, resolves with \`getent ahostsv4\` (the real libc resolver, asking for IPv4 only), and prints each query with the server's reply. It then tries two more names: **p.q.x.y** (three dots) and **x.y.** with a trailing dot.

The \`resolv.conf\` is the per-namespace kind. \`ip netns exec\` looks for \`/etc/netns/<name>/resolv.conf\` and uses it in place of \`/etc/resolv.conf\` for programs started inside that namespace, so no other process on the VM is affected.`,
        },
        {
          lab: {
            explain: 'Build the bench and look up x.y, p.q.x.y and x.y. with ndots:3 (list the queries in order)',
            cmd: `for n in n63s n63c; do ip netns del $n 2>/dev/null; done; ip link del v63s 2>/dev/null; ip link del v63c 2>/dev/null; sleep 0.5
mkdir -p /etc/netns/n63c
for n in n63s n63c; do ip netns add $n; ip netns exec $n sysctl -qw net.ipv6.conf.all.disable_ipv6=1 net.ipv6.conf.default.disable_ipv6=1; done
ip link add v63s netns n63s type veth peer name v63c netns n63c
ip -n n63s addr add 10.63.0.53/24 dev v63s; ip -n n63s link set v63s up
ip -n n63c addr add 10.63.0.2/24 dev v63c; ip -n n63c link set v63c up
printf 'search a.test b.test\\noptions ndots:3\\nnameserver 10.63.0.53\\n' > /etc/netns/n63c/resolv.conf
${START_DNS}; sleep 0.5
${Q}
ip netns exec n63c cat /etc/resolv.conf
echo "# x.y (1 dot)"; q x.y
echo "# p.q.x.y (3 dots)"; q p.q.x.y
echo "# x.y. (trailing dot)"; q x.y.
kill $(cat /tmp/n63.pid); echo "dnsmasq stopped"`,
          },
        },
        {
          md: `For \`x.y\` the client sent three queries: \`x.y.a.test.\` (NXDOMAIN), \`x.y.b.test.\` (NXDOMAIN) and finally \`x.y.\`, which the server answered. For \`p.q.x.y\` it sent one, the name as written, and got the answer at once. For \`x.y.\` it sent one.

The man page states the rule. \`ndots:n\` "sets a threshold for the number of dots which must appear in a name ... before an initial absolute query will be made". The default is 1, and the value is silently capped to 15. Two cases follow:

- **Fewer dots than ndots** (\`x.y\` has 1, the threshold is 3): the name might be relative, so each search suffix is tried first, in order. The name as written comes last.
- **At least ndots dots** (\`p.q.x.y\` has 3): the name is tried as written first. Suffixes are only a fallback if that fails.

A name with a **trailing dot** is fully qualified and is never expanded. That is how you say "do not search".

> [!IMPORTANT]
> Fewer dots than \`ndots\`: try the search suffixes first, the name as written last. At least \`ndots\` dots: the name as written first. A trailing dot skips the search list.

One more thing the capture shows. Every failed suffix is a real round trip: the server had to receive the query and answer NXDOMAIN, and the lookup did not move on until it did. The counter line under each lookup is the capture's own check: it counts what went out on the wire, and the 1-query cases show the capture was recording (a count of 0 there would have meant it never started). How much a failed candidate costs depends on how far away and how busy the server is, which this bench does not measure.

NXDOMAIN is the signal that makes the resolver move on to the next candidate. Under \`a.test\` and \`b.test\` the server could say "this name does not exist" with authority (that is what \`--local\` configures in dnsmasq), so each wrong guess was rejected quickly. A server that stayed silent instead would make the resolver wait out a timeout before trying the next candidate. That variant was not run here.`,
        },
      ],
    },
    {
      id: 'k8s',
      title: 'Why a pod\'s lookups multiply',
      blocks: [
        {
          md: `Kubernetes writes a \`resolv.conf\` into every pod. The Kubernetes documentation shows its shape:

\`\`\`
nameserver 10.32.0.10
search <namespace>.svc.cluster.local svc.cluster.local cluster.local
options ndots:5
\`\`\`

(The docs use that example nameserver address; the real one is your cluster DNS service's IP.) The three search entries let a pod in namespace \`ns\` reach a Service called \`data\` by typing \`data\`: it is expanded to \`data.ns.svc.cluster.local\`. The line that matters for this chapter is the last one, \`ndots:5\`.

Reproduce the file on the bench, with a namespace called \`ns\`. The server answers \`example.com\` and says NXDOMAIN for anything under \`cluster.local\`, which is what a cluster DNS server does for a name that is not a Service. A pod asks for the external name \`example.com\`.`,
        },
        {
          checkpoint: {
            id: 'c2',
            prompt: 'Apply the rule from the previous lab to this file. How many A queries go out for example.com, including the one that gets the answer?',
            options: [
              'Single query: a name with a dot is looked up as written',
              'Three queries, then failure: one per search domain, with no as-written try',
              'Four queries: three suffixed names fail first, then example.com works',
              'Two queries: the name as written fails, then one search domain works',
            ],
            key: 2,
            why: 'example.com has one dot, below ndots:5, so all three search suffixes are tried first and each returns NXDOMAIN. Only then is example.com sent as written and answered.',
          },
        },
        {
          lab: {
            explain: 'Kubernetes-style resolv.conf (ndots:5): look up example.com, then example.com. with a trailing dot',
            cmd: `${NEED_63}
printf 'search ns.svc.cluster.local svc.cluster.local cluster.local\\noptions ndots:5\\nnameserver 10.63.0.53\\n' > /etc/netns/n63c/resolv.conf
${START_DNS}; sleep 0.5
${Q}
echo "# example.com (1 dot)"; q example.com
echo "# example.com. (trailing dot)"; q example.com.
kill $(cat /tmp/n63.pid); echo "dnsmasq stopped"`,
          },
        },
        {
          md: `Four queries for one lookup: \`example.com.ns.svc.cluster.local.\`, \`example.com.svc.cluster.local.\` and \`example.com.cluster.local.\` each returned NXDOMAIN, and then \`example.com.\` was answered. The counter line says the same: 4 queries on the wire, 3 NXDOMAIN replies. With the trailing dot there was a single query. In both cases the application got the same address.

This lab asked for IPv4 only. As general knowledge, not shown by this lab: a dual-stack program normally asks for both A and AAAA records, which would double each of those counts. General knowledge, also not measured here: in a busy cluster those failed suffix queries are extra traffic that the cluster's DNS server has to answer.

There are three ways to cut it down:

1. **Write the name fully qualified**, with the trailing dot, in code that you control.
2. **Lower \`ndots\`** for the pod. The Kubernetes docs say a pod's \`dnsConfig\` accepts an \`options\` list of name and optional value, merged into the options the DNS policy generated. The next lab shows the effect of \`ndots:1\`.
3. **Use names with enough dots.** A name with five or more dots goes out as written. This is awkward for most real hostnames.

Lowering ndots has a cost, and it follows from the rule. With \`ndots:1\`, a name such as \`data.ns\` (a Service in another namespace) has one dot, so it goes out as written first and is only expanded with the search list after that fails. This bench did not run that case, so it is an application of the rule, not an observation.`,
        },
        {
          lab: {
            explain: 'Same lookup with options ndots:1 (expect one query for example.com)',
            cmd: `${NEED_63}
printf 'search ns.svc.cluster.local svc.cluster.local cluster.local\\noptions ndots:1\\nnameserver 10.63.0.53\\n' > /etc/netns/n63c/resolv.conf
${START_DNS}; sleep 0.5
${Q}
echo "# example.com with ndots:1"; q example.com
kill $(cat /tmp/n63.pid); echo "dnsmasq stopped"`,
          },
        },
        {
          md: `One query, answered. The search list is still there, but \`example.com\` has one dot, which meets the threshold of 1, so it is sent as written first and succeeds. Nothing else changed between this lab and the last one except the \`ndots\` value, so the extra queries in the previous lab came from the threshold.

Note what this does not tell you: it does not show a real cluster. The bench reproduces the resolver's behaviour with the file the Kubernetes docs describe. Your cluster's search list, DNS server and caching may differ.`,
        },
      ],
    },
    {
      id: 'twins',
      title: "Where you've met this",
      blocks: [
        {
          md: `**Kubernetes.** This is the \`ndots:5\` effect above. It is sourced from the Kubernetes DNS docs. kubelet generates the file, and the three search entries (namespace, \`svc\`, cluster domain) are what let a short Service name work.

**AWS VPC.** A DHCP option set has a **domain name** field, described by AWS as the domain name a client uses when resolving hostnames using DNS. How that value becomes a \`search\` line differs by operating system and DHCP client, which this chapter did not check, so treat "the option set's domain name appears in the search list" as the usual expectation and look at \`/etc/resolv.conf\` on your own instance to confirm. \`ndots\` is not part of a DHCP option set; it is a resolver setting.

**Proxmox.** The search domain is a host or guest setting. On a Linux guest it ends up as the \`search\` line in \`/etc/resolv.conf\`. This is general knowledge and was not checked against Proxmox documentation.`,
        },
      ],
    },
    {
      id: 'keep',
      title: 'What to keep',
      blocks: [
        {
          md: `- \`search\` lists suffixes to append, and \`ndots:n\` is the threshold. A name with **fewer than n dots** tries the suffixes first and itself last. A name with **n or more dots** is tried as written first.
- The default is \`ndots:1\`. Kubernetes pods get \`ndots:5\`, so \`example.com\` costs four queries (three NXDOMAIN) in the bench.
- A trailing dot (\`example.com.\`) is absolute: no search, one query.
- Per-namespace \`resolv.conf\` for experiments: \`/etc/netns/<name>/resolv.conf\`, picked up by \`ip netns exec\`.
- To see what the resolver really sends, capture port 53. The name you typed is not the name on the wire.`,
        },
      ],
    },
  ],
};
