#!/bin/sh
# Browser Sanity — native host installer (macOS / .pkg)
#
# TOOLCHAIN: macOS with Xcode command-line tools — `pkgbuild` (and, for signing/
# notarization, `productsign` + `xcrun notarytool` + `xcrun stapler`). Run on a
# macos-latest runner (see .github/workflows/release-host.yml) or by a maintainer.
#
# This script is NOT run in the CI-less / offline Linux sandbox — pkgbuild only
# exists on macOS. It expects the SEA binary from `npm run build:sea` at
# dist/host/browser-sanity-host.
#
# Produces dist/BrowserSanity.pkg. The payload stages the binary under
# /usr/local/browser-sanity; the postinstall script (scripts/postinstall)
# copies it into the logged-in user's ~/.browser-sanity and runs `--install`
# so registration is per-user (no root-owned manifests).
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
# Default the version from the single source of truth (native-host/package.json);
# CI overrides via $VERSION. Keeps all installers from drifting apart.
VERSION="${VERSION:-$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$ROOT_DIR/native-host/package.json" | head -1)}"
IDENTIFIER="io.github.greenysmac.browsersanity.host"
BIN="$ROOT_DIR/dist/host/browser-sanity-host"
OUT="$ROOT_DIR/dist/BrowserSanity.pkg"

if [ ! -f "$BIN" ]; then
  echo "error: $BIN not found — run 'npm run build:sea' first." >&2
  exit 1
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/payload/usr/local/browser-sanity"
cp "$BIN" "$STAGE/payload/usr/local/browser-sanity/browser-sanity-host"
chmod 755 "$STAGE/payload/usr/local/browser-sanity/browser-sanity-host"

mkdir -p "$STAGE/scripts"
cp "$ROOT_DIR/installer/macos/scripts/postinstall" "$STAGE/scripts/postinstall"
chmod 755 "$STAGE/scripts/postinstall"

mkdir -p "$ROOT_DIR/dist"
pkgbuild \
  --root "$STAGE/payload" \
  --scripts "$STAGE/scripts" \
  --identifier "$IDENTIFIER" \
  --version "$VERSION" \
  --install-location "/" \
  "$OUT"

echo "Built $OUT"
# Signing + notarization (maintainer/CI, requires an Apple Developer account):
#   productsign --sign "Developer ID Installer: <NAME> (<TEAMID>)" "$OUT" "$OUT.signed"
#   xcrun notarytool submit "$OUT.signed" --keychain-profile "<PROFILE>" --wait
#   xcrun stapler staple "$OUT.signed"
