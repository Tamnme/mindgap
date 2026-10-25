// Chapter 5.2: Kubernetes pod network model. Authored content; the tutor gets this file as chapter_source.
// Labs run in netlab (Ubuntu 26.04, iproute2 6.19) on 2026-10-25; outputs described in the prose were observed (twice, in order).
// Sources:
//   https://kubernetes.io/docs/concepts/services-networking/ ("The Kubernetes network model": each pod gets its own unique cluster-wide IP; all pods can communicate with all other pods, on the same node or different nodes, directly "without the use of proxies or address translation (NAT)"; agents on a node can reach all pods on it; the container runtime sets up the pod network namespace; the pod network is managed by a pod network implementation, usually a CNI plugin)
//   https://kubernetes.io/docs/concepts/cluster-administration/networking/ (cluster networking page; fetched and indexed, quoted claims come from the page above)
//   https://docs.cilium.io/en/stable/network/concepts/routing/ (AWS ENI section: the pod's eth0 is one end of a veth pair named lxcXXXXXX in the host namespace; a host route such as "192.168.105.44 dev lxc5a4def8d96c5" steers traffic into the veth; Cilium's eBPF program runs on that interface; the pod's default route points to the node's router IP)
//   https://docs.cilium.io/en/stable/network/concepts/ipam/ (IPAM allocates the addresses used by endpoints; tunnel routing and direct routing columns)
// Hedged, not sourced: how the AWS VPC CNI wires a pod (only Cilium's ENI mode is cited); what a Proxmox VM must provide for a CNI (reasoning).
// The lab is an emulation, not Cilium: pods use a scope-link default route and the node answers ARP with proxy_arp, whereas the Cilium page says the pod's default route points at a router IP. The chapter does not claim Cilium uses proxy ARP.
// 1.1 (l1-links-nics) already showed the pod veth and peer_ifindex; this chapter links back to it.

const NEED = `ip netns list | grep -q n52node || { echo "Run the first lab first."; exit 1; }`;

export default {
  node: 'k8s-pod-network-model',
  number: '5.2',
  kicker: 'Overlays',
  title: 'Kubernetes pod network model',
  lede: 'Kubernetes asks one thing of the network: every pod has its own IP and reaches every other pod directly. How a node meets that promise is a handful of veths and routes you can build yourself.',
  sections: [
    {
      id: 'model',
      title: 'The promise and the pieces',
      blocks: [
        { md: `Start with what Kubernetes says. The networking page of the Kubernetes documentation describes the **network model** as a set of pieces:

- Each pod gets its own unique cluster-wide IP address.
- All pods can communicate with all other pods, whether they are on the same node or on different nodes. They communicate "directly, without the use of proxies or address translation (NAT)". The page says "barring intentional network segmentation", which is the job of NetworkPolicy.
- Agents on a node, such as the kubelet, can communicate with all pods on that node.

It also says who builds the network. The container runtime creates the pod's network namespace. The *pod network* is built by a pod network implementation, which on Linux is usually a CNI plugin. A **CNI** plugin is the program the runtime calls when a pod starts: it creates the pod's interface, gives it an address and sets up the routes. Nothing in the model says *how*, which is why different CNI plugins can satisfy it in different ways (general knowledge, not from the fetched page).

Compare that with what you know. In chapter 3.1 you carved subnets, and in chapter 1.1 you built a pod-shaped network namespace with a veth pair: the pod's \`eth0\` is one end, and the other end sits in the node's root namespace. Put those together and a pod on a node is a namespace with an \`eth0\`, an IP, and a cable to the node. That much is a given. The open question is what the *node* does with a packet that arrives on one cable and is addressed to a pod on another.

Picture one node with two pods. **pod1** has \`10.52.0.11\` and **pod2** has \`10.52.0.12\`. Each is connected to the node by its own veth pair, and the node has no bridge device. The node holds the other end of each pair, in the interface names \`l52a\` (pod1's cable) and \`l52b\` (pod2's cable). pod1 pings pod2.` },
        {
          checkpoint: {
            id: 'c1',
            prompt: "pod1's packet for 10.52.0.12 arrives at the node on the veth end l52a. What does the node consult to choose l52b as the way out?",
            options: [
              'A firewall rule: a netfilter forward rule names the veth for each pod address',
              'A route: a host route for 10.52.0.12 pointing at l52b',
              'A NAT table: it rewrites both pod addresses and tracks the flow',
              'A neighbour entry only: the ARP cache for 10.52.0.12 names the veth by itself',
            ],
            key: 1,
            why: 'The node looks up the destination IP in its routing table and the matching route names the interface. Firewall rules filter or rewrite packets but do not pick the egress interface, NAT is not required, and a neighbour entry only maps an IP to a MAC after a route has chosen the interface.',
          },
        },
        { md: `The node has one interface per pod. For each pod it needs a **/32 host route**: "this one address is reachable through that one veth." Every pod's address is an exact match, so no subnet is shared between the cables.

That also tells you what the CNI plugin has to do on every pod start, in three steps:

1. Create the veth pair and move one end into the pod's namespace as \`eth0\`.
2. Assign the pod its IP.
3. Install the route that points the pod's address at the node's end of the veth.

The Cilium routing documentation shows exactly this in its AWS ENI example. The node's routing table has an exact-match entry, \`192.168.105.44 dev lxc5a4def8d96c5\`, to steer traffic into the veth that is "hooked into the pod". Chapter 5.3 comes back to what Cilium attaches to that interface.

Build a node of this shape in netlab: a namespace \`n52node\` plays the node, and two more, \`n52p1\` and \`n52p2\`, play the pods. The pods get /32 addresses. The other lines you will see in the lab are there so the pods can find the way out, and they get explained after you have seen them run.` },
        {
          lab: {
            explain: 'Build a node with two pod namespaces joined by veths; print the pod addresses and the routes',
            cmd: `for n in n52node n52p1 n52p2; do ip netns del $n 2>/dev/null; done; ip link del l52a 2>/dev/null; ip link del l52b 2>/dev/null; sleep 0.5
for n in n52node n52p1 n52p2; do ip netns add $n; ip netns exec $n sysctl -qw net.ipv6.conf.all.disable_ipv6=1 net.ipv6.conf.default.disable_ipv6=1; done
ip netns exec n52node sysctl -qw net.ipv4.ip_forward=1
ip -n n52p1 link add eth0 type veth peer name l52a netns n52node
ip -n n52p2 link add eth0 type veth peer name l52b netns n52node
ip -n n52p1 addr add 10.52.0.11/32 dev eth0; ip -n n52p2 addr add 10.52.0.12/32 dev eth0
for p in p1 p2; do ip -n n52$p link set eth0 up; ip -n n52$p route add default dev eth0 scope link; done
for l in l52a l52b; do ip -n n52node link set $l up; ip netns exec n52node sysctl -qw net.ipv4.conf.$l.proxy_arp=1; done
ip -n n52node route add 10.52.0.11/32 dev l52a
ip -n n52node route add 10.52.0.12/32 dev l52b
echo "--- pod1 address"; ip -n n52p1 -br addr show eth0
echo "--- pod1 routes"; ip -n n52p1 route
echo "--- node routes"; ip -n n52node route`,
          },
        },
        { md: `The node's routing table has exactly two entries, one per pod: \`10.52.0.11 dev l52a\` and \`10.52.0.12 dev l52b\`. There is no subnet route, no gateway, and no default route. pod1's table has a single line, \`default dev eth0 scope link\`, which means "send everything out of eth0, and treat every destination as directly reachable on that cable". The pod's address is a /32, so on its own it has no on-link neighbours at all. The default route is what makes it try.` },
      ],
    },
    {
      id: 'walk',
      title: 'Follow one packet',
      blocks: [
        { md: `Now trace pod1's ping to 10.52.0.12 step by step. pod1 looks up 10.52.0.12 in its routing table and finds the \`default dev eth0 scope link\` route. "Scope link" means the destination is on the wire itself, so pod1 must find its MAC with ARP and put that MAC in the Ethernet header. It broadcasts an ARP request for 10.52.0.12 out of \`eth0\`.

The request travels down the veth and arrives on \`l52a\` in the node. After the ping, pod1 will have cached a MAC for 10.52.0.12, and the lab compares that MAC against the three interfaces involved: pod2's own \`eth0\`, the node's \`l52b\` (the pod2 side) and the node's \`l52a\` (the pod1 side).` },
        {
          checkpoint: {
            id: 'c2',
            prompt: 'After the ping, which MAC address does pod1 hold for 10.52.0.12?',
            options: [
              "Pod2's own eth0: the ARP request crossed the node and pod2 answered",
              "The node's l52b: the node answers with the MAC of the veth that faces pod2",
              "The node's l52a: the node answers with the MAC of the veth that faces pod1",
              'Broadcast ff:ff:ff:ff:ff:ff: with no direct neighbour, pod1 floods every packet',
            ],
            key: 2,
            why: 'pod1 can only talk to the other end of its own cable, which is l52a. Whatever the node answers, the answering device is the veth end that received the request, so pod1 ends up with l52a\'s MAC, not pod2\'s.',
          },
        },
        { md: `One more prediction, about the packet itself. The \`ttl\` printed on a ping reply is the one from chapter 3.8, and Linux hosts usually start at 64 (general knowledge). The path of the ping is pod1, then the node, then pod2.` },
        {
          checkpoint: {
            id: 'c3',
            prompt: "The ping is pod1 to pod2 on the same node. What ttl does the echo reply show when it reaches pod1?",
            options: [
              'One forwarding hop: the node routes the reply, so ttl=63',
              'No router in between: same node, so ttl=64 arrives untouched',
              'Counted per veth cable: each cable crossed takes one off, so ttl=62',
            ],
            key: 0,
            why: 'The reply leaves pod2 with ttl 64 and crosses the node once. The node forwards it as a router, which takes one off. Each veth is a link, not a hop, so it does not decrement.',
          },
        },
        {
          lab: {
            explain: 'pod1 pings pod2; capture in pod2, then compare the MAC pod1 learned with the three candidates',
            cmd: `${NEED}
ip netns exec n52p2 timeout 6 tcpdump -nl -i eth0 -c 2 icmp >/tmp/n52.txt 2>/dev/null &
TP=$!
sleep 1
ip netns exec n52p1 ping -c1 -W1 10.52.0.12 | sed -n 2p
wait $TP
echo "positive control, ICMP lines captured in pod2: $(grep -c ICMP /tmp/n52.txt)"
echo "of those, requests with pod1's own address as source: $(grep -c 'IP 10.52.0.11 > 10.52.0.12: ICMP echo request' /tmp/n52.txt)"
echo "--- who answered pod1's ARP for 10.52.0.12?"
echo "pod1 neighbour entry: $(ip -n n52p1 neigh show 10.52.0.12 | awk '{print $1, $2, $3, $4, $5}')"
echo "node l52a MAC (pod1's veth end): $(ip -n n52node -br link show l52a | awk '{print $3}')"
echo "node l52b MAC (pod2's veth end): $(ip -n n52node -br link show l52b | awk '{print $3}')"
echo "pod2 eth0 MAC: $(ip -n n52p2 -br link show eth0 | awk '{print $3}')"`,
          },
        },
        { md: `Three things come out of that output.

**The node is a router hop.** The reply line shows \`ttl=63\`: one below the usual 64, which is the node's forwarding hop (the lab turned on \`ip_forward\` in the node). The two pods are on the same node and still one routed hop apart, not one switch apart.

**No translation happened.** The capture inside pod2 shows the echo request with source \`10.52.0.11\`, pod1's own address, not an address owned by the node. The positive control, two ICMP lines in the capture, shows the capture ran, so the count of one request line is real. That is the "no NAT between pods" part of the model, here for pods on the same node. The lab does not test pods on different nodes.

**The node answered the ARP.** pod1's neighbour entry for 10.52.0.12 holds the MAC of \`l52a\`, the node's end of pod1's own cable, not pod2's. The lab turned on \`proxy_arp\` for both veth ends, which is consistent with the node answering on behalf of 10.52.0.12. There was no run without it, so the lab does not isolate that cause. The usual rule for proxy ARP is that the node answers when its routing table sends that address out of a different interface (general knowledge; the lab did not test the condition). pod1 then sends the frame to that MAC, the node receives it, looks up the destination IP in its routing table, finds the host route to \`l52b\` and sends it on with a new Ethernet header (general knowledge of routing; this lab only captured inside pod2). The two pods never share a layer-2 segment; each lives on its own two-device segment with the node, and the node routes between them.

> [!IMPORTANT]
> Pod-to-pod on one node is routing. The pod's veth leads to the node, the node has a /32 route per pod, and the packet is forwarded at layer 3. The source IP arrives unchanged.

This is only one way to satisfy the model. The Cilium page says its pods have a default route that points at a router IP on the node, rather than the proxy-ARP shortcut this lab uses. This chapter does not claim Cilium uses proxy ARP, and the lab is an emulation, not a Cilium node.

Last, make sure nothing else is hiding in the lab. A bridge would be a second way to join the veths, and the lab should show that none exists. The lab also asks pod1's \`eth0\` for its \`peer_ifindex\`, the number chapter 1.1 used to find a pod's host-side interface, and finds that interface in the node.` },
        {
          lab: {
            explain: 'Count veth links, bridge ports and bridge devices on the node, then map pod1 eth0 to its peer',
            cmd: `${NEED}
echo "veth links on the node (positive control): $(ip -n n52node -o -d link show | grep -c veth)"
echo "links with a master, i.e. bridge ports: $(ip -n n52node -o -d link show | grep -c ' master ')"
echo "bridge devices: $(ip -n n52node -o -d link show type bridge | grep -c bridge)"
P=$(ip netns exec n52p1 ethtool -S eth0 | awk '/peer_ifindex/{print $2}')
echo "pod1 eth0 peer_ifindex = $P"
ip -n n52node -o link show | awk -v p="$P" -F': ' '$1==p{print "node-side interface with that index: " $2}' | sed 's/@if[0-9]*//'`,
          },
        },
        { md: `The node has two veth links and no bridge: the count of links with a master is 0, as is the count of bridge devices, and the positive control (two veth links) shows the commands really saw the node's links. \`peer_ifindex\` for pod1's \`eth0\` is 2 in these runs (the number can differ elsewhere), and the node's interface with index 2 is \`l52a\`, the end the ARP answer came from. That is the same pod-to-host mapping from chapter 1.1, and on a real node it is how you go from a pod to the interface where \`tcpdump\` would see its traffic.` },
      ],
    },
    {
      id: 'twins',
      title: "Where you've met this",
      blocks: [
        { md: `**Kubernetes / Cilium.** This chapter's lab is a model of the Kubernetes page's pieces: a namespace per pod, an interface per pod, an address per pod, and a route to each. The Cilium routing documentation states that the pod's \`eth0\` is one end of a veth pair named \`lxcXXXXXX\` in the host namespace, and that the node has an exact-match host route for the pod's IP pointing at that interface. Its IPAM page covers where the addresses come from, which the lab simply typed in by hand.

**AWS.** In the AWS ENI mode of Cilium, the routing documentation says pods are assigned ENI IPs "directly routable in the AWS VPC", which avoids SNAT. In that mode, the VPC route tables are what carries pod addresses between nodes. AWS's own VPC CNI is a different implementation, and its wiring was not checked here, so treat any claim about it as unchecked. With an overlay CNI instead, pod IPs exist only inside the tunnel; chapter 5.1 built that tunnel.

**Proxmox.** If Kubernetes nodes are Proxmox VMs, the VM NICs are the underlay between nodes. This is reasoning, not documented fact: the pod addresses in this chapter are only known to the node that hosts the pod, so something has to carry them between VMs, either a tunnel over the VM NICs or routes the physical network knows about.

The part this chapter does not cover is crossing from one node to another. That is exactly where the two designs split, tunnel or routed, and chapter 5.3 starts there.` },
      ],
    },
    {
      id: 'keep',
      title: 'What to keep',
      blocks: [
        { md: `- The model has three parts: every pod has a unique cluster-wide IP, pods reach each other directly without NAT, and node agents reach every pod on their node.
- Kubernetes does not say how. The container runtime creates the pod namespace, and a **CNI** plugin creates the interface, gives it an address and installs the routes.
- On this emulated node, pod-to-pod on one node is **routing**: a veth per pod, a /32 route per pod, no bridge, forwarding on. The reply came back with ttl 63, one forwarding hop, and the source address arrived unchanged.
- To find a pod's host-side interface, read \`peer_ifindex\` in the pod and look up that index on the node.` },
      ],
    },
  ],
};
