---
name: skool-headless-reader
description: Read, monitor, and analyze Skool communities or posts headlessly for lead discovery, customer pain, acquisition opportunities, or ThumbGate revenue research without blocking the user's browser.
---

# Skool Headless Reader

## Overview

Use this skill when a task asks to inspect Skool communities, find revenue opportunities in Skool, summarize Skool posts, or mine AI automation communities for ThumbGate acquisition signals. It uses direct HTTP reads and the local MCP connector instead of the user's logged-in browser, so the user can keep working.

## Operating Rules

- Do not use the user's Comet, Chrome, or Computer Use session first. Start with the headless reader.
- Do not post, comment, DM, scrape private data, or take write actions. Draft replies or outreach only unless the user explicitly authorizes posting.
- Use cookies only through the `SKOOL_COOKIE` environment variable when a private group requires auth. Never print, commit, or persist cookies.
- Keep outputs focused on revenue: pain, buyer intent, possible ThumbGate angle, and a concrete next action.

## Quick Start

Read a public community:

```bash
node scripts/skool-reader.js --community ai-automation-society --limit 10 --format json
```

Rank ThumbGate revenue signals:

```bash
node scripts/skool-reader.js --url https://www.skool.com/ai-automation-society --category "Support Needed" --signals --format markdown
```

Use `--post-limit` to read more posts before returning the top `--limit` signals.

Run the local MCP server:

```bash
node adapters/skool/server-stdio.js
```

Useful MCP tools:

- `skool_read_community`: return normalized categories, posts, and engagement.
- `skool_revenue_signals`: rank posts for ThumbGate acquisition opportunities.
- `skool_post_detail`: read a single Skool post URL.

## Revenue Workflow

1. Read the community overview to identify categories, member count, and visible post volume.
2. Prioritize `Support Needed`, `Hire Me / Looking For Hire`, `Wins`, and high-comment posts.
3. Look for Claude Code, Codex, Cursor, MCP, n8n, GitHub, Supabase, Vercel, token cost, and broken automation workflows.
4. Produce a lead list with post URL, pain, ThumbGate angle, and draft reply.
5. Keep outreach non-spam: give useful diagnosis first, then mention ThumbGate only where the reliability problem is direct.

## Private Groups

If a group is not publicly SSR-readable, supply an operator-provided cookie header through the environment without storing it:

```bash
SKOOL_COOKIE='skool_session=...' node scripts/skool-reader.js --community private-community --signals
```

Never save that cookie in repo files, memories, PR text, logs, or test fixtures.
