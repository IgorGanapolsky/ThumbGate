# ThumbGate — Launch Content

---

## 1. Show HN Post

**Title:** Show HN: MCP server that stops Claude/Cursor from making the same mistake twice

**Body:**

I built an MCP server that prevents AI coding agents from repeating known mistakes. It's called ThumbGate.

The problem: AI agents lose memory between sessions. You tell Claude "don't push without checking PR threads" on Monday, and by Wednesday it's doing it again. Multiply that by every mistake across every project.

What this does, concretely:

1. You capture explicit up/down feedback with structured context (vague thumbs-down is rejected)
2. Repeated failures (3+ occurrences) auto-promote into prevention rules
3. PreToolUse hooks physically block the agent before it executes a known-bad action
4. At session start, relevant past context is injected so the agent has project history it would otherwise lose

This is NOT another context/memory store like Mem0 or Zep. Those systems store and retrieve context. This system enforces behavior change — it has pre-action gates that block tool calls before they happen. The agent literally cannot push to main without checking review threads if that rule exists. That's the difference between "remember this" and "prevent this."

Honest disclaimer in the README: this is context injection, not actual RLHF. LLM weights don't change. What happens is feedback gets validated, promoted to searchable memory, and recalled at session start. The pre-action gates are the real value — they turn past mistakes into physical blocks.

Works with Claude Code, Codex, Gemini, Amp, Cursor, OpenCode.

Install:

```
npx mcp-memory-gateway init
```

Or wire it to a specific agent:

```
npx mcp-memory-gateway init --agent claude-code
```

MIT licensed. $49 one-time Mistake-Free Starter Pack (500 credits) available for teams that want hosted analytics, but the core is fully open source.

GitHub: https://github.com/IgorGanapolsky/thumbgate

Happy to answer questions about the gate engine or how prevention rules are generated.

---

## 2. Reddit r/ClaudeAI Post

**Title:** I built an MCP server that gives Claude Code persistent memory and prevents it from repeating mistakes

**Body:**

If you use Claude Code daily, you've hit this: Claude makes the same mistake across sessions. It pushes without checking PR threads. It skips tests. It force-pushes when it shouldn't. You correct it, it apologizes, and next session it does it again.

The root cause is simple — Claude has no memory between sessions. Every conversation starts from zero.

I built ThumbGate to fix this. Here's how it works:

**Capture:** When Claude does something wrong, you capture structured feedback (not just "bad" — it requires what went wrong and what to change). When it does something right, you capture that too.

**Promote:** When the same failure shows up 3+ times, it automatically becomes a prevention rule.

**Gate:** Prevention rules become PreToolUse hooks. Before Claude executes a tool call, the gate engine checks if it matches a known failure pattern. If it does, the call is blocked with an explanation of why and what to do instead.

**Recall:** At session start, relevant context from past sessions is injected so Claude knows what happened before.

The key difference from other memory tools: this doesn't just store context for retrieval. It physically blocks known-bad actions before they execute. Claude cannot skip the step it keeps forgetting because the gate won't let it.

Install in one command:

```
npx mcp-memory-gateway init
```

Or add it directly:

```
claude mcp add rlhf -- npx -y mcp-memory-gateway serve
```

Works with Claude Code, Codex, Gemini, Amp, and Cursor. MIT licensed, fully open source.

There's an optional Pro tier ($49 one-time, 500 credits) for hosted memory sync and usage analytics, but everything described above works locally for free.

GitHub: https://github.com/IgorGanapolsky/thumbgate

---

## 3. Reddit r/vibecoding Post

**Title:** I tracked my AI agent's mistakes for 3 months — it repeated the same 10 failures 84% of the time

**Body:**

I've been using Claude Code as my primary coding agent for months. After yet another session where it pushed to main without checking PR review threads (for the fifth time), I started logging every failure with structured context.

After 3 months of data, the pattern was obvious: the same small set of mistakes accounted for the vast majority of failures. Skip tests, forget to check threads, force-push, ignore linting, commit secrets — the same stuff, over and over.

The problem isn't that AI agents are bad at coding. It's that they have zero memory between sessions. Every session starts clean. There's no mechanism to say "you've done this wrong before, don't do it again."

So I built one. ThumbGate captures explicit feedback, and when the same failure appears 3+ times, it auto-generates a prevention rule. That rule becomes a pre-action gate — a hook that fires before the agent executes a tool call. If the call matches a known failure pattern, it's blocked.

The result: after deploying gates on my top 10 failure patterns, those specific mistakes dropped to near-zero. The agent still finds new ways to mess up (it's creative like that), but it stopped repeating the known ones.

It works with any MCP-compatible agent. One command to set up:

```
npx mcp-memory-gateway init
```

The core is open source and MIT licensed. There's a $49 one-time Starter Pack if you want hosted analytics.

GitHub: https://github.com/IgorGanapolsky/thumbgate

---

## 4. X/Twitter Thread

**Tweet 1:**
AI coding agents have a dirty secret: they repeat the same mistakes every single session.

No memory. No learning. You correct them, they apologize, and do it again tomorrow.

I built something that fixes this. Thread:

**Tweet 2:**
ThumbGate captures structured feedback when your agent fails.

Not vague "thumbs down" — it requires: what went wrong, what context, what to change.

When the same failure appears 3+ times, it auto-promotes into a prevention rule.

**Tweet 3:**
Prevention rules become pre-action gates.

Before your agent executes a tool call, the gate engine checks if it matches a known failure pattern.

If it does: blocked. With an explanation. Before the damage happens.

This is not "remember context." This is "physically prevent the mistake."

**Tweet 4:**
Example: my agent kept pushing to main without checking PR review threads.

After 3 captured failures, a gate was auto-generated. Now the agent literally cannot run `git push` without running `gh pr view` first. The gate blocks it.

**Tweet 5:**
Works with Claude Code, Codex, Gemini, Amp, Cursor.

One command:
```
npx mcp-memory-gateway init
```

MIT licensed. Fully open source.

**Tweet 6:**
Optional: $49 one-time Mistake-Free Starter Pack (500 credits) for teams that want hosted memory sync and analytics.

But the gate engine, prevention rules, and local memory all work for free.

GitHub: github.com/IgorGanapolsky/thumbgate
Landing: rlhf-feedback-loop-production.up.railway.app

#MCP #AIcoding

---

## 5. Product Hunt

**Tagline:** Pre-action gates that stop AI agents repeating mistakes

**Description:** MCP server that captures structured feedback from AI coding agents, auto-promotes repeated failures into prevention rules, and enforces them via pre-action gates. Your agent physically cannot repeat a known mistake. Works with Claude Code, Codex, Gemini, Amp, Cursor. Open source, one command install.

---

## 6. mcp.so Submission

ThumbGate is a pre-action gate engine for AI coding agents. Unlike memory servers that store and retrieve context (Mem0, Zep), this server enforces behavior change: repeated failures are auto-promoted into prevention rules, and PreToolUse hooks physically block tool calls that match known failure patterns before they execute. Capture structured up/down feedback, validate it against a rubric engine (vague signals are rejected), promote to searchable JSONL + LanceDB vector memory, and recall relevant context at session start. The gate engine is the differentiator — agents don't just remember past mistakes, they are blocked from repeating them. Works with Claude Code, Codex, Gemini, Amp, Cursor, and any MCP-compatible agent. Install with `npx mcp-memory-gateway init`. MIT licensed.

---

## 7. smithery.ai Submission

ThumbGate captures explicit structured feedback from AI coding agents, validates it against a rubric engine, and auto-promotes repeated failures into prevention rules enforced via PreToolUse hooks. Pre-action gates physically block tool calls matching known failure patterns before execution — turning past mistakes into hard constraints rather than suggestions. Supports semantic recall via LanceDB vectors, DPO/KTO export for downstream fine-tuning, and a file watcher bridge for external signal ingestion. Compatible with Claude Code, Codex, Gemini, Amp, Cursor, and OpenCode. Install with `npx mcp-memory-gateway init` or `claude mcp add rlhf -- npx -y mcp-memory-gateway serve`. MIT licensed, open source.
