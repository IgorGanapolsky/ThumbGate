# Trunk AI-speed ops (ThumbGate)

Maps Trunk Aug 2026 product updates to repo automation.

| Trunk feature | ThumbGate surface |
|---------------|-------------------|
| Stacked PRs in merge queue | `orderPrsForStackMerge` in `scripts/pr-manager.js` — base before child when `npm run pr:manage` |
| Timeout-inflation monitor | `npm run ci:timeout-inflation -- --pr N` |
| Flaky ticket lifecycle | `npm run ci:flaky-ticket -- --from flaky --to healthy --ticket-exists --ticket-open` |
| Copy Prompt for agents | `npm run ci:copy-prompt -- --pr N` |

Always merge `main` via `/trunk merge` (never raw `gh pr merge --auto`).
