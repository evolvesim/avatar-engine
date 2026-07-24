#!/usr/bin/env bash
# Mirror the built engine into each product's vendored copy.
#
# Both products depend on "@evolvesim/avatar-engine": "file:vendor/avatar-engine"
# so builds need NO npm token / GitHub Packages access. This script is the
# "publish": build the engine, then copy dist/ + package.json into each product's
# vendor/avatar-engine/. Run it from the engine repo root after any engine change,
# then commit the vendored change in each product.
#
# Usage: scripts/sync-vendor.sh [product-dir ...]
#   Defaults to the sibling ../evolve-sim-portal, ../avatar-playground and
#   ../acts-education-portal.
set -euo pipefail
cd "$(dirname "$0")/.."
ENGINE_ROOT="$(pwd)"

echo "▸ Building engine…"
npm run build >/dev/null

TARGETS=("$@")
if [ ${#TARGETS[@]} -eq 0 ]; then
  TARGETS=("../evolve-sim-portal" "../avatar-playground" "../acts-education-portal")
fi

for product in "${TARGETS[@]}"; do
  dest="$product/vendor/avatar-engine"
  if [ ! -d "$product" ]; then echo "  – skip $product (not found)"; continue; fi
  mkdir -p "$dest"
  rm -rf "$dest/dist"
  cp -R "$ENGINE_ROOT/dist" "$dest/dist"
  cp "$ENGINE_ROOT/package.json" "$dest/package.json"
  echo "  ✓ synced → $dest ($(node -p "require('$ENGINE_ROOT/package.json').version"))"
done
echo "▸ Done. Commit the vendored change in each product, then reinstall."
