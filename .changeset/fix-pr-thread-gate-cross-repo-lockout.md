---
thumbgate: patch
---

Fix pr-thread-resolution-verified-required gate leaking across repos/worktrees: a commit on one repo's branch could permanently lock out an unrelated repo's session. The gate is now scoped to the repo that actually committed, and the block message tells the agent exactly how to clear it (the satisfy_gate tool with real evidence) instead of leaving no discoverable escape hatch.
