# Stack Overflow Autonomous Answer Bot

## Category

Revenue & Marketing

## TL;DR

Daily cron-driven SO answer discovery, drafting, anti-slop verification, and two-stage approval posting. Finds high-ROI questions matching ThumbGate's domain, drafts helpful answers with real gate examples, and stages them for human "send it" approval.

## Trigger

Daily at 9:00 AM EST via cron, or manually via:
```bash
node scripts/so-answer-cron.js
```

## Problem Solved

ThumbGate needs consistent, high-ROI Stack Overflow presence to drive developer awareness and conversions. Manual posting is inconsistent. Fully autonomous posting risks spam. This bot discovers relevant questions, drafts genuinely helpful answers, verifies they pass anti-slop checks, and stages them for human approval before posting.

## How It Works

### 1. Discovery (StackExchange API)

Queries for questions with tags: `claude-code`, `cursor-ide`, `codex`, `ai-agent`, `code-review`, `mcp`, `automation`, `anthropic-claude`, `large-language-model`

Filters to questions that:
- Have 0 answers OR ≤2 answers with score < 5
- Were created in the last 7 days
- Score ≥ 1 (community interest)
- Not closed, locked, or community-wiki

### 2. Ranking (ROI Score)

```
roi = (score × view_count × (3 - answer_count) × tag_weight) / (age_days + 1)
```

Tag weights: claude-code=2.0, cursor-ide=1.8, codex=1.5, ai-agent=1.3, mcp=1.5

### 3. Drafting (Template Engine)

Three templates match question intent:

- **Safety** — "Gate catches mistakes before they execute" (Pro $19/mo, $49 Kit)
- **Branch Review** — "Shift-left review for branch PRs" (Pro $19/mo, $49 Kit, $499 Diagnostic)
- **DevOps** — "DevOps pipeline guardrails" ($499 Diagnostic)

Each draft includes real `npx thumbgate gate-check` output (hard-block + warning examples).

### 4. Anti-Slop Verification

Each draft is verified via:
```bash
bash /Users/iganapolsky/workspace/projects/secure-yolo/scripts/verify-human-paste-anti-slop.sh check --file <path>
```

Must return "ALLOW: human-readable colleague paste" to proceed.

### 5. Two-Stage Approval

**Stage 1 (Staging):** Drafts saved to `~/Documents/AI-Agent-Sync/Email-Drafts/so-answer-NN-<slug>.md`, displayed in chat with exact question link + body text.

**Stage 2 (Posting):** On "send it" / "send them" approval, answer posted via BrowserOS Neo CDP to the SO editor, screenshot uploaded to imgur, "Post Your Answer" clicked.

## Stolen Ideas

- **Spotify Confidence "typed schemas"**: Gate rules should be typed configurations, not free-form text (applied to gate-check output format)
- **Gradual rollout**: New answer templates start at 10% of questions, ramp up
- **Audit logs**: Every posted answer tracked in `so-answer-tracker.tsv` with timestamp, question ID, template, and action
- **MCP integration**: Like Confidence's Flag MCP Server, ThumbGate's MCP can check gate rule status inline during answer drafting

## Files

- `scripts/so-answer-cron.js` — Daily cron entry point
- `scripts/so-answer-templates.js` — Template engine with real gate examples
- `so-answer-tracker.tsv` — Posted answers ledger
- `Email-Drafts/so-answer-NN-*.md` — Staged answer drafts

## Cron

```cron
0 14 * * * NODE_ENV=production /usr/local/bin/node /Users/iganapolsky/workspace/ThumbGate/scripts/so-answer-cron.js >> ~/Documents/AI-Agent-Sync/so-answer-log.txt 2>&1
```

## Monetization Links

- Pro: https://thumbgate.ai/go/pro-direct ($19/mo, $149/yr)
- Rule-Pack Kit: https://thumbgate.ai/go/bundle-49 ($49 one-time)
- Workflow Gate Diagnostic: https://thumbgate.ai/diagnostic ($499)

## Tags

`stackoverflow` `revenue` `automation` `cron` `content-marketing` `seo`
