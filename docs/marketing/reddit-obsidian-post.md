# Reddit Post: r/ObsidianMD

**Subreddit:** r/ObsidianMD
**Account:** u/eazyigz123
**Post type:** "Sharing my setup" — authentic, not promotional

---

**Title:** I connected Obsidian to Claude Code's persistent memory — here's the setup

---

**Body:**

Obsidian is my go-to for personal knowledge management, but I kept running into a mismatch: my AI coding agent (Claude Code) forgets everything between sessions while my Obsidian vault remembers everything. So I wired them together.

Here's what I built and how.

**The problem**

Every Claude Code session starts from zero. Same mistakes, same "oh I see, let me fix that," same patterns the agent was supposed to have learned. Obsidian is great for storing knowledge — so why not store the agent's memory there too?

**What thumbgate does**

[thumbgate](https://github.com/IgorGanapolsky/thumbgate) is an MCP server that gives Claude Code persistent memory:

- You give thumbs up/down feedback on what the agent does
- It auto-promotes repeated failures into **prevention rules** — structured constraints the agent checks before executing any tool call
- Prevention rules are stored as a plain `.md` file: `.thumbgate/prevention-rules.md`
- Thompson Sampling gates adapt which rules fire based on success/failure rates
- Memory is captured in `.thumbgate/memory-log.jsonl` — a local, git-ignored file

None of this is cloud sync or real-time updates. It's local files that persist between sessions and get smarter as you use it.

**The Obsidian connection**

The [obsidian-claude-ide plugin](https://github.com/petersolopov/obsidian-claude-ide) (install via BRAT) adds a `/ide` command to Obsidian. When you invoke it on a note, Claude Code opens with that note's content as context.

My setup:

1. Create `AI-Memories/thumbgate/` folder in your vault
2. Symlink the memory files into it:
   - `Prevention Rules.md` → `.thumbgate/prevention-rules.md`
   - `Primer.md` → `primer.md` (active session context: next steps, blockers, revenue truth)
3. Periodically paste `npm run feedback:stats` output into a `Feedback Stats.md` note
4. Open any memory note, run `/ide` — Claude Code reads your vault note as context and can write back updates

**What you see in Obsidian**

- Prevention rules as browsable, searchable notes
- Graph view connections between memory notes as the feedback loop runs
- Session primer always visible — what was last completed, what's next
- Feedback stats in a dedicated note updated as often as you want

**Full setup guide:** `docs/OBSIDIAN_SETUP.md` in the repo

**What I did NOT build (and won't claim)**

- No real-time Obsidian sync
- No auto-updating vault notes (you run the commands, you control it)
- No cloud storage of your memory (all local, all git-ignored)

It's a personal knowledge loop, not a SaaS product pretending to be one.

**Setup in 3 minutes:**

```bash
# 1. Add to Claude Code MCP config
{
  "mcpServers": {
    "thumbgate": {
      "command": "npx",
      "args": ["thumbgate", "serve"]
    }
  }
}

# 2. In Obsidian: BRAT > Add Beta Plugin > petersolopov/obsidian-claude-ide

# 3. Create AI-Memories/thumbgate/ in your vault and symlink memory files
```

Open source, MIT licensed. The core memory system works fully offline.

Happy to answer questions about the prevention rules system or the Obsidian setup. If someone asks for the repo or setup commands, share them in the reply instead of front-loading the thread with a CTA.
