// Chapter 5.3: K8s pod network and the Cilium datapath. Authored content; the tutor gets this file as chapter_source.
// Labs run in netlab (Ubuntu 26.04 userland, iproute2 6.19) on 2026-10-25; outputs described in the prose were observed (twice, in order).
// ONE lab only, and it is deliberately small: netlab has no Cilium, no Kubernetes and no loaded BPF programs, so no Cilium behaviour can be observed here.
// The lab shows only what the VM's kernel can host: the tc hook point on a veth (a clsact qdisc) and a netkit device. Every Cilium statement below comes from the docs listed here or is marked as inference.
// Sources:
//   https://docs.cilium.io/en/stable/network/concepts/routing/ (encapsulation: tunnel-protocol defaults to vxlan, tunnel-port 8472/6081, needs only node-to-node IP, VXLAN costs 50 bytes, identity carried as metadata; native routing: "routing-mode: native", packets not for a local endpoint go to the Linux routing subsystem, the network "must be capable of routing PodCIDRs"; AWS ENI example: veth pair lxcXXXXXX, eBPF program on it "before reaching the Linux routing layer")
//   https://docs.cilium.io/en/stable/network/ebpf/intro/ (hooks used by the datapath: XDP; traffic-control (tc) ingress/egress, which runs after the stack's initial processing and before L3, used for L3/L4 endpoint policy and redirecting to endpoints; endpoint policy and service objects)
//   https://docs.cilium.io/en/stable/overview/intro/ (identity-based security: a security identity assigned to groups of containers with identical policies, attached to packets and validated at the receiving node; east-west load balancing rewrites at connect() and fully replaces kube-proxy; north-south uses XDP)
//   https://docs.cilium.io/en/stable/network/kubernetes/kubeproxy-free/ (kube-proxy replacement; BPF cgroup programs (connect4, sendmsg4, ...) for socket-based load balancing)
//   https://docs.cilium.io/en/stable/security/network/identity/ (IP-address filters must be updated on every node whenever a pod with a matching label starts or stops; identity-based security avoids that)
//   https://docs.cilium.io/en/stable/operations/performance/tuning/ and https://docs.cilium.io/en/stable/operations/system_requirements/ (netkit device mode: veth is the default datapath mode, netkit replaces it, kernel >= 6.8 required; recommended kernel >= 5.10 for Cilium)
//   https://kubernetes.io/docs/concepts/services-networking/ (Service gives a stable virtual IP; kube-proxy is the default service proxy, and some pod network implementations use their own)
// Hedged, not sourced: that the packets leaving a pod already carry the backend address under socket-level load balancing (inferred from the wording about connect()); the Proxmox angle (reasoning); the routes in the widget (illustrative, not output from a Cilium node).
// Chapter 1.1 (l1-links-nics) showed the pod veth and the lxcXXXXXX naming; it does not mention netkit, so this chapter introduces it from the Cilium docs.

export default {
  node: 'cilium-datapath',
  number: '5.3',
  kicker: 'Overlays',
  title: 'K8s pod network and the Cilium datapath',
  lede: 'Cilium keeps the model from chapter 5.2 and puts eBPF programs on the pod interfaces. Between nodes it either wraps pod packets in a tunnel or lets the network route pod IPs.',
  sections: [
    {
      id: 'hook',
      title: 'A program on the pod interface',
      blocks: [
        { md: `Chapter 5.2 built a node out of kernel parts: a veth per pod, a /32 route per pod and forwarding turned on. Nothing in that node could say "pod1 may not talk to pod2". The kernel forwards whatever it can route.

Cilium is a CNI plugin (chapter 5.2) built around a different idea: attach small **eBPF** programs to hook points in the kernel's networking path and let those programs make the decisions. eBPF here just means programs the kernel loads, checks and runs at a chosen point, on each packet that passes it.

Cilium's routing documentation describes the interface you already know. In its AWS ENI walkthrough, the pod's \`eth0\` is one end of a veth pair, and the other end is called \`lxcXXXXXX\` in the host namespace (chapter 1.1 found that interface from the pod side). The same walkthrough shows an exact-match host route for the pod's IP pointing at it, the same shape as the /32 routes in 5.2.

So a packet leaves a pod, crosses the veth, and arrives on the \`lxc\` interface at the node. From there, the node's normal path would be a routing lookup, as in 5.2.` },
        {
          checkpoint: {
            id: 'c1',
            prompt: 'A pod sends a packet. Relative to the node\'s routing lookup, where does Cilium\'s eBPF program on that pod\'s lxc interface run?',
            options: [
              'After routing: it is a netfilter hook that fires once a route has been chosen',
              'Before routing: it sees the packet as it arrives from the veth, ahead of the routing layer',
              'In userspace: packets are copied up to the Cilium agent, which decides and sends them back',
              'Instead of routing: Cilium removes the host routes and the program picks every next hop',
            ],
            key: 1,
            why: 'The Cilium routing page says the traffic is subject to the eBPF program "after passing through the veth pair and before reaching the Linux routing layer". The traffic-control hook runs before the L3 stack. Nothing in it says Cilium removes host routes, and the same page shows an exact-match route into the lxc interface.',
          },
        },
        { md: `The Cilium documentation lists the kernel hooks its datapath uses. Two matter here:

- **XDP** runs at the earliest point, in the network driver, on packet reception. The documentation says it is ideal for filtering programs that drop unwanted traffic, and uses it for north-south load balancing.
- **Traffic control (tc) ingress and egress** attach to a network interface too, but run after the stack's initial processing and before the L3 layer. The documentation says this is ideal for local node processing: applying L3/L4 endpoint policy and redirecting traffic to endpoints.

The tc hook on the \`lxc\` interface is where the packet from the pod meets the program. In the documentation's AWS ENI walkthrough, outgoing traffic is subject to the eBPF program "to enforce network policies, implement load-balancing and provide networking features" before it reaches the routing layer, and incoming traffic passing the \`lxc\` interface into the pod is subject to it as well, to enforce policy, provide service reverse load-balancing and give visibility.

> [!IMPORTANT]
> Cilium's decisions (policy, service load balancing, visibility) happen in eBPF programs on the pod's interface, before the kernel's routing lookup. The routes and the veth from chapter 5.2 are still there.

The documentation also describes a newer pod-side device, **netkit**. In its default mode Cilium uses veth devices at layer 2. In netkit device mode, the netkit device replaces the veth; the Cilium documentation says the pod's BPF programs are attached inside the netkit peer device, and it requires kernel 6.8 or later and eBPF host-routing.

**This chapter has one lab only, and it is small.** netlab has no Cilium and no Kubernetes, so none of this can be shown running here. What netlab can do is check that its kernel offers the two ingredients: a place to attach tc programs on a veth (the \`clsact\` qdisc is the attachment point for tc BPF programs; general knowledge), and a netkit device. The lab loads no program, so it shows capability on this kernel, nothing about Cilium's behaviour.` },
        {
          lab: {
            explain: 'Attach a clsact hook to a veth and create a netkit pair in a scratch namespace; print what the kernel reports',
            cmd: `echo "kernel: $(uname -r | cut -d. -f1,2)"
ip netns del n53k 2>/dev/null; sleep 0.3; ip netns add n53k
ip -n n53k link add v53a type veth peer name v53b
ip netns exec n53k tc qdisc add dev v53a clsact 2>&1
echo "--- hook point on the veth"; ip netns exec n53k tc qdisc show dev v53a
echo "--- netkit pair"
ip -n n53k link add nk53a type netkit peer name nk53b 2>&1 | head -2
ip -n n53k -d -o link show nk53a 2>&1 | grep -o 'netkit mode [a-z0-9]*'
echo "veth, for comparison: $(ip -n n53k -d -o link show v53a | grep -o 'veth')"
ip netns del n53k`,
          },
        },
        { md: `The kernel line prints \`7.2\`, newer than the 6.8 the Cilium documentation asks for netkit. \`tc qdisc add dev v53a clsact\` succeeds without complaint, and \`tc qdisc show\` lists \`qdisc clsact ffff: parent ffff:fff1\`. That is the attachment point; no program is hooked to it. The netkit pair is created too, and \`ip -d link\` reports \`netkit mode l3\`, the mode the Cilium documentation recommends because it removes the need for Cilium to process ARP packets. In 5.2 the node had to answer ARP for the pod (proxy ARP); in that mode Cilium would not have to.

So this kernel can host the same two device types a Cilium node uses. Whether the actual datapath is built on them cannot be shown from here.` },
      ],
    },
    {
      id: 'modes',
      title: 'Between nodes: tunnel or routed',
      blocks: [
        { md: `Now go across nodes. Two nodes, **A** and **B**, each have their own block of pod addresses. A pod on A sends a packet to a pod on B. Node A forwards it using its routing table, as in 5.2, and it leaves node A's uplink onto the underlay.

The underlay is the network between the nodes: ordinary IP routers whose tables know the *node* addresses and nothing about pod addresses.` },
        {
          checkpoint: {
            id: 'c2',
            prompt: 'The routers between nodes have no routes for pod addresses, and you may not change them. Which Cilium routing mode lets a pod on A reach a pod on B?',
            options: [
              'Encapsulation: the underlay needs node-to-node IP only, and the pod packet rides inside',
              'Native routing: Linux forwards the pod packet as it is, and ordinary IP routing carries it to the pod\'s node',
              'Either mode: both are overlays, so the underlay never needs pod routes',
              'Only after SNAT: pod addresses must be rewritten to node addresses before anything crosses nodes',
            ],
            key: 0,
            why: 'With encapsulation the routers see only an outer packet between two node IPs, which they can already forward. With native routing the outer destination is the pod IP itself, so the network has to be able to route it. Rewriting to node addresses would break the pod-to-pod-without-NAT promise.',
          },
        },
        { md: `The Cilium routing documentation names both modes.

**Encapsulation.** It states that encapsulation "relies on normal node to node connectivity", and that the network connecting the nodes does not need to know the PodCIDRs. The topology of the underlying network is irrelevant as long as nodes can reach each other using IP/UDP. Its table of options names VXLAN as the default encapsulation mode, with Geneve as the alternative: \`tunnel-protocol\` defaults to \`vxlan\`, and \`tunnel-port\` defaults to 8472 for VXLAN and 6081 for Geneve. That is the 8472 you printed on a bare Linux link in 5.1, and the firewalls and security groups between nodes have to allow it. The price is the chapter 5.1 arithmetic: the documentation lists "MTU Overhead" of 50 bytes per packet for VXLAN as a disadvantage, and mentions jumbo frames as a mitigation.

**Native routing.** Enabled with \`routing-mode: native\`. The documentation says Cilium then "delegates all packets which are not addressed to another local endpoint to the routing subsystem of the Linux kernel", so the packet is routed as if a local process had sent it. The network connecting the nodes "must be capable of routing PodCIDRs". There is no outer header and no 50-byte tax, but somebody has to put the pod routes where the routers can find them. The documentation lists options for that, such as \`auto-direct-node-routes\`; how they work is not covered here. In the AWS ENI example, the VPC does that job, because pods get ENI addresses that are routable in the VPC.

The widget shows what the node's own table looks like in the native case. It is an illustration built from the model of chapter 5.2, not output from a Cilium node.` },
        {
          widget: {
            id: 'w-native',
            kind: 'routes',
            title: 'Node A in native routing mode (illustrative)',
            hint: 'Try 10.52.0.12, then 10.52.1.7, then 10.52.2.9, and read which row wins each time.',
            takeaway: 'A local pod matches its /32, a pod on node B matches the /24 someone installed, and 10.52.2.9 has no pod route so it falls to the default route. That is the case the documentation means when it says the network must be able to route PodCIDRs.',
            caption: 'Illustrative routing table of node A',
            routes: [
              { prefix: '10.52.0.11/32', target: 'pod1 (lxc veth)' },
              { prefix: '10.52.0.12/32', target: 'pod2 (lxc veth)' },
              { prefix: '10.52.1.0/24', target: 'next hop node B 192.168.1.12' },
              { prefix: '192.168.1.0/24', target: 'eth0 (connected)' },
              { prefix: '0.0.0.0/0', target: 'next hop router 192.168.1.1' },
            ],
            dest: '10.52.0.12',
            presets: ['10.52.0.12', '10.52.1.7', '10.52.2.9'],
          },
        },
        { md: `The choice, then, is mostly about the underlay. If you cannot change the network (a shared cloud VPC with fixed route tables, say) encapsulation needs only IP reachability and UDP 8472 open between nodes. If you can make the network route pod addresses, as the AWS ENI mode does, native routing avoids the overhead. Both modes use the same pod-side veth, host routes and eBPF programs from the first section.` },
      ],
    },
    {
      id: 'services',
      title: 'Services and policy',
      blocks: [
        { md: `Two more jobs sit on top of pod addressing.

**Services.** A Kubernetes Service gives a set of pods one stable virtual IP. The Kubernetes documentation says the default implementation is kube-proxy, and that some pod network implementations bring their own service proxy instead. Cilium can replace kube-proxy entirely. Its introduction says east-west load balancing "rewrites service connections at the socket level (\`connect()\`), avoiding the overhead of per-packet NAT", and north-south load balancing uses XDP for high-throughput cases. The kube-proxy-free page adds that Cilium attaches BPF cgroup programs (\`connect4\`, \`sendmsg4\` and others) for the socket-based load balancing. Chapter 4.7 covered NAT, where conntrack remembers each translated flow. By the documentation's wording, the socket-level rewrite happens at connect time instead of on each packet. An inference, not tested here: if the address is chosen before the first packet is sent, the packets leaving the pod already carry a backend address.

**Policy.** Chapter 4.5 filtered by address and port. A pod's address is the most temporary thing about it: restart it and it gets a new one.

Consider this rule: pods labelled \`role=frontend\` may connect to pods labelled \`role=backend\`. Scaling the frontend from 2 pods to 20 gives you 18 new IP addresses.` },
        {
          checkpoint: {
            id: 'c3',
            prompt: 'Frontend scales from 2 to 20 pods. The rule "frontend may reach backend" does not change. Which statement fits the Cilium documentation?',
            options: [
              'IP allow-lists: every node with a backend pod updates its filter with the 18 new addresses',
              'One identity per pod: each of the 18 new pods gets a separate security identity and rule',
              'One identity per policy group: the new pods join the frontend group, so the rule is untouched',
              'No pod IPs at all: identities replace addresses, so packets are matched without any IP',
            ],
            key: 2,
            why: 'Cilium assigns a security identity to groups of containers that share identical policies, attaches it to their packets and validates it at the receiving node. New frontend pods fall into the existing identity, so the rule over identities does not change. The traditional IP-filter approach is the one that needs an update on every node.',
          },
        },
        { md: `The Cilium documentation spells out why the IP-filter approach scales badly: every time a pod with a matching label starts or stops, the rules on every node running such a pod have to be updated with the changed address list. The identity model avoids it. Its introduction says Cilium "assigns a security identity to groups of application containers which share identical security policies", associates it with all packets those containers emit, and validates it at the receiving node. The routing page adds that encapsulation can carry metadata, and that Cilium uses this to pass the source security identity as an optimisation that avoids one identity lookup on the remote node.

IP addresses are still used to route. The identity decides whether the packet is allowed, and the policy documentation extends to labels, protocols, ports, DNS names and L7 rules such as HTTP method and path.

Putting the chapter together, a packet from a pod meets four things on its way: the veth pair into the node, an eBPF program that applies policy and service translation, a routing step (plain forwarding, with a tunnel header in encapsulation mode), and the same steps in reverse on the destination node.` },
      ],
    },
    {
      id: 'twins',
      title: "Where you've met this",
      blocks: [
        { md: `**Kubernetes.** Cilium is a pod network implementation, so it is an answer to the model in chapter 5.2. The Cilium system-requirements page says "it is recommended to use kernel 5.10 or later" and lists the BPF kernel options to enable; netkit needs 6.8 or later.

**AWS.** The documentation says encapsulation needs UDP 8472 (or 6081 for Geneve) open between nodes, and its system-requirements page shows AWS security-group rules for VXLAN mode. In its AWS ENI mode, pods get ENI IP addresses that are routable inside the VPC, so no tunnel is needed. How that interacts with your own VPC route tables and security groups is something to check on the real cluster.

**Proxmox.** This is reasoning, not documented fact. If Kubernetes nodes are VMs on Proxmox, the VM NICs are the underlay. Encapsulation works over any IP path between VMs. Native routing needs the pod routes to exist somewhere the VMs and the physical network can see, so it is only as easy as your ability to add routes there.

**What you cannot check from netlab.** Whether a given cluster is on a tunnel or on native routing, what its pod MTU is, whether kube-proxy is replaced, and which identity a pod holds. Those come from the real cluster's Cilium configuration and Cilium's own tooling, not from the VM used for these labs.` },
      ],
    },
    {
      id: 'keep',
      title: 'What to keep',
      blocks: [
        { md: `- Cilium keeps the pod/veth/route model of 5.2 and attaches **eBPF programs to the pod's lxc interface** (tc hook), which per its documentation run before the Linux routing layer. They apply policy, service load balancing and visibility.
- Between nodes there are two modes. **Encapsulation** (VXLAN on UDP 8472 by default, Geneve on 6081) needs only node-to-node IP and costs 50 bytes of MTU. **Native routing** has no overhead but needs a network able to route pod IPs.
- **kube-proxy replacement**: Cilium's documentation says east-west service load balancing rewrites at the socket level, at \`connect()\`, instead of NAT on each packet.
- **Identity-based policy**: rules are written over a security identity shared by a group of pods with identical policies, so scaling a Deployment does not rewrite them.
- This chapter's one lab only showed that the kernel can host a tc hook point and a netkit device. It never ran Cilium.` },
      ],
    },
  ],
};
