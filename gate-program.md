# ThumbGate Gate Program

This file defines **what good agent behavior looks like** for this project.
It is read by the meta-agent loop to evaluate candidate prevention rules.
Edit it in plain English — no code required. The meta-agent will translate your
intent into enforcement gates overnight.

---

## What We Are Building

ThumbGate: pre-action governance for AI coding agents.
Every thumbs-down becomes a prevention rule. Every rule blocks the next agent
from repeating the same mistake.

---

## Success Looks Like

- The agent completes tasks without requiring human correction mid-stream
- No force-pushes to `main` or protected branches
- No secrets, API keys, or `.env` contents committed or logged
- Tests pass before any merge
- Deployment is verified (health endpoint + dashboard) before saying "deployed"
- PR threads are at zero before saying "done"
- Version numbers stay in sync across all files (`node scripts/sync-version.js --check`)
- The agent asks before taking irreversible actions (drop table, delete branch, rm -rf)

---

## Patterns to Block (Hard Stop)

1. **Force push to main** — `git push --force` on `main` or `master`
2. **Secret in output** — any `ANTHROPIC_API_KEY`, `STRIPE_SECRET`, `JWT_SECRET` in logs or diffs
3. **Skip CI / bypass hooks** — `--no-verify`, `--no-gpg-sign`, `-c commit.gpgsign=false`
4. **Drop production table** — `DROP TABLE` against a non-test database
5. **rm -rf on project root** — `rm -rf /home/user/ThumbGate` or similar
6. **Claim deployed without verification** — saying "deployed" or "live" without curl output

---

## Patterns to Warn (Review Required)

1. **Amend a published commit** — `git commit --amend` after push
2. **Edit .env directly** — modifying `.env` files instead of `.env.example`
3. **Hard reset** — `git reset --hard` without explicit user instruction
4. **Delete a remote branch** — `git push origin --delete` without confirmation
5. **Bypass rate limiter** — commenting out `isProTier()` or `rateLimiter` checks
6. **Skip test suite** — merging without running `npm test`
7. **Stale prevention rules** — `prevention-rules.md` not regenerated after 10+ new failures

---

## Domain Context (for Meta-Agent Evaluation)

- Primary language: Node.js (>=18.18.0)
- Critical files: `package.json` (version), `scripts/sync-version.js`, `.claude/settings.json`
- Protected branches: `main`
- Test command: `npm test` (1634 tests, expect 0 failures)
- Deployment: Railway auto-deploy from `main` via Docker
- Verification endpoint: `https://thumbgate.ai/health`

---

## How the Meta-Agent Uses This File

1. Reads the **Success Looks Like** section to score candidate rules
2. Replays failures from `feedback-log.jsonl` against each candidate
3. Keeps rules that catch failures without blocking successes
4. Reverts rules that produce false positives on passing sessions
5. Writes approved rules to `auto-promoted-gates.json` and `prevention-rules.md`

To trigger a meta-agent run manually:
```bash
npm run meta-agent:run
```

To see what it would do without writing anything:
```bash
npm run meta-agent:dry
```
