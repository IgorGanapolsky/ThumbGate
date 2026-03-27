# Reddit Post: r/programming

**Subreddit:** r/programming
**Account:** u/eazyigz123
**Post type:** Architecture essay — technical concept, no product pitch in body

---

**Title:** Pre-Action Gates: a reliability primitive for stateful AI agent workflows

---

**Body:**

AI coding agents (Claude Code, Cursor, Codex, etc.) have an underexplored failure mode: cross-session amnesia. You correct the agent, it adjusts within the session, and then next session it repeats the exact same mistake. System prompts and rules files help, but they're passive — the agent can read a rule and still ignore it.

**The pattern: enforcement over memory**

Instead of improving the agent's memory (larger context, better RAG), treat reliability as an enforcement problem. A pre-action gate sits between the agent's intent and execution — it intercepts tool calls (shell commands, file writes, API calls) before they run and checks them against a validated set of failure patterns. If the action matches a known-bad pattern, it's blocked. The agent never gets to execute it.

This is fundamentally different from context injection. A system prompt says "please don't force-push." A gate says "you physically cannot force-push until this rule is resolved."

**Where the rules come from**

Rules aren't hand-authored. They're promoted from structured feedback. When something goes wrong, you capture what happened, what went wrong, and what should change. If the same failure pattern appears repeatedly, it gets promoted into a prevention rule, which becomes a gate. The pipeline is: feedback -> validation -> dedup -> rule promotion -> gate enforcement.

**The interesting tradeoffs**

1. **False positives.** Gates that fire on legitimate actions erode trust. If the agent gets blocked when it shouldn't be, users disable gates entirely. The rule engine needs a way to demote or retire rules that fire incorrectly — we used Thompson Sampling (multi-armed bandit) to let rules earn or lose confidence over time.

2. **Rule staleness.** A rule that made sense 3 months ago may be wrong today. Codebases change. Without a decay mechanism, the gate set grows monotonically and becomes a drag on every tool call.

3. **Cold start.** New rules have no calibration data. Do you enforce them aggressively (risk false positives) or leniently (risk letting the failure through again)?

4. **Structured feedback quality.** This was the biggest surprise: requiring "what went wrong" and "what to change" fields (not just good/bad) dramatically reduced low-quality rules entering the gate engine. Unstructured feedback produces vague rules. Vague rules produce false positives. Structured feedback breaks the cycle.

**The result**

After running this pattern on a real codebase for a few months: repeated failures dropped to near-zero for any failure type that had a validated rule. The agent still makes new mistakes, but it genuinely cannot repeat old ones. The gate set acts as an accumulating immune system.

Curious if others have explored enforcement-based reliability for agentic workflows, or if the industry is mostly focused on the memory/RAG side of the problem.

---

**Comment (post alongside or when asked):**

Implementation is open source if anyone wants to look at the gate engine and feedback pipeline: https://github.com/IgorGanapolsky/mcp-memory-gateway — MIT licensed. The pre-action gate evaluator, Thompson Sampling, and feedback-to-rule promotion pipeline are all there.

Disclosure: I built this.
