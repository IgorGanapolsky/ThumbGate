# high-ROI Launch Content Package

## 1. Reddit Post (Target: r/ClaudeCode, r/ClaudeAI)

**Title:** I built persistent memory for Claude Code — never lose context between sessions again

**Body:**
Claude Code is amazing, but the biggest pain is how it forgets context between sessions. I spent the last week building a persistent memory layer that fixes this.

It's called **Agentic Feedback Studio**.

- **Problem:** Claude forgets what we decided yesterday. Subjective instructions (vibes) don't stick.
- **Solution:** A Veto Layer that captures feedback (up/down) and converts it into hard architectural constraints (`CLAUDE.md`) automatically.
- **Features:** 
  - Zero-Config: Drop it into any repo with `npx mcp-memory-gateway install`.
  - Bayesian Preference Scoring: Thompson Sampling models your preferences in real-time.
  - DPO/KTO Export: Turn your sessions into training data for fine-tuning.
- **Open Source:** Totally free for solo devs.
- **Commercial:** The public self-serve offer today is the **$29/mo Pro plan**. Hosted pilots are by request.

Check it out on GitHub: [https://github.com/IgorGanapolsky/mcp-memory-gateway]
Demo/Hosted: [https://mcp-memory-gateway.up.railway.app]

Would love to hear how you're managing long-term agent memory!

---

## 2. Show HN Post

**Title:** Show HN: MCP Memory Gateway – Persistent memory and guardrails for AI coding agents

**Body:**
Hi HN, I’m launching the MCP Memory Gateway (Agentic Feedback Studio).

Most developers are "vibe coding"—giving agents subjective instructions that are forgotten in the next session. This creates massive technical and security debt as agents repeat mistakes.

I built an Agentic Control Plane that implements:
1. **Vibe-to-Verification (V2V):** Directly converts thumbs up/down into repository guardrails.
2. **Thompson Sampling:** A Bayesian reward estimator that models user preference shifts over time.
3. **DPO/KTO Pipelines:** Automated dataset engineering for model alignment.

It works with any MCP-compatible agent (Claude Code, Codex, Gemini).

**Zero-Config:** Drop it into any repo with one command: `npx mcp-memory-gateway install`

GitHub: [https://github.com/IgorGanapolsky/mcp-memory-gateway]
Landing Page: [https://mcp-memory-gateway.up.railway.app]

I'm here all day to answer technical questions about Agentic Control Planes!

---

## 3. Discord Showcase Post (MCP Official / Claude Code)

**Message:**
🚀 Just launched **Agentic Feedback Studio**! It's a persistent memory layer and Veto control plane for MCP agents.

Stop vibe-coding. If Claude makes a mistake, flag it, and the Studio generates a hard guardrail in your `CLAUDE.md` so it never happens again.

- 🛠 **Zero-Config:** `npx mcp-memory-gateway install`
- 🧠 **Smart Memory:** Vector storage via LanceDB + Bayesian reward estimation.
- ⚡ **Global Skill:** Install once, use across all your repos.

OSS is free. The public self-serve offer is Pro at $29/mo.
Repo: https://github.com/IgorGanapolsky/mcp-memory-gateway
Live: https://mcp-memory-gateway.up.railway.app

---

## 4. Cold Outreach Hooks (Twitter DM / LinkedIn)

- **Hook 1:** "I saw your work on [Project]. We're building a Veto Layer for agent fleets to stop them from repeating expensive hallucinations. Would love your feedback on the Zero-Config setup."
- **Hook 2:** "Running Claude Code in production? We built a Revenue-at-Risk analyzer that calculates exactly how much money you lose to repeated agent failures. Try it: `npx mcp-memory-gateway stats`."
