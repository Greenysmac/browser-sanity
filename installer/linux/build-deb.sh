#!/bin/sh
# Browser Sanity — native host installer (Linux / .deb)
#
# TOOLCHAIN: dpkg-deb (Debian/Ubuntu: `apt-get install dpkg-dev`). Run on an
# ubuntu-latest runner (see .github/workflows/release-host.yml) or a Debian host.
# NOT run in the offline sandbox unless dpkg-deb is present.
#
# Expects the SEA binary from `npm run build:sea` at
# dist/host/browser-sanity-host. Produces
# dist/browser-sanity-host_<version>_amd64.deb.
#
# The package installs the binary system-wide at
# /usr/lib/browser-sanity/browser-sanity-host and drops a helper wrapper at
# /usr/bin/browser-sanity-host. Native-messaging manifests are per-user, so
# registration is NOT done at package-install time: each user runs
# `browser-sanity-host --install` once (the postinst prints this hint). This
# keeps the package free of per-user side effects and multi-user safe.
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
# Default the version from the single source of truth (native-host/package.json);
# CI overrides via $VERSION. Keeps all installers from drifting apart.
VERSION="${VERSION:-$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$ROOT_DIR/native-host/package.json" | head -1)}"
ARCH="${ARCH:-amd64}"
BIN="$ROOT_DIR/dist/host/browser-sanity-host"
OUT="$ROOT_DIR/dist/browser-sanity-host_${VERSION}_${ARCH}.deb"

if [ ! -f "$BIN" ]; then
  echo "error: $BIN not found — run 'npm run build:sea' first." >&2
  exit 1
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE/usr/lib/browser-sanity" "$STAGE/usr/bin" "$STAGE/DEBIAN"
cp "$BIN" "$STAGE/usr/lib/browser-sanity/browser-sanity-host"
chmod 755 "$STAGE/usr/lib/browser-sanity/browser-sanity-host"
ln -s ../lib/browser-sanity/browser-sanity-host "$STAGE/usr/bin/browser-sanity-host"

cat > "$STAGE/DEBIAN/control" <<EOF
Package: browser-sanity-host
Version: $VERSION
Section: utils
Priority: optional
Architecture: $ARCH
Maintainer: Jeff Greenberg (https://github.com/Greenysmac)
Homepage: https://github.com/Greenysmac/browser-sanity
Description: Browser Sanity native messaging host
 Local helper that lets the Browser Sanity browser extension talk to your
 AI CLI or an OpenAI-compatible endpoint. Registered system-wide for Chrome,
 Chromium, and Edge on install (available to all users on this machine).
EOF

# Static system-wide native-messaging manifests, shipped in the package payload so
# dpkg tracks them (dpkg -L), removes them on uninstall, and cleans empty dirs it
# created. Linux browsers read these /etc dirs for all users. No maintainer scripts.
for dir in "$STAGE/etc/opt/chrome/native-messaging-hosts" "$STAGE/etc/chromium/native-messaging-hosts" "$STAGE/etc/opt/edge/native-messaging-hosts"; do
  mkdir -p "$dir"
  cat > "$dir/com.browser_sanity.host.json" <<'JSON'
{
  "name": "com.browser_sanity.host",
  "description": "Browser Sanity native host",
  "path": "/usr/lib/browser-sanity/browser-sanity-host",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://kebmdofdghcjmknaecnojcglkibcacgn/"
  ]
}
JSON
done

mkdir -p "$ROOT_DIR/dist"
dpkg-deb --build --root-owner-group "$STAGE" "$OUT"
echo "Built $OUT"
