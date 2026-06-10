---
name: thumbgate-protect
description: Show this repo's branch/release governance and grant a scoped, time-limited approval for an action that touches protected files. Use for "protect this branch", "is main protected", "approve this protected change", "branch governance", "let me edit a protected file".
allowed-tools: mcp__thumbgate__get_branch_governance, mcp__thumbgate__approve_protected_action
---

# ThumbGate Protect

Inspect the protected-action posture for this project and, when the user explicitly approves, grant a scoped, expiring exception so a protected-file edit or publish can proceed under audit.

This command wraps existing ThumbGate capability — **no new logic**. It reads governance state and records a time-boxed approval.

## Steps

1. Read the current posture with the `get_branch_governance` MCP tool: which branches are protected, release rules, and the protected-file globs in effect.
2. Report it plainly: what is protected, and what the agent is currently blocked from touching without approval.
3. **Only if the user explicitly asks to proceed**, grant a scoped approval with `approve_protected_action`:
   - `pathGlobs`: the smallest set of protected globs the action needs.
   - `reason`: why this is approved (one sentence).
   - `evidence`: supporting note (tests passing, owner sign-off, etc.) when available.
   - `ttlMs`: keep it short — default is 1 hour, never exceed what the task needs.
4. Confirm the approval id, covered globs, and expiry. Approvals are deliberately temporary and audited; re-run for the next task.

> This is for granting *narrow, temporary* exceptions, not for disabling protection. Never use it to bypass branch governance wholesale.

## Example

```
/thumbgate-protect
```
