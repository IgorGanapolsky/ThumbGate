# Reddit Post: r/LocalLLaMA

**Subreddit:** r/LocalLLaMA
**Account:** u/eazyigz123
**Post type:** Technical discussion — algorithm tradeoffs, no product links in body

---

**Title:** Using Thompson Sampling for adaptive pre-action gates in AI agent workflows — worth it or overkill?

---

**Body:**

Working on a reliability layer for AI coding agents and ran into an interesting algorithmic tradeoff I wanted to get opinions on.

**The problem:** You have a set of prevention rules that gate agent actions — things like "don't force-push to main" or "don't delete files matching *.env." Each rule fires before a tool call executes and can block it. The challenge is that static rules degrade over time: some fire too aggressively (false positives cause alert fatigue, the user starts ignoring gates), and some fire too rarely to justify the overhead of checking them.

**What I tried:** Thompson Sampling, where each rule maintains a Beta(alpha, beta) distribution over its block/pass history. When the agent requests a tool call, the gate engine samples from each relevant rule's distribution and decides whether to enforce it. Rules with high uncertainty (new rules, or rules that haven't been tested much) get sampled more aggressively — essentially maximum exploration. Rules that have a strong track record of correct blocks settle into reliable enforcement. Rules that consistently fire on legitimate actions decay naturally.

**The tradeoff I'm stuck on:** Cold start. A brand new rule has Beta(1,1) — uniform prior — which means it gets maximum exploration weight. In practice, this means new rules fire very aggressively in their first ~20 evaluations, which feels punitive to the user. You just created a rule and suddenly it's blocking everything.

I tried a few mitigations:
- Warm start with Beta(2,5) — biased toward passing, so new rules are lenient by default and tighten only after confirmed blocks
- Decay factor on alpha — old successes count less, so rules that haven't triggered recently lose confidence
- Separate exploration budget — only N rules per session can be in "exploration mode"

Each has its own failure mode. The warm start means genuinely dangerous rules (like the rm -rf gate) don't activate fast enough. The decay factor causes oscillation in stable rules. The exploration budget creates priority conflicts.

Has anyone used Thompson Sampling or other bandit approaches (UCB1, EXP3, contextual bandits) for rule selection or policy enforcement in agentic systems? Curious if there's a cleaner solution to the cold-start problem that I'm missing.

---

**Comment (post if someone asks to see the implementation):**

Implementation is here if you want to look at the gate engine code: https://github.com/IgorGanapolsky/mcp-memory-gateway — the Thompson Sampling logic is in the pre-action gate evaluator. MIT licensed.

Disclosure: I built this.
