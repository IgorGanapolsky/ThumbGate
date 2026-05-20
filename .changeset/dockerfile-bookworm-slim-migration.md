---
"thumbgate": patch
---

Migrates the Docker base image from `node:20-alpine` to `node:22-bookworm-slim`
for both the builder and runtime stages.

**Why:** `better-sqlite3@12.10.0` does not ship a prebuilt binary for the Node 20
ABI (v115). On the previous Alpine image that meant `prebuild-install` always
fell back to `node-gyp rebuild`, which required `python3 + make + g++` to be
installed at build time. That toolchain added build minutes, image surface
area, and one more thing to keep patched. The upstream WiseLibs prebuild
matrix DOES include `node-v127-linux-x64` (Node 22), so moving the base to
Node 22 lets `prebuild-install` resolve a ready-made `better_sqlite3.node`
and skip the native compile entirely.

**What changed:**
- Builder + runtime: `node:20-alpine` → `node:22-bookworm-slim`
- Removed `apk add --no-cache python3 make g++` from the builder stage
- Swapped `apk add --no-cache git` for `apt-get install -y --no-install-recommends git wget` (wget is required by the existing HEALTHCHECK and is not preinstalled on bookworm-slim)
- Swapped `addgroup -S / adduser -S` for the Debian-equivalent `groupadd -r / useradd -r`
- Kept HEALTHCHECK timing, USER, EXPOSE, CMD, and the entire COPY layout identical

**Verification (local, linux/amd64):**
- `docker build` succeeds in ~61s (vs ~122s for the previous Alpine image, a ~2x speedup on a cold build)
- `better_sqlite3.node` is present at `node_modules/better-sqlite3/build/Release/` and dated to upstream's release, confirming a prebuild download rather than a local compile
- In-container `require('better-sqlite3')(':memory:')` round-trips a row correctly
- Container starts and `/health` returns the expected JSON payload

**Image size delta:** 511 MB → 564 MB (+53 MB). Acceptable trade-off given the
build-time win, removal of the build-toolchain attack surface, and the
reliability win of staying on prebuilt binaries.
