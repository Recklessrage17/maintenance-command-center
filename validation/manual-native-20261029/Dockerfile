FROM node@sha256:8f96ba6ac643748ef847a961a11459b801308a8cd40ad59cc37363e1301a6567
ENV DEBIAN_FRONTEND=noninteractive
RUN test "$(dpkg --print-architecture)" = arm64 && . /etc/os-release && test "$VERSION_ID" = 13 \
 && apt-get update \
 && apt-get install -y --no-install-recommends -t trixie \
    'libreoffice-calc=4:25.2.3-2+deb13u6' 'libreoffice-core=4:25.2.3-2+deb13u6' \
    'fonts-crosextra-carlito=20230309-2' 'fonts-dejavu-core=2.37-8' 'fonts-liberation=1:2.1.5-3' \
    'fonts-noto-core=20201225-2' 'fonts-noto-extra=20201225-2' fonts-droid-fallback \
    'fonts-opensymbol=4:102.12+LibO25.2.3-2+deb13u6' 'fonts-urw-base35=20200910-8' \
    ca-certificates git unzip procps python3 python3-pip poppler-utils fontconfig \
    libnss3 libnspr4 libdbus-1-3 libatk1.0-0t64 libatk-bridge2.0-0t64 \
    libcups2t64 libxkbcommon0 libatspi2.0-0t64 libx11-6 libxcomposite1 libxdamage1 \
    libxext6 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /work
