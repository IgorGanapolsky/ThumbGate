---
thumbgate: patch
---

Close the declared-vs-shipped gap that produced two external build/listing failures in one
day. The MCP tool list is now a generated artifact of the live server
(config/directory-manifest.json, npm run manifest:export) with a CI parity test, so a tool
added or removed fails the build until the directory listing is regenerated; the manifest
also derives which tools accept conversation excerpts and asserts the disclosure matches.
Adds a Container Build workflow that builds the shipped Dockerfile on amd64 AND arm64 and
proves the image answers /health — previously nothing built it and third-party builders
were our only test. Moves better-sqlite3 and @lancedb/lancedb to optionalDependencies:
both are already loaded through loadOptionalModule at runtime, and a missing native
prebuild on a builder's architecture should degrade, not fail the build (verified: the
server starts and /health returns 200 with both modules deleted).
