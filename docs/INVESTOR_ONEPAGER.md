# ThumbGate — Investor One-Pager

**The control tower for autonomous coding agents.** *2026-07-09 · pre-seed*

## Problem
Enterprises are giving AI coding agents (Claude Code, Cursor, Codex, Gemini CLI) write-access to terminals, repos, databases, and production — and running up large monthly token bills on runaway loops. Public reporting says Uber exhausted its **entire 2026 AI budget in four months** as Claude Code adoption spread internally, and later applied monthly per-tool caps for agentic coding software ([Forbes](https://www.forbes.com/sites/janakirammsv/2026/05/17/uber-burns-its-2026-ai-budget-in-four-months-on-claude-code/), [Fortune](https://fortune.com/2026/05/26/uber-coo-ai-spending-tokens-claude-code/), [Simon Willison/Bloomberg summary](https://simonwillison.net/2026/Jun/3/uber-caps-usage/)). The governance layer is still catching up.

## Product
ThumbGate is a **PreToolUse firewall** that sits in the call path of every major coding agent. It learns each org's known-bad actions from developer 👍/👎 feedback, turns them into prevention rules, and hard-blocks the catastrophic ones (secret exfiltration, destructive deletes, supply-chain) before they execute — warn-by-default for the rest. One governance layer across all agents, not locked to one vendor's native gate.

## Why now
Runtime AI-agent security is validated and consolidating fast: **$3.6B** into agentic-AI-security startups (2025–26), and three enforcement-layer acquisitions in 12 months — Lakera→Check Point, Protect AI→Palo Alto (~$29B agentic-security roll-up), Invariant→Snyk. Platforms are buying this category.

## The open seat
The enterprise-SOC crowd is well-funded, but the **coding-agent-native / MCP-security niche has taken only ~$40M total** (Runlayer $11M, Helmet $9M, Operant $13.5M) — a fraction of the category. ThumbGate is the coding-agent-native, learns-from-feedback wedge in an under-capitalized niche.

## Moat (compounding, un-forkable)
Not the code — the enforcement primitive is commoditized OSS. The moat is: **(1) accumulated per-org lesson data** that gets more accurate the longer each customer's agents run; **(2) hosted state + adapter breadth** across every major coding agent (switching cost); **(3) the enterprise audit surface** — an immutable record of what every agent was blocked from doing, i.e. a system-of-record.

## Business model (open-core)
Free OSS runtime = top-of-funnel adoption. **Team $49–99/seat/mo** and **Enterprise $25K–75K+ ACV** unlock the learned models, exporters, hosted dashboard/sync, SSO, and audit/compliance. Positioning: **"token-insurance"** — a fraction of the agent spend it protects.

## Traction plan → raise
North-star metric: **tokens-prevented / catastrophic-blocks-fired.** Pre-raise targets: OSS install + active-agents count, 3–5 design partners with visible token-burn pain, ≥1 enterprise LOI/paid pilot at $25K+ ACV. 2026 seed bar: ~$300–500K ARR trajectory, 15–20%+ MoM; rounds land $1–4M (median ~$2.5M).

## Ask
[Raise amount / use of funds — TBD by CEO.] Target COSS-focused investors (OSS Capital, Open Core Ventures) + agentic-security-thesis funds (Khosla, Felicis, SYN Ventures active in the MCP-security cohort).

*Sources: softwarestrategiesblog.com (funding/M&A); cossreport.com; techcrunch.com (IBM/HashiCorp $6.4B); snyk.io, generalanalysis.com; getdx.com, digitalapplied.com (pricing); crv.com (seed criteria).*
