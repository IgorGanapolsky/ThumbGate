---
"thumbgate": minor
---

Enforcement teeth: move ThumbGate's PreToolUse path from advisory to preventive.

- `capture_feedback` now surfaces `correctiveActions` as a top-level `<system-reminder>` block in the MCP response (content[1]) alongside the JSON body (content[0]), so prior lessons reach the calling agent as first-class context instead of buried JSON.
- Replaces the no-op `scripts/hook-verify-before-done.sh` with `scripts/hook-pre-tool-use.js` (matcher expanded to `Bash|Edit|Write`). The new hook: (1) preserves the existing curl-to-prod timestamp tracking; (2) calls `retrieveWithRerankingSync` against the about-to-run tool and injects matched lessons via `hookSpecificOutput.additionalContext`; (3) opt-in via `THUMBGATE_HOOKS_ENFORCE=1`, blocks tool calls with `decision:"block"` when a matched lesson carries a high-risk tag at/above threshold (default 5, configurable via `THUMBGATE_HOOKS_ENFORCE_THRESHOLD`); (4) opt-in via `THUMBGATE_AUTOGATE_PR_COMMITS=1`, auto-registers a `thread-resolution-verified` claim gate when `git commit` runs on a non-main branch.
- `bin/cli.js session-start` now emits top ThumbGate hard-block rules and top high-risk tags as a structured `hookSpecificOutput.additionalContext` reminder (with stderr fallback for older Claude Code versions), so session start forces the agent to see current enforcement state rather than relying on opt-in `recall`.
- Every enforcement path fails open: malformed hook stdin, missing risk model, or any uncaught exception in the hook exits 0 with no block, ensuring a bug never deadlocks the agent. Flags default to OFF so the first misfiring regex can be corrected in the same session that shipped it.
