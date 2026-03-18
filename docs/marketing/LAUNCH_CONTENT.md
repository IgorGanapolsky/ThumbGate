# high-ROI Launch Content Package

## 1. Reddit Post (Target: r/ClaudeCode, r/ClaudeAI)

**Title:** I built an AI reliability system for Claude Code — keep one sharp agent on task

**Body:**
Claude Code is strong, but the failure mode I kept seeing was not just forgetting context. It was repeating the same operational mistakes across sessions.

It's called **Agentic Feedback Studio**.

- **Problem:** Project lessons disappear, feedback gets lost, and the same mistakes keep happening.
- **Solution:** A local-first reliability layer that captures feedback, retrieves the right lesson on the next task, and turns repeated failures into prevention rules.
- **Features:** 
  - Zero-Config: Drop it into any repo with `npx mcp-memory-gateway install`.
  - Reliability Loop: feedback -> retrieval -> prevention rules -> verification.
  - Bayesian Preference Scoring: Thompson Sampling models preference shifts over time.
  - DPO/KTO Export: Turn real sessions into training data for fine-tuning.
- **Open Source:** Totally free for solo devs.
- **Commercial:** The public self-serve offer today is the **$49 one-time Pro plan**. Hosted pilots are by request.

Check it out on GitHub: [https://github.com/IgorGanapolsky/mcp-memory-gateway]
Demo/Hosted: [https://mcp-memory-gateway.up.railway.app]

Would love to hear how you're reducing repeated agent mistakes without adding more orchestration overhead.

---

## 2. Show HN Post

**Title:** Show HN: MCP Memory Gateway – AI reliability layer for coding agents

**Body:**
Hi HN, I’m launching the MCP Memory Gateway (Agentic Feedback Studio).

Most developers are now running serious work through coding agents, but the same mistake keeps showing up: the agent has the docs, but not the lesson. That leads to repeated errors, extra review overhead, and brittle workflows.

I built a local-first reliability layer that implements:
1. **Vibe-to-Verification (V2V):** Turns operator feedback into repository guardrails.
2. **Structured Retrieval:** Pulls the right project lesson back into the next task.
3. **Prevention Rules:** Repeated failures become hard checks instead of recurring incidents.
4. **DPO/KTO Pipelines:** Automated dataset engineering for model alignment.

It works with any MCP-compatible agent (Claude Code, Codex, Gemini).

**Zero-Config:** Drop it into any repo with one command: `npx mcp-memory-gateway install`

GitHub: [https://github.com/IgorGanapolsky/mcp-memory-gateway]
Landing Page: [https://mcp-memory-gateway.up.railway.app]

I'm here all day to answer technical questions about reliability layers, guardrails, and proof loops for coding agents.

---

## 3. Discord Showcase Post (MCP Official / Claude Code)

**Message:**
🚀 Just launched **Agentic Feedback Studio**. It is a local-first AI reliability layer for MCP-compatible coding agents.

If Claude makes a mistake, capture it once and turn it into a reusable lesson, prevention rule, or hard guardrail so the same failure stops repeating.

- 🛠 **Zero-Config:** `npx mcp-memory-gateway install`
- 🧠 **Reliability Loop:** feedback -> retrieval -> prevention rules -> verification
- ⚡ **Global Skill:** Install once, use across all your repos.

OSS is free. The public self-serve offer is Pro at $49 one-time.
Repo: https://github.com/IgorGanapolsky/mcp-memory-gateway
Live: https://mcp-memory-gateway.up.railway.app

---

## 4. Cold Outreach Hooks (Twitter DM / LinkedIn)

- **Hook 1:** "I saw your work on [Project]. We are building a local-first reliability layer for coding agents that turns repeated failures into prevention rules. Would love your feedback on the zero-config setup."
- **Hook 2:** "Running Claude Code or Codex seriously? We built a feedback -> retrieval -> prevention loop that helps one sharp agent stop repeating the same mistakes across sessions. Want to try it?"
