#!/usr/bin/env bash
# Idempotent setup for the OrbStack "netlab" lab VM used by underlay.
# Creates the machine if missing, installs networking tools as root, prints versions.
set -euo pipefail

ORB="${ORB:-orb}"
MACHINE="netlab"

if ! "$ORB" list -q | grep -qx "$MACHINE"; then
  echo "Creating OrbStack machine '$MACHINE' (ubuntu)..."
  "$ORB" create ubuntu "$MACHINE"
else
  echo "Machine '$MACHINE' already exists, skipping create."
fi

PACKAGES="iproute2 bridge-utils tcpdump iputils-ping iputils-tracepath traceroute netcat-openbsd dnsutils ethtool iptables conntrack dnsmasq-base"

"$ORB" -m "$MACHINE" -u root bash -lc "
  set -euo pipefail
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq $PACKAGES
  echo '--- versions ---'
  ip -V
  tcpdump --version 2>&1 | head -1
"

echo "setup-netlab: OK"
