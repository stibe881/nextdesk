#!/usr/bin/env bash
# Installiert oder aktualisiert die nextDesk-Sonde als Docker-Container.
#
#   sudo linux/install.sh [Pfad zur config.json]
#
# Ohne Angabe wird die config.json im Paketordner verwendet; fehlt sie dort,
# bleibt eine bereits installierte Konfiguration erhalten (Aktualisierung).
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_DIR=/etc/nextdesk-ipam-agent
CONFIG="${1:-$DIR/config.json}"
NAME=nextdesk-ipam-agent

command -v docker >/dev/null || { echo "Docker ist nicht installiert." >&2; exit 1; }
mkdir -p "$CONFIG_DIR"
if [ -f "$CONFIG" ]; then
  install -m 600 -o 1000 -g 1000 "$CONFIG" "$CONFIG_DIR/config.json"
elif [ ! -f "$CONFIG_DIR/config.json" ]; then
  echo "config.json fehlt. In nextDesk unter Sonde hinzufügen herunterladen und in $DIR legen." >&2
  exit 1
fi

docker build -t "$NAME" -f "$DIR/linux/Dockerfile" "$DIR"
docker run --rm --network host -v "$CONFIG_DIR:$CONFIG_DIR:ro" "$NAME" node dist/main.js --check
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --network host --restart unless-stopped \
  -v "$CONFIG_DIR:$CONFIG_DIR:ro" "$NAME" >/dev/null
echo "Sonde läuft (Version $(cat "$DIR/VERSION" 2>/dev/null || echo '?')). Protokoll: docker logs -f $NAME"
if [ -f "$DIR/config.json" ]; then
  echo "Hinweis: $DIR/config.json enthält den Zugangsschlüssel und kann jetzt gelöscht werden."
fi
