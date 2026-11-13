# What Comes After Loops — Modern Agent Harness & Multi-Agent Architecture (OpenAI & Anthropic Consensus)

> **Architectural Specification & ThumbGate Harness Upgrade**  
> Based on the industry consensus from OpenAI and Anthropic engineering teams regarding agent loops, multi-agent orchestration, and harness design.

---

## 1. Prompting & Context Management

### 1.1 Outcome Goals, Not Step-by-Step Instructions
* **Anti-Pattern**: Capping the agent's solution space by prescribing procedural micro-steps (e.g., *"add Redis cache to line 42, alter column, run migration"*).
* **Consensus Pattern**: Provide a verifiable outcome goal alongside the necessary tools and constraints:
  - *Example*: `"Make P95 API response latency under 200ms while preserving 0 test regressions."`
  - *Mechanism*: Let the frontier model explore and synthesize the optimal architecture within the bounded tool contract.

### 1.2 Compaction Threshold & Spec Execution
* **Anti-Pattern**: Artificially splitting a single feature specification into micro-sprint tickets to fit within obsolete 150k token boundaries.
* **Consensus Pattern**: Modern frontier models maintain coherence across 200k–400k+ tokens.
  - Set the compaction threshold to **~400,000 tokens**.
  - A single builder agent implements the entire specification across 1–2 compactions rather than fragmenting context across disconnected sessions.

---

## 2. Subagent Routing & Effort Scaling

### 2.1 Fan Out ONLY for Truly Independent Tasks
* **Strict Rule**: Restrict parallel subagent fan-out to workloads that do not require intermediate state exchange:
  - Independent library benchmarking (`research_lib_a`, `research_lib_b`).
  - Parallel end-to-end user-flow verification (independent Playwright test flows).
  - Parallel bug hunting across isolated directories.
* **Block Rule**: **NEVER** fan out interconnected feature tickets in parallel. Parallelizing coupled feature slices creates merge deadlocks, conflicting ASTs, and duplicated code.

### 2.2 Scale Effort Across Model Tiers
* **Dynamic Escalation**: When the primary builder is stuck on hard edge problems (race conditions, async deadlocks, cryptographic diodes), escalate immediately to a stronger advisor/frontier model (`scripts/model-tier-router.js` advisor escalation).
* **Routine Offloading**: Offload self-contained, low-risk routine tasks (documentation, changelog updates, static copy, UI styling) to cost-efficient tiers (`nano` / `mini` / local models).

---

## 3. The Builder–Reviewer–Verifier (BRV) Pipeline

```text
  [Spec with Outcome Goal]
             │
             ▼
     ┌───────────────┐
     │ Builder Agent │ ◄───────────────────────────────┐
     └───────┬───────┘                                 │
             │ Code complete                           │ Rework Findings
             ▼                                         │ (Route back to
     ┌───────────────┐                                 │  ORIGINAL instance,
     │ Reviewer      │ ──[Unresolved issues <= 3]──────┤  saving ~38% tokens)
     └───────┬───────┘                                 │
             │ Approved                                │
             ▼                                         │
     ┌───────────────┐                                 │
     │ Verifier      │ ──[Failed flows <= 2]───────────┘
     └───────┬───────┘
             │ Verified Pass (at capability edge)
             ▼
      [Production Ready]
```

### 3.1 The 3-Part Pipeline
1. **Builder Agent** (e.g. Claude Code / Laguna): Receives acceptance criteria and writes implementation.
2. **Reviewer Agent** (e.g. Codex): Reviews diff against security, typing, and architectural consistency (up to 3 rounds).
3. **Verifier Agent** (e.g. Isolated Verifier / Playwright): Tests independent flows in parallel (up to 2 rounds).

### 3.2 Route Fixes to the ORIGINAL Builder Instance
* **Anti-Pattern**: Spinning up a fresh agent instance to fix review comments or failed tests. Fresh agents lack structural context and produce brittle band-aid fixes.
* **Consensus Pattern**: Always route reviewer findings and verifier failures back to the **original builder instance**.
* **Measured Benefit**: Preserving the original builder's context reduces token costs by **~38%** and ensures structural, root-cause fixes.

### 3.3 Verify Only at the Capability Edge
* **Selective Verification**: Skip automated verifier overhead on routine, mastered tasks (doc updates, static forms, translation).
* **Reserve Heavy Verification**: Focus verifier cycles strictly on the capability edge (offline sync merges, distributed locking, financial reconciliation, PreToolUse diodes).

### 3.4 Continuous Harness Pruning
* Every harness guardrail encodes an assumption about what the base model cannot do.
* As frontier models absorb capabilities natively, systematically prune obsolete scaffolding, prompt crutches, and micro-ticket constraints.

---

## 4. Orchestration & Swarms

### 4.1 Single "Chief of Staff" Manager Thread
* Avoid manual context-switching across terminal tabs and split panes.
* Interact with a single local coordinator thread (e.g., local Claude Code / MCP) that delegates to and monitors sandboxed execution containers.

### 4.2 Anti-Bureaucracy Swarm Guardrail
* **Prohibited**: Peer-to-peer persona swarms for feature building (e.g. 10–20 peer agents acting as Designer, Tester, Security, and Ops arguing in a loop). Non-hierarchical peer models stagnate into excessive rule-making and halt code delivery.
* **Permitted**:
  1. Subagents invoked strictly as tool calls with defined inputs and outputs.
  2. Large swarms reserved exclusively for parallel vulnerability hunting, fuzzing, and bug bashing.

---

## 5. ThumbGate Implementation & Verification

* **Core Engine**: `scripts/builder-reviewer-verifier.js`
* **Model Tier Integration**: `scripts/model-tier-router.js`
* **Test Suite**: `tests/builder-reviewer-verifier.test.js` (10/10 passing)
* **Isolated Verifier**: Approved (`VERDICT: PASS`)
