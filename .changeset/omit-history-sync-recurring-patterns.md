---
"thumbgate": patch
---

fix(feedback): stop history-sync fallback junk from becoming PreToolUse Avoid constraints

`claude-feedback-sync` tags rotated Claude history as `claude-history-sync` +
`auto-capture-fallback` with context like "thumbs down". `isAutomatedFeedback`
already skipped `auto-capture` / gate logs for tool-count attribution, but
those fallback rows still entered `recurringNegativePatterns`, so every tool
call got `Avoid: "thumbs down claude-history-sync auto-capture-fallback" (seen Nx)`.

Treat those tags as automated and skip them when ranking constraints. Real
human-enriched negatives (completion-claim, SHA evidence) still rank.
Complementary to #3678 (stop re-import) — this stops already-logged junk from
teaching the gate.
