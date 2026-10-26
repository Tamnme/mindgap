// Chapter 2.9: Why a VPC has no L2 broadcast. Authored content; the tutor gets this file as chapter_source.
// Labs run in netlab (Ubuntu 26.04, iproute2 6.19) on 2026-10-25; outputs described in the prose were observed.
// Sources: https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html (reserved addresses: "10.0.0.255: Network broadcast address. We do not support broadcast in a VPC, therefore we reserve this address."),
//   https://docs.aws.amazon.com/vpc/latest/tgw/tgw-multicast-overview.html (Transit Gateway multicast: multicast domains, IGMPv2 and static membership, "You must create a new transit gateway to support multicast",
//   not supported over Direct Connect, Site-to-Site VPN, peering or Connect attachments),
//   https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/MultipleIP.html (use case: "Redirect internal traffic to a standby instance in case your instance fails, by reassigning the secondary IP address to the standby instance"),
//   https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/scenarios-enis.html (ENI re-attached to a standby keeps its private IPs, Elastic IPs and MAC address; "no changes to the route table or your DNS server are required"),
//   https://pve.proxmox.com/wiki/Network_Configuration (routed example sets proxy_arp on the host NIC).
// Hedged, not sourced: how the VPC answers ARP for an instance (AWS does not publish it), what a VPC does with a gratuitous ARP frame an instance sends (the fetched pages are silent),
//   route-table updates as a failover method (the fetched route-table pages list targets but don't describe failover), the Kubernetes note, and the claim that VRRP works on Proxmox (not run here).
// The proxy_arp lab is a mental model of "something else answers ARP for you", not AWS's implementation.

const NEED = `ip netns list | grep -q n29r || { echo "Run the first lab (build n29a/n29r/n29b) first."; exit 1; }`;
// Trim a tcpdump -e ARP line to the parts we discuss.
const TRIM = `sed -E 's/^[0-9:.]+ //; s/ethertype ARP \\(0x0806\\), //; s/, length [0-9]+//g'`;

export default {
  node: 'vpc-no-l2-broadcast',
  number: '2.9',
  kicker: 'Layer 2',
  title: 'Why a VPC has no L2 broadcast',
  lede: 'On a Proxmox bridge your VMs share a real Ethernet segment. In a VPC they don\'t: something else delivers every packet, and several tricks that need a shared segment stop working.',
  sections: [
    {
      id: 'segment',
      title: 'A segment that isn\'t one',
      blocks: [
        { md: `Chapter 2.8 ended with two things that only work on a segment where a broadcast reaches everyone: ARP's "who has", and a gratuitous ARP that rewrites every neighbour's cache. Both quietly assume a shared wire, or a switch acting like one.

An EC2 instance in a subnet looks like it has that. It has an IP in a /24, a default gateway, and an \`ip neigh\` table. So it's reasonable to expect the subnet to behave like a VLAN with a switch behind it.

AWS's subnet documentation lists the addresses it reserves in every subnet. For a 10.0.0.0/24 subnet, the list is: the network address, three addresses AWS uses itself (the VPC router, DNS, and one held for future use), and the **last** address, 10.0.0.255.` },
        {
          checkpoint: {
            id: 'c1',
            prompt: 'Why does AWS reserve that last address, 10.0.0.255, in every subnet?',
            options: [
              'It is the broadcast address, reserved because AWS doesn\'t support broadcast',
              'It is where the VPC\'s ARP responder lives: instances ARP for it to find neighbours',
              'It is a standby gateway address, held for the VPC router\'s failover pair',
              'It is held for a DHCP relay, so DHCP broadcasts have somewhere to go',
            ],
            key: 0,
            why: 'The subnet-sizing page says it outright: 10.0.0.255 is the "Network broadcast address. We do not support broadcast in a VPC, therefore we reserve this address."',
          },
        },
        { md: `That sentence is the whole premise of the chapter: AWS states it doesn't support broadcast in a VPC. The last address of a /24 is the one a real Ethernet segment would use for it, and AWS keeps it out of reach.

Multicast is a separate story. Transit Gateway offers **multicast domains** as an opt-in feature: you associate subnets with a multicast domain, and individual network interfaces join groups through IGMPv2 or static (API-based) membership, and the docs say you must create a new transit gateway to support it. It's a distinct service you switch on, not something a subnet gives you. The same page says multicast routing isn't supported over Direct Connect, Site-to-Site VPN, peering attachments or Connect attachments.

> [!IMPORTANT]
> A VPC is not a shared Ethernet segment. Don't build anything that needs a broadcast or a multicast to reach the other instances, unless you've set up Transit Gateway multicast for it.` },
      ],
    },
    {
      id: 'model',
      title: 'A model to reason with',
      blocks: [
        { md: `Instances in a VPC still ARP, as 2.8 said. AWS doesn't publish how they get answered. What you can do is build a *model* of one possibility with a Linux router feature, \`proxy_arp\`, which the PVE wiki's routed example sets on the host NIC.

**This lab is a mental model only.** It is not how the VPC is built, and it doesn't claim to be.

Topology: **A** has \`10.29.0.1/16\`. That /16 makes A believe \`10.29.1.2\` is on its own segment. **B** really is \`10.29.1.2\`, but on a different link behind a router that has \`10.29.0.254/24\` toward A and \`10.29.1.254/24\` toward B. The router forwards, and A has no gateway configured, because A thinks B is on-link.

First, with nothing special on the router, A pings B.` },
        {
          lab: {
            explain: 'Build A (/16), router and B on separate links, then A pings B with no proxy_arp (expect no reply)',
            cmd: `for n in n29a n29r n29b; do ip netns del $n 2>/dev/null; done
for v in v29a v29b; do ip link del $v 2>/dev/null; done; sleep 0.5
for n in n29a n29r n29b; do ip netns add $n; ip netns exec $n sysctl -qw net.ipv6.conf.all.disable_ipv6=1 net.ipv6.conf.default.disable_ipv6=1; done
ip link add v29a type veth peer name eth0 netns n29a; ip link set v29a netns n29r name eth0
ip link add v29b type veth peer name eth0 netns n29b; ip link set v29b netns n29r name eth1
for n in n29a n29b; do ip -n $n link set eth0 up; done; ip -n n29r link set eth0 up; ip -n n29r link set eth1 up
ip -n n29a addr add 10.29.0.1/16 dev eth0
ip -n n29r addr add 10.29.0.254/24 dev eth0; ip -n n29r addr add 10.29.1.254/24 dev eth1
ip -n n29b addr add 10.29.1.2/24 dev eth0; ip -n n29b route add default via 10.29.1.254
ip netns exec n29r sysctl -qw net.ipv4.ip_forward=1
sleep 1
echo "A's route to B: $(ip -n n29a route get 10.29.1.2 | head -1)"
echo "proxy_arp on router eth0: $(ip netns exec n29r sysctl -n net.ipv4.conf.eth0.proxy_arp)"
echo "replies received: $(ip netns exec n29a ping -c1 -W2 10.29.1.2 | grep -c 'bytes from')"
ip -n n29a neigh show 10.29.1.2`,
          },
        },
        { md: `A thinks B is directly reachable (the route says \`dev eth0\`, no gateway) and it ARPs for B. The request goes out on A's link, which ends at the router. B isn't on that link, so it never hears the request, and nobody answers. Zero replies, and the entry stays INCOMPLETE.

Now turn on \`proxy_arp\` on the router's \`eth0\`, flush A's table, and ping again with a capture on A. The lab also prints the router's eth0 MAC and B's MAC.` },
        {
          checkpoint: {
            id: 'c2',
            prompt: 'With proxy_arp on, A ARPs for 10.29.1.2. Which MAC does A end up caching for it?',
            options: [
              'B\'s own MAC: B answers once it receives the request',
              'Nothing: the request still gets no answer, because B is on another link',
              'The router\'s MAC: the router answers for an address it can reach',
              'Broadcast address (ff:ff:ff:ff:ff:ff): the router has no MAC for B, so A falls back to broadcast',
            ],
            key: 2,
            why: 'B is not on A\'s link, so B can\'t answer. With proxy_arp, the router replies with its own MAC. A then sends its frames for 10.29.1.2 to the router, which forwards them.',
          },
        },
        {
          lab: {
            explain: 'Turn on proxy_arp on the router, flush A\'s table, ping B again with an ARP capture on A, then compare MACs',
            cmd: `${NEED}
ip -n n29a neigh flush all
ip netns exec n29r sysctl -qw net.ipv4.conf.eth0.proxy_arp=1
ip netns exec n29a timeout 4 tcpdump -nel -i eth0 arp 2>/dev/null | ${TRIM} &
sleep 1; ip netns exec n29a ping -c1 -W2 10.29.1.2 | sed -n 2p; wait
echo "--- A's table:"; ip -n n29a neigh show
echo "router eth0 = $(ip -n n29r -br link show eth0 | awk '{print $3}')"
echo "B eth0      = $(ip -n n29b -br link show eth0 | awk '{print $3}')"`,
          },
        },
        { md: `\`proxy_arp\` makes the router answer ARP requests on behalf of addresses it can route to, when they're behind a different interface. The reply to A's "who has 10.29.1.2" comes from the router's MAC, and A's table maps \`10.29.1.2\` to that MAC, not to B's. The ping succeeds (the first output line), with \`ttl=63\`: one hop, because the router forwarded it. A never learned B's real MAC and never needed it.

That's the shape of the idea: the owner of an address isn't the one answering ARP, and the sender doesn't care, because it only wants a MAC to put in a frame. AWS doesn't say whether the VPC does anything like this. The safe mental model, as in 2.2, is **programmed, not learned**: the network already knows where every ENI is and delivers to it directly.

> [!IMPORTANT]
> Whoever answers ARP only has to supply a MAC that gets the frame delivered. It need not be the owner's. So in a VPC, an ARP answer is not proof of who sits behind an IP; AWS doesn't document what an instance's neighbour table holds, so check with \`ip neigh\`.` },
      ],
    },
    {
      id: 'failover',
      title: 'What breaks, and what AWS gives you instead',
      blocks: [
        { md: `Think of a pair of servers sharing a virtual IP with keepalived and VRRP. When the active one dies, the standby takes over the VIP and sends a **gratuitous ARP**, as in the last lab of 2.8, so every neighbour's cache switches to the standby's MAC. That recipe needs a segment where the broadcast reaches every neighbour. What a VPC does with a gratuitous ARP an instance sends isn't covered in the AWS pages cited here, so don't design around it, and don't assume it works.

AWS documents other ways to move an address. In the EC2 docs, one stated use case for secondary private IPs is to "Redirect internal traffic to a standby instance in case your instance fails, by reassigning the secondary IP address to the standby instance." In the network-interface docs, there's a hot-standby pattern: re-attach the failed instance's ENI to a replacement instance.` },
        {
          checkpoint: {
            id: 'c3',
            prompt: 'You re-attach a failed instance\'s ENI to a hot standby. Why do no neighbour ARP caches need updating?',
            options: [
              'The VPC floods a gratuitous ARP from the standby to every neighbour for you',
              'The interface keeps its MAC as well as its IPs, so cached entries stay correct',
              'Instances in a VPC never cache ARP entries, so there is nothing to update',
              'The standby copies the dead instance\'s MAC onto a different interface itself',
            ],
            key: 1,
            why: 'The docs say the ENI keeps its private IPs, Elastic IPs and MAC address. If the MAC stays the same, every cached IP-to-MAC pair is still right and nothing has to be announced.',
          },
        },
        { md: `The same page says the interface "maintains its private IP addresses, Elastic IP addresses, and MAC address", and that "no changes to the route table or your DNS server are required". That's the contrast with the VRRP recipe. On a shared segment you move the IP and *announce a new MAC*. With an ENI move, the MAC travels with the IP, so there's nothing to announce. Reassigning a secondary IP to a different instance's ENI is the other documented route. Whether neighbours then see a new MAC is not described in the AWS page cited here, so test with \`ip neigh\` on an instance rather than assuming either answer.

A third pattern is a route-table update: point a route's target at the standby, as a failover script would. The route-table pages cited here list the possible targets but don't describe failover, so treat this one as a common pattern, not a documented recipe, and check the current docs for which targets a route can take.

> [!IMPORTANT]
> In a VPC, fail over by moving the thing the network tracks (an ENI, a secondary IP, or a route target), not by announcing a MAC. A gratuitous ARP is an L2 broadcast, and AWS says it doesn't support broadcast in a VPC.` },
      ],
    },
    {
      id: 'twins',
      title: "Where you've met this",
      blocks: [
        { md: `**Proxmox.** The contrast case. VMs on one \`vmbr0\` share a real L2 segment (2.7), and broadcast and gratuitous ARP work, as the labs in 2.8 showed on a Linux bridge. VRRP rides on the same multicast-capable segment, so keepalived should work between two VMs on a bridge. That wasn't run in these chapters. The PVE routed example uses \`proxy_arp\`, the same knob as the model above.

**AWS.** Subnet-level behaviour: no broadcast, an opt-in Transit Gateway multicast feature for the cases that need it, and ENI or IP moves for failover. How ARP is answered inside the VPC isn't published.

**Kubernetes.** On AWS, anything that needs L2 adjacency, such as keepalived-style VIPs or gratuitous-ARP failover, runs into the same limit in general. Use a cloud-native mechanism (an ENI or IP move, a load balancer) instead; this chapter doesn't verify any specific CNI's behaviour.` },
      ],
    },
    {
      id: 'keep',
      title: 'What to keep',
      blocks: [
        { md: `- AWS states it does not support broadcast in a VPC, and reserves each subnet's last address because of it. Transit Gateway multicast is a separate opt-in feature.
- Something other than a shared wire delivers packets and answers ARP. AWS doesn't publish how. \`proxy_arp\` is only a model of the idea.
- Gratuitous ARP and VRRP assume a shared segment. Don't rely on them in a VPC.
- Move the ENI, move a secondary IP, or change a route target instead. An ENI move keeps the MAC, so no cache needs updating.` },
      ],
    },
  ],
};
