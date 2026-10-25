// Chapter 2.5: VLAN access ports. Authored content; the tutor gets this file as chapter_source.
// Labs run in netlab (Ubuntu 26.04, iproute2 6.19) on 2026-10-25; outputs described in the prose were observed.
// Sources: https://man7.org/linux/man-pages/man8/bridge.8.html (bridge vlan add: "pvid" = untagged frames at ingress are assigned to this VLAN; "untagged" = treated as untagged on egress),
//   https://man7.org/linux/man-pages/man8/ip-link.8.html (vlan_filtering: when off, "the bridge will not consider the VLAN tag when handling packets"),
//   https://pve.proxmox.com/wiki/Network_Configuration (Proxmox: a VLAN tag is part of a guest's network configuration; with a VLAN-aware Linux bridge it is "transparently supported by the Linux bridge"),
//   https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html (AWS: no broadcast in a VPC).
// Hedged, not sourced: the AWS "no VLAN you configure" and Kubernetes/Multus notes, and "a router connects VLANs" (general L3 knowledge; chapter 3.3 builds the router).

const NEED = `ip link show br25 >/dev/null 2>&1 || { echo "Run the first lab (build br25) first."; exit 1; }`;

export default {
  node: 'vlan-access',
  number: '2.5',
  kicker: 'Layer 2',
  title: 'VLAN access ports',
  lede: 'Put the ports of one switch in different VLANs, keep every host in the same IP subnet, and see what can still talk.',
  sections: [
    {
      id: 'same',
      title: 'Same subnet, different VLAN',
      blocks: [
        { md: `Chapter 2.4 defined a broadcast domain as the set of ports a broadcast reaches, and showed that cabling decides it, not IP addresses.

Take one VLAN-aware bridge, \`br25\`, with three hosts. **a** and **b** are plugged into ports configured for VLAN 10. **c** is plugged into a port configured for VLAN 20. All three hosts have addresses in the same subnet, 10.25.0.0/24.

\`\`\`
   a 10.25.0.1    b 10.25.0.2    c 10.25.0.3
       |              |              |
   [VLAN 10]      [VLAN 10]      [VLAN 20]
   +--------------------------------------+
   |                br25                  |
   +--------------------------------------+
\`\`\`

a pings c. a looks at 10.25.0.3, sees it is inside its own /24, and decides c is on-link.` },
        {
          checkpoint: {
            id: 'c1',
            prompt: 'a pings c (10.25.0.3), which sits on a port in a different VLAN but the same /24. What happens?',
            options: [
              'Yes, same subnet: hosts in one /24 are on-link, so the switch delivers it',
              'Blocked: the ARP request stays inside VLAN 10, so c never even receives it',
              'Yes, once learned: one flood teaches the switch where c is, and later frames get through',
              'Yes, tagged: the switch marks the frame VLAN 20 and delivers it to c',
            ],
            key: 1,
            why: 'The switch decides which VLAN a frame belongs to from the port it arrived on, and only forwards it to ports in that VLAN. The IP subnet is a label the hosts use; it does not override the port. Without the ARP answer, a cannot even build the frame.',
          },
        },
        { md: `Build it and see. Each host port gets \`vid 10\` or \`vid 20\`. A port you don't touch comes up as a member of VLAN 1 (\`1 PVID Egress Untagged\`, as chapter 2.6's e and f ports show), so the lab also deletes that default \`vid 1\` to leave each port in exactly one VLAN. The flags are explained after the second lab.` },
        {
          lab: {
            explain: 'Build br25 (vlan_filtering) with a,b on VLAN 10 and c on VLAN 20; ping b then c from a (expect 2 received, then 0)',
            cmd: `for n in n25a n25b n25c; do ip netns del $n 2>/dev/null; done
for l in v25a v25b v25c; do ip link del $l 2>/dev/null; done; ip link del br25 2>/dev/null; sleep 0.5
ip link add br25 type bridge vlan_filtering 1 && ip link set br25 up
mk() { ip netns add n25$1
  ip netns exec n25$1 sysctl -qw net.ipv6.conf.all.disable_ipv6=1 net.ipv6.conf.default.disable_ipv6=1
  ip link add v25$1 type veth peer name eth0 netns n25$1
  ip link set v25$1 master br25 up
  bridge vlan del dev v25$1 vid 1
  bridge vlan add dev v25$1 vid $2 pvid untagged
  ip -n n25$1 link set eth0 up; ip -n n25$1 addr add 10.25.0.$3/24 dev eth0; }
mk a 10 1; mk b 10 2; mk c 20 3
sleep 1
for t in 2 3; do echo "a -> 10.25.0.$t: $(ip netns exec n25a ping -c2 -W1 -q 10.25.0.$t | grep -o '[0-9]* received')"; done
ip -n n25a neigh show | grep 10.25.0`,
          },
        },
        { md: `b answers, c doesn't, and a's neighbour table says why. The entry for b is \`REACHABLE\` with a MAC. The entry for c is \`INCOMPLETE\`: a sent an ARP request and no reply ever came. a never got as far as a ping; there is no routing involved. The failure is below IP.

The ARP request is a broadcast, and a broadcast is flooded to the ports of *its* VLAN. c's port is in the other one, so c never saw the question. This is chapter 2.4 again with one change: the bridge now holds more than one broadcast domain.

> [!IMPORTANT]
> A VLAN is a separate broadcast domain on the same switch. Two hosts in different VLANs cannot reach each other at layer 2, however their IP addresses look.

If two hosts in different VLANs *do* need to talk, something with a leg in each VLAN has to receive the packet and send a new one into the other side. That is a router. This chapter does not build one; chapter 3.3 covers the difference between a router and a switch.` },
      ],
    },
    {
      id: 'port',
      title: 'What the port does',
      blocks: [
        { md: `The ARP frame from a came into \`v25a\` and left toward b through \`v25b\`. Two things are not obvious about how hosts take part. Do the hosts have to cooperate, with a VLAN setting on their NICs? And what does the frame look like on the wire between the switch and a host? The next lab captures with \`tcpdump -e\`, which prints the link-layer header, on b's NIC while a pings b, and also counts the lines mentioning VLAN in b's interface details.` },
        {
          checkpoint: {
            id: 'c2',
            prompt: 'tcpdump -e on b’s eth0 shows a’s ARP request, which was sent from the VLAN 10 port. What does its link-layer header show?',
            options: [
              'A VLAN 10 tag: the frame carries its VLAN ID all the way to the host',
              'A VLAN 20 tag: the bridge re-tags it for the next VLAN',
              'A plain Ethernet header: dst ff:ff:ff:ff:ff:ff, src, ethertype ARP, no VLAN field',
              'A VLAN 1 tag: untagged frames on a VLAN-aware bridge are tagged VLAN 1',
            ],
            key: 2,
            why: 'On an access port the VLAN is a property of the port, held inside the bridge. The frame on the link to the host is ordinary Ethernet, which is why the host needs no VLAN configuration.',
          },
        },
        {
          lab: {
            explain: 'Capture a→b ARP with tcpdump -e on b, count VLAN lines in b’s eth0 details, then show each port’s VLAN entry',
            cmd: `${NEED}
ip -n n25a neigh flush all; ip -n n25b neigh flush all
ip netns exec n25b timeout 3 tcpdump -nel -c2 -i eth0 arp 2>/dev/null &
sleep 1
ip netns exec n25a ping -c1 -W1 -q 10.25.0.2 >/dev/null
wait
echo "lines mentioning vlan in b's eth0 details: $(ip -n n25b -d link show eth0 | grep -c -i vlan)"
echo
for p in v25a v25b v25c; do bridge vlan show dev $p | grep -v port; done`,
          },
        },
        { md: `The capture shows an ordinary Ethernet header and no \`vlan\` field. The request is \`xx:… > ff:ff:ff:ff:ff:ff, ethertype ARP\` (the MACs differ on every run) and the reply is the unicast back. b's own interface details contain 0 lines mentioning VLAN, so b is a plain host: nothing on the host was told about the VLANs, and the frames it sends and receives are untagged.

\`bridge vlan show\` lists \`10 PVID Egress Untagged\` on the two VLAN 10 ports and \`20 PVID Egress Untagged\` on c's. Those words are the flags you passed to \`bridge vlan add\`:

- \`vid 10\`: this port is a member of VLAN 10.
- \`pvid\`: an *untagged* frame arriving on this port is assigned to VLAN 10. The bridge man page words it as "any untagged frames will be assigned to this VLAN".
- \`untagged\`: frames of VLAN 10 leave this port without a tag.

That pair is what makes a port an **access port**: untagged in, untagged out, one VLAN. The PVID (port VLAN ID) is the label the bridge sticks on each frame as it enters, and the \`untagged\` flag takes it off again as it leaves.

> [!IMPORTANT]
> An access port belongs to exactly one VLAN. The host behind it sends and receives ordinary untagged frames and cannot tell VLANs exist.

\`vlan_filtering 1\` on the bridge is what turns this logic on; the \`ip-link\` man page says that with it off the bridge does not consider the VLAN tag when handling packets. Without it the three ports would simply be one broadcast domain again.` },
      ],
    },
    {
      id: 'domain',
      title: 'Who hears what',
      blocks: [
        { md: `Now closer to chapter 2.4. a pings c again, so a broadcasts an ARP request for 10.25.0.3. The lab listens for ARP on b and c at the same time. b is in a's VLAN but is not the target; c is the target but is in the other VLAN.` },
        {
          lab: {
            explain: 'a pings c; report whether b and c saw an ARP request (expect b yes, c no)',
            cmd: `${NEED}
for n in a b c; do ip -n n25$n neigh flush all; done
d=$(mktemp -d)
for n in b c; do ip netns exec n25$n timeout 3 tcpdump -nl -i eth0 arp > $d/$n 2>/dev/null & done
sleep 1
ip netns exec n25a ping -c1 -W1 -q 10.25.0.3 >/dev/null
wait
for n in b c; do grep -q Request $d/$n && r=yes || r=no; echo "n25$n saw an ARP request: $r"; done
rm -rf $d`,
          },
        },
        { md: `b saw the request, c did not. b ignored a question about someone else, as in chapter 2.2. c was the one being asked and never heard.

One more case. Suppose the switch has learned c, because c has sent a frame, and a then sends a *unicast* frame straight to c's MAC. The lab makes c send something (a ping to an address nobody owns, which produces an ARP broadcast), pins a's ARP entry for c to c's real MAC so no broadcast is needed, and then a pings c. It listens for the echo request on b and c.` },
        {
          checkpoint: {
            id: 'c3',
            prompt: 'The switch has learned c’s MAC on c’s port. a sends a unicast frame addressed to that MAC. What does the switch do with it?',
            options: [
              'Out c’s port: the switch knows that MAC, so it forwards the frame there',
              'Dropped on arrival: a frame for a MAC in another VLAN is discarded at once',
              'Flooded to every port: any frame that reaches the switch is copied everywhere',
              'Flooded inside VLAN 10: VLAN 10 has no entry for that MAC, so b gets it and c does not',
            ],
            key: 3,
            why: 'The switch learned c in VLAN 20, but a’s frame belongs to VLAN 10. Lookups happen per VLAN, so VLAN 10 has no entry for c’s MAC, and the frame is flooded only to ports in VLAN 10.',
          },
        },
        {
          lab: {
            explain: 'Flush the table, let c send a frame, pin a’s ARP entry for c, ping; report who saw the echo request, then the table (expect b yes, c no)',
            cmd: `${NEED}
for n in a b c; do ip -n n25$n neigh flush all; done
ip link set br25 type bridge fdb_flush
macc=$(ip -n n25c -br link show eth0 | awk '{print $3}')
ip netns exec n25c ping -c1 -W1 -q 10.25.0.9 >/dev/null
ip -n n25a neigh replace 10.25.0.3 lladdr $macc dev eth0 nud permanent
d=$(mktemp -d)
for n in b c; do ip netns exec n25$n timeout 3 tcpdump -nl -i eth0 icmp > $d/$n 2>/dev/null & done
sleep 1
ip netns exec n25a ping -c1 -W1 -q 10.25.0.3 >/dev/null
wait
for n in b c; do grep -q 'echo request' $d/$n && r=yes || r=no; echo "n25$n saw the echo request: $r"; done
rm -rf $d
echo; bridge fdb show br br25 | grep -v permanent`,
          },
        },
        { md: `b saw the echo request and c did not, even though the switch had c's MAC in its table. The table at the end lists two learned entries, each ending \`vlan 10\` or \`vlan 20\`: a's MAC on \`v25a\` in VLAN 10 and c's on \`v25c\` in VLAN 20. b's MAC is absent, since b never sent anything.

So the MAC table is **per VLAN**: an entry is (VLAN, MAC) → port. A frame from VLAN 10 is looked up among VLAN 10's entries only. c's MAC is in VLAN 20's set, so VLAN 10 has no entry for it, and the switch floods the frame inside VLAN 10 as it would for any unknown unicast (chapter 2.3). A host in another VLAN stays out of reach even when the switch knows its address.

Try the same thing in the simulator. All four hosts carry addresses from one subnet; A and B are on VLAN 10 ports and C and D on VLAN 20 ports. The table has a VLAN column for exactly this reason.` },
        {
          widget: {
            id: 'w-vlan',
            sim: 'vlan-broadcast',
            title: 'Two VLANs, one switch',
            hint: 'Click "A ARP broadcast", then "C ARP broadcast", then "A → C (unicast)". Watch which hosts each frame reaches, and which VLAN each table row belongs to.',
            takeaway: 'A’s broadcast reaches only B and C’s only D. The switch keeps a separate table per VLAN, so VLAN 10 has no entry for C: the unicast from A to C is flooded inside VLAN 10 and **never reaches C**.',
          },
        },
      ],
    },
    {
      id: 'twins',
      title: "Where you've met this",
      blocks: [
        { md: `**Proxmox.** The VLAN tag you set on a VM's NIC is an access-port setting. The Proxmox wiki says that with a VLAN-aware Linux bridge each guest's NIC is assigned to a VLAN tag, "transparently supported by the Linux bridge". The guest keeps sending untagged frames, as b did, and \`bridge vlan show\` lists the VM's tap interface with its VID, like \`v25a\`.

**AWS VPC.** There is no VLAN you configure in a VPC. Subnets are separated by routing and security groups, and two subnets talk through the VPC's implied router. AWS doesn't support broadcast in a VPC at all ([subnet sizing](https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html)), so the isolation this chapter showed is not something you would build there. AWS doesn't publish the internals, so treat this as a statement about what you can configure.

**Kubernetes / Cilium.** Default pod networking has no VLAN concept. Secondary networks (Multus with macvlan or VLAN interfaces, for example) can attach a pod to a VLAN. That is general behaviour of those plugins, not tested here.` },
      ],
    },
    {
      id: 'keep',
      title: 'What to keep',
      blocks: [
        { md: `- A VLAN splits one switch into several broadcast domains. Frames and broadcasts stay inside the VLAN of the port they entered.
- The MAC table is per VLAN: (VLAN, MAC) → port. Knowing a MAC in VLAN 20 does not help a frame in VLAN 10.
- An access port is one VLAN, untagged both ways. \`bridge vlan add dev X vid N pvid untagged\` makes one on a VLAN-aware bridge.
- Hosts know nothing about it: same /24 on two VLANs still means no ARP reply and no ping.
- Connecting two VLANs takes a router. Diagnose the symptom \`INCOMPLETE\` in \`ip neigh\` by checking the VLANs of both ports first.` },
      ],
    },
  ],
};
