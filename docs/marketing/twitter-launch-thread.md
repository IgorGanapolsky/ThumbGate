# Twitter / X Launch Thread — ThumbGate

---

**Tweet 1 (hook):**
Your AI coding agent forgets every mistake the moment you close the session.

You corrected it yesterday. Today it breaks the same thing again.

I built a fix. Thread 🧵

---

**Tweet 2 (product + live URL):**
ThumbGate gives Claude Code, Codex, and Gemini persistent memory across sessions.

Thumbs-up/down feedback → stored locally → queried before every action → repeated failures auto-blocked.

Self-serve Pro ($49 one-time):
https://rlhf-feedback-loop-production.up.railway.app/checkout/pro

---

**Tweet 3 (free self-hosted CTA):**
Self-hosting is free and takes 30 seconds.

npx mcp-memory-gateway serve

That's it. Works with Claude Code, Codex CLI, Gemini CLI, Amp, Cursor. All data stays on your machine.

---

**Tweet 4 (what it actually does):**
Under the hood:

→ Captures structured feedback (context, what went wrong, severity)
→ LanceDB vector index for semantic recall mid-session
→ 3+ identical failures auto-generate a CLAUDE.md prevention rule
→ Exports DPO training pairs (chosen/rejected) for fine-tuning your own model

---

**Tweet 5 (engineering proof / validation):**
The system was validated using four independent AI agents — Claude, Codex, Amp, Gemini — each running the same test suite against it.

Compatibility report is generated in CI on every push.

This is dogfooding and engineering proof, not customer proof.

---

**Tweet 6 (objection handling):**
"I just put rules in my system prompt."

System prompts are per-session. They don't accumulate signal over time. They don't block semantically similar variants of the same mistake. They don't export training data.

This does all three.

---

**Tweet 7 (close + dual CTA):**
Free self-hosted: npx mcp-memory-gateway serve
Pro ($49 one-time): https://rlhf-feedback-loop-production.up.railway.app/checkout/pro
Hosted demo: https://rlhf-feedback-loop-production.up.railway.app
GitHub: https://github.com/IgorGanapolsky/ThumbGate
