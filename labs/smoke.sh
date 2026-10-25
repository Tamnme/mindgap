#!/usr/bin/env bash
# Smoke test: Linux bridge lab0 with three netns (hA, hB, hC) on 10.0.0.0/24.
# Runs INSIDE netlab as root, e.g.:
#   orb -m netlab -u root bash -lc "$(cat labs/smoke.sh)"
set -euo pipefail

BR="lab0"
NAMES=(hA hB hC)
IPS=(10.0.0.1 10.0.0.2 10.0.0.3)

pass() { echo "PASS: $*"; }
fail() { echo "FAIL: $*"; exit 1; }

cleanup() {
  for n in "${NAMES[@]}"; do ip netns del "$n" 2>/dev/null || true; done
  ip link del "$BR" 2>/dev/null || true
}
trap cleanup EXIT

# Idempotent: start from a clean slate.
cleanup

ip link add "$BR" type bridge
ip link set "$BR" up

for i in "${!NAMES[@]}"; do
  n="${NAMES[$i]}"
  ip netns add "$n"
  ip link add "vb$n" type veth peer name eth0 netns "$n"
  ip link set "vb$n" master "$BR"
  ip link set "vb$n" up
  ip -n "$n" link set lo up
  ip -n "$n" link set eth0 up
  ip -n "$n" addr add "${IPS[$i]}/24" dev eth0
done
pass "created bridge $BR and netns ${NAMES[*]}"

# Baseline connectivity hA -> hC.
if ip netns exec hA ping -c 2 -W 2 10.0.0.3 >/dev/null 2>&1; then
  pass "ping hA(10.0.0.1) -> hC(10.0.0.3)"
else
  fail "ping hA -> hC on plain bridge"
fi

# Learned FDB entries (non-permanent).
fdb=$(bridge fdb show br "$BR" | grep -v permanent || true)
echo "--- bridge fdb show br $BR | grep -v permanent ---"
echo "$fdb"

mac_a=$(ip -n hA link show eth0 | awk '/link\/ether/ {print $2}')
mac_c=$(ip -n hC link show eth0 | awk '/link\/ether/ {print $2}')

grep -qi "$mac_a" <<<"$fdb" || fail "hA MAC $mac_a not learned on $BR"
pass "hA MAC $mac_a learned"
grep -qi "$mac_c" <<<"$fdb" || fail "hC MAC $mac_c not learned on $BR"
pass "hC MAC $mac_c learned"

# VLAN check: hA in VLAN 10, hC in VLAN 20, both untagged pvid. Ping must fail.
ip link set "$BR" type bridge vlan_filtering 1
bridge vlan del dev "vbhA" vid 1 2>/dev/null || true
bridge vlan del dev "vbhC" vid 1 2>/dev/null || true
bridge vlan add dev "vbhA" vid 10 pvid untagged
bridge vlan add dev "vbhC" vid 20 pvid untagged
ip netns exec hA ip neigh flush all
ip netns exec hC ip neigh flush all

if ip netns exec hA ping -c 2 -W 2 10.0.0.3 >/dev/null 2>&1; then
  fail "hA -> hC still reachable across VLAN 10 / VLAN 20"
fi
pass "ping hA -> hC blocked across VLAN 10 / VLAN 20"

echo "PASS: smoke complete"
