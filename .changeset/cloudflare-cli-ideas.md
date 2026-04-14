---
"thumbgate": minor
---

Steal Cloudflare CLI ideas: schema-first help, --json everywhere, --local/--remote

Three improvements stolen from Cloudflare's CLI architecture post:

**1. Schema-first CLI (`scripts/cli-schema.js`)**
Single source of truth for all CLI command metadata. `help()` is now generated
from the schema rather than hardcoded console.log lines. Each command declares
its name, description, flags (with types), group, and MCP tool binding.
Adding a new command in cli-schema.js auto-updates help output and the explore
TUI command browser.

**2. `--json` everywhere**
- `thumbgate stats --json` → structured payload with total, positives, negatives,
  approvalRate, recentTrend, revenueAtRisk, topTags, recentActivity
- `thumbgate gate-stats --json` → all gate engine metrics except the full gates
  array (add `--verbose` to include it)
- `thumbgate doctor --json` already existed; now documented in schema

**3. `--local` / `--remote` flag on `lessons`**
- `thumbgate lessons --local` (default) uses the local JSONL/SQLite store
- `thumbgate lessons --remote` fetches from the hosted Railway instance at
  `GET /v1/lessons/search?q=...&limit=...` — same response shape
- Respects `THUMBGATE_API_URL` env var for custom deployments
