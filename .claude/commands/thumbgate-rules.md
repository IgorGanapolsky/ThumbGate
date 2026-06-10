---
name: thumbgate-rules
description: List the active prevention rules and learned lessons guarding this project. Use to answer "what is ThumbGate protecting me from", "show my gates/rules", "what has the agent learned", "what's blocked here".
allowed-tools: mcp__thumbgate__prevention_rules, mcp__thumbgate__get_reliability_rules, mcp__thumbgate__search_lessons, Bash(npx thumbgate rules:*)
---

# ThumbGate Rules

Show the guardrails currently in force for this project: the auto-promoted prevention rules, the reliability rules, and the promoted lessons behind them.

This command wraps existing ThumbGate capability — **no new logic**. It reads the live rule + lesson stores.

## Steps

1. List the active prevention rules with the `prevention_rules` MCP tool (or the CLI fallback `npx thumbgate rules`).
2. Pull the reliability rules with `get_reliability_rules` to show which tool-call shapes are gated.
3. For each rule, surface the lesson it came from with `search_lessons` so the user sees *why* the rule exists, not just *what* it blocks.
4. Present a compact table:

   | Rule / Gate | Blocks | From lesson | State |
   |-------------|--------|-------------|-------|
   | … | … | … | active / archived |

5. If there are zero active rules, point the user to `/thumbgate-guard` to promote their first one.

## Example

```
/thumbgate-rules
```
