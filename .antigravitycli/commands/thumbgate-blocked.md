---
name: thumbgate-blocked
description: Show what ThumbGate has actually blocked — gate enforcement stats and the full enforcement matrix. Use for "what has ThumbGate blocked", "show gate stats", "is enforcement working", "how many tokens did we save", "enforcement matrix".
allowed-tools: mcp__thumbgate__gate_stats, mcp__thumbgate__enforcement_matrix, Bash(npx thumbgate gate-stats:*)
---

# ThumbGate Blocked

Show the enforcement record: how many risky actions were blocked vs warned, which gates fire most, and the full feedback → check → rejection pipeline.

This command wraps existing ThumbGate capability — **no new logic**. It reads the live enforcement counters.

## Steps

1. Call the `gate_stats` MCP tool for the headline numbers: blocked count, warned count, and the top gates by hits. (CLI fallback: `npx thumbgate gate-stats`.)
2. Call the `enforcement_matrix` MCP tool for the full picture: feedback pipeline stats, active pre-action checks, and the rejection ledger with revival conditions.
3. Summarize for the user:
   - Total blocks (each block = a repeat mistake stopped before it spent tokens or did damage).
   - Most-triggered gates.
   - Anything in the rejection ledger that is close to revival.
4. If counts are all zero, note that enforcement is wired but hasn't fired yet, and point to `/thumbgate-guard` to promote a rule.

## Example

```
/thumbgate-blocked
```
