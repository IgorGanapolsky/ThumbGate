---
"thumbgate": patch
---

Fix a PR-thread-resolution gate self-lockout: a commit landing on a branch whose PR was already merged/closed used to arm the gate forever, since it never checked live GitHub PR state — only the branch name. Now auto-detects a dormant PR (merged, closed, or none found) via a single `gh` check at commit time and auto-satisfies instead of permanently blocking every subsequent tool call. Also closes a gap where the free-tier daily block cap could downgrade catastrophic commands (force-push, `git reset --hard`, `git clean -f`, `rm -rf` on home/root) to a warning even under `THUMBGATE_STRICT_ENFORCEMENT=1`.
