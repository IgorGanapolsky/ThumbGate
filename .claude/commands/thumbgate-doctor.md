---
name: thumbgate-doctor
description: Health-check the ThumbGate wiring for this project — hooks, MCP server, and agent-readiness — and report what's broken. Use for "is ThumbGate wired up", "thumbgate doctor", "check my guardrails are installed", "why aren't my gates firing", "agent readiness".
allowed-tools: Bash(npx thumbgate doctor:*), mcp__thumbgate__check_operational_integrity
---

# ThumbGate Doctor

Audit whether ThumbGate is actually wired into this agent: PreToolUse / SessionStart hooks installed, MCP server reachable, lesson store present, and overall agent-readiness — then tell the user exactly what to fix.

This command wraps existing ThumbGate capability — **no new logic**. It runs the existing doctor + integrity checks.

## Steps

1. Run the existing wiring/health audit:
   ```bash
   npx thumbgate doctor
   ```
   (Add `--json` for a machine-readable report.) It exits non-zero when the project is not `ready`.
2. For deeper runtime state, call the `check_operational_integrity` MCP tool to verify the server-side enforcement path is live, not just the local config.
3. Summarize:
   - ✅ what's wired (hooks, MCP, store, statusline).
   - ❌ what's missing, with the exact fix command (usually `npx thumbgate init`).
4. If everything is green, say so plainly with the readiness status; if not, lead with the single highest-impact fix.

## Example

```
/thumbgate-doctor
```
