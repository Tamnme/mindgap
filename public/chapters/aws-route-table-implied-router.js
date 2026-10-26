// Chapter 3.6: AWS route table and the implied router. Authored content; the tutor gets this file as chapter_source.
// No labs: the VPC router exists only inside AWS, and netlab cannot reproduce it. The Linux side of everything here (longest prefix, next hop, metric) was already run in chapters 3.4 and 3.5, and the routes widget below replays this chapter's AWS-style table. Fetched on 2026-10-25 and not run against a real VPC.
// Sources: https://docs.aws.amazon.com/vpc/latest/userguide/subnet-sizing.html (10.0.0.1 in 10.0.0.0/24 is "Reserved by AWS for the VPC router"),
//   https://docs.aws.amazon.com/vpc/latest/userguide/subnet-route-tables.html (every route table has a local route, added by default, whose target can be replaced or restored; each subnet must be associated with a route table, explicitly or implicitly via the main table; more-specific-than-local routes: the destination must match the entire CIDR of a subnet in the VPC and the target must be a NAT gateway, network interface or Gateway Load Balancer endpoint; most specific route wins),
//   https://docs.aws.amazon.com/vpc/latest/userguide/route-table-options.html (middlebox appliance examples, incl. a gateway route table whose subnet-CIDR route "is more specific than the local route"; NAT, peering and gateway endpoint rows; gateway-endpoint routes cannot be deleted or modified; security-group note for inter-subnet appliances),
//   https://docs.aws.amazon.com/vpc/latest/userguide/route-tables-priority.html (longest prefix first, then static, prefix-list, propagated; the static-route resources: internet gateway, NAT gateway, network interface, instance ID, gateway VPC endpoint, transit gateway, VPC peering connection, Gateway Load Balancer endpoint),
//   https://docs.aws.amazon.com/vpc/latest/userguide/WorkWithRouteTables.html (subnets without an explicit association are implicitly associated with the main route table),
//   https://aws.amazon.com/blogs/aws/new-vpc-ingress-routing-simplifying-integration-of-third-party-appliances/ (AWS News Blog, dated 03 DEC 2019: announces VPC ingress routing, a route table attached to an internet gateway that sends incoming traffic to an appliance's network interface).
// Hedged, not sourced: how AWS builds the router, the date the subnet-to-subnet form (an appliance row inside a subnet table) became available (the page I fetched carries no date; a dated announcement returned 404), and the Kubernetes remark.

export default {
  node: 'aws-route-table-implied-router',
  number: '3.6',
  kicker: 'Layer 3',
  title: 'AWS route table and the implied router',
  lede: 'In a VPC the router is implied: you never log into it, you only edit route tables. The questions that matter are which table a packet is read against, and which row in it wins.',
  sections: [
    {
      id: 'implied',
      title: 'The router you never see',
      blocks: [
        { md: `Chapter 3.2 gave an instance's first decision: destination on its own prefix, or send it to the default gateway. In a VPC, that gateway is the **VPC router**, and AWS puts it at a fixed address. The subnet-sizing page lists the reserved addresses of a \`10.0.0.0/24\` subnet, and \`10.0.0.1\` is "Reserved by AWS for the VPC router": the subnet's base address plus one. In a subnet \`10.0.1.0/24\` it is \`10.0.1.1\`. (The same page reserves base+2 for the DNS server and base+3 for future use.)

You cannot SSH to it, give it a second address or read its table with \`ip route\`. AWS doesn't publish how it is built, so treat it as a function: it applies a route table to each packet. The table is the only thing you configure.

Set up a concrete VPC: CIDR \`10.0.0.0/16\`, with subnets \`10.0.1.0/24\` (call it **app**) and \`10.0.2.0/24\` (**db**). You edit app's route table and add exactly one row yourself:

| Destination | Target |
|---|---|
| \`0.0.0.0/0\` | \`nat-0abc\` |

An instance in app, \`10.0.1.10\`, then sends a packet to \`10.0.2.40\` in db, a different subnet of the same VPC.` },
        {
          checkpoint: {
            id: 'c1',
            prompt: 'The only row you added is 0.0.0.0/0 → nat-0abc. Where does the packet for 10.0.2.40 go?',
            options: [
              'Via the NAT gateway: 0.0.0.0/0 is the one row, and it matches',
              'Delivered inside the VPC: a row you did not add already covers it',
              'Dropped, no route: nothing mentions 10.0.2.0/24',
              'Needs a gateway: separate subnets cannot talk without peering or a transit gateway',
            ],
            key: 1,
            why: 'Every route table starts with a local row for the VPC CIDR. 10.0.0.0/16 is longer than 0.0.0.0/0, so for 10.0.2.40 the local row wins (chapter 3.4) and the packet is delivered inside the VPC.',
          },
        },
        { md: `The subnet-route-tables page says: "Every route table contains a local route for communication within the VPC. This route is added by default to all route tables." If the VPC has more than one IPv4 CIDR block, there is one local row for each. The page says you can replace or restore the target of each local route.

So app's real table is:

| Destination | Target |
|---|---|
| \`10.0.0.0/16\` | \`local\` |
| \`0.0.0.0/0\` | \`nat-0abc\` |

This is the longest-prefix rule from chapter 3.4 doing the work. \`10.0.2.40\` matches both rows, the /16 wins, and the target \`local\` means "deliver inside the VPC". AWS's own page says it uses "the most specific route that matches the traffic".

The other targets play the part of the next hop (chapter 3.5): internet gateway, NAT gateway, VPC peering connection (\`pcx-\`), transit gateway (\`tgw-\`), a gateway VPC endpoint (\`vpce-\`), a network interface, a Gateway Load Balancer endpoint. The priority page lists exactly these as the resources that create *static* routes. When two rows have the *same* destination, AWS prefers static rows over prefix-list rows over propagated rows, as the priority page describes. Prefix length always comes first.

> [!IMPORTANT]
> The local row is always there. For traffic inside the VPC CIDR it wins by prefix length, and you never wrote it.` },
      ],
    },
    {
      id: 'assoc',
      title: 'Which table applies',
      blocks: [
        { md: `Take two subnets, each with a custom table of its own. **app** (\`10.0.1.0/24\`) uses \`RT-app\`, and **db** (\`10.0.2.0/24\`) uses \`RT-db\`. \`RT-db\` is the default shape: local, plus \`0.0.0.0/0 → nat-0def\`. An admin adds one row to \`RT-app\` only:

| Destination | Target |
|---|---|
| \`10.1.0.0/16\` | \`pcx-1\` (a peering to another VPC) |

An instance in **db** now sends a packet to \`10.1.4.4\`, an address in the peer VPC.` },
        {
          checkpoint: {
            id: 'c2',
            prompt: 'The peering row is only in RT-app. Where does a packet from a db instance to 10.1.4.4 go?',
            options: [
              'Via the peering: once a row exists in the VPC, every subnet gets it',
              "The peer VPC's table decides: the destination side picks the path",
              "db's own table: RT-db has no row for 10.1.0.0/16, so the NAT default takes it",
              'The main route table: it is the one table all subnets fall back to',
            ],
            key: 2,
            why: "A packet is read against the table associated with the subnet it leaves. RT-db has no 10.1.0.0/16 row, so only its default row matches and the packet goes to the NAT gateway, not the peering.",
          },
        },
        { md: `A route table is a separate object from a subnet, and a subnet gets its table by **association**. The subnet-route-tables page says each subnet must be associated with a route table: explicitly with a custom one, or with the main route table, either explicitly or implicitly. A subnet you never associated is implicitly associated with the main route table (WorkWithRouteTables page). The page states the limit outright: "A subnet can only be associated with one route table at a time, but you can associate multiple subnets with the same subnet route table." The router applies *that* table to each packet leaving the subnet.

The route table is read for traffic *leaving* the subnet it is associated with. A row added to \`RT-app\` does nothing for db. A familiar symptom after setting up a peering is "it works from the instance I tested, not from the other subnet": the row exists, but in one table (general experience, not from the docs).

The same reasoning explains why replies need their own rows. A reply is a new packet leaving the destination's subnet, so it is read against that subnet's table (this follows from the rule above; the exact return-path behaviour for each target was not tested here).

Two practical consequences:

- A new subnet with no explicit association inherits the **main** table, whatever is in it at that moment. If someone adds an internet-gateway row to the main table, every subnet that depends on the main table gets it.
- To see a subnet's real routing, find its association first and read that table. The console's subnet page has a Route table tab for exactly this.` },
      ],
    },
    {
      id: 'inspect',
      title: 'Steering traffic through a firewall',
      blocks: [
        { md: `A third subnet, **fw** (\`10.0.3.0/24\`), holds a firewall appliance with the network interface \`eni-fw1\`. The goal is to inspect everything that app sends *to db*, and nothing else. app's table is:

| Destination | Target |
|---|---|
| \`10.0.0.0/16\` | \`local\` |
| \`10.0.2.0/24\` | \`eni-fw1\` |
| \`0.0.0.0/0\` | \`nat-0abc\` |

The second row is new. An instance in app sends one packet to \`10.0.2.40\` (db) and another to \`10.0.3.40\` (fw).` },
        {
          checkpoint: {
            id: 'c3',
            prompt: 'The /24 row to eni-fw1 sits inside the VPC CIDR, next to the local row. What happens to the packets for 10.0.2.40 and 10.0.3.40?',
            options: [
              'Row wins for its own subnet: 10.0.2.40 goes to eni-fw1 and 10.0.3.40 stays local',
              'Row refused: nothing may be more specific than the local route',
              'Local always wins: it covers the whole VPC CIDR, so both stay local',
              'Firewall takes all VPC traffic: both go to eni-fw1',
            ],
            key: 0,
            why: 'AWS accepts a row more specific than local when the destination is the full CIDR of a subnet. For 10.0.2.40 the /24 beats the /16, so it goes to the appliance. 10.0.3.40 is outside the /24 and still matches only the local row.',
          },
        },
        { md: `The subnet-route-tables page states the rule outright: "You can add a route to your route tables that is more specific than the local route. The destination must match the entire IPv4 or IPv6 CIDR block of a subnet in your VPC. The target must be a NAT gateway, network interface, or Gateway Load Balancer endpoint." The page adds that middlebox appliances can be added to the routing paths of the VPC, and gives the inter-subnet example: subnet A's table sends subnet B's CIDR to the appliance's interface, and subnet B's table sends subnet A's CIDR the same way.

Nothing about the lookup changes. The local row is still there, and the /24 row simply beats it for its own addresses, the same longest-prefix choice you ran in chapter 3.4. Only db's addresses are intercepted. A second row of the same kind would catch another subnet.

Two things the docs call out:

- **Return path.** The appliance's own subnet needs a table that sends traffic onward, and the reply direction needs the matching rows, as the page's example tables show.
- **Security groups.** For instances in different subnets routed through an appliance, each instance's security group must allow the other by its private IP or by the CIDR of its subnet. Referencing the other instance's *security group* as the source does not allow the traffic.

A different way to say "everything", from the same page: replace the local route's target with the appliance's interface, so that all traffic for the VPC CIDR, including subnets you add later, goes through it.

**When this arrived.** The AWS News Blog post "New – VPC Ingress Routing", dated 3 December 2019, announced routing for inbound traffic through an appliance: a route table associated with the internet gateway whose row sends traffic to the appliance's network interface. The User Guide page for the subnet-table form quoted here carries no date, and a dated announcement for that form returned a 404 when requested, so treat 2019 as the date for the gateway-table form only.` },
        {
          widget: {
            id: 'w-aws-rt',
            kind: 'routes',
            title: 'app\'s route table',
            hint: 'Try 10.0.3.40 first and count the matching rows before reading the winner, then 10.0.2.40. Finish with 10.1.4.4 and 8.8.8.8.',
            takeaway: '10.0.2.40 matches three rows and the /24 beats local; 10.0.3.40 matches two and local wins; 10.1.4.4 and 8.8.8.8 fall to the peering row and the NAT default.',
            caption: 'Route table of the app subnet',
            routes: [
              { prefix: '10.0.0.0/16', target: 'local' },
              { prefix: '10.0.2.0/24', target: 'eni-fw1' },
              { prefix: '10.1.0.0/16', target: 'pcx-1' },
              { prefix: '0.0.0.0/0', target: 'nat-0abc' },
            ],
            dest: '10.0.3.40',
            presets: ['10.0.3.40', '10.0.2.40', '10.1.4.4', '8.8.8.8'],
          },
        },
      ],
    },
    {
      id: 'twins',
      title: "Where you've met this",
      blocks: [
        { md: `**Kubernetes.** If pod IPs are VPC addresses (for example, pods that get addresses from the VPC subnets), the same table routes them as it routes any instance address. With an overlay only the node IPs appear on the VPC side. Which one a cluster uses depends on the CNI, and this was not sourced or tested here.

**Proxmox.** There is no implied router. The gateway is a real machine or VM with its own routing table, which you configure and can log into, with \`ip route\` and \`ip route get\` as in chapters 3.4 and 3.5. In AWS you edit rows and AWS applies them.` },
      ],
    },
    {
      id: 'keep',
      title: 'What to keep',
      blocks: [
        { md: `- The VPC router is the subnet's base address plus one. It applies the associated route table and is not a box you can reach or configure.
- Every route table contains a local row for the VPC CIDR. It wins inside the VPC by prefix length, not by special treatment.
- A packet is read against the table associated with the subnet it leaves. Unassociated subnets use the main table.
- Targets (igw, nat, pcx, tgw, vpce, network interface) play the next-hop role. Same destination: static before prefix-list before propagated.
- A row more specific than local is allowed when the destination is a whole subnet CIDR and the target is a NAT gateway, network interface or Gateway Load Balancer endpoint. That is how inspection appliances are put in the path.` },
      ],
    },
  ],
};
