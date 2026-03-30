# Reddit Post: r/LocalLLaMA

**Subreddit:** r/LocalLLaMA
**Account:** u/eazyigz123
**Post type:** Technical discussion — accessible framing, no product links in body

---

**Title:** Has anyone built a feedback loop where thumbs-down actually blocks the agent from repeating a mistake?

---

**Body:**

I've been running local models for coding tasks and hit a pattern I think most people here have seen: you correct the agent, it adjusts, and next session it does the exact same thing again. System prompts help, but the agent can read a rule and still ignore it.

I tried a different approach: **give the agent a thumbs down 👎 when it screws up.** Not just a signal — a structured capture: what went wrong, what should change. That thumbs-down gets promoted into a prevention rule. The rule becomes a gate. The gate fires *before* the agent's tool call executes and blocks it. The agent physically cannot repeat the mistake.

👍 works the other way — it reinforces good behavior. Over time you get an adaptive system where patterns the agent should follow get stronger, and patterns it should avoid are blocked at the execution layer.

The interesting technical bit: the rules use Thompson Sampling (Beta distributions) to adapt. New rules start with high uncertainty and explore aggressively. Rules with a track record of correct blocks settle into stable enforcement. Rules that fire on legitimate actions decay. It's basically a bandit over your feedback history.

The cold-start question is the tricky part — a brand new rule has Beta(1,1) and fires very aggressively in its first ~20 evaluations. Warm-starting with Beta(2,5) helps but means genuinely dangerous rules (like blocking `rm -rf`) don't activate fast enough.

Has anyone used bandit approaches (UCB1, EXP3, contextual bandits) for rule enforcement in agentic systems? Curious if there's a cleaner cold-start solution.

---

**Comment (post if someone asks to see the implementation):**

Implementation is here: https://github.com/IgorGanapolsky/mcp-memory-gateway — the 👍/👎 feedback pipeline, Thompson Sampling, and gate engine are all in there. MIT licensed.

Disclosure: I built this.
