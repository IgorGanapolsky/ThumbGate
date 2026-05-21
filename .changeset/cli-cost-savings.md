---
"thumbgate": minor
---

feat(cli): add `thumbgate cost` to surface $ saved by gate blocks

Wires the existing `scripts/token-savings.js` (already used by the
dashboard) into a CLI subcommand so users can see — in plain dollars —
what their PreToolUse gates are worth without leaving the terminal.

```
$ thumbgate cost

💰 ThumbGate cost-savings — cumulative
──────────────────────────────────────────────────
  Tool calls blocked : 247
  Tool calls warned  : 12
  Tool calls passed  : 3,401
  Top blocker        : no-mocked-db (138 blocks)

  Tokens you did NOT spend
    Input  : 494K
    Output : 148K
    Total  : 642K

  Estimated $ saved  : $3.95
```

Flags: `--json` for machine output, `--stats <path>` to point at a
non-default `gate-stats.json`, `--mix <json>` to override the Sonnet-heavy
default model blend. Aliased as `savings` and `costs`.

Positioning: the 2026 wave of "FinOps for AI agents" tools (Finout, etc.)
*reports* on agent spend. ThumbGate *prevents* it. This subcommand makes
that value visible in dollars to the operator without integrating a
separate FinOps platform.

10 unit tests in `tests/cost-cli.test.js` cover arg parsing, missing/present
stats files, the no-data friendly message, and top-blocker selection.
