---
"thumbgate": patch
---

Fix statusline 👍/👎 counts not updating after `thumbgate capture` / `node .claude/scripts/feedback/capture-feedback.js` runs.

**Background**: the statusline reads a cache file (`~/.thumbgate/statusline_cache.json`) that is normally refreshed by the `cache-update` PostToolUse hook — but that hook only fires for `mcp__thumbgate__feedback_stats` / `mcp__thumbgate__dashboard` MCP tool calls. When feedback is captured via Bash (the CLI), no MCP tool fires, the cache stays stale, and the bar keeps showing the old counts until the next dashboard call (potentially hours).

**Fix**: capture-feedback.js now calls `refreshStatuslineCache(analyzeFeedback())` inline after a successful capture. Cache updates immediately; statusline reflects the new count on the very next render.

**Notable subtlety found during implementation**: `feedbackSummary()` returns a string (the human-readable summary). When passed to `normalizeStatsPayload` it merges as a character array with numeric keys, producing the empty `{thumbs_up:'0', thumbs_down:'0'}` payload — no update. The correct stats API is `analyzeFeedback()` which returns the object shape `{ totalPositive, totalNegative, total, approvalRate, trend, rubric }` that `normalizeStatsPayload` expects.

**Best-effort design**: if `scripts/hook-thumbgate-cache-updater` isn't available (minimal install), the call no-ops silently rather than failing the capture.

**Verified locally**: captured 3 feedback entries, observed cache `updated_at` timestamp + `thumbs_up`/`thumbs_down` counters increment in real time, statusline-render reflected the new state.
