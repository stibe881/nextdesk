# Laufzeit-Image aus dem Installationspaket (bereits gebaut, kein Compiler
# nötig). Wird von linux/install.sh im Paketordner gebaut.
FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends iputils-ping iproute2 \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY dist ./dist
COPY node_modules ./node_modules
COPY package.json ./
ENV NODE_ENV=production \
    IPAM_AGENT_CONFIG=/etc/nextdesk-ipam-agent/config.json
# Kein root: ping nutzt die Datei-Capability cap_net_raw (Docker-Standard).
USER node
# openssl-legacy-provider: SNMPv3 mit DES (z. B. ältere APC-USV).
CMD ["node", "--openssl-legacy-provider", "dist/main.js"]
