// Chapter 6.1: DHCP. Authored content; the tutor gets this file as chapter_source.
// Labs run in netlab (Ubuntu 26.04, iproute2 6.19, dnsmasq 2.92, dhcpcd 10.3.0) on 2026-10-25; outputs described in the prose were observed.
// dnsmasq (package dnsmasq-base) was added to PACKAGES in labs/setup-netlab.sh for this chapter. It is the DHCP server in the labs; dhcpcd is the client.
// Sources: https://datatracker.ietf.org/doc/html/rfc2131 (message flow, BROADCAST flag, giaddr and relay agents, T1/T2 renewal and rebinding),
//   https://docs.aws.amazon.com/vpc/latest/userguide/VPC_DHCP_Options.html (option sets control DNS servers, domain name, NTP servers),
//   https://docs.aws.amazon.com/vpc/latest/userguide/DHCPOptionSetConcepts.html (fields of a custom option set),
//   https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html (security groups do not filter Amazon DHCP and DNS traffic).
//   https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/ (kubelet configures each Pod's /etc/resolv.conf).
// Not sourced, so hedged in the text: how pods get addresses, how Proxmox guests get addresses.

const NEED_61 = `ip netns list | grep -qw n61c || { echo "Run the first lab (build the DHCP link) first."; exit 1; }`;

// Starts dnsmasq as a DHCP-only server (--port=0 turns its DNS off) inside n61s, on v61s only.
const START_SERVER = `ip netns exec n61s dnsmasq --port=0 --user=root --interface=v61s --bind-interfaces --no-ping --dhcp-range=10.61.0.100,10.61.0.110,120s --dhcp-option=option:router,10.61.0.1 --dhcp-option=option:dns-server,10.61.0.53 --dhcp-option=option:domain-name,lab.test --dhcp-leasefile=/tmp/n61.leases --pid-file=/tmp/n61.pid`;

export default {
  node: 'dhcp',
  number: '6.1',
  kicker: 'Services',
  title: 'DHCP',
  lede: 'A host that has just joined a network has no address to send from and no idea who could give it one. DHCP is the conversation that gets it out of that position.',
  sections: [
    {
      id: 'nothing',
      title: 'A host with nothing',
      blocks: [
        {
          md: `You already know two things that make this problem hard. A packet needs a source and a destination IP before it can leave a NIC (UDP is no exception, see the UDP chapter).

Now boot a new VM on a segment where a DHCP server exists somewhere. The link is up. The host has a MAC address, and that is all. It has no IP, no subnet mask, no default gateway, no DNS server, and it has never heard the server's address.

It still has to send one packet to start the conversation. Every field in that packet's IP header has to be filled in with something.`,
        },
        {
          checkpoint: {
            id: 'c1',
            prompt: 'What are the source and destination IP addresses of the first DHCP packet the new host sends?',
            options: [
              'Unicast to the default gateway: the gateway is where unknown traffic goes',
              'Self-assigned 169.254.x.x to the subnet broadcast: it must pick a link-local address first',
              'Source 0.0.0.0, destination 255.255.255.255: no address, no known server',
              'Unicast to the well-known DHCP server address: that address is built into every client',
            ],
            key: 2,
            why: 'The host has no address, so the only source it can use is 0.0.0.0. It knows no server and no subnet, so the only destination that still reaches a server on the same link is the limited broadcast 255.255.255.255.',
          },
        },
        {
          md: `This is the hard part of DHCP, and the rest of the protocol is built around it. The client sends from \`0.0.0.0\` to \`255.255.255.255\`, the "this network, everyone" address.

Two port numbers keep the conversation recognisable. A DHCP server listens on UDP **67** and a client uses UDP **68**. The client binds port 68 before it has an address, so the DHCP reply can find it.

> [!IMPORTANT]
> The first DHCP packet is a limited broadcast: source \`0.0.0.0\`, destination \`255.255.255.255\`, UDP 68 → 67.`,
        },
      ],
    },
    {
      id: 'dora',
      title: 'Four messages: DORA',
      blocks: [
        {
          md: `The conversation has four messages. The first letters give the usual name, **DORA**.

\`\`\`
client                                         server
  |-- DISCOVER: is any DHCP server here? ------>|
  |<----- OFFER: here is an address + options --|
  |-- REQUEST: I take this offer -------------->|
  |<----- ACK: it is yours for the lease time --|
\`\`\`

The DISCOVER asks the segment for any server. An OFFER proposes an address and the options that go with it: subnet mask, router (the default gateway), DNS servers, domain name, and so on. The REQUEST names the offer the client accepts, and the ACK confirms it and starts the lease clock. Only after the ACK does the client configure the address on its interface.

The labs in this chapter use **dhcpcd** as the client and **dnsmasq** as the server. The next checkpoint is about the Ethernet destination of each of the four in a capture of that pair.`,
        },
        {
          checkpoint: {
            id: 'c2',
            prompt: 'In a capture of one full DORA between dhcpcd (client) and dnsmasq (server), which messages go to the broadcast MAC ff:ff:ff:ff:ff:ff?',
            options: [
              'All four broadcast: the client has no address until the ACK, so nothing can be unicast to it',
              'Only the DISCOVER: once a server answered, both sides know each other and use unicast',
              'The two server messages: the server has to shout because the client cannot be addressed',
              'The two client messages: the server replies straight to the client’s MAC',
            ],
            key: 3,
            why: 'For this pair, the client never knows a server MAC before the exchange ends, so both of its messages are broadcast, while dnsmasq addresses its replies to the client MAC it learned from the DISCOVER. A client that sets the BROADCAST flag asks for broadcast replies, so other pairs can differ.',
          },
        },
        {
          md: `Build a small test bench to see it. Two network namespaces are joined by one veth pair: **n61s** is the server (10.61.0.1) and **n61c** is the client, which starts with no address. dnsmasq runs as the server with a pool of 10.61.0.100 to 10.61.0.110, a 120-second lease, a router option (10.61.0.1), a DNS server option (10.61.0.53) and a domain name (\`lab.test\`). dnsmasq is not installed in a stock Ubuntu, so netlab's setup script now installs it. The client is \`dhcpcd\`, a real DHCP client. The capture runs on the client side and the lab prints one line per packet with its Ethernet destination.`,
        },
        {
          lab: {
            explain: 'Build the link, run dnsmasq, capture one DHCP exchange on the client (expect 4 lines)',
            cmd: `for n in n61s n61c n61d n61x; do ip netns del $n 2>/dev/null; done; for l in v61s v61c v61d v61x; do ip link del $l 2>/dev/null; done; sleep 0.5
for n in n61s n61c; do ip netns add $n; ip netns exec $n sysctl -qw net.ipv6.conf.all.disable_ipv6=1 net.ipv6.conf.default.disable_ipv6=1; done
ip link add v61s netns n61s type veth peer name v61c netns n61c
ip -n n61s addr add 10.61.0.1/24 dev v61s; ip -n n61s link set v61s up; ip -n n61c link set v61c up
echo "client before: [$(ip -n n61c -4 -br addr show v61c | awk '{print $3}')]"
: > /tmp/n61.leases; ${START_SERVER}
sleep 0.5
ip netns exec n61c timeout 8 tcpdump -nelv -i v61c -c 4 udp port 67 or udp port 68 > /tmp/n61.cap 2>/dev/null & TP=$!
sleep 1
ip netns exec n61c dhcpcd -4 -1 -A -y 0 -G -C resolv.conf v61c >/dev/null 2>&1
wait $TP
awk '/^[0-9][0-9]:/{l2=$4; sub(/,/,"",l2)} /BOOTP\\/DHCP/{ip=$1" "$2" "$3} /DHCP-Message/{printf "%-8s L2 dst %-17s  %s\\n", $NF, l2, ip}' /tmp/n61.cap
echo "--- options in the ACK"
sed -n '/: ACK/,$p' /tmp/n61.cap | grep -E 'Lease-Time|RN |RB |Subnet-Mask|Domain-Name|Default-Gateway' | sed 's/^[[:space:]]*//'
echo "client after: $(ip -n n61c -4 -br addr show v61c | awk '{print $3}')"
kill $(cat /tmp/n61.pid); echo "dnsmasq stopped"`,
          },
        },
        {
          md: `Read the four lines against the diagram. The DISCOVER and the REQUEST are broadcasts at both layers: Ethernet destination \`ff:ff:ff:ff:ff:ff\`, IP \`0.0.0.0\` to \`255.255.255.255\`. The OFFER and the ACK go to the client's own MAC and to the address it is being offered, even though the client has not configured that address yet. The client's NIC accepts the frame because the MAC matches. General knowledge, not shown by this lab: a client with no configured address can still read the reply because DHCP clients such as dhcpcd receive it on a raw packet socket instead of through the normal IP stack.

That unicast reply is a choice, not a law. RFC 2131 gives the client a BROADCAST flag it can set to ask for broadcast replies, "a client that cannot receive unicast IP datagrams until its protocol software has been configured with an IP address SHOULD set the BROADCAST bit". In this capture the flags field printed \`Flags [none]\`, so dhcpcd did not ask for broadcast replies and dnsmasq answered with unicast. With other client and server pairs, the OFFER and ACK could look different. This lab tested one pair.

Why does the REQUEST still broadcast? The sensible reason is that the client might have heard offers from several servers. A broadcast tells all of them which offer was taken, and the others can free the address they had held. That is reasoning from the protocol, not something this capture shows: only one server was running here.

The ACK also carried the settings the client uses. The lease time is 120 seconds, the subnet mask, the DNS server (10.61.0.53), the default gateway (10.61.0.1) and the domain name. DHCP delivers all of them in the same reply as the address. The address came from the pool 10.61.0.100 to 10.61.0.110, and which of the 11 it picks differs from run to run, so yours may not match the one in the output.`,
        },
      ],
    },
    {
      id: 'lease',
      title: 'Leases, and finding the server',
      blocks: [
        {
          md: `The address is not given away, it is **leased**. The server records who holds which address and until when, and the client has to renew before the lease runs out. The ACK told the client two renewal times along with the lease. dnsmasq set a 120 s lease with timers of 60 s (\`RN\`, renewing) and 105 s (\`RB\`, rebinding), which are 50% and 87.5% of the lease. RFC 2131 describes the roles. At T1 the client sends a unicast REQUEST to the server that gave it the address. At T2 it gives up on that server and broadcasts to any server. The values in this lab are what dnsmasq chose.

The next lab reads the server's lease record and the client's view of the same lease, and does the arithmetic. It works only while the lease is still valid, so run it within two minutes of the first lab.`,
        },
        {
          lab: {
            explain: 'Compare the server’s lease record with what the client holds',
            cmd: `${NEED_61}
read exp mac ip host cid < /tmp/n61.leases
echo "server record: $ip held by $mac, host '$host'"
echo "server says it expires in: $((exp - $(date +%s))) s"
v=$(ip -n n61c -4 addr show v61c | grep -o 'valid_lft [0-9a-z]*')
[ -n "$v" ] && echo "client holds: $ip with $v" || echo "client holds nothing: the 120 s lease already ran out (run the first lab again)"
ip -n n61c -4 addr show v61c | grep -o 'preferred_lft [0-9a-z]*'`,
          },
        },
        {
          md: `Right after the ACK, the server's expiry and the client's \`valid_lft\` both read 120, the lease time from the ACK. The client's number is a kernel countdown: reading it again a minute later gives a smaller value. The client's \`preferred_lft\` started at 105, the same number as \`RB\` above. That matches the numbers, but the lab did not isolate why, and it may be how dhcpcd sets it.

Nothing in this lab renews the lease, because \`dhcpcd -1\` exits after getting the address. A real client keeps running and renews at T1. If the client goes away, the server takes the address back when the lease expires and may give it to someone else. The lease is also why DHCP ranges can be smaller than the host count: addresses of hosts that left come back.

Now the other half of the problem. DISCOVER is a limited broadcast, so what if the server is on a different link from the client? Put a second client, **n61d**, on a link of its own: a veth pair whose other end sits in an empty namespace, so there is no server on it. The server is running on its own link, on the same machine. The lab starts dnsmasq again and captures on both links. The server's link also carries DHCP from the first client **n61c**, which gets a fresh lease in the same capture.`,
        },
        {
          checkpoint: {
            id: 'c3',
            prompt: 'The isolated client keeps trying for a few seconds. How many DHCP packets from its MAC does dnsmasq’s link see?',
            options: [
              'Nothing arrives: a broadcast stays on the link it was sent into',
              'Every DISCOVER arrives: both links are in one machine, so they share a broadcast domain',
              'Later retries arrive: after a timeout the client falls back to the last server it knew',
            ],
            key: 0,
            why: 'A limited broadcast is not forwarded between links, and nothing in this setup relays it. The server’s link sees only what the other client (which is on that link) sends.',
          },
        },
        {
          lab: {
            explain: 'Isolated client n61d tries for 4 s while n61c gets a lease; count each MAC on the server’s link (expect 0 for n61d)',
            cmd: `${NEED_61}
ip netns add n61d 2>/dev/null; ip netns add n61x 2>/dev/null
ip netns exec n61d sysctl -qw net.ipv6.conf.all.disable_ipv6=1 net.ipv6.conf.default.disable_ipv6=1
ip link show v61d >/dev/null 2>&1 || ip link add v61d netns n61d type veth peer name v61x netns n61x
ip -n n61d link set v61d up; ip -n n61x link set v61x up
ip -n n61c addr flush dev v61c
MC=$(ip -n n61c -br link show v61c | awk '{print $3}'); MD=$(ip -n n61d -br link show v61d | awk '{print $3}')
: > /tmp/n61.leases; ${START_SERVER}
sleep 0.5
ip netns exec n61s timeout 6 tcpdump -nl -i v61s udp port 67 > /tmp/n61.srv 2>/dev/null & P1=$!
ip netns exec n61d timeout 6 tcpdump -nl -i v61d udp port 67 > /tmp/n61.dcap 2>/dev/null & P2=$!
sleep 1
ip netns exec n61c dhcpcd -4 -1 -A -y 0 -G -C resolv.conf v61c >/dev/null 2>&1
ip netns exec n61d timeout 4 dhcpcd -4 -1 -A -y 0 -t 3 -G -C resolv.conf v61d >/dev/null 2>&1
wait $P1; wait $P2
echo "server link, from n61c (control, expect >0): $(grep -c "from $MC" /tmp/n61.srv)"
echo "server link, from n61d (expect 0):           $(grep -c "from $MD" /tmp/n61.srv)"
echo "n61d's own link, from n61d (control, expect >0): $(grep -c "from $MD" /tmp/n61.dcap)"
echo "n61d address: [$(ip -n n61d -4 -br addr show v61d | awk '{print $3}')]"
kill $(cat /tmp/n61.pid); echo "dnsmasq stopped"`,
          },
        },
        {
          md: `The isolated client's DISCOVER (one in this window) was visible on \`v61d\`, which proves that capture was running. None showed up on the server's link, where the other client's two packets did (its DISCOVER and REQUEST), so that capture was running too. The isolated client ends with no address. Nothing answered because no server saw its broadcast.

In real networks the server is often *not* on the client's segment. Running a server per VLAN would be unmanageable, so a router (or L3 switch) on the client's segment acts as a **relay agent**. It listens for the broadcast, then forwards it as a unicast to a configured server and writes its own address on that segment into the packet's \`giaddr\` field. RFC 2131 says the server uses that field to pick the pool: the address is chosen "based on the subnet from which the message was received (if 'giaddr' is 0) or on the address of the relay agent that forwarded the message ('giaddr' when not 0)". This lab did not run a relay, so the relay mechanics here come from the RFC, not from a capture.

Routers do not forward the limited broadcast 255.255.255.255 (general knowledge, consistent with nothing crossing between the two links here), which is why the server has to be on the client's segment or reachable through a relay.

> [!IMPORTANT]
> DHCP needs the server in the client's broadcast domain, or a relay agent in it that forwards the DISCOVER by unicast and sets \`giaddr\`.`,
        },
      ],
    },
    {
      id: 'twins',
      title: "Where you've met this",
      blocks: [
        {
          md: `**AWS VPC.** A VPC hands out addresses with DHCP, and the settings come from a **DHCP option set** attached to the VPC. AWS's documentation says option sets control the DNS servers, domain name and NTP servers used by the devices in your VPC, and a custom option set has fields for domain name servers, domain name, NTP servers, plus NetBIOS settings for Windows. You do not run the server. AWS documents that security groups do not filter Amazon DHCP and Amazon DNS traffic, so a locked-down security group does not stop an instance from getting its address. How the VPC delivers DHCP to the instance is not documented here. The safe mental model is that it behaves like a DHCP server the VPC runs for you, with the broadcast handled by the platform. Chapter 2.9 covers why a VPC has no real L2 broadcast domain.

**Kubernetes.** Pods do not normally run a DHCP client. The CNI plugin assigns the pod IP when the pod's network is set up, and kubelet writes the pod's \`resolv.conf\` (the second part is in the Kubernetes DNS docs). The CNI part is general knowledge and was not checked in this chapter. Node addresses still usually come from DHCP or static configuration, the same as any VM.

**Proxmox.** A guest asks for an address like any other host. Whatever DHCP server is on the guest's VLAN answers, and on many networks that is the physical router. A bridge forwards the broadcast like a switch does, so the same rules as above apply, and the VLAN is the broadcast domain. This is general knowledge from how bridges work and was not tested here; Proxmox's own SDN/IPAM DHCP features were not checked.`,
        },
      ],
    },
    {
      id: 'keep',
      title: 'What to keep',
      blocks: [
        {
          md: `- A client with no address sends DISCOVER from \`0.0.0.0\` to \`255.255.255.255\`, UDP 68 → 67, and a broadcast does not leave its segment.
- DORA: DISCOVER, OFFER, REQUEST, ACK. The address and the options (mask, gateway, DNS, domain) arrive together in the OFFER and ACK.
- Addresses are leased. Renewal starts at T1 with a unicast to the same server, and rebinding at T2 with a broadcast to any server.
- A server on another segment needs a relay agent that unicasts the request on and sets \`giaddr\`.
- In AWS, DHCP option sets are how you change the DNS servers, domain name and NTP servers that instances get.`,
        },
      ],
    },
  ],
};
