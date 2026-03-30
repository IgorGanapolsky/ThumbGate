# Reddit Post: r/programming

**Subreddit:** r/programming
**Account:** u/eazyigz123
**Post type:** Architecture essay — approachable framing, no product links in body

---

**Title:** What if AI agents had a thumbs-down button that actually prevented them from repeating mistakes?

---

**Body:**

AI coding agents have a UX problem nobody talks about: you can't give meaningful feedback that persists.

You correct the agent in a session — "don't force-push to main" — and it adjusts. Next session, it does it again. Prompt rules help, but they're suggestions the agent can ignore. Memory/RAG approaches improve recall, but they don't enforce anything.

**The idea: thumbs-down = enforcement, not just feedback.**

When something goes wrong, you give a 👎. Not just a signal — a structured capture: what happened, what went wrong, what should change. That thumbs-down gets validated, deduplicated, and promoted into a prevention rule. The rule becomes a gate that fires *before* the agent's tool call executes. The agent physically cannot repeat the mistake.

👍 reinforces good behavior. Over time, the 👍/👎 signals build an accumulating immune system — patterns the agent should follow get stronger, patterns it should avoid are blocked at execution.

**Why enforcement beats memory:**

A system prompt says "please don't force-push." A gate says "you cannot force-push — this tool call is blocked." The difference matters. Memory is advisory. Enforcement is physical.

**The tricky parts:**

1. **False positives.** Gates that block legitimate actions erode trust. If users start ignoring gates, the system is useless. You need rules to lose confidence when they fire incorrectly — adaptive weighting (Thompson Sampling / multi-armed bandit) works here.

2. **Feedback quality.** Just "thumbs down" without context produces vague rules. Requiring "what went wrong" + "what to change" fields dramatically reduces garbage entering the gate engine.

3. **Cold start.** New rules have no data. Enforce aggressively (risk false positives) or leniently (risk letting the failure through)?

After running this pattern for months: repeated failures dropped to near-zero for any failure type with a validated rule. The agent still makes new mistakes, but it genuinely cannot repeat old ones.

Curious if others have explored enforcement-based feedback (not just context/memory) for agentic workflows.

---

**Comment (post alongside or when asked):**

Implementation is open source: https://github.com/IgorGanapolsky/ThumbGate — 👍 reinforces, 👎 blocks. Works with Claude Code, Cursor, Codex, Gemini, Amp. MIT licensed.

Disclosure: I built this.
