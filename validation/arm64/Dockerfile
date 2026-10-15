FROM ubuntu:24.04
ENV container=docker
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends systemd systemd-sysv util-linux e2fsprogs iproute2 procps fontconfig fonts-dejavu-core libatomic1 libstdc++6 git python3 curl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY node /usr/local/bin/node
RUN test "$(/usr/local/bin/node -p process.arch)" = arm64 && touch /opt/mcc-arm64-disposable.marker
STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
