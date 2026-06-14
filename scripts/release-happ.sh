#!/usr/bin/env bash
#
# One-time (per DNA version) bootstrap of the canonical, FROZEN happ release.
#
# Why this exists: the zome wasm embeds the original builder's absolute paths
# (~/.cargo/... and source file paths via the HDK macros), so the happ cannot be
# reproduced byte-for-byte on a different machine/user or in CI. The published
# DNA was built once (by user "leo"); rebuilding anywhere else yields a DIFFERENT
# DNA hash, i.e. a DIFFERENT network. To keep every install on the same network
# we reuse the exact original happ bytes forever.
#
# This script recovers those exact bytes from an already-published .webhapp,
# verifies the DNA sha256, and publishes them as the `happ-v<dnaVersion>` release
# that release-webhapp.yaml downloads. Run it once per DNA version.
#
# Requirements: `hc` (enter `nix develop` first) and `gh` (authenticated).
# Usage: nix develop --command bash scripts/release-happ.sh [SOURCE_WEBHAPP_URL]
set -euo pipefail

# The frozen DNA. Every webhapp release must embed a happ with this sha256.
EXPECTED_SHA="8a7584239b7cd4349b08f8083c9dd479b9dc112112cda5c58757f0aff1dda750"

HAPP_TAG=$(tr -d '[:space:]' < .happ-version)
SRC_WEBHAPP_URL="${1:-https://github.com/lightningrodlabs/notebooks/releases/download/v0.6.0/notebooks.webhapp}"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "Recovering canonical happ from: $SRC_WEBHAPP_URL"
curl -fsSL -o "$tmp/src.webhapp" "$SRC_WEBHAPP_URL"
hc web-app unpack "$tmp/src.webhapp" -o "$tmp/wa" >/dev/null

got=$(sha256sum "$tmp/wa/notebooks.happ" | awk '{print $1}')
if [ "$got" != "$EXPECTED_SHA" ]; then
  echo "ERROR: recovered happ sha256 ($got) != expected canonical ($EXPECTED_SHA)." >&2
  echo "Refusing to publish a happ that would change the DNA/network." >&2
  exit 1
fi
echo "Verified canonical happ sha256 = $got"

if gh release view "$HAPP_TAG" >/dev/null 2>&1; then
  echo "Release $HAPP_TAG already exists; uploading/clobbering the happ asset."
  gh release upload "$HAPP_TAG" "$tmp/wa/notebooks.happ" --clobber
else
  gh release create "$HAPP_TAG" "$tmp/wa/notebooks.happ" \
    --title "Canonical happ $HAPP_TAG (frozen DNA)" \
    --notes "Frozen canonical notebooks.happ reused by every webhapp release to keep all installs on the same network. DNA sha256: $EXPECTED_SHA. Do NOT rebuild."
fi
echo "Done. release-webhapp.yaml will download notebooks.happ from $HAPP_TAG."
