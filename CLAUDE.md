# CLAUDE.md — ThumbGate (`thumbgate`)

## Constants

```
PROD_URL    = https://thumbgate-production.up.railway.app
REPO        = IgorGanapolsky/ThumbGate
NPM_PKG     = thumbgate
NPM_PRO_PKG = thumbgate-pro
VERSION     = package.json  (source of truth: scripts/sync-version.js propagates release surfaces)
DEPLOY      = Railway auto-deploys from main via Docker (2-5 min rebuild)
```

## Autonomy Directive

You are the CTO. Igor Ganapolsky is your CEO. Execute autonomously: branch, commit, push, PR, merge, deploy. Never tell the CEO to run a command — run it yourself. Never leave a PR open when CI passes and threads are resolved.

**Never tell the CEO to do anything manually. If something needs doing, do it yourself.**

## What This Repo Is

ThumbGate: pre-action gates for AI coding agents. Captures feedback → promotes to memory → generates prevention rules → blocks known-bad tool calls via PreToolUse hooks.

**Not** traditional model-training feedback optimization. It is context engineering + enforcement.

Stack: Node.js >=18.18.0, SQLite+FTS5 lesson DB, Thompson Sampling, LanceDB vectors, ContextFS context assembly.

## Canonical Product Scope

ThumbGate is the only active source of truth. Use `IgorGanapolsky/ThumbGate`, npm package `thumbgate`, and `https://thumbgate-production.up.railway.app` for repo, package, launch, GPT Actions, and production API references.

Do not use `mcp-memory-gateway`, `rlhf`, old RLHF-loop paths, or similarly named local worktrees/remotes as active product context. Those strings are legacy migration aliases only when cleanup code or tests intentionally remove old config keys.

## Distribution Channel Focus

Active outbound channels (2026-04-20 onward): **Reddit, LinkedIn, Threads, Bluesky, Instagram, YouTube.**

X/Twitter was retired from active distribution 2026-04-20. The `scripts/post-to-x*.js` and `scripts/x-autonomous-marketing.js` modules remain on disk for potential future use but are no longer wired into any scheduled workflow, `post-everywhere` default, or reply-monitor CI env surface. Do not add new features that re-introduce X as a primary channel without CEO approval.

Default platform list enforced by `scripts/post-everywhere.js` (`DEFAULT_PLATFORMS`). Tests in `tests/post-everywhere-channels.test.js` pin the list — keep them green.

## Social stack: Zernio canonical

All social publishing and analytics route through Zernio (`https://zernio.com/api/v1`). Zernio holds the OAuth connections for every focus channel (Reddit, LinkedIn, Bluesky, Threads, Instagram, YouTube, TikTok), which removes the need to maintain eight separate token rotations + poller implementations.

- **Analytics** — `scripts/social-analytics/poll-all.js` runs three pollers by default: `github`, `plausible`, `zernio`. The per-platform direct pollers (`reddit`, `linkedin`, `x`, `threads`, `instagram`, `youtube`, `tiktok`) are retained in `LEGACY_POLLERS` and only activate when `THUMBGATE_USE_DIRECT_POLLERS=1`. Treat that env flag as an emergency fallback, not steady state.
- **CEO visibility** — `npm run social:zernio:status` (or `node scripts/social-analytics/zernio-status.js`) prints per-platform row counts for the last 24h and exits non-zero when zero rows ingested. This surfaces Zernio 402 / auth / rate-limit failures loudly; previously they went silent for weeks.
- **Reply monitoring** — Zernio exposes no inbound/comments API as of 2026-04-21 (probed `/inbox`, `/comments`, `/conversations`, `/messages`, `/dms`, `/threads`, `/engagements`, `/replies` — all 404 with HTML shell while `/accounts` returns 200 JSON, confirming auth works). The Inbox add-on is a manual dashboard surface only. Reply monitoring therefore runs through direct-APIs on a per-platform basis: `scripts/social-reply-monitor.js` (Reddit/LinkedIn) and `scripts/social-reply-monitor-bluesky.js` (Bluesky via AT Protocol) — both wired into Ralph Loop's `engage` stage, both queue drafts to `.thumbgate/reply-drafts.jsonl` for human review and never auto-post. CEO-approved 2026-04-21 after a thumbs-down on AI-pitch reply voice required the draft-only posture. Re-probe the Zernio inbox endpoint list when the CEO renews the Inbox add-on past its trial; swap to Zernio if/when a public comments API ships.
- **Publishing** — `scripts/post-everywhere.js` still defers to per-platform dispatchers; Zernio-backed dispatchers are the preferred path where `ZERNIO_API_KEY` is present.

Regression guard: `tests/zernio-canonical-pollers.test.js` pins the active POLLERS list. `tests/zernio-status.test.js` pins the status-report contract. Keep both green.

## Files You Must Not Commit

| Pattern | Why |
|---------|-----|
| `.claude/worktrees/*` | Ephemeral agent workspaces |
| `.claude/memory/*.sqlite*` | Local lesson DB runtime artifacts |
| `.claude/context-engine/quality-log.json` | Generated context-engine runtime log |
| `.thumbgate/*` | Runtime artifacts |
| `.claude/memory/feedback/lancedb/*` | Generated vector store |
| `.env`, `*.pem`, `*.key` | Secrets |

## Deployment Verification Gate (MANDATORY)

**NEVER say "done", "deployed", "live", or "shipped" without FIRST running this exact sequence and showing the output:**

```bash
# Step 1: After merging PR, wait for Railway rebuild
sleep 180

# Step 2: Verify the health endpoint returns the new version
EXPECTED_VERSION="$(node -p "require('./package.json').version")"
curl -s https://thumbgate-production.up.railway.app/health | grep "\"version\":\"${EXPECTED_VERSION}\""

# Step 3: Verify the dashboard loads
curl -s https://thumbgate-production.up.railway.app/dashboard | grep 'ThumbGate Dashboard'

# Step 4: Show BOTH grep outputs to the CEO
# Step 5: ONLY THEN say "deployed"
```

**If grep returns nothing:** say "Merged but Railway hasn't rebuilt yet. Will re-check in 2 minutes." Then actually re-check.

**History:** This gate exists because on 2026-03-26 the CTO said "deployed" 3 times without verification. Trust was broken. Memory alone did not prevent it — only this enforcement gate will.

## PR and CI Protocol

1. Branch from `main`. Name: `fix/...`, `feat/...`, `chore/...`.
2. Push to remote. Create PR via `gh pr create --repo IgorGanapolsky/ThumbGate`.
3. Wait for CI (runs on push to `main` and `feat/**` branches).
4. After push, run: `gh pr view --json reviewDecision,comments,reviewThreads`
5. If unresolved threads > 0 → fix them → push again → re-check.
6. If a PR is not mergeable, report the exact blocker (`REVIEW_REQUIRED`, pending checks, failing checks, behind base, merge conflicts).
6. Merge only when: CI green AND 0 unresolved threads.
   - Never use raw `gh pr merge --auto`; use `npm run pr:manage` after all critical quality checks have terminal success.
7. After merge, verify `main` CI on the exact merge commit, not just the latest branch run.
8. Delete the feature branch after merge. Archive unique orphan branches before deleting them.
9. For `main`, merge submission is Trunk-managed: request `/trunk merge` and let the queue finish asynchronously. Do not build helper workflows that poll their own required check or block on the final merge commit.
10. Never persist secrets, PATs, or copied credentials into tracked repo files, PR bodies, or local memory notes.
11. Enterprise Managed User accounts may reject GraphQL PR creation or merge mutations. For local `gh` writes, prefer `GH_TOKEN` and fall back from `GH_PAT` automatically. In GitHub Actions write steps, prefer `${{ secrets.GH_PAT || github.token }}`.

**NEVER say "done" or "pushed" without showing `gh pr view` output first.**

## Verification Commands (Standard Set)

Run ALL of these before claiming any task complete:

```bash
npm test                    # full repository suite, expect 0 failures
npm run test:coverage       # repository coverage report
npm run prove:adapters      # adapter compatibility proof suite
npm run prove:automation    # automation proof suite
npm run self-heal:check     # overall status must be HEALTHY
```

## Audit Lessons

- Feature-detect Node test coverage include/exclude flags before passing them to `node --test`; supported LTS runtimes do not expose identical coverage CLI surfaces.
- Tests for Pro-gated features must inject the gate predicate or stub it directly. Do not couple CI to an operator's saved local Pro license.
- Treat `.claude/context-engine/quality-log.json` as disposable runtime output. Keep it ignored and out of tracked history.

For deployment changes, also run:

```bash
curl -s https://thumbgate-production.up.railway.app/health
curl -s https://thumbgate-production.up.railway.app/dashboard | head -20
```

## Feedback Capture Commands

```bash
# Thumbs up (something worked)
node .claude/scripts/feedback/capture-feedback.js \
  --feedback=up \
  --context="what happened" \
  --what-worked="specific thing that worked" \
  --tags="tag1,tag2"

# Thumbs down (something failed)
node .claude/scripts/feedback/capture-feedback.js \
  --feedback=down \
  --context="what happened" \
  --what-went-wrong="specific failure" \
  --what-to-change="specific fix" \
  --tags="tag1,tag2"
```

## Analysis Commands

```bash
npm run feedback:stats       # show feedback counts
npm run feedback:summary     # generate summary
npm run feedback:rules       # regenerate prevention rules
npm run feedback:export:dpo  # export DPO pairs
npm run self-heal:check      # check system health
npm run self-heal:run        # auto-fix known issues
npm run pr:manage            # review all open PRs
```

## Version Sync

Version lives in `package.json`. To propagate to all 20+ targets:

```bash
node scripts/sync-version.js          # update all files
node scripts/sync-version.js --check  # dry-run check for drift
```

CI runs `--check` on every push. If it fails, files are out of sync.

## Local Data (git-ignored)

```
.claude/memory/feedback/feedback-log.jsonl    # raw feedback entries
.claude/memory/feedback/memory-log.jsonl      # promoted memories
.claude/memory/feedback/feedback-summary.json # aggregated stats
.claude/memory/feedback/prevention-rules.md   # generated rules
.claude/memory/feedback/contextfs/            # context packs
.claude/memory/feedback/lancedb/              # vector index
```

## MCP Profiles

| Profile | Use case | Set via |
|---------|----------|---------|
| `default` | Full local toolset | (default) |
| `readonly` | Read-heavy review sessions | `THUMBGATE_MCP_PROFILE=readonly` |
| `locked` | Constrained runtime | `THUMBGATE_MCP_PROFILE=locked` |

Policy file: `config/mcp-allowlists.json`

## Session Handoff

Before ending any session:

```bash
# 1. Update primer with latest revenue
node bin/cli.js cfo --today

# 2. Refresh git context
./bin/memory.sh

# 3. State what was completed and what's next
```

## Session Startup

```bash
# 1. Read directives and primer to recover context
cat AGENTS.md
cat CLAUDE.md
cat GEMINI.md
cat primer.md

# 2. Check local ThumbGate memory and open PRs
npm run feedback:summary
npm run pr:manage

# 3. Verify main is green
gh run list --branch main --limit 3
```
