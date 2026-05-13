---
"thumbgate": minor
---

Add a Branch Contamination Guard (workflow + `scripts/audit-pr-bot-contamination.js`) that fails fast when a PR contains commits authored by the bare `actions@github.com` identity (NOT the registered `github-actions[bot]`) that drop > 100 lines of new files onto a non-automation branch. Catches the failure mode that turned PR #1910 (a 21-line `/go/teams` redirector fix) into a 4-hour pipeline grind: a 693-line `scripts/feedback_quality_eval.py` got committed onto its branch by off-script tooling and tanked SonarCloud's coverage gate (9% on new code). Skips audit cleanly on automation-owned branches (`auto/`, `agent/`, `claude/`, `codex/`, `dependabot/`, `renovate/`). 7 regression tests including one that re-plays the actual `bee4938a` commit.
