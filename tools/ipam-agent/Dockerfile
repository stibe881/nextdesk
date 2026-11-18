# nextDesk IPAM-Agent (Linux). Start mit Host-Netzwerk, damit Ping, ARP/NDP
# und SNMP die lokalen Netze sehen:
#   docker build -t nextdesk-ipam-agent tools/ipam-agent
#   docker run -d --name nextdesk-ipam-agent --network host --restart unless-stopped \
#     -v /etc/nextdesk-ipam-agent:/etc/nextdesk-ipam-agent:ro nextdesk-ipam-agent
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --no-audit --no-fund
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends iputils-ping iproute2 \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
ENV NODE_ENV=production \
    IPAM_AGENT_CONFIG=/etc/nextdesk-ipam-agent/config.json
# Kein root: ping nutzt die Datei-Capability cap_net_raw (Docker-Standard).
USER node
CMD ["node", "dist/main.js"]
