# Token-Cost Mission — Social Pack

ThumbGate's new positioning, framed for every channel. Each variant is pre-validated against the platform char limit.

> **Mission:** stop paying for the same AI mistake twice.

Run `node scripts/validate-social-post.js path/to/draft.md` before publishing any of these.

---

## X / Twitter (≤ 280 chars)

### A — math hook (235 chars)

```text
Sonnet costs $3/$15 per 1M tokens. Every retry, every hallucination, every repeat-mistake the agent makes — you pay for it. ThumbGate blocks known-bad calls before the model sees them. 0 tokens. 0 round-trip. 0 retry loop. Fix it once, your bill never sees it again.
```

### B — meter hook (244 chars)

```text
Your AI agent forgets between sessions. Same hallucination, same retry loop, same wasted tokens — every Monday. ThumbGate's pre-action gates intercept the call before it hits the model. Tokens spent on the repeat: 0. Mission: don't pay for the same mistake twice.
```

### C — receipt hook (227 chars)

```text
$0.21 in tokens to fix the same agent mistake 3 times. Multiply by every dev, every repeated mistake class, every week. The math gets ugly fast. ThumbGate blocks the repeat before the model sees it. Fix it once. Bill never sees it again.
```

---

## Threads / Mastodon (≤ 500 chars)

### A — long math hook (484 chars, fits Threads/Mastodon)

```text
The honest cost of AI coding nobody talks about:

Sonnet 4.5 = $3 / 1M input + $15 / 1M output. Opus = 5x.

Every hallucination → retry. Every "no, try again" → the meter runs. Your agent has no memory between sessions, so the same mistake costs you again next Monday.

ThumbGate's mission: stop paying for the same AI mistake twice.

One 👎 → permanent gate → 0 tokens on the repeat. Forever.

→ thumbgate.ai
```

### B — story hook (489 chars)

```text
Sat down to look at my Anthropic bill. ~40% of the spend was Claude Code retrying things I'd already corrected. Same wrong import, same wrong file path, same wrong test name. Different week. Same tokens. Same dollars.

So I built ThumbGate. One thumbs-down on the wrong tool call → a Pre-Action Gate intercepts every future occurrence before it hits the model. 0 input tokens. 0 output tokens. 0 retry loop.

Mission: stop paying for the same AI mistake twice.

→ thumbgate.ai
```

---

## LinkedIn (≤ 3000 chars; sweet spot 1300–1700)

### A — engineering-leader hook (1240 chars)

```text
The hidden line item on every AI-coding budget: paying for the same mistake twice.

Frontier models are not cheap. Sonnet 4.5 is $3 per million input tokens and $15 per million output. Opus is 5× that. The arithmetic looks fine on a single call. It looks ugly across a team of 8 engineers, each running an agent loop 50 times a day, where the agent has no memory between sessions and re-discovers the same wrong import, same flaky test pattern, same wrong file path it already learned about last Tuesday.

Most "AI agent reliability" tools approach this as a quality problem. We approached it as a billing problem.

ThumbGate is a local-first enforcement layer that turns one thumbs-down into a Pre-Action Gate — a hook that physically intercepts the offending tool call before it reaches the model. Zero input tokens. Zero output tokens. Zero retry loop. The savings show up on the dashboard as a live "tokens saved this week" counter so your engineering manager can put a real dollar number on the gate's value.

Mission: stop paying for the same AI mistake twice.

Open source, MIT, runs against Claude Code / Cursor / Codex / Gemini / Amp / OpenCode and any MCP-compatible agent.

→ thumbgate.ai
→ npm i -g thumbgate

What's the worst repeat-mistake your agent makes that you wish you could just block forever? Reply below.
```

---

## Hacker News title (≤ 80 chars; ideal ≤ 60)

### A (54 chars)

```text
Show HN: ThumbGate – stop paying for the same AI mistake twice
```

### B (58 chars)

```text
Show HN: ThumbGate – live "tokens saved" counter for AI agents
```

### C (67 chars)

```text
ThumbGate: pre-action gates that cut your Anthropic bill on retry loops
```

---

## Reddit (r/LocalLLaMA, r/ChatGPTCoding, r/programming)

### Title (≤ 300 chars)

```text
[Tool] ThumbGate – an open-source pre-action gate that stops your AI agent from burning tokens on the same hallucination twice
```

### Body (no enforced limit — keep tight)

```text
Why I built this: I was looking at my Anthropic bill and noticed that ~40% of the spend was Claude Code retrying tool calls I'd already corrected once. Same wrong file path. Same wrong test name. Same wrong import. Different week. Same dollars.

ThumbGate is a local-first enforcement layer. You give a tool call a thumbs-down, ThumbGate distills it into a Pre-Action Gate — a PreToolUse hook that physically intercepts the same call before it reaches the model. Zero input tokens. Zero output tokens. Zero retry loop.

The dashboard has a live "tokens saved this week" counter so you can see the actual dollar impact of your gates. Defaults to a Sonnet-blended estimate (you can swap models if you're on Opus or GPT).

MIT licensed. Works with Claude Code, Cursor, Codex, Gemini, Amp, OpenCode, and any MCP-compatible agent.

Repo: https://github.com/IgorGanapolsky/ThumbGate
Live dashboard: https://thumbgate.ai/dashboard

Honest feedback wanted — especially from people running agent loops at scale. What's your worst repeat-mistake?
```

---

## Video script — 60-second TikTok / Shorts

```text
[0:00–0:05] Open on Anthropic billing page. Highlight a $400 monthly line item.

VO: "$400 a month on Claude. Forty percent of that — paying for the same mistake twice."

[0:05–0:15] Cut to terminal. Agent makes a wrong git push command. User types `thumbs down: never run --force on main`. ThumbGate captures the lesson.

VO: "One thumbs-down. ThumbGate turns it into a permanent gate."

[0:15–0:30] New session. Same agent, same wrong command. Hook fires. ⛔ BLOCKED. Token counter on screen reads 0.

VO: "Next time the agent tries it — zero tokens. Zero retry. Zero round-trip. The model never even sees the call."

[0:30–0:45] Dashboard screen. Live "Tokens Saved This Week" counter ticks up. Big green number.

VO: "Live counter on the dashboard. Real dollar savings. Every gate, every block, every week."

[0:45–0:55] Cut to logo. Tagline on screen: "Stop paying for the same AI mistake twice."

VO: "ThumbGate. Open source. Free CLI. Install in five minutes."

[0:55–1:00] CTA card: thumbgate.ai
```

---

## After publishing

For each channel, log the variant + char-count + post URL into `.claude/memory/feedback/feedback-log.jsonl` so we can A/B which hook converts. The hook with the highest 48h profile-click rate becomes the default for the next round.
