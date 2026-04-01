---
title: "I Built Persistent Memory for Claude Code — Here's What I Learned"
published: false
tags: ai, mcp, rlhf, devtools
cover_image:
canonical_url: https://github.com/IgorGanapolsky/ThumbGate
---

Every AI coding agent has the same defect, and it has nothing to do with intelligence.

It forgets.

You spend 20 minutes explaining a constraint. The agent nails it. Next session, it violates that same constraint in the first 30 seconds. You thumbs-down, re-explain, move on. Two sessions later — same thing. There is no learning. There is no memory. There is just an expensive autocomplete that makes you repeat yourself.

I got tired of it, so I built a system that actually retains feedback across sessions. Along the way, I discovered that the hard part is not storing memories — it is deciding which ones to enforce.

## The Problem Is Not What You Think

When I started, I assumed the fix was simple: write feedback to a file, load it next session, done. I tried several approaches:

**Attempt 1: CLAUDE.md rules.** I manually added "never do X" lines to my project instructions. This worked until the file hit 200 lines and the agent started ignoring half of it due to context window pressure. Rules conflicted with each other. No way to know which ones actually mattered.

**Attempt 2: A simple feedback log.** I captured every up/down signal to a JSONL file and injected recent entries into the system prompt. Better, but noisy. The agent would fixate on irrelevant old feedback while ignoring critical patterns. No prioritization, no decay.

**Attempt 3: Vector search over feedback.** I embedded all feedback entries and retrieved the most relevant ones per query. This helped with relevance but created a new problem: the agent would retrieve memories about a similar-sounding situation and apply the wrong lesson. Semantic similarity is not the same as causal relevance.

None of these worked reliably. The missing piece was not retrieval — it was **behavior steering**.

## What Actually Worked: Prevention Gates

The breakthrough came when I stopped treating feedback as passive context and started treating it as active control flow.

[mcp-memory-gateway](https://github.com/IgorGanapolsky/ThumbGate) is an MCP server that sits inside your agent's tool chain. The core loop:

1. You rate agent actions (thumbs up or down) with a brief note
2. Feedback gets stored in JSONL and indexed in LanceDB
3. When the same failure pattern appears 3+ times, the system auto-generates a **prevention gate** — a structured rule that the agent must check before acting
4. Gates get enforced pre-action, not post-hoc

The install is one line:

```bash
npx mcp-memory-gateway serve
```

Then add it to your MCP config (Claude Code example):

```json
{
  "mcpServers": {
    "memory-gateway": {
      "command": "npx",
      "args": ["mcp-memory-gateway", "serve"]
    }
  }
}
```

The agent now has access to tools like `capture_feedback`, `query_memory`, and `check_gates`. When it starts a task, it queries relevant gates first. If a gate fires, the agent gets a structured warning with the historical context of why that approach failed before.

## The Interesting Part: Thompson Sampling

Static rules decay in usefulness. A gate that was critical last month might be irrelevant after a refactor. Hard-coding enforcement creates the same problem as the 200-line CLAUDE.md — the agent drowns in stale constraints.

So I added Thompson Sampling (Beta-Bernoulli model) to decide which gates to enforce. Each gate tracks its own alpha/beta parameters based on outcomes:

- Gate fires and prevents a real failure -> reward (alpha increments)
- Gate fires but the action would have been fine -> penalty (beta increments)
- Gate with low engagement over time -> natural decay toward prior

The agent samples from each gate's Beta distribution to decide enforcement probability. High-value gates get enforced consistently. Stale or noisy gates fade out on their own. No manual curation needed.

This turned out to be the single most impactful design decision in the project. The system self-corrects without human maintenance.

## DPO Export: Your Feedback as Training Data

Every up/down rating with context is a preference pair. The system exports these in standard DPO format (chosen/rejected with full prompt context) as JSONL, compatible with TRL and similar frameworks. It also supports KTO (Kahneman-Tversky Optimization) export for unpaired preference data.

I have not fine-tuned a model with this data yet, but the export pipeline is tested and the format is standard. If you are doing preference optimization research, this gives you a structured way to collect pairs from real coding sessions instead of synthetic generation.

## What I Learned

**Memory without enforcement is just a suggestion.** Agents ignore passive context under pressure. Gates that block action are 10x more effective than memories that inform context.

**Behavior steering needs exploration/exploitation.** Static rules accumulate cruft. Thompson Sampling keeps the system adaptive without manual pruning.

**MCP is the right abstraction layer.** Building this as an MCP server means it works with any MCP-compatible agent — Claude Code, Codex CLI, Gemini CLI, Amp — without agent-specific integration code. One server, multiple agents.

**Testing feedback systems is hard.** You cannot unit test "does the agent learn" in the traditional sense. I ended up with 314 tests and 12 proof-of-correctness reports that verify the pipeline mechanics (capture, storage, retrieval, gate generation, DPO export) without trying to test emergent behavior.

## Try It

The core is open source under MIT:

```bash
npx mcp-memory-gateway serve
```

GitHub: [github.com/IgorGanapolsky/ThumbGate](https://github.com/IgorGanapolsky/ThumbGate)
npm: [mcp-memory-gateway](https://www.npmjs.com/package/mcp-memory-gateway)

If you want a personal local dashboard, DPO export, and an optional hosted API key for team workflows, there is a [Pro tier at $19/mo](https://rlhf-feedback-loop-production.up.railway.app). The core local feedback loop still works on its own.

I have been running this on my own projects for months. The difference between session 1 and session 50 is noticeable — the agent stops making the same classes of mistakes. Not because it got smarter, but because the gates will not let it repeat what already failed.

Happy to answer questions or take feedback (pun intended).
