# Reddit Post: r/ObsidianMD

**Subreddit:** r/ObsidianMD
**Account:** u/eazyigz123
**Post type:** Sharing a setup — no product links in body

---

**Title:** I started exporting my AI agent's memory into my Obsidian vault — the graph view is surprisingly useful

---

**Body:**

I use Obsidian as my second brain and Claude Code as my coding agent. Problem: the agent's memory (feedback, prevention rules, lessons learned) was trapped in JSONL logs. I could `cat` the files, but they weren't browsable, searchable, or connected to anything in my vault.

So I wrote an export script that converts the agent's memory state into well-formatted Obsidian notes with YAML frontmatter and wiki-links.

**What gets exported**

- Feedback logs as individual notes with signal type, category, and tags
- Prevention rules with severity levels, each linking back to the feedback that created it
- Lessons that link to their associated rules and gates
- A master index note at the root that connects everything

Every note has proper YAML frontmatter so Dataview queries work out of the box. The wiki-links mean graph view lights up with connections between feedback entries, the rules they generated, and the lessons extracted from them.

It's a one-shot snapshot — I run the command whenever I want to browse the agent's current state. No real-time sync, no background processes, no accounts. Just markdown files in my vault.

The [petersolopov/obsidian-claude-ide](https://github.com/petersolopov/obsidian-claude-ide) plugin pairs well with this — you can browse exported memory, then invoke Claude directly from any note via `/ide` to feed it back as context.

Anyone else pulling AI agent data into their vault? Curious what formats and structures have worked for you.

---

**Comment (post immediately after the main post):**

The tool is open source. The `obsidian-export` command handles the full conversion to vault-ready markdown.

Try free for 7 days (no credit card, 2-minute setup): https://thumbgate-production.up.railway.app/?utm_source=reddit&utm_medium=organic_social&utm_campaign=reddit_followup_comment&utm_content=obsidian_export_post&community=ObsidianMD

Source code (MIT licensed): https://github.com/IgorGanapolsky/ThumbGate

Disclosure: I built this.
