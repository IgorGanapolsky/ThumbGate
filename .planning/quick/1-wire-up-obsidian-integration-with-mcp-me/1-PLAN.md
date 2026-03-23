---
phase: quick
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - docs/OBSIDIAN_SETUP.md
  - docs/marketing/reddit-obsidian-post.md
  - scripts/verify-obsidian-setup.sh
autonomous: true
requirements: [OBS-01, OBS-02, OBS-03]

must_haves:
  truths:
    - "OBSIDIAN_SETUP.md contains only real, verifiable file paths and features from this repo"
    - "Reddit post draft references actual mcp-memory-gateway capabilities, not fabricated ones"
    - "Verification script proves every claim in both docs maps to real artifacts"
  artifacts:
    - path: "docs/OBSIDIAN_SETUP.md"
      provides: "Step-by-step Obsidian + MCP Memory Gateway integration guide"
      min_lines: 60
    - path: "docs/marketing/reddit-obsidian-post.md"
      provides: "r/ObsidianMD post draft with real feature references"
      min_lines: 40
    - path: "scripts/verify-obsidian-setup.sh"
      provides: "Automated fact-checker for setup doc and marketing claims"
  key_links:
    - from: "scripts/verify-obsidian-setup.sh"
      to: "docs/OBSIDIAN_SETUP.md"
      via: "parses doc and validates every referenced path/command exists"
      pattern: "grep.*OBSIDIAN_SETUP"
    - from: "scripts/verify-obsidian-setup.sh"
      to: "docs/marketing/reddit-obsidian-post.md"
      via: "validates feature claims against actual repo artifacts"
      pattern: "grep.*reddit-obsidian"
---

<objective>
Create an Obsidian integration guide for MCP Memory Gateway and a Reddit marketing post for r/ObsidianMD, with automated verification that every claim is factual.

Purpose: Enable Obsidian users to browse RLHF memory via the petersolopov/obsidian-claude-ide plugin, and draft a marketing post to drive awareness on r/ObsidianMD.
Output: Setup doc, Reddit post draft, and a verification script proving both are factually correct.
</objective>

<execution_context>
@/Users/ganapolsky_i/.claude/get-shit-done/workflows/execute-plan.md
@/Users/ganapolsky_i/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@primer.md
@docs/marketing/reddit-claude-code-post.md
@scripts/social-analytics/publishers/reddit.js
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create OBSIDIAN_SETUP.md integration guide</name>
  <files>docs/OBSIDIAN_SETUP.md</files>
  <action>
Create `docs/OBSIDIAN_SETUP.md` with these sections:

1. **Prerequisites** — Obsidian installed, BRAT plugin installed, Claude Code installed
2. **Install obsidian-claude-ide plugin** — Add `petersolopov/obsidian-claude-ide` via BRAT (Settings > BRAT > Add Beta Plugin > paste repo URL). Explain the `/ide` command it adds.
3. **Connect to MCP Memory Gateway** — Show MCP config JSON snippet to add to Claude Code settings:
   ```json
   {
     "mcpServers": {
       "mcp-memory-gateway": {
         "command": "npx",
         "args": ["mcp-memory-gateway", "serve"]
       }
     }
   }
   ```
4. **Vault structure for RLHF browsing** — Recommend creating an `AI-Memories/rlhf/` folder in the vault with these files:
   - `Memory Log.md` — symlink or periodic export from `.claude/memory/feedback/memory-log.jsonl`
   - `Primer.md` — symlink or copy of `primer.md` for session context
   - `Prevention Rules.md` — symlink or copy of `.claude/memory/feedback/prevention-rules.md`
   - `Feedback Stats.md` — output of `npm run feedback:stats` pasted periodically
5. **Usage workflow** — Open Obsidian, use `/ide` to invoke Claude Code, Claude reads vault notes as context + writes back memory updates. The RLHF loop becomes visible in Obsidian's graph view.
6. **What you get** — Bullet list: persistent memory across sessions, visual graph of feedback connections, prevention rules visible as notes, feedback stats at a glance.

CRITICAL: Only reference features that actually exist in this repo. The feedback commands are: `npm run feedback:stats`, `npm run feedback:summary`, `npm run feedback:rules`, `npm run feedback:export:dpo`. The memory stores are `.claude/memory/feedback/feedback-log.jsonl`, `.claude/memory/feedback/memory-log.jsonl`, `.claude/memory/feedback/prevention-rules.md`. Do NOT invent features.
  </action>
  <verify>File exists at docs/OBSIDIAN_SETUP.md with at least 60 lines. All referenced npm scripts exist in package.json. All referenced file paths exist in the repo or are documented local-only paths.</verify>
  <done>OBSIDIAN_SETUP.md contains accurate, step-by-step instructions with zero fabricated features or paths.</done>
</task>

<task type="auto">
  <name>Task 2: Draft r/ObsidianMD Reddit post</name>
  <files>docs/marketing/reddit-obsidian-post.md</files>
  <action>
Create `docs/marketing/reddit-obsidian-post.md` following the same format as `docs/marketing/reddit-claude-code-post.md` (title, body, subreddit metadata).

**Subreddit:** r/ObsidianMD
**Angle:** "I connected Obsidian to my AI agent's memory — here's how" (Obsidian-first, not product-first)
**Account:** u/eazyigz123

Structure:
- **Title:** Something like "I connected Obsidian to Claude Code's persistent memory — here's the setup" (under 300 chars, genuine tone)
- **Body:**
  - Hook: Obsidian is great for personal knowledge, but AI agents forget everything between sessions. What if your AI's memory lived in your vault?
  - What it does: MCP Memory Gateway gives Claude Code persistent memory (feedback capture, prevention rules, memory logs). The obsidian-claude-ide plugin lets Obsidian talk to Claude Code via `/ide`.
  - Setup summary: Install BRAT > add obsidian-claude-ide > configure MCP server > create AI-Memories folder > symlink memory files
  - What you see: Prevention rules as browsable notes, feedback stats, memory graph in Obsidian's graph view
  - Link to full setup: `docs/OBSIDIAN_SETUP.md` in the repo
  - CTA: GitHub link to mcp-memory-gateway, mention it's open source (MIT)
  - Keep it authentic — this is a "sharing my setup" post, not an ad

Reference ONLY real features: feedback capture (up/down), prevention rules auto-generation, DPO export, Thompson Sampling gates, memory-log.jsonl, contextfs. Do NOT claim Obsidian sync, real-time updates, or any feature that doesn't exist.
  </action>
  <verify>File exists at docs/marketing/reddit-obsidian-post.md with at least 40 lines. No feature claims that don't map to actual repo capabilities.</verify>
  <done>Reddit post draft is authentic, Obsidian-community-appropriate, and references only real features.</done>
</task>

<task type="auto">
  <name>Task 3: Create and run verification script proving all claims are factual</name>
  <files>scripts/verify-obsidian-setup.sh</files>
  <action>
Create `scripts/verify-obsidian-setup.sh` (bash, executable) that:

1. **Validates OBSIDIAN_SETUP.md references:**
   - Extract every npm script referenced (e.g., `npm run feedback:stats`) and verify each exists in `package.json` scripts section
   - Extract every file path referenced (e.g., `.claude/memory/feedback/memory-log.jsonl`) and verify it either exists on disk OR is documented as local-only/git-ignored in CLAUDE.md
   - Verify the MCP config JSON snippet uses the correct package name (`mcp-memory-gateway`)
   - Verify the plugin repo reference (`petersolopov/obsidian-claude-ide`) is correct

2. **Validates reddit-obsidian-post.md claims:**
   - Extract feature claims and grep for supporting code/config in the repo
   - Verify GitHub repo URL is correct
   - Verify no claims about features that don't exist (check for common false claims: "real-time sync", "auto-update", "cloud sync")

3. **Output format:**
   - Print each check with PASS/FAIL
   - Exit 0 if all pass, exit 1 if any fail
   - Print summary: "X/Y checks passed"

After creating the script, run it: `bash scripts/verify-obsidian-setup.sh`

The script MUST pass. If it fails, fix the docs until it passes. Do not claim done until exit code 0.
  </action>
  <verify>Run `bash scripts/verify-obsidian-setup.sh` and confirm exit code 0 with all checks passing.</verify>
  <done>Verification script exits 0, proving every claim in OBSIDIAN_SETUP.md and the Reddit post maps to real repo artifacts. Evidence printed to stdout.</done>
</task>

</tasks>

<verification>
1. `bash scripts/verify-obsidian-setup.sh` exits 0 — all claims factual
2. `wc -l docs/OBSIDIAN_SETUP.md` shows 60+ lines
3. `wc -l docs/marketing/reddit-obsidian-post.md` shows 40+ lines
4. No dead code — verification script is used, both docs are referenced by it
</verification>

<success_criteria>
- OBSIDIAN_SETUP.md is a complete, accurate integration guide
- Reddit post draft is authentic and community-appropriate for r/ObsidianMD
- Verification script proves every claim with evidence (exit 0)
- Zero fabricated features or paths in any file
</success_criteria>

<output>
After completion, create `.planning/quick/1-wire-up-obsidian-integration-with-mcp-me/1-SUMMARY.md`
</output>
