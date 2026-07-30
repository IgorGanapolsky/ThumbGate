---
"thumbgate": patch
---

Fix Glama/MCP registry install: ship server.json + glama.json + smithery.yaml with explicit `npx -y thumbgate serve` stdio start so indexers stop guessing `npm start` (HTTP API). Document the contract in README.
