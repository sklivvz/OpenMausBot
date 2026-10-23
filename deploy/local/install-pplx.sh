#!/bin/sh
# Installs the official pplx binary for this machine, checksum checked.
# Usage: install-pplx.sh v0.2.3
set -eu

TAG="${1:?release tag required}"
case "$TAG" in
  *[!A-Za-z0-9._-]*) echo "malformed pplx release tag" >&2; exit 1 ;;
esac

case "$(uname -s)-$(uname -m)" in
  Linux-aarch64|Linux-arm64) ASSET=pplx-aarch64-linux-gnu.bin ;;
  Linux-x86_64|Linux-amd64) ASSET=pplx-x86_64-linux-gnu.bin ;;
  *) echo "unsupported platform for pplx: $(uname -s) $(uname -m)" >&2; exit 1 ;;
esac

BASE=https://github.com/perplexityai/perplexity-cli
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

curl -fsSL --retry 3 "$BASE/releases/download/$TAG/SHA256SUMS" -o "$TMP/SHA256SUMS"
curl -fsSL --retry 3 "$BASE/releases/download/$TAG/$ASSET" -o "$TMP/$ASSET"
(cd "$TMP" && grep "  $ASSET\$" SHA256SUMS | sha256sum -c -)
install -m 0755 "$TMP/$ASSET" /usr/local/bin/pplx
pplx --version >/dev/null
