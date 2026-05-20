---
"thumbgate": patch
---

Fix Railway production deploys that have been failing since the better-sqlite3@12.10.0 bump. The Dockerfile's `node:20-alpine` builder stage was missing Python and a C++ toolchain, so when better-sqlite3's prebuilt musl binary wasn't found, the `node-gyp rebuild` fallback failed with `Could not find any Python installation to use`. Every Railway deploy since the bump has built green in GitHub Actions, sent `railway up` successfully, then failed inside Railway's Docker build — and Railway's restart policy kept serving the old container (buildSha `92f8e4b1`, version 1.20.0) for hours.

Added `RUN apk add --no-cache python3 make g++` to the builder stage. Runtime stage stays slim (Python isn't needed at runtime, only at install).
