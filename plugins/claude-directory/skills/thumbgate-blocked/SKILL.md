---
name: thumbgate-blocked
description: Show ThumbGate's enforcement record — how many risky actions were actually blocked versus warned, which gates fire most, the tokens/damage saved, and the full feedback to check to rejection pipeline. Reads live enforcement counters via the gate_stats and enforcement_matrix MCP tools (CLI fallback `npx thumbgate gate-stats`). Use when the user says "what has ThumbGate blocked", "show gate stats", "is enforcement working", "how many tokens did we save", "show the enforcement matrix", or "what got stopped". Do NOT use to list rule DEFINITIONS that exist (use the thumbgate-rules skill), to create a new rule (use the thumbgate-guard skill), or to check whether ThumbGate is installed and wired (use the thumbgate-doctor skill).
---

# ThumbGate Blocked

Show the enforcement record: how many risky actions were blocked vs warned, which gates fire most,
and the full feedback → check → rejection pipeline. Each block is a repeat mistake stopped before
it spent tokens or did damage.

This skill wraps existing ThumbGate capability and adds **no new logic** — it reads the live
enforcement counters.

## Workflow

1. **Headline numbers** with the `gate_stats` MCP tool: blocked count, warned count, and the top
   gates by hits. (CLI fallback: `npx thumbgate gate-stats`.)
2. **Full picture** with the `enforcement_matrix` MCP tool: feedback-pipeline stats, active
   pre-action checks, and the rejection ledger with revival conditions.
3. **Summarize** for the user: total blocks, most-triggered gates, and anything in the rejection
   ledger close to revival.
4. **If counts are all zero,** say enforcement is wired but hasn't fired yet and point to the
   thumbgate-guard skill to promote a rule.

Field-by-field meanings (blocked vs warned, the rejection ledger, revival conditions) are in
[references/enforcement-fields.md](references/enforcement-fields.md).

## Example

Input: "is ThumbGate actually blocking anything? how many tokens did we save?"

Action: call `gate_stats` for the counters and `enforcement_matrix` for the pipeline, then:

> 14 blocks, 3 warns in the last 30 days. Top gate: `no-force-push-main` (6 hits). Estimated
> ~9k tokens saved from re-runs avoided. 1 archived gate is one strike from revival.

## Troubleshooting

- **All zeros but rules exist:** enforcement is wired but no gated action has been attempted yet —
  this is normal early on.
- **All zeros and rules also empty:** nothing has been promoted — use the thumbgate-guard skill.
- **`gate_stats` / `enforcement_matrix` unreachable:** fall back to `npx thumbgate gate-stats`, then
  run the thumbgate-doctor skill to confirm the MCP server and hooks are live.

## Quality checklist (self-verify before delivering)

- [ ] I pulled real counters via `gate_stats` (or the `npx thumbgate gate-stats` fallback), not estimates.
- [ ] I included the full pipeline via `enforcement_matrix`, not just the headline block count.
- [ ] I framed each block as a prevented repeat mistake (tokens/damage avoided), with real numbers.
- [ ] On all-zero, I explained why (wired-but-unfired vs nothing-promoted) instead of implying failure.
- [ ] I added no new logic — only read existing enforcement counters.
