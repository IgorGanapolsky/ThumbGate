---
'thumbgate': minor
---

feat(security): Cloudflare-style MCP WriteGuard interceptor and hop-level latency budget engine

- Implements `src/mcp-writeguard.js` and `scripts/mcp-writeguard.js` for fine-grained MCP risk-tier tool governance (read/write/privileged_write/admin), dangerous command pattern interdiction, parameter secret scrubbing, and Cloudflare WriteGuard policy JSON export.
- Implements `src/latency-budget.js` and `scripts/latency-budget.js` for hop-level SLA monitoring (<500ms enterprise, <250ms voice), CPU-side bottleneck identification (>70%), and OpenTelemetry attribute emission.
- Adds CLI subcommands `thumbgate writeguard` and `thumbgate latency-budget`.
- Adds public guides in `public/guides/mcp-writeguard.html` and `public/guides/latency-infrastructure.html`.
