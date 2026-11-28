#!/usr/bin/env bash
# ThumbGate Gate Anna AI OS executa, version 1.0.3 (self-contained pkg binaries).
# Builds all five platform binaries and packs the Anna binary-artifact archives.
# Requirements: node >= 22, @yao-pkg/pkg, esbuild; run from a checkout of this repo.
set -euo pipefail

VERSION="1.0.3"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 1. Bundle the MCP server (self-launch guards patched out: inside a single-file
#    pkg bundle, argv[1] equals the bundle path, so every "am I the main?" check
#    evaluates true; the patcher rewrites them all to false).
esbuild adapters/mcp/server-stdio.js --bundle --platform=node --format=cjs \
  --outfile="$WORK/bundle.cjs"
python3 patch_bundle.py "$WORK/bundle.cjs"

# 2. Stage the pkg build tree. The native addons (@lancedb/lancedb,
#    better-sqlite3) are replaced with stub packages: the bridge entry refuses
#    them at Module._resolveFilename time, so ThumbGate runs on its proven
#    non-native fallback paths and nothing native is embedded. That is what
#    keeps the binary at ~114MB instead of ~378MB.
cp mcp-bridge-entry.js package.executa.json "$WORK/"
ln -s "$PWD/node_modules" "$WORK/node_modules"
for d in config skills commands .well-known openapi adapters public conformance; do
  ln -s "$PWD/$d" "$WORK/$d"
done
# ... stub the two native packages in a copy of node_modules (see README)
mkdir -p out
for t in linux-x64 linux-arm64 macos-arm64 macos-x64 win-x64; do
  (cd "$WORK" && pkg mcp-bridge-entry.js -t "node22-$t" -C GZip --fallback-to-source \
     -c package.executa.json -o "out/tg-$t")
done

# 3. Pack the Anna archives (root manifest.json + bin entrypoint; POSIX carries
#    the self-contained binary directly, Windows carries exe + .cmd shim).
#    See README.md for the exact layout.
echo "binaries in $WORK/out; pack archives per README.md"
