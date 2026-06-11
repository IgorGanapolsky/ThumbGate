# Enforcement counters — field reference

Detailed reference for the thumbgate-blocked skill. Load only when you need to interpret a
specific field.

## `gate_stats` MCP tool
Headline enforcement counters:
- **blocked** — actions a gate hard-stopped before they ran.
- **warned** — actions a gate flagged but allowed (soft gates).
- **top gates** — the gates with the most hits, with per-gate counts.
- token/cost savings estimates, when available (a block avoids the cost of the mistake + the re-run).

CLI fallback: `npx thumbgate gate-stats` (`--json` for structured output).

## `enforcement_matrix` MCP tool
The full pipeline view:
- **feedback pipeline stats** — captures → lessons → promoted rules.
- **active pre-action checks** — the gates currently armed.
- **rejection ledger** — patterns that were proposed but rejected/archived, each with a
  **revival condition** (how many more strikes until it auto-promotes again).

## Reading it
- A high **blocked** count with low **warned** = strong hard enforcement.
- Many **warns** and few **blocks** = mostly soft gates; consider promoting the worst offenders to
  blocks via the thumbgate-guard skill.
- A rejection-ledger entry near its revival threshold = a pattern about to become a rule; mention it.

## Zero-state disambiguation
- **Rules exist, counts zero** → wired but no gated action attempted yet (normal early on).
- **Rules empty, counts zero** → nothing promoted → thumbgate-guard skill.
- **Tool errors** → MCP/hook wiring problem → thumbgate-doctor skill.
