#!/bin/sh
# Vendor the H-MEM reference into vendor/hmem at a pinned upstream commit.
# Replaces the starter's `npx degit` step, which downloads the whole monorepo
# tarball and stalled on this network. A sparse, blobless clone fetches only
# the engine files.
set -eu
COMMIT="$(cat vendor/HMEM_SOURCE_COMMIT 2>/dev/null || echo main)"
if [ -f vendor/hmem/src/index.ts ]; then
  echo "vendor/hmem already present (pinned ${COMMIT}); delete it to re-vendor"
  exit 0
fi
TMP="$(mktemp -d)"
git clone --filter=blob:none --no-checkout --quiet https://github.com/Meterless/Meterless.git "$TMP/meterless"
git -C "$TMP/meterless" sparse-checkout set engines/hmem/reference
git -C "$TMP/meterless" checkout --quiet "$COMMIT"
mkdir -p vendor
cp -R "$TMP/meterless/engines/hmem/reference" vendor/hmem
git -C "$TMP/meterless" rev-parse HEAD > vendor/HMEM_SOURCE_COMMIT
rm -rf "$TMP"
echo "vendored H-MEM reference at $(cat vendor/HMEM_SOURCE_COMMIT)"
