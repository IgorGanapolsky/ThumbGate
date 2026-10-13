# Harness Evolution Ceiling & Weight Training Trigger (arXiv:2610.11655 FORMAT Steal)

Doctor: `node scripts/harness-ceiling-doctor.js --json`  
CLI: `npx thumbgate harness-ceiling --json` | `npx thumbgate harness-ceiling --map-only` | `npx thumbgate harness-ceiling --evaluate --process=0 --content=8`

Sources:
- Paper: *Harness Evolution Hits a Ceiling: When Weight Training Should Begin* (arXiv:2610.11655, Oct 8, 2026; Yuan Tian, Bing Hu, Hao Wang, Binghang Lu, Fang Wu).
- Foundation: Self-evolving agent scaffolds, prompt optimization, runtime firewalls, and trajectory post-training.

ThumbGate does **not** vendor black-box cloud training pipelines or require GPU clusters. This is an architectural FORMAT steal of the paper's diagnose-then-intervene decision protocol and failure composition taxonomy into ThumbGate's deterministic task-outcome metrics, RRSI regularizer, and omp.sh coordination rails.

---

## The High-ROI Problem & Opportunity for ThumbGate & Agents (omp.sh)

When developers and autonomous agents attempt to improve long-horizon task performance, they fall into one of two failure modes:

1. **The Prompt Bloat Trap (Harness Thrashing):** When an agent delivers an incomplete, low-quality, or conceptually incorrect artifact, operators instinctively append more instructions, guidelines, and negative constraints to `AGENTS.md`, `CLAUDE.md`, or the system prompt.
   - *The Reality:* As proved empirically across 8 model families in arXiv:2610.11655, harness evolution (prompts, tool contracts, retry loops, error feedback) only repairs **Process Failures** (tool call errors, loops, timeouts, budget exhaustion).
   - Once process failures drop, the remaining bottlenecks are **Content Failures** (nuanced domain judgment, complex reasoning, architectural intuition).
   - Trying to fix content failures with prompt additions yields **zero or negative ROI**: it bloats context, slows latency, causes instruction distraction, and degrades performance.

2. **Premature Weight Training:** Operators attempt fine-tuning or LoRA adaptation while the harness is still leaking basic process failures (e.g. malformed tool arguments, unhandled exceptions, infinite loops). Training on noisy, process-failing trajectories bakes bad execution habits into model weights.

**The Solution:** The **Diagnose-Then-Intervene Rule**:
- **First Signal Fires:** Label every failed trajectory by the *first signal that fires* to separate Process Failures from Content Failures.
- **Read Failure Composition:**
  - If Process Failures $\ge 20\%$: Evolve the harness (fix gates, tool contracts, hooks, and error messages).
  - If Content Failures $\ge 80\%$ and Process Failures $\le 20\%$ (with $N \ge 3$): Declare **Harness Ceiling Reached**. **Freeze prompt/rule expansion** and switch the lever to **Weight Training** (LoRA/trajectory distillation on verified successful runs) or **Model Tier Escalation** (e.g. route to frontier model via omp named route).
- **Partition Accepted Edits:** Inspect accepted harness improvements:
  - Behaviors, output formats, and planning conventions are candidates to be *trained into weights*.
  - Security gates, single-writer checkout leases, task-scope bounds, and signature verifiers *must remain in the runtime harness*.

---

## Rail Map

| arXiv:2610.11655 Principle | Paper Finding | ThumbGate Rail | Enforcement & Impact |
| :--- | :--- | :--- | :--- |
| **First-Signal-Fires Failure Classification** | "Labelling failed trajectories by the first signal that fires separates process failures from content failures." | `scripts/task-outcomes.js` (`classifyFailureType`) | Inspects tool call contracts, policy denials, duplicate loops, and verification outcomes to categorize each failure as `process` or `content`. |
| **Failure Composition Telemetry** | "The right lever can be read off the agent's failure composition: $P_f$ vs $C_f$." | `scripts/task-outcomes.js` (`calculateTaskOutcomeMetrics`) | Computes `processFailureRate`, `contentFailureRate`, `harnessCeiling`, and `recommendedIntervention` in task outcome receipts. |
| **Harness Evolution Ceiling Detection** | "Harness evolution repairs process failures but hits an asymptotic ceiling when content failures dominate." | `scripts/rrsi-regularizer.js` (`evaluateHarnessCeiling`) | Detects when prompt evolution is saturating and signals the transition from harness engineering to weight adaptation. |
| **Train-in vs Keep-in-Runtime Partition** | "Read what accepted edits changed to decide which gains to train in." | `scripts/rrsi-regularizer.js` (`partitionAcceptedEdits`) | Guarantees that security boundaries (leases, firewalls, permissions) stay in runtime while formatting/planning conventions are isolated for distillation. |
| **omp.sh Named-Model Escalation over Prompt Bloat** | "Content failures are what weight training [or model capacity] is for." | `scripts/omp-coordination-honesty.js` (`diagnoseFailureIntervention`) | Prevents adding redundant rules to `AGENTS.md` when content ceiling is reached; guides escalation to frontier named models (`Route: named`). |

---

## Fail-Closed Invariants

| Invariant | Trigger Condition | Enforcement Action |
| :--- | :--- | :--- |
| `harness_ceiling_prompt_bloat` | Operator/agent proposes adding prompt rules when content failures dominate ($\ge 80\%$) and process failures are low ($\le 20\%$) | **REFUSED** (`[omp-coordination-honesty]`: Escalate named model tier or train weights instead) |
| `premature_ceiling_declaration` | Ceiling claimed with $<3$ failures or when active process failures remain ($>20\%$) | **BLOCKED** (Intervention remains `harness_evolution` until mechanical process failures are solved) |
| `runtime_security_leak_to_weights` | Attempting to replace runtime security gates, checkout leases, or task-scope fences with fine-tuned model weights | **BLOCKED** (`partitionAcceptedEdits` forces security gates into `keepInRuntimeHarness`) |

---

## Verification & Usage

```bash
# 1. Audit harness ceiling doctor & rail mapping
node scripts/harness-ceiling-doctor.js
node scripts/harness-ceiling-doctor.js --json
node scripts/harness-ceiling-doctor.js --map-only

# 2. Evaluate failure composition dynamically
npx thumbgate harness-ceiling --evaluate --process=0 --content=8 --json

# 3. Run the unit and integration test suite
node --test tests/harness-ceiling.test.js
node --test tests/verified-agent-outcomes.test.js
node --test tests/rrsi-regularizer.test.js
node --test tests/omp-coordination-honesty.test.js
```
