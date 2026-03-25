# Reddit Post: r/ObsidianMD

**Subreddit:** r/ObsidianMD
**Account:** u/eazyigz123
**Post type:** Developer sharing a setup — NOT promotional

---

**Title:** New: export your AI agent's memory into Obsidian vault notes — feedback logs, prevention rules, lessons as interlinked markdown

---

**Body:**

I use Obsidian as my second brain and Claude Code as my coding agent. Problem: the agent's memory (feedback, rules, lessons) was trapped in JSONL logs. I could `cat` the files, but they weren't browsable, searchable, or connected to anything in my vault.

**What's new**

I added an `obsidian-export` command to [mcp-memory-gateway](https://github.com/IgorGanapolsky/mcp-memory-gateway) that converts ALL the agent's memory state into well-formatted, interlinked Obsidian markdown notes.

**What gets exported**

- **Feedback logs** → individual notes in `Feedback/` with YAML frontmatter (signal, category, tags) and wiki-links
- **Memory log** → notes in `Memories/` with backlinks to source feedback entries
- **Prevention rules** → individual rule notes in `Rules/` with severity levels + `Prevention Rules Index.md`
- **Gates** → gate notes in `Gates/` with match conditions, actions, and tool patterns + `Gates Index.md`
- **Context packs** → pack notes in `Context Packs/` with provenance (template, item count, outcome)
- **Lessons** → lesson notes in `Lessons/` with linked rules and linked gates + `Lessons Index.md`
- **Master index:** `ThumbGate.md` at the vault root — export stats and links to every index

**How to use**

```bash
npx mcp-memory-gateway obsidian-export --vault-path ~/my-vault --output-dir AI-Memories/rlhf
```

That's it. One command, full snapshot.

**What you see in Obsidian**

- **YAML frontmatter** on every note — works with Dataview queries out of the box
- **Wiki-links** everywhere — graph view lights up with connections between feedback, rules, gates, and lessons
- **Tags** for search — filter by category, severity, signal type
- Each rule links to the feedback that created it. Each lesson links to the rules and gates it generated. The graph tells the story.

**Pairs well with**

The [petersolopov/obsidian-claude-ide](https://github.com/petersolopov/obsidian-claude-ide) plugin lets you invoke Claude Code directly from an Obsidian note via `/ide`. Export your agent's memory, browse it in the vault, then open any note and feed it back as context. Full circle.

**Link:** https://github.com/IgorGanapolsky/mcp-memory-gateway

**What this is NOT**

This is a one-shot export, not real-time sync. Run it whenever you want a snapshot of the agent's current memory state. No cloud, no accounts, no background processes. You run the command, you get the files.

MIT licensed. Happy to answer questions about the export format or how it looks in graph view.
