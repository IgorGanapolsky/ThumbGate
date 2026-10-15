---
name: autonomous-linkedin-growth-engine
description: Autonomous LinkedIn technical storytelling, daily showcase generation, viral engineering postmortems, comment injection, and profile positioning for ThumbGate. Rotates high-intent topics (HotData POC, Autotomy dual-lock, 301M token runaway agent loops) and converts engineering leaders into $499 Diagnostic and $19/mo Pro pilots.
---

# Autonomous LinkedIn Growth Engine & Technical Showcases

> Purpose: **Autonomous LinkedIn Profile Enhancement & Daily Outreach**
> Target: **Convert Engineering Leaders to ThumbGate Pilots ($499 / $19/mo)**

---

## 1. Executive Strategy

LinkedIn is the highest-converting B2B channel for enterprise AI infrastructure and agentic reliability. Autonomous coding agents (Cursor, Claude Code, Copilot) are causing massive pain: runaway loops burning $1,000s in API bills, broken builds, and production regressions.

This skill equips Antigravity to:
1. **Showcase Deep Technical Milestones Daily**:
   - The **HotData Apache Arrow POC**: Dropping local LanceDB for high-concurrency Arrow memory with sub-0.5ms PreToolUse query diodes.
   - The **Autotomy Dual-Lock Architecture**: Compile-time layer boundaries paired with runtime execution firewalls.
   - The **HALO 301M-Token Runaway Loop Teardown**: Why prompt guardrails fail and why runtime CPU firewalls are mandatory.
2. **Execute Proactive Conversation Injection**:
   - Scan posts from AI thought leaders, CTOs, and founders discussing agent failures, token waste, or tool execution bugs.
   - Inject constructive, authoritative technical perspectives with verified code snippets and diagrams.
3. **Drive Seamless Funnel Conversion**:
   - Offer the **$499 1-Day Agent Reliability Diagnostic**.
   - Offer the **$19/mo Pro Developer PreToolUse Firewall**.

---

## 2. Daily Content Pillars & Templates

### Pillar A: HotData POC & In-Memory PreToolUse Diode
```text
We just finished an architectural POC integrating HotData (Apache DataFusion + Arrow) into ThumbGate.

Most teams treat agent databases like static PostgreSQL servers ("pets"). HotData treats execution workers like disposable cattle over infinite S3 storage with microsecond Arrow scans.

To make it safe for autonomous agents, we wrapped it in a 3-layer PreToolUse Diode running on CPU in <0.5ms:
1. Exploration Guard: Blocks unbounded `SELECT *` scans.
2. Runaway Interdiction: Interdicts if an agent repeats the same query hash >5 times.
3. Mutation Barrier: Drops and truncates require cryptographic signatures.

Result: 11/11 tests green, sub-millisecond latency, zero runaway cloud bills.

What is your strategy for gating database access for coding agents?
```

### Pillar B: The Autotomy Dual-Lock Pattern
```text
The biggest mistake in AI engineering is "vibe coding spaghetti" — letting LLMs write arbitrary code across your architecture until production breaks.

We’ve codified the "Dual-Lock Model":
• Lock 1 (Compile-Time): Strict layer whitelists via dependency-cruiser (app -> hooks -> services) with 100% logic test coverage.
• Lock 2 (Runtime): ThumbGate sub-millisecond PreToolUse firewall that catches rogue mutations before the process runs.

Never rely on an LLM to police its own tools. Code enforces code.
```

### Pillar C: The 301M Token Runaway Loop Teardown
```text
A client recently had an autonomous agent get stuck in a recursive error-handling loop.
In 6 hours, it burned 301,000,000 tokens trying to self-heal a missing dependency.

Why?
Prompt rules ("Please stop if you see an error") do not work when the model hallucinate progress.
Post-mortem logs are too late.

The only reliable defense is an OS-level PreToolUse firewall that monitors identical command hashes and fails closed at N=5.
```

---

## 3. Autonomous Execution & Verification

Run the daily promoter script:
```bash
node scripts/autonomous-linkedin-promoter.js
```

Verify scheduled launchd job:
```bash
launchctl list | grep -i linkedin-promoter
```

Check prepared draft queue:
```bash
ls -la sales/linkedin-*
```
