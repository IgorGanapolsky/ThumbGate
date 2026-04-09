# ForgeCode x ThumbGate Integration Post

**For posting as a GitHub Discussion or Issue on antinomyhq/forgecode**

---

**Title:** Add pre-action safety gates for Forge agents (ThumbGate integration)

**Body:**

Hey Forge team and community,

I built [ThumbGate](https://github.com/IgorGanapolsky/ThumbGate) — pre-action gates for AI coding agents. It captures thumbs-down feedback and turns it into prevention rules that physically block agents from repeating mistakes.

**The problem ThumbGate solves for Forge users:**

When using Forge (or any AI agent), the agent might:
- Force-push to main
- Commit `.env` files to public repos
- Delete production branches
- Run destructive shell commands

You correct it once... but next session, it does the same thing again. Instructions in `AGENTS.md` are suggestions — the agent can ignore them after context drift.

**How ThumbGate works with Forge:**

ThumbGate ships as a Forge skill that intercepts tool calls before execution:

```bash
npx thumbgate init --agent=forge
```

This creates a `.forge/skills/thumbgate/SKILL.md` that:
1. Intercepts tool calls (Bash, file writes, git operations)
2. Checks them against prevention rules generated from your feedback
3. Blocks known-bad patterns before execution
4. Learns from every thumbs-down — rules compound across sessions

**Example:**
```
Session 1: Agent tries `git push --force origin main`
You: 👎 "Never force-push to main"
→ ThumbGate generates a prevention rule

Session 2: Agent tries `git push --force origin main` again
→ ThumbGate blocks it. Agent uses `git push` instead.
```

**Quick start:**
```bash
npx thumbgate init --agent=forge
```

This is free, local-first, and open source. No data leaves your machine.

Would love feedback from Forge users on this integration. What patterns do your agents repeat that you wish they'd stop?

---

**Tags:** feature-request, integration, safety
