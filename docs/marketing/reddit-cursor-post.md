# Reddit Post: r/cursor

**Subreddit:** r/cursor
**Account:** u/eazyigz123
**Post type:** Discussion / question — problem-first, no product links in body

---

**Title:** Does Cursor retain anything you've corrected between sessions?

---

**Body:**

I keep running into the same thing: I correct Cursor mid-session — "don't force-push," "always run tests before committing," "use the existing helper, don't write a new one" — and it listens. That session is great.

Next session? It's like the conversation never happened. Same force-push. Same skipped tests. Same duplicate helper function. I've tried beefing up my `.cursorrules` and adding more context to system prompts, but it only partially helps. The rules file captures general patterns, but the agent doesn't learn from specific mistakes it made in *my* project.

What actually changed things for me was hooking into the agent's tool execution layer — intercepting commands like `git push` or `rm -rf` *before* they run and checking them against a list of validated failure patterns. Not a memory file the agent reads. A physical gate that blocks the action. The gate list grows from structured feedback (not just thumbs up/down, but "what went wrong" and "what to change"), and rules that fire too often or too rarely get reweighted automatically.

It's made a real difference — the agent literally can't repeat a known mistake once a rule exists for it.

Curious how others are handling cross-session reliability. Are `.cursorrules` and manual prompting enough for your workflow, or have you found something that sticks better?

---

**Comment (post immediately after, only if the post stays up):**

For those asking how the gate system works — I built it as an open-source Cursor plugin. Repo is here: https://github.com/IgorGanapolsky/mcp-memory-gateway

It includes pre-action hooks, feedback capture with schema validation, and Thompson Sampling for adaptive rule enforcement. MIT licensed, fully local (no cloud, no telemetry). Happy to explain any of the internals.

Disclosure: I built this.
