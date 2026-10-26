FROM ubuntu:26.04

RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      iproute2 bridge-utils tcpdump iputils-ping iputils-tracepath traceroute \
      netcat-openbsd dnsutils ethtool iptables nftables conntrack dnsmasq-base \
      procps python3 curl \
 && rm -rf /var/lib/apt/lists/*

CMD ["sleep", "infinity"]
