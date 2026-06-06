---
"thumbgate": patch
---

Remove internal AI-orchestration files from the public repo after they were called out on Reddit r/devops on 2026-06-06 as "vibe-coded" / bot-like:

- `.claude/implementation-notes/` — internal decision/postmortem docs leaking founder sentiment + revenue state
- `.claude/ralph/ATTEMPTS.md` — task list including "ready-to-post for Reddit, HN, Discord"
- `.github/workflows/ralph-*.yml` + `social-engagement-hourly.yml` — hourly social-posting cadence evidence
- `docs/marketing/reddit-posts/` — literal draft post copy

Adds `.gitignore` entries, a pre-commit guard in `.githooks/pre-commit`, and a CI test (`tests/no-internal-orchestration-leaks.test.js`) so these path families cannot be re-introduced. Note: this only prevents future leaks — the content is still in git history; nuclear history-rewrite is a separate decision.
