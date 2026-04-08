# Obsidian + ThumbGate Integration Guide

Connect your Obsidian vault to ThumbGate so Claude Code's persistent ThumbGate memory
is browsable, searchable, and linkable inside Obsidian.

---

## Prerequisites

- [Obsidian](https://obsidian.md/) installed (desktop app)
- [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat) installed in Obsidian
  (Settings > Community Plugins > Browse > search "BRAT" > Install > Enable)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- Node.js >= 18.18.0

---

## Step 1: Install obsidian-claude-ide via BRAT

1. Open Obsidian settings (Cmd/Ctrl + ,)
2. Go to **Community Plugins > BRAT**
3. Click **Add Beta Plugin**
4. Paste the repository URL: `https://github.com/petersolopov/obsidian-claude-ide`
5. Click **Add Plugin** then enable it in Community Plugins

The plugin adds a `/ide` command to the Obsidian command palette. When invoked, it opens
a Claude Code session with your current vault note as context.

---

## Step 2: Connect Claude Code to ThumbGate

Add the following to your Claude Code MCP configuration
(typically `~/.claude/claude_desktop_config.json` or the Claude Code settings file):

```json
{
  "mcpServers": {
    "thumbgate": {
      "command": "npx",
      "args": ["thumbgate", "serve"]
    }
  }
}
```

Alternatively, run the MCP server directly from this repo:

```bash
node adapters/mcp/server-stdio.js
```

Restart Claude Code after updating the config. You can verify the MCP server is active by
checking Claude Code's MCP panel or running:

```bash
npx thumbgate serve
```

---

## Step 3: Set Up Your Vault Structure for ThumbGate Browsing

Create an `AI-Memories/thumbgate/` folder inside your Obsidian vault. This folder becomes your
live view into Claude Code's memory system.

**Recommended files to populate in this folder:**

### Memory Log.md

Tracks episodic feedback events. Sourced from the local ThumbGate store:

```
.thumbgate/memory-log.jsonl
```

This file is local-only and git-ignored. To expose it in Obsidian, create a symlink:

```bash
# From your vault's AI-Memories/thumbgate/ directory
ln -s /path/to/thumbgate/.thumbgate/memory-log.jsonl "Memory Log.md"
```

Or export a human-readable snapshot periodically from within the repo.

### Primer.md

The active session primer that contains the latest revenue truth, next steps, and blockers.
Sourced from `primer.md` in the repo root.

```bash
# Symlink or copy
ln -s /path/to/thumbgate/primer.md Primer.md
```

### Prevention Rules.md

Auto-generated prevention rules from repeated AI mistakes. Sourced from:

```
.thumbgate/prevention-rules.md
```

This file is local-only and git-ignored. Symlink it to your vault:

```bash
ln -s /path/to/thumbgate/.thumbgate/prevention-rules.md "Prevention Rules.md"
```

### Feedback Stats.md

Paste the output of the feedback stats command periodically to track your feedback history:

```bash
npm run feedback:stats
```

Copy the output into `AI-Memories/thumbgate/Feedback Stats.md` for historical reference.

---

## Step 4: Usage Workflow

1. Open Obsidian and navigate to any note in `AI-Memories/thumbgate/`
2. Press Cmd/Ctrl + P to open the command palette
3. Type `/ide` and select the **Claude IDE** command
4. Claude Code opens with your current note as context — it can read your memory logs and
   write back updates
5. As you give feedback during Claude Code sessions (`npm run feedback:stats` to review),
   your prevention rules and memory logs update automatically
6. Refresh symlinked files or re-paste stats to see updates in Obsidian

The ThumbGate feedback loop becomes visible in Obsidian's **Graph View** as your memory files
develop connections across sessions.

---

## Step 5: Inspect and Analyze Memory

Use these commands from the repo root to populate your Obsidian notes:

```bash
# View feedback statistics
npm run feedback:stats

# Summarize feedback and regenerate prevention rules
npm run feedback:summary

# Output prevention rules only
npm run feedback:rules

# Check system health and self-healing status
npm run self-heal:check
```

---

## What You Get

- **Persistent memory across Claude Code sessions** — prevention rules block repeated mistakes
- **Visual graph of feedback connections** — Obsidian's graph view shows memory note relationships
- **Prevention rules as browsable notes** — searchable, linkable, editable in Obsidian
- **Feedback stats at a glance** — paste `npm run feedback:stats` output into a vault note
- **Session context in primer.md** — always know the last completed task and next step
- **Pre-action gates** — Claude Code checks prevention rules before executing any tool call

---

## Memory File Locations (Local Only)

These files are git-ignored and exist only on your local machine:

| File | Purpose |
|------|---------|
| `.thumbgate/feedback-log.jsonl` | Raw feedback events |
| `.thumbgate/memory-log.jsonl` | Promoted memory entries |
| `.thumbgate/prevention-rules.md` | Auto-generated prevention rules |
| `.thumbgate/feedback-summary.json` | Aggregated feedback statistics |

---

## Troubleshooting

**MCP server not connecting:**
Verify `npx thumbgate serve` runs without error. Check Node.js version >= 18.18.0.

**Symlinks not resolving in Obsidian:**
Enable "Detect all file extensions" in Obsidian Settings > Files and Links > Detect all file extensions.
For `.jsonl` files, you may need to open them as plain text or export to `.md` format.

**`/ide` command not appearing:**
Ensure the BRAT-installed plugin is enabled in Settings > Community Plugins.

---

## Further Reading

- [ThumbGate on GitHub](https://github.com/IgorGanapolsky/ThumbGate)
- [obsidian-claude-ide plugin](https://github.com/petersolopov/obsidian-claude-ide)
- [Claude Code MCP documentation](https://docs.anthropic.com/en/docs/claude-code)
