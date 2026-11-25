---
"thumbgate": patch
---

Every gate decision row in `audit-trail.jsonl` now carries the session id, the host that sent the call (Claude Code or Cursor when it declares itself), and a short hash of the gate catalog in force, and logged command text goes through the shared secret redactor. `npm run audit:export` (or `node scripts/audit-trail.js --export [--since ISO] [--verdict allow|deny|ask|warn] [--limit N]`) prints one JSON line per decision.
