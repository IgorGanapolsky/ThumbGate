---
"thumbgate": patch
---

Add daily stale PR sweeper workflow and `pr:manage --sweep-stale [--dry-run]` mode to close non-draft PRs with required checks red >24h and drafts idle >3d while preserving branches and skipping `dependabot/*` and `trunk-merge/*`.
