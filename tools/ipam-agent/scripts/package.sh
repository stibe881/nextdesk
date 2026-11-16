#!/usr/bin/env bash
# Baut das Installationspaket der Sonde (nextdesk-sonde-<version>.zip) mit
# allem, was ein Server braucht: gebauter Agent, Abhängigkeiten,
# Installationsskripte für Windows und Linux sowie WinSW (Dienst-Wrapper).
#
#   scripts/package.sh [Ausgabeordner] [Build-Kennung]
#
# WINSW_EXE=<Pfad> verwendet eine vorhandene WinSW-x64.exe statt des Downloads.
set -euo pipefail

cd "$(dirname "$0")/.."
OUT="${1:-package}"
BUILD="${2:-local}"
VERSION="$(node -p "require('./package.json').version")"
WINSW_URL="https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe"
WINSW_SHA256="05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da"
ROOT="$OUT/nextdesk-sonde"
ZIP="nextdesk-sonde-$VERSION-$BUILD.zip"

rm -rf "$OUT"
mkdir -p "$ROOT"
npm ci --no-audit --no-fund
npm run build
npm prune --omit=dev --no-audit --no-fund
cp -r dist node_modules package.json README.md config.example.json windows linux "$ROOT/"

if [ -n "${WINSW_EXE:-}" ]; then
  cp "$WINSW_EXE" "$ROOT/windows/WinSW-x64.exe"
else
  curl -fsSL --retry 3 -o "$ROOT/windows/WinSW-x64.exe" "$WINSW_URL"
fi
echo "$WINSW_SHA256  $ROOT/windows/WinSW-x64.exe" | sha256sum -c -

printf '%s\n' "$VERSION" > "$ROOT/VERSION"
(cd "$OUT" && zip -qr "$ZIP" nextdesk-sonde)
SIZE="$(stat -c %s "$OUT/$ZIP")"
SHA="$(sha256sum "$OUT/$ZIP" | cut -d' ' -f1)"
node -e '
  const [version, build, file, size, sha256] = process.argv.slice(1);
  process.stdout.write(JSON.stringify({
    version, build, file, size: Number(size), sha256,
    builtAt: new Date().toISOString(),
  }, null, 2) + "\n");
' "$VERSION" "$BUILD" "$ZIP" "$SIZE" "$SHA" > "$OUT/latest.json"
echo "Paket: $OUT/$ZIP ($SIZE Bytes)"
