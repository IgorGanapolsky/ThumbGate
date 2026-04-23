---
title: "I Built Persistent Memory for Claude Code — Here's What I Learned"
published: false
tags: ai, mcp, thumbgate, devtools
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

## What Actually Worked: Prevention Checks

The breakthrough came when I stopped treating feedback as passive context and started treating it as active control flow.

[thumbgate](https://github.com/IgorGanapolsky/ThumbGate) is an MCP server that sits inside your agent's tool chain. The core loop:

1. You rate agent actions (thumbs up or down) with a brief note
2. Feedback gets stored in JSONL and indexed in LanceDB
3. When the same failure pattern appears 3+ times, the system auto-generates a **prevention check** — a structured rule that the agent must check before acting
4. Checks get enforced pre-action, not post-hoc

The install is one line:

```bash
npx thumbgate serve
```

Then add it to your MCP config (Claude Code example):

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

The agent now has access to tools like `capture_feedback`, `query_memory`, and `check_gates`. When it starts a task, it queries relevant checks first. If a check fires, the agent gets a structured warning with the historical context of why that approach failed before.

## The Interesting Part: Thompson Sampling

Static rules decay in usefulness. A check that was critical last month might be irrelevant after a refactor. Hard-coding enforcement creates the same problem as the 200-line CLAUDE.md — the agent drowns in stale constraints.

So I added Thompson Sampling (Beta-Bernoulli model) to decide which checks to enforce. Each check tracks its own alpha/beta parameters based on outcomes:

- Check fires and prevents a real failure -> reward (alpha increments)
- Check fires but the action would have been fine -> penalty (beta increments)
- Check with low engagement over time -> natural decay toward prior

The agent samples from each check's Beta distribution to decide enforcement probability. High-value checks get enforced consistently. Stale or noisy checks fade out on their own. No manual curation needed.

This turned out to be the single most impactful design decision in the project. The system self-corrects without human maintenance.

## DPO Export: Your Feedback as Training Data

Every up/down rating with context is a preference pair. The system exports these in standard DPO format (chosen/rejected with full prompt context) as JSONL, compatible with TRL and similar frameworks. It also supports KTO (Kahneman-Tversky Optimization) export for unpaired preference data.

I have not fine-tuned a model with this data yet, but the export pipeline is tested and the format is standard. If you are doing preference optimization research, this gives you a structured way to collect pairs from real coding sessions instead of synthetic generation.

## What I Learned

**Memory without enforcement is just a suggestion.** Agents ignore passive context under pressure. Checks that block action are 10x more effective than memories that inform context.

**Behavior steering needs exploration/exploitation.** Static rules accumulate cruft. Thompson Sampling keeps the system adaptive without manual pruning.

**MCP is the right abstraction layer.** Building this as an MCP server means it works with any MCP-compatible agent — Claude Code, Codex CLI, Gemini CLI, Amp — without agent-specific integration code. One server, multiple agents.

**Testing feedback systems is hard.** You cannot unit test "does the agent learn" in the traditional sense. I ended up with a large regression suite and proof-backed verification reports that cover the pipeline mechanics (capture, storage, retrieval, check generation, DPO export) without pretending to test emergent behavior directly.

## Try It

The core is open source under MIT:

```bash
npx thumbgate serve
```

GitHub: [github.com/IgorGanapolsky/ThumbGate](https://github.com/IgorGanapolsky/ThumbGate)
npm: [thumbgate](https://www.npmjs.com/package/thumbgate)

If you want a personal local dashboard and DPO export, there is a [Pro tier at $19/mo or $149/yr](https://thumbgate-production.up.railway.app/checkout/pro). Team workflows start with the Workflow Hardening Sprint when shared lessons, org visibility, and hosted rollout proof matter. The core local feedback loop still works on its own.

I have been running this on my own projects for months. The difference between session 1 and session 50 is noticeable — the agent stops making the same classes of mistakes. Not because it got smarter, but because the checks will not let it repeat what already failed.

Happy to answer questions or take feedback (pun intended).
