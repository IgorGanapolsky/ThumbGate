---
name: pstack-rigorous-engineering
description: >
  Rigorous engineering workflow engine based on pstack (Lauren Tan / @poteto and Flavio Copes).
  Enforces 22 playbooks (Investigation, Bug Fix, Feature, Refactoring, Forensics, Babysit, Shipping),
  specialist skills (/how, /why, /architect, /arena, /interrogate), and 21 engineering principles
  operating under ThumbGate pre-action firewalls and the Ralph Loop.
  Slash: /pstack, /poteto-mode.
---

# pstack: Rigorous Engineering Engine for ThumbGate Agents

Based on [pstack](https://flaviocopes.com/pstack/) by Lauren Tan ([@poteto](https://x.com/poteto)) and Flavio Copes.  
Adapted for ThumbGate agent swarms, pre-action firewalls, and the **Ralph Loop** (`Observe → Act → Feedback → Promote → Enforce`).

The core premise of pstack is **not more code, but less code, higher quality, and verified boundaries** before shipping.

---

## 1. The Core Router: `/poteto-mode`

When operating in `poteto-mode`:
1. **Read Principles First:** Consult the 21 principles before planning.
2. **Match a Playbook:** Categorize the task into one of the 22 canonical playbooks verbatim into the task list. Do not improvise an unvetted shortcut.
3. **Trace Before Mutating:** Call `/how` or `/why` to understand the runtime call stack and history before modifying files.
4. **Enforce Boundary Gates:** All actions execute under ThumbGate's PreToolUse diode.
5. **Verify on Real Interfaces:** Run end-to-end proofs, not just shallow unit mocks.
6. **Clean, Review, and Ship:** Verify contiguous commit integrity through Trunk and the Completion Claim Contract.

---

## 2. The 22 Canonical Playbooks

### Category A: Understand Before Changing
- **Investigation (`/how`, `/why`):** Traces runtime flow, call hierarchies, and ownership without changing code.
- **Teach (`/teach`):** Synthesizes architectural mechanics and git history into operational explanations.
- **Recall (`/recall`):** Reconstructs session context, transcript decisions, and active leases.

### Category B: Build and Change Code
- **Bug Fix:** Reproduce bug first on the real interface. Form competing hypotheses. Eliminate via evidence. Verify reproduction turns green.
- **Feature:** `/how` (trace caller) → `/architect` (define interface contract) → implement → diff review → verify on real interface.
- **Refactoring:** Record baseline behavior with characterization snapshot. Change structure incrementally while keeping baseline green.
- **Perf Issue:** Measure flamegraph/trace baseline before touching code. Compare post-change numbers. Never accept "it feels faster".
- **Hillclimb:** Iterative single-metric optimization. Retain improvements, immediately revert regressions.
- **Prototype:** Build disposable throwaway proof-of-concept to resolve architectural ambiguity.
- **Visual Parity:** Screenshot comparison with zero tolerance for pixel drift.

### Category C: Diagnose Without Fixing (Read-Only Separation)
- **Runtime Forensics:** Live capture of CPU profile, memory snapshot, or network HAR trace.
- **Trace Forensics:** Post-mortem parsing of existing traces to identify bottleneck frame or retention leak. Stated diagnosis is the deliverable; stops before mutation.

### Category D: Long-Running Work Orchestration
- **Autonomous Run:** Drives single task continuously until deterministic pass condition is met.
- **Multi-Phase Plan:** Sequenced execution across independent dependency layers.
- **Orchestrate:** Multi-agent swarm coordinator managing parallel subagents and shared resource claims.
- **Autopilot-Full:** Automated drain of independent PR queues through verification and merge.
- **Autopilot-Stack:** Builds reviewed stacked PRs, deferring final landing to human review.

### Category E: Safe Handoff & Continuity
- **Session Pickup:** Inspects transcript, active worktrees, and decision log to resume exactly where previous agent paused.
- **Pause Safely:** Commits atomic state, releases session lease, and writes clear resume ledger.

### Category F: Delivery Pipeline
- **Babysit:** Drives PR to merge-ready state (addresses bot comments, resolves merge conflicts, ensures CI green).
- **Shipping:** Fresh clean worktree verification, Trunk merge queue dispatch, production health check (`GET /health`), and hygiene cleanup.

---

## 3. Specialist Skills

| Command | Purpose | Input / Deliverable |
| :--- | :--- | :--- |
| `/how` | Trace runtime path | Given a behavior or symptom, outputs the exact call tree, file boundaries, and data transformations. |
| `/why` | Trace historical intent | Inspects git log, PR bodies, and issues to explain why code was designed in a specific way. |
| `/architect` | Interface contract design | Designs from the caller's perspective first. Specifies schemas and failure modes before writing code. |
| `/arena` | Competing implementations | Evaluates multiple distinct approaches against the exact same test harness; picks highest-scoring variant. |
| `/interrogate`| Multi-model review panel | Runs adversarial review across distinct personas (Security, Reliability, Performance, Simplicity). |

---

## 4. The 21 Engineering Principles

1. **Understand before changing:** Never edit code you have not traced.
2. **Reproduce before fixing:** An un-reproduced bug is an unverified fix.
3. **Measure before optimizing:** Cite raw baseline metrics before proposing a speedup.
4. **Caller-first design:** Interfaces exist for their consumers, not their implementers.
5. **Separate diagnosis from repair:** Deliver the diagnosis before jumping to surgery.
6. **No guessing root causes:** Back every hypothesis with raw runtime evidence.
7. **Small, contiguous diffs:** Avoid sweeping multi-file rewrites when a localized change suffices.
8. **Verify on real interfaces:** Mocked units can lie; test the CLI, HTTP endpoint, or DOM.
9. **Never drop checklist steps:** Playbook steps are mandatory or explicitly recorded as skipped with rationale.
10. **Fail closed:** An unexpected state or missing credential must halt safely, never proceed blindly.
11. **Single-writer lease:** Only one agent mutates a checkout; use separate worktrees for parallel work.
12. **Idempotent receipts:** Every mutation produces a verifiable trace in local ledgers.
13. **Sticky modes:** Follow-up prompts stay within the active playbook context until explicitly reset.
14. **Truth over enthusiasm:** Never claim "done" or "faster" without terminal proof.
15. **Attribution integrity:** All outbound marketing and documentation carries full UTM tags.
16. **Canonical preservation:** Syndicated content must point canonical back to our domain.
17. **Deterministic gates over LLM opinions:** Safety checks must be code, not polite prompting.
18. **Continuous learning:** Capture mistakes into feedback immediately; promote to prevention rules.
19. **Clean worktree verification:** Never run final verification in a dirty primary branch.
20. **Zero branch-protection bypass:** Never approve PRs, never bypass branch rulesets.
21. **North star alignment:** Prioritize tasks that tangibly advance the $100/day after-tax profit goal.

---

## 5. Integration with ThumbGate & Ralph Loop

```
+-------------------------------------------------------------+
|                        RALPH LOOP                           |
|                                                             |
|  [Observe] ---> [Act] ---> [Feedback] ---> [Promote] ---> [Enforce]
|     |             |             |             |             |
|  Session       pstack        Thumbs /      Prevention    PreToolUse
|  Preflight    Playbooks     Incident         Rules        Firewall
+-------------------------------------------------------------+
```

When executing any pstack playbook:
- All file reads and shell commands pass through **ThumbGate PreToolUse** interceptors.
- Discovered flaws or agent regressions emit a `capture_feedback` event.
- Proven corrections are codified into `.claude/memory/feedback/` and auto-promoted to permanent enforcement rules.
