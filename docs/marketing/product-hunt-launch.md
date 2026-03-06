# Product Hunt Launch Assets

## Name
Agentic Feedback Studio

## Tagline (60 chars)
Stop vibe-coding. The Veto Layer for AI Agents.

## Description (260 chars)
The operational layer for high-density preference data. Capture human feedback (thumbs up/down) to generate RLHF-ready datasets and enforce kernel-level guardrails across your repositories.

## Topics
Developer Tools, Artificial Intelligence, GitHub

## First Comment (Maker's Comment)
Hey Product Hunt! 👋 Igor here. 

We've all seen the magic of AI coding agents, but we've also seen the dark side: **Vibe Coding**. You tell an agent not to do something, and two days later, it makes the exact same mistake. Prompts are suggestions, not constraints. 

I built the **Agentic Feedback Studio** to solve the security and operational debt crisis caused by unmanaged agents. 

It provides a **Veto Layer** for your workflows. 

**How it works (V2V Pipeline):**
1️⃣ Capture a subjective "vibe" (thumbs down on a bad agent output).
2️⃣ The Studio extracts the semantic state of the failure.
3️⃣ It auto-generates a hard architectural constraint (`CLAUDE.md`) that blocks the agent from repeating the mistake. 

It is completely Zero-Config. Run `npx rlhf-feedback-loop install` in any repo, and it just works. 

**Bonus:** Run `npx rlhf-feedback-loop stats` to see our **Revenue-at-Risk Analyzer**, which calculates exactly how much money you are losing to repeated agent failures.

We are entirely open source, with a Cloud Pro tier for teams who want to sync their Veto rules globally. 

I'll be here all day answering questions! Let me know what you think. 🚀
