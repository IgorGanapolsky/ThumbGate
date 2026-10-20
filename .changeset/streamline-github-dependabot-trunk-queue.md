---
'thumbgate': patch
---

Streamline GitHub Dependabot and Trunk Merge Queue workflow by grouping npm/workers/actions updates in `.github/dependabot.yml`, allowing manifest-only dependency updates without package version bumps in `scripts/changeset-check.js` so `trunk-io[bot]` test PRs pass `Verify changeset`, and surfacing `Trunk Merge Queue (main)` failures in `scripts/thumbgate-board-loop.js` to prevent duplicate `/trunk merge` comment loops.
