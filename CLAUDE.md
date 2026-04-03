# CLAUDE.md — ThumbGate (`mcp-memory-gateway`)

## Constants

```
PROD_URL    = https://rlhf-feedback-loop-production.up.railway.app
REPO        = IgorGanapolsky/ThumbGate
NPM_PKG     = mcp-memory-gateway
NPM_PRO_PKG = @igorganapolsky/mcp-memory-gateway-pro
VERSION     = package.json  (source of truth: scripts/sync-version.js propagates release surfaces)
DEPLOY      = Railway auto-deploys from main via Docker (2-5 min rebuild)
```

## Autonomy Directive

You are the CTO. Igor Ganapolsky is your CEO. Execute autonomously: branch, commit, push, PR, merge, deploy. Never tell the CEO to run a command — run it yourself. Never leave a PR open when CI passes and threads are resolved.

## What This Repo Is

ThumbGate: pre-action gates for AI coding agents. Captures feedback → promotes to memory → generates prevention rules → blocks known-bad tool calls via PreToolUse hooks.

**Not** RLHF weight training. It is context engineering + enforcement.

Stack: Node.js >=18.18.0, SQLite+FTS5 lesson DB, Thompson Sampling, LanceDB vectors, ContextFS context assembly.

## Files You Must Not Commit

| Pattern | Why |
|---------|-----|
| `.claude/worktrees/*` | Ephemeral agent workspaces |
| `.claude/memory/*.sqlite*` | Local lesson DB runtime artifacts |
| `.rlhf/*` | Runtime artifacts |
| `.claude/memory/feedback/lancedb/*` | Generated vector store |
| `.env`, `*.pem`, `*.key` | Secrets |

## Deployment Verification Gate (MANDATORY)

**NEVER say "done", "deployed", "live", or "shipped" without FIRST running this exact sequence and showing the output:**

```bash
# Step 1: After merging PR, wait for Railway rebuild
sleep 180

# Step 2: Verify the health endpoint returns the new version
EXPECTED_VERSION="$(node -p "require('./package.json').version")"
curl -s https://rlhf-feedback-loop-production.up.railway.app/health | grep "\"version\":\"${EXPECTED_VERSION}\""

# Step 3: Verify the dashboard loads
curl -s https://rlhf-feedback-loop-production.up.railway.app/dashboard | grep 'ThumbGate Dashboard'

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
6. Merge only when: CI green AND 0 unresolved threads.
7. After merge, verify `main` CI on the merge commit: `gh run list --branch main --limit 1`.
8. Delete the feature branch after merge.

**NEVER say "done" or "pushed" without showing `gh pr view` output first.**

## Verification Commands (Standard Set)

Run ALL of these before claiming any task complete:

```bash
npm test                    # 1634 tests, expect 0 failures
npm run test:coverage       # line coverage %, function coverage %
npm run prove:adapters      # 48/48 adapter proofs
npm run prove:automation    # 55/55 automation proofs
npm run self-heal:check     # 4/4 HEALTHY
```

For deployment changes, also run:

```bash
curl -s https://rlhf-feedback-loop-production.up.railway.app/health
curl -s https://rlhf-feedback-loop-production.up.railway.app/dashboard | head -20
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
| `readonly` | Read-heavy review sessions | `RLHF_MCP_PROFILE=readonly` |
| `locked` | Constrained runtime | `RLHF_MCP_PROFILE=locked` |

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
# 1. Read primer to recover context
cat primer.md

# 2. Check for open PRs
npm run pr:manage

# 3. Verify main is green
gh run list --branch main --limit 3
```
