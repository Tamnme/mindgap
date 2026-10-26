// Chapter 2.1: Ethernet frames and MAC addresses. Authored content; the tutor gets this file as chapter_source.
// Labs run in netlab (Ubuntu 26.04, iproute2 6.19) on 2026-10-25; outputs described in the prose were observed (twice, in order).
// Sources:
//   https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/using-eni.html (an ENI has a MAC address attribute)
//   https://pve.proxmox.com/wiki/Network_Configuration (the network sees each VM with its own MAC through the bridge)
//   https://man7.org/linux/man-pages/man8/ip-link.8.html (the ip link tooling used in the labs)
// Hedged, not sourced: the field layout, EtherType values, I/G and U/L bit meanings and the 4-byte FCS come from IEEE 802 / 802.3
// as general knowledge (the IEEE page is a paywalled landing page, not read); the observed tcpdump lengths agree (IPv4 ping = 14 + 84 = 98).
// Hedged: the NIC filtering rule (general knowledge; veth drop point not captured on b), and what AWS or Cilium overlays put on the wire between nodes.

const NEED_N21 = `ip netns list | grep -q n21a || { echo "Run the first lab first."; exit 1; }`;

export default {
  node: 'frames-mac',
  number: '2.1',
  kicker: 'Layer 2',
  title: 'Ethernet frames and MAC addresses',
  lede: 'On a link, everything travels in frames. A frame starts with two 6-byte addresses, destination then source, and those MACs name interfaces on one segment, not machines on the internet.',
  sections: [
    {
      id: 'header',
      title: 'Fourteen bytes in front of everything',
      blocks: [
        { md: `Chapter 1.1 showed that a link delivers whatever enters one end. A *frame* is the unit that enters. The part you need to read is its first 14 bytes:

\`\`\`
 6 bytes      6 bytes      2 bytes
+-----------+-----------+----------+----------------------+
| dst MAC   | src MAC   | EtherType| payload (IP packet…) |
+-----------+-----------+----------+----------------------+
\`\`\`

The destination comes first, so a receiver can decide as early as possible whether the frame is for it. The **EtherType** says what the payload is, so the receiver knows which code to hand it to:

| EtherType | Payload |
|---|---|
| \`0x0800\` | IPv4 |
| \`0x0806\` | ARP |
| \`0x86DD\` | IPv6 |
| \`0x8100\` | an 802.1Q VLAN tag follows (chapter 2.6) |

A real wire frame also ends with a 4-byte checksum, the FCS. The NIC checks it and strips it before the OS ever sees the frame, which is why \`tcpdump\` doesn't show it.

A MAC address names an interface on this segment. There is no \`10.x.x.x\` anywhere in those 14 bytes, and a MAC is only meaningful on the link it was used on.

Now watch one. a and b sit on a veth pair with addresses 10.21.0.1 and .2, and a pings b once. The first thing a does is ARP: it knows 10.21.0.2 but not which MAC owns it. Think about what destination MAC that first frame can carry.` },
        {
          checkpoint: {
            id: 'c1',
            prompt: 'a has never talked to 10.21.0.2. What destination MAC is on a’s very first frame, the ARP request?',
            options: [
              'All-zero address (00:00:00:00:00:00): a placeholder meaning "unknown"',
              'All-ones address (ff:ff:ff:ff:ff:ff): every interface on the segment is meant to take it',
              'b’s MAC: ARP asks b directly, because a already knows b’s IP',
              'a’s own MAC: a asks itself and the switch relays the question',
            ],
            key: 1,
            why: 'a is trying to learn b’s MAC, so it cannot put b’s MAC in the header. The address that reaches everyone on the segment is all ones, the broadcast address.',
          },
        },
        {
          lab: {
            explain: 'Build n21a and n21b on a veth pair, then ping once while capturing with tcpdump -e on b',
            cmd: `for n in n21a n21b; do ip netns del $n 2>/dev/null; done
for n in n21a n21b; do ip netns add $n; ip netns exec $n sysctl -qw net.ipv6.conf.all.disable_ipv6=1 net.ipv6.conf.default.disable_ipv6=1; done
ip link add v21a netns n21a type veth peer name v21b netns n21b
ip -n n21a addr add 10.21.0.1/24 dev v21a; ip -n n21b addr add 10.21.0.2/24 dev v21b
ip -n n21a link set v21a up; ip -n n21b link set v21b up
sleep 1
for n in a b; do echo "n21$n: $(ip -n n21$n -br link show v21$n | awk "{print \\$3}")"; done
ip netns exec n21b timeout 5 tcpdump -e -nn -l -c4 -i v21b "arp or icmp" 2>&1 | grep -v -e listening -e "^$" &
sleep 1
ip netns exec n21a ping -c1 -W1 10.21.0.2 >/dev/null
wait`,
          },
        },
        { md: `Four frames, and the \`-e\` flag is what prints the link-level header. Read the first one: \`a-mac > ff:ff:ff:ff:ff:ff, ethertype ARP (0x0806)\`. It is a broadcast carrying ARP.

The second is b's reply: source b's MAC, destination a's MAC, still ARP. This reply is unicast, because b now knows exactly who asked.

Now a knows b's MAC, so frames three and four are \`ethertype IPv4 (0x0800)\`, with b's MAC as destination, then a's. The ping itself is the payload. The same two machines used three different destination-MAC choices in four frames, depending on what the sender knew.

The \`length\` is 98 for the ping and 42 for ARP. 98 is 14 bytes of Ethernet header plus the 84-byte IP packet. So \`tcpdump\`'s \`length\` counts the 14-byte header plus the IP packet. (A veth carries no FCS at all; on a physical NIC the hardware strips it, as above.)

> [!IMPORTANT]
> The destination MAC is chosen by what the sender knows: unknown means broadcast \`ff:ff:ff:ff:ff:ff\`, known means that interface's MAC. The EtherType says what is inside.` },
      ],
    },
    {
      id: 'mac',
      title: 'What is inside a MAC address',
      blocks: [
        { md: `A MAC is 48 bits, written as six hex bytes. The structure is in the first byte and the first three bytes together:

- **First 3 bytes (the OUI):** the vendor prefix, handed out by the IEEE. Tools like Wireshark use it to say which company made a NIC.
- **Bit 0 of the first byte, the I/G bit:** 0 means an individual (unicast) address, 1 means a group address. Broadcast \`ff:ff:ff:ff:ff:ff\` is the all-ones group address, and multicast MACs also have this bit set.
- **Bit 1 of the first byte, the U/L bit:** 0 means universally administered (a vendor burned it in from their OUI), 1 means locally administered (someone, or some software, assigned it).

That makes the first byte worth reading. For example, \`0x3c\` is \`0011 1100\`: bit 0 is 0 (unicast), bit 1 is 0 (universal).` },
        {
          checkpoint: {
            id: 'c2',
            prompt: 'The kernel picks a random MAC for a new veth end. Which values must it give the first byte’s two low bits (I/G, U/L)?',
            options: [
              'Plain vendor-style address (I/G 0, U/L 0): it should look like an ordinary vendor NIC so nothing treats it as special',
              'Group address (I/G 1, U/L 0): a random address is allowed to be a group address',
              'Unicast and locally set (I/G 0, U/L 1): unicast, and marked as not assigned by any vendor',
              'Group and local (I/G 1, U/L 1): group and local, because it is virtual',
            ],
            key: 2,
            why: 'An interface address must be unicast, so I/G is 0. The kernel has no OUI, so it must not pretend to be a vendor-assigned address, so U/L is 1.',
          },
        },
        {
          lab: {
            explain: 'Read the first byte of both veth MACs (and the VM’s own NIC) and print the two low bits',
            cmd: `${NEED_N21}
for n in a b; do
  m=$(ip -n n21$n -br link show v21$n | awk "{print \\$3}"); b1=$((16#\${m%%:*}))
  echo "v21$n $m  first octet bit0 (group)=$((b1&1))  bit1 (local)=$(((b1>>1)&1))"
done
m=$(cat /sys/class/net/$(ls /sys/class/net | grep -m1 -e eth -e enp -e ens)/address); b1=$((16#\${m%%:*}))
echo "VM NIC $m  group=$((b1&1)) local=$(((b1>>1)&1))"`,
          },
        },
        { md: `Both veth MACs come out as group 0, local 1, whatever the random digits are. Different runs give different MACs; the two bits don't change. The VM's own NIC, which OrbStack gives a MAC, is also local 1, group 0. That tells you the address was assigned by software rather than burned in. Try \`ip -br link\` on a hypervisor with real NICs to see the contrast: those first bytes depend on the vendor.

In practice, the U/L bit is a fast way to tell virtual from physical when reading a capture. A veth, a container, a bridge and a virtual NIC will usually show it set. Don't treat it as a rule: a hypervisor may assign addresses from its own registered OUI, and that would look universal.` },
      ],
    },
    {
      id: 'filter',
      title: 'Who accepts a frame',
      blocks: [
        { md: `Because the destination comes first, a receiver can decide what to do with a frame immediately. You can test that with raw frames on the veth. The lab sends three crafted ICMP echo requests from a to b's IP 10.21.0.2. Every frame has the right IP addresses, so the only difference is the destination MAC: b's real MAC, a made-up MAC \`02:00:00:00:00:99\`, and broadcast. A \`tcpdump\` on a counts the echo replies.` },
        {
          checkpoint: {
            id: 'c3',
            prompt: 'All three frames carry an IPv4 echo request addressed to b’s IP. For which destination MACs does b send an echo reply?',
            options: [
              'Only b’s real MAC: any other destination is simply not for b',
              'b’s MAC and broadcast: both are addresses b accepts, the made-up one is not',
              'Any destination MAC works: the IP header says 10.21.0.2, so the MAC is irrelevant',
              'No reply at all: the sender used a raw frame instead of a real ARP exchange',
            ],
            key: 1,
            why: 'Frames are accepted on destination MAC first. b’s own MAC and the broadcast address both pass. A made-up MAC belongs to somebody else, so b discards it before it reaches the IP stack’s local delivery.',
          },
        },
        {
          lab: {
            explain: 'Send one raw echo request each to b’s MAC, a made-up MAC and broadcast; a reply line means b answered',
            cmd: `${NEED_N21}
cat >/tmp/f21.py <<PY
import socket, struct, sys
dst = bytes.fromhex(sys.argv[1].replace(":", ""))
src = bytes.fromhex(open("/sys/class/net/v21a/address").read().strip().replace(":", ""))
def ck(b):
    s = sum(struct.unpack("!%dH" % (len(b)//2), b)); s = (s & 0xffff) + (s >> 16); s = (s & 0xffff) + (s >> 16)
    return ~s & 0xffff
icmp = struct.pack("!BBHHH", 8, 0, 0, 7, 1); icmp = icmp[:2] + struct.pack("!H", ck(icmp)) + icmp[4:]
ip = struct.pack("!BBHHHBBH4s4s", 0x45, 0, 20 + len(icmp), 1, 0, 64, 1, 0, bytes([10,21,0,1]), bytes([10,21,0,2]))
ip = ip[:10] + struct.pack("!H", ck(ip)) + ip[12:]
s = socket.socket(socket.AF_PACKET, socket.SOCK_RAW); s.bind(("v21a", 0))
s.send(dst + src + struct.pack("!H", 0x0800) + ip + icmp)
PY
MB=$(ip -n n21b -br link show v21b | awk "{print \\$3}")
for d in $MB 02:00:00:00:00:99 ff:ff:ff:ff:ff:ff; do
  ip netns exec n21a timeout 2 tcpdump -nl -c1 -i v21a "icmp[icmptype]==icmp-echoreply" 2>/dev/null | sed "s/^/  reply: /" &
  sleep 0.7
  ip netns exec n21a python3 /tmp/f21.py $d
  wait
  echo "sent echo request to dst MAC $d"
done`,
          },
        },
        { md: `The output prints a \`reply:\` line *before* the \`sent …\` line of the frame that caused it, because the capture finishes first. Reading them in pairs: b's real MAC gets a reply. The made-up MAC \`02:00:00:00:00:99\` gets an empty \`reply:\` line, after the 2 s timeout. Broadcast gets a reply again, a little later.

That is the filtering rule. A receiver accepts a frame whose destination is its own MAC, the broadcast address, or a multicast group it has joined, and ignores the rest. On a physical NIC that filter is in hardware, and **promiscuous mode** turns it off so the OS sees everything. \`tcpdump\` enables promiscuous mode by default, the same detail behind the flooding demo in chapter 2.2. A veth has no hardware filter, so on Linux the frame is handed up marked as addressed to someone else and discarded before IP local delivery (this lab doesn't capture on b to show the frame arriving). What a sees is silence: no reply came back.

> [!IMPORTANT]
> A frame for someone else's MAC is discarded before it reaches the IP stack's local delivery. A correct IP address with the wrong MAC gets silence.

Routers are the other half of the story. When a packet crosses a router, the router builds a new frame: new source MAC (its own egress interface), new destination MAC (the next hop), same IP packet. Every hop rewrites both MACs, and none of them ever appear end to end. Chapter 3.2 builds on this.` },
      ],
    },
    {
      id: 'twins',
      title: "Where you've met this",
      blocks: [
        { md: `**AWS.** Every ENI has a MAC address, per the EC2 documentation. Inside an instance, \`tcpdump -e\` shows the MAC your instance uses as the next hop for off-subnet traffic. You'll likely see the same MAC for everything outside the subnet, but AWS doesn't document that or what the MAC belongs to, so check with \`tcpdump -e\` rather than assuming.

**Kubernetes / Cilium.** A pod has a MAC on its veth end (you just saw how that MAC is made). Which MACs appear on the wire between nodes depends on the CNI mode: in an overlay the whole frame or packet is encapsulated, so the outer MACs are the nodes' and not the pods'. Check with \`tcpdump -e\` on the node's NIC rather than assuming.

**Proxmox.** Each VM NIC has its own MAC, visible in the VM config, and the physical network sees one MAC per VM through the bridge, as the Proxmox network documentation says. If a VM is "invisible" to its upstream switch, check its MAC first.` },
      ],
    },
    {
      id: 'keep',
      title: 'What to keep',
      blocks: [
        { md: `- A frame starts with destination MAC, source MAC, then the EtherType (\`0x0800\` IPv4, \`0x0806\` ARP, \`0x86DD\` IPv6, \`0x8100\` VLAN tag). \`tcpdump\` doesn't show the FCS.
- A MAC names one interface on one segment. Unknown destination means broadcast \`ff:ff:ff:ff:ff:ff\`.
- First byte: bit 0 is group vs individual, bit 1 is locally vs universally administered. Software-made MACs (veth, bridges) are local, unicast.
- A frame for another MAC is discarded before it reaches the IP stack's local delivery, and every router rewrites both MACs.
- \`tcpdump -e\` shows the MACs. Use it when "the IP is right but nothing arrives".` },
      ],
    },
  ],
};
