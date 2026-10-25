// Chapter 1.1: Links, NICs and virtual cables. Authored content; the tutor gets this file as chapter_source.
// Labs run in netlab (Ubuntu 26.04, iproute2 6.19) on 2026-10-25; outputs described in the prose were observed (twice, in order).
// Sources:
//   https://man7.org/linux/man-pages/man4/veth.4.html (veth devices are created in pairs; packets sent on one end are immediately received on the other; either end down means the pair's link state is down)
//   https://docs.cilium.io/en/stable/network/concepts/routing/ (pod eth0 is one end of a veth pair named lxcXXXXXX in the host namespace; shown in its AWS ENI section)
//   https://pve.proxmox.com/wiki/Network_Configuration (vmbr0 is a software bridge on the first Ethernet card, e.g. eno1; the network sees each VM with its own MAC)
//   https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-eni.html (an ENI is a logical component representing a virtual network card, with a MAC address)
// Hedged, not sourced: "tap device per VM NIC on Proxmox" (standard KVM behaviour, not read in the page fetched); that AWS exposes no physical link state.
// The brief mentions LOWERLAYERDOWN; it did not appear for a veth in netlab (ip shows NO-CARRIER and state DOWN), so the chapter uses what was observed.

const NEED_N11 = `ip netns list | grep -q n11a || { echo "Run the first lab first."; exit 1; }`;

export default {
  node: 'l1-links-nics',
  number: '1.1',
  kicker: 'Physical',
  title: 'Links, NICs and virtual cables',
  lede: 'A NIC puts bits on a link and takes bits off it, and it neither knows nor cares what is addressed to whom. A veth pair is that link made of software.',
  sections: [
    {
      id: 'cable',
      title: 'A link is a cable with two ends',
      blocks: [
        { md: `Strip away every protocol and a network is two things: **interfaces** (NICs) and **links** between them. A link joins exactly two ends. What the sender puts on one end comes out of the other.

On a real machine that cable is copper or fibre. In Linux there is a software cable too, the **veth pair**: two interfaces created together, joined internally.

\`\`\`
  namespace A                           namespace B
 +-----------+                         +-----------+
 |  v11a     |<======== veth ========>|  v11b     |
 +-----------+                         +-----------+
\`\`\`

The useful trick is that the two ends can sit in *different network namespaces*. A namespace has its own interfaces, routes and ARP table, so a veth pair is a patch cable between two isolated network stacks. The kernel manual says it directly: packets transmitted on one device are immediately received on the other.

Every container runtime and CNI relies on this. A pod lives in its own namespace, and a veth pair is how it reaches the node. Picture one: the pod's \`eth0\` is one end. The other end is somewhere else.` },
        {
          checkpoint: {
            id: 'c1',
            prompt: 'A pod on a Cilium node sends a packet to another node. Which interface on the node receives that packet first?',
            options: [
              'The node’s physical NIC (e.g. ens5): it is the way out, so the packet goes straight there',
              'The host-side end of the pod’s veth pair: the cable from the pod ends there',
              'The cilium_vxlan device: overlay traffic is picked up by the tunnel first',
              'The node’s default gateway: the pod addresses it directly',
            ],
            key: 1,
            why: 'The pod’s only link is its veth. Whatever leaves eth0 comes out of the other end of the pair, in the node’s root namespace. Routing and the physical NIC come after that.',
          },
        },
        { md: `It lands on the other end of the cable, which is an interface in the node's root namespace. Cilium's documentation names it: the pod's \`eth0\` is one end of the pair, and the other end is called \`lxcXXXXXX\` in the host namespace. Only after the packet has come out of that \`lxc…\` interface do the eBPF programs, the routing table and the physical NIC get involved.

So the physical NIC is not the pod's first hop. It is the node's own link, one more port on the node's side. The pod never touches it directly.

Build a cable of your own. The first lab makes two namespaces joined by a veth pair, gives each end an address, and pings across.` },
        {
          lab: {
            explain: 'Build namespaces n11a and n11b joined by a veth pair; show both ends and ping across',
            cmd: `for n in n11a n11b; do ip netns del $n 2>/dev/null; done
for n in n11a n11b; do ip netns add $n; ip netns exec $n sysctl -qw net.ipv6.conf.all.disable_ipv6=1 net.ipv6.conf.default.disable_ipv6=1; done
ip link add v11a netns n11a type veth peer name v11b netns n11b
ip -n n11a addr add 10.11.0.1/24 dev v11a; ip -n n11b addr add 10.11.0.2/24 dev v11b
ip -n n11a link set v11a up; ip -n n11b link set v11b up
sleep 1
for n in n11a n11b; do echo "$n:"; ip -n $n -br link show type veth; done
ip netns exec n11a ping -c1 -W1 10.11.0.2 | sed -n 2p`,
          },
        },
        { md: `Each namespace holds one end, and both show \`UP\` with \`LOWER_UP\`. \`LOWER_UP\` means the interface sees a live link underneath. Both ends have a MAC, and the MACs are random (more on that in chapter 2.1). The ping goes through, 64 bytes back from 10.11.0.2.

The \`@if2\` after each name is the *other* end's interface index, counted inside its own namespace. In each namespace the veth happens to be interface number 2, after \`lo\`. That is how \`ip\` tells you the interface is one half of a pair.` },
      ],
    },
    {
      id: 'addressing',
      title: 'The link does not read addresses',
      blocks: [
        { md: `An IP address on an interface is a *host's* property: it is what the kernel's IP layer matches packets against. The link and the NIC live below that. They move frames.

Test that. Take the address off b's end, so \`v11b\` has no IP at all. Then ping 10.11.0.2 from a. A \`tcpdump\` on b's end listens the whole time.` },
        {
          checkpoint: {
            id: 'c2',
            prompt: 'v11b has no IP address. a pings 10.11.0.2 and tcpdump listens on v11b. What does tcpdump print?',
            options: [
              'Nothing: with no IP, the kernel on b has nothing to receive the frame for',
              'ICMP echo requests: the ping packet is delivered, b simply does not answer',
              'ARP requests from a: a has to find a MAC first, and the frame reaches b’s end regardless',
              'An error: a cannot send to an interface that has no address',
            ],
            key: 2,
            why: 'a does not know a MAC for 10.11.0.2, so it broadcasts an ARP request. The cable delivers that frame to v11b whether or not v11b has an address. a never gets an answer, so it never sends the ICMP packet.',
          },
        },
        {
          lab: {
            explain: 'Remove the IP from v11b, clear a’s ARP cache, ping, and capture on v11b',
            cmd: `${NEED_N11}
ip -n n11b addr flush dev v11b; ip -n n11a neigh flush dev v11a
ip netns exec n11b timeout 3 tcpdump -nl -i v11b 2>&1 | grep -v -e listening -e "^$" &
sleep 1
ip netns exec n11a ping -c1 -W1 10.11.0.2 >/dev/null 2>&1
wait`,
          },
        },
        { md: `tcpdump shows two ARP requests, \`who-has 10.11.0.2 tell 10.11.0.1\`, about a second apart. ARP is not a failure here, it is a frame that crossed the link. The frames reached an interface that has no address, because delivery on a link depends on the cable. The receiver's IP only decides what the kernel does *afterwards*.

No ICMP appears. a cannot build the Ethernet header without a destination MAC, and nobody answered the ARP. That is also the first look at what the next chapter takes apart: a frame has an address of its own, below IP.

> [!IMPORTANT]
> A link delivers every frame sent into one end to the other end. IP addresses decide what a host does with the frame, not whether it arrives.` },
      ],
    },
    {
      id: 'state',
      title: 'Link state: a cable has two ends',
      blocks: [
        { md: `An interface has two separate pieces of state. The **admin state** is what you asked for: \`ip link set … up\` or \`down\`. The **carrier** is what the hardware sees: is something alive on the other end?

A veth pair copies that behaviour. The man page says when either device is down, the link state of the pair is down. Put the address back on b's end, then set b down and look at a, which you have not touched. Ping from a after that.` },
        {
          checkpoint: {
            id: 'c3',
            prompt: 'You run `ip link set v11b down`. Without touching it, what does v11a show?',
            options: [
              'Unchanged, still UP: its own admin state is UP, so nothing about it changes',
              'Gone: a veth end cannot exist without its partner',
              'DOWN, because the admin state of a pair is shared: one down sets both down',
              'Still admin-UP, but NO-CARRIER and state DOWN: it lost the link, though nobody touched it',
            ],
            key: 3,
            why: 'Admin state is per interface and v11a keeps its UP flag. Carrier is a property of the link, and a link with a dead end has none. So v11a shows NO-CARRIER and state DOWN while still flagged UP.',
          },
        },
        {
          lab: {
            explain: 'Put b’s IP back, set v11b down and read v11a, ping, then set v11b up again',
            cmd: `${NEED_N11}
ip -n n11b addr add 10.11.0.2/24 dev v11b
echo "before:"; ip -n n11a -br link show v11a
ip -n n11b link set v11b down
echo "peer down:"; ip -n n11a -br link show v11a
ip -n n11a link show v11a | head -1
ip netns exec n11a ping -c1 -W1 10.11.0.2 | tail -3
ip -n n11b link set v11b up; sleep 1
echo "peer up again:"; ip -n n11a -br link show v11a`,
          },
        },
        { md: `Before, \`v11a\` shows \`UP\` with \`LOWER_UP\`. After b goes down it shows \`DOWN\`, with \`NO-CARRIER\` in the flags and \`UP\` still present, and the long form says \`state DOWN\`. The ping gets 0 received. Set b up again and a returns to \`UP\` with \`LOWER_UP\`, with no action on a.

Two readings to keep apart. \`UP\` in the flags is *admin up*. The \`state\` column and \`LOWER_UP\` say whether the link actually works. An interface can be admin-UP and state DOWN, and that combination points at the far end or the cable, not at a's configuration.

> [!IMPORTANT]
> \`UP\` in the flags is what someone configured. \`LOWER_UP\` and the state column are what the link is doing. Debug the second one with \`NO-CARRIER\`.` },
        { md: `One more, to find the other end of a pod-style pair. A pod's \`eth0\` knows its partner's interface index, and \`ethtool -S\` reports it as \`peer_ifindex\`. Look that index up in the host namespace and you have the \`lxc…\` end. The lab uses a namespace as the pod.` },
        {
          lab: {
            explain: 'Make a pod-like namespace, read its eth0 peer_ifindex, and find that interface on the host side',
            cmd: `${NEED_N11}
ip netns del n11p 2>/dev/null; ip link del h11 2>/dev/null
ip netns add n11p; ip link add h11 type veth peer name eth0 netns n11p
P=$(ip netns exec n11p ethtool -S eth0 | awk "/peer_ifindex/{print \\$2}")
echo "pod eth0 says its peer has ifindex $P"
ip -o link | awk -F": " -v i=$P "\\$1==i{print \\"in this namespace, that is: \\" \\$2}"`,
          },
        },
        { md: `The pod end reports a peer index, and the host namespace has an interface with exactly that number: \`h11\`, in the role Cilium's \`lxc…\` plays. The actual number differs from run to run, so don't memorise it. On a real node, this is how you go from a pod to its host-side interface when you want to capture on it.` },
      ],
    },
    {
      id: 'twins',
      title: "Where you've met this",
      blocks: [
        { md: `**Kubernetes / Cilium.** Per the Cilium routing documentation, a pod's namespace holds \`eth0\`, one end of a veth pair, and the other end is \`lxcXXXXXX\` in the host namespace. That is the first hop you just proved, and a good place to \`tcpdump\` when a pod's traffic goes missing.

**Proxmox.** \`vmbr0\` is a Linux bridge, usually attached to the first physical NIC (the docs' example uses \`eno1\`). The physical NIC is one port on that bridge. Each VM NIC shows up on the host as a tap device on a bridge port, the VM equivalent of a veth end (the tap detail is standard KVM behaviour; the page I read doesn't spell it out). The network sees one MAC per VM through that single cable, as the Proxmox docs note.

**AWS.** An ENI is a logical component that represents a virtual network card, with a MAC address of its own. AWS doesn't publish the datapath behind it, so there is no cable to inspect and no \`NO-CARRIER\` to read. The safe mental model is that L1 is not yours to debug in a VPC: if packets stop, look at addresses, routes and filters.` },
      ],
    },
    {
      id: 'keep',
      title: 'What to keep',
      blocks: [
        { md: `- A link joins two interface ends. Whatever enters one end comes out the other. A veth pair is that link in software, and its two ends can be in different namespaces.
- A pod's \`eth0\` and the node's \`lxc…\` are the two ends of one veth. A pod's packet reaches the host-side veth first, never the physical NIC.
- The link delivers frames without checking IP addresses. The receiver's address only decides what its kernel does with the frame.
- \`UP\` means configured. \`LOWER_UP\` and the state column mean the link works. \`NO-CARRIER\` with \`UP\` means the other end is gone or down.` },
      ],
    },
  ],
};
