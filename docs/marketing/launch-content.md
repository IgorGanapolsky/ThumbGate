# ThumbGate — Launch Content

---

## 1. Show HN Post

**Title:** Show HN: MCP server that stops Claude/Cursor from making the same mistake twice

**Body:**

I built ThumbGate — an MCP server where 👎 thumbs down blocks the agent from repeating a mistake, and 👍 thumbs up reinforces the good stuff.

The problem: AI agents lose memory between sessions. You tell Claude "don't push without checking PR threads" on Monday, and by Wednesday it's doing it again.

How it works:

1. Something goes wrong → you give a 👎 with what happened and what should change
2. The thumbs-down becomes a prevention rule
3. The rule becomes a gate that fires *before* the agent's tool call executes
4. The agent physically cannot repeat the mistake

👍 works the opposite way — reinforces behavior you want the agent to keep doing.

This is NOT another memory store like Mem0 or Zep. Those remember context. This enforces behavior — the agent literally cannot push to main without checking review threads if a 👎 rule exists for it. That's the difference between "remember this" and "prevent this."

Works with Claude Code, Codex, Gemini, Amp, Cursor, OpenCode.

Install:

```
npx mcp-memory-gateway init
```

Or wire it to a specific agent:

```
npx mcp-memory-gateway init --agent claude-code
```

MIT licensed. Pro is $19/mo or $149/yr for individual operators, while Team rollout stays intake-first for buyers who want hosted analytics and shared lessons.

GitHub: https://github.com/IgorGanapolsky/ThumbGate

Happy to answer questions about the gate engine or how prevention rules are generated.

---

## 2. Reddit r/ClaudeAI Post

**Title:** I gave Claude Code a 👎 button. Now it can't repeat the same mistake twice.

**Body:**

If you use Claude Code daily, you've hit this: Claude makes the same mistake across sessions. Force-pushes. Skips tests. You correct it, it apologizes, next session it does it again.

I built ThumbGate to fix this. The UX is simple:

👎 **Thumbs down** when Claude screws up — capture what went wrong and what should change. That thumbs-down becomes a prevention rule. The rule becomes a gate. The gate fires *before* Claude's tool call executes. The agent physically cannot repeat it.

👍 **Thumbs up** when Claude does something right — reinforces the behavior so it sticks.

Over time, your 👍/👎 signals build an immune system. Good patterns get stronger. Bad patterns are blocked at execution.

The key difference from memory tools like Mem0: this doesn't just store context for retrieval. It physically blocks known-bad actions. Claude cannot skip the step it keeps forgetting because the gate won't let it.

Install in one command:

```
npx mcp-memory-gateway init
```

Or add it directly:

```
claude mcp add rlhf -- npx -y mcp-memory-gateway serve
```

Works with Claude Code, Codex, Gemini, Amp, and Cursor. MIT licensed, fully open source.

There's an optional Pro tier ($19/mo or $149/yr) for the personal local dashboard, exports, and advanced gate workflows, but everything described above works locally for free.

GitHub: https://github.com/IgorGanapolsky/ThumbGate

---

## 3. Reddit r/vibecoding Post

**Title:** I gave my AI agent a 👎 button — repeated mistakes dropped to near-zero

**Body:**

I've been using Claude Code as my primary coding agent for months. After yet another session where it pushed to main without checking PR threads (for the fifth time), I started thinking about what would actually fix this.

The answer was embarrassingly simple: a thumbs-down button.

Not a mental note. Not a prompt update. An actual 👎 that captures what went wrong and turns it into a rule that blocks the agent from doing it again. Physically blocks — the agent's tool call gets intercepted before execution. It can't repeat the mistake even if it wants to.

👍 works the other way — reinforces the behavior you like. Over time, your 👍/👎 signals build an immune system. Good patterns strengthen. Bad patterns are blocked.

After setting up gates on my top 10 failure patterns, those specific mistakes dropped to near-zero. The agent still finds new ways to mess up (it's creative like that), but it can't repeat the known ones.

It works with any MCP-compatible agent. One command to set up:

```
npx mcp-memory-gateway init
```

The core is open source and MIT licensed. There's a Pro tier at $19/mo or $149/yr if you want the personal local dashboard and exports.

GitHub: https://github.com/IgorGanapolsky/ThumbGate

---

## 4. X/Twitter Thread

**Tweet 1:**
What if your AI coding agent had a 👎 button that actually worked?

Not "noted." Not "I'll try to remember."

👎 = the agent physically cannot repeat that mistake. Ever.

Thread:

**Tweet 2:**
How it works:

👎 Thumbs down → captures what went wrong → becomes a prevention rule → rule fires before the tool call executes → blocked.

👍 Thumbs up → reinforces what worked → pattern gets stronger.

Your feedback builds an immune system for your agent.

**Tweet 3:**
Example: my agent kept force-pushing to main.

I gave it a 👎 once. That thumbs-down became a gate.

Now it literally cannot run `git push --force` — the gate blocks it before execution. Not a suggestion. A physical block.

**Tweet 4:**
The difference from memory tools:

Mem0/Zep: "Here's context about past mistakes" (agent can still ignore it)

ThumbGate: "You cannot execute this action" (gate fires before the tool call)

Memory is advisory. 👎 is enforcement.

**Tweet 5:**
Works with Claude Code, Codex, Gemini, Amp, Cursor.

One command:
```
npx mcp-memory-gateway init
```

Fully free and unlimited. MIT licensed.

**Tweet 6:**
Pro ($19/mo or $149/yr) adds a searchable dashboard to query and export your 👍/👎 entries.

But captures, recalls, gates, and blocking all work for free. No limits.

GitHub: github.com/IgorGanapolsky/ThumbGate

#MCP #AIcoding #vibecoding

---

## 5. Product Hunt

**Tagline:** 👎 Thumbs down a mistake. It never happens again.

**Description:** Give your AI coding agent a 👎 when it screws up. ThumbGate turns that thumbs-down into a prevention rule that physically blocks the agent from repeating the mistake. 👍 Thumbs up reinforces what works. Over time, your feedback builds an immune system — good patterns stick, bad patterns are blocked at execution. Works with Claude Code, Codex, Gemini, Amp, Cursor. Free and unlimited. One command install.

---

## 6. mcp.so Submission

ThumbGate is a pre-action gate engine for AI coding agents. Unlike memory servers that store and retrieve context (Mem0, Zep), this server enforces behavior change: repeated failures are auto-promoted into prevention rules, and PreToolUse hooks physically block tool calls that match known failure patterns before they execute. Capture structured up/down feedback, validate it against a rubric engine (vague signals are rejected), promote to searchable JSONL + LanceDB vector memory, and recall relevant context at session start. The gate engine is the differentiator — agents don't just remember past mistakes, they are blocked from repeating them. Works with Claude Code, Codex, Gemini, Amp, Cursor, and any MCP-compatible agent. Install with `npx mcp-memory-gateway init`. MIT licensed.

---

## 7. smithery.ai Submission

ThumbGate captures explicit structured feedback from AI coding agents, validates it against a rubric engine, and auto-promotes repeated failures into prevention rules enforced via PreToolUse hooks. Pre-action gates physically block tool calls matching known failure patterns before execution — turning past mistakes into hard constraints rather than suggestions. Supports semantic recall via LanceDB vectors, DPO/KTO export for downstream fine-tuning, and a file watcher bridge for external signal ingestion. Compatible with Claude Code, Codex, Gemini, Amp, Cursor, and OpenCode. Install with `npx mcp-memory-gateway init` or `claude mcp add rlhf -- npx -y mcp-memory-gateway serve`. MIT licensed, open source.
