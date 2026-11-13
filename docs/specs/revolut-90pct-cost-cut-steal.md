# Revolut 90% AI Coding Cost-Cut Architecture Steal

> **Source**: *TechRadar Pro* & *The Register* (Nov 2026): "We were highly skeptical about the cost of AI: Revolut reveals it cut AI coding costs by cutting out Claude entirely."
> Presented by **David Abitbol**, Ops & Infrastructure Lead at Revolut, at GTC Berlin and AI Engineer NYC.
>
> **Integrated into ThumbGate**: `scripts/model-tier-router.js`, `scripts/token-tco.js`, `scripts/triage-savings-calculator.js`, `scripts/banking-code-confinement-diode.js`, and `scripts/session-lease.js`.

---

## 1. Executive Summary & The Revolut Paradigm Shift

When deploying coding assistants (Claude Code, Cursor, Gemini) across 2,000 developers, Revolut hit an operational wall:
- Heavy developers burned **$1,000 to $10,000 per month** in commercial API tokens.
- Strict token budgets created a **scarcity mindset**: engineers hoarded tokens and stopped using AI for debugging, Jira tickets, or Confluence docs.
- **The Breakthrough**: Revolut self-hosted open-weight models (Z.ai GLM-5.1/5.3) on an internal cluster of **56 Nvidia B200 GPUs** (~380GB memory + 6–26GB KV-cache retention per user).
- **Result**: Slashed raw inference costs by **~90%** (from ~$3.33/M to ~$0.30/M tokens), achieved **+70% lead-time productivity** and **+60% coding productivity**, with full GPU capex payback in **under 1 month** across 2,000 engineers.

---

## 2. Core Architectural Pillars Stolen into ThumbGate

### A. "The Frontier is the Exception" Model Router
- **Rule**: Self-hosted open-weight models (`localFrontier` at $0.30/M tokens) are the unbudgeted default for 95%+ of engineering tasks (code editing, tests, triage, debugging, Jira sync).
- **Exception Triggers**:
  1. **Vision / Multimodal**: GLM is text-only. Prompts containing images, screenshots, or UI mockups route to commercial frontier models (`frontier` via Gemini/GPT).
  2. **Context Window Overflow**: Requests exceeding the local GPU memory context threshold escalate to commercial cloud models.
  3. **High-Risk Retries**: Critical workflows failing repeatedly on local models escalate to frontier reasoning models.
- **Implementation**: `scripts/model-tier-router.js` (`isRevolutRoutingActive`, `classifyTask`, `recommendExecutionPlan`).

### B. Unrationed Token Velocity & Psychological Safety
- Token budgets and rationing kill developer adoption.
- In ThumbGate's Revolut mode, tasks routed to `localFrontier` are marked `tokenBudgetExempt: true`.
- Engineers can feed whole test logs, call stacks, and multi-file repositories without token anxiety.

### C. Banking Code Confinement Diode
- In fintech and banking, proprietary financial algorithms, cardholder data (PCI-DSS), SWIFT/IBAN identifiers, and core ledger mutations must never leave the on-premise perimeter.
- **Implementation**: `scripts/banking-code-confinement-diode.js` evaluates every tool payload and prompt. Sensitive banking patterns directed to commercial cloud LLMs are hard-blocked (`BLOCKED_CLOUD_EGRESS`), while execution on on-premise `localFrontier` is verified and permitted (`ALLOWED_CONFINED_ON_PREM`).

### D. Disconnect Execution Boundary Check (Tim Urista Steal)
- When human review occurs out-of-band (e.g. in a browser approval card or mobile push), network disconnects or pauses create a split-brain window:
  - Worker A requests approval, then gets partitioned or disconnects.
  - Worker B claims the lease (generation $N+1$).
  - Worker A wakes up and attempts to execute the operator's approval.
- **Implementation**: `scripts/session-lease.js` (`verifyApprovalExecutionBoundary`). Approvals are cryptographically bound to monotonic generation tokens. If the active lease generation advanced while approval was in flight, the command is rejected at the execution diode with `STALE_APPROVAL_GENERATION`.

---

## 3. Financial & ROI Comparison (2,000 Devs)

| Metric | Commercial APIs (Claude/GPT) | Revolut Architecture (GLM on B200s) | ThumbGate Integration |
|---|---|---|---|
| **Cost per 1M Tokens** | ~$3.33 / M | **$0.30 / M** | **$0.30 / M** (`localFrontier`) |
| **Monthly Token Spend** | $2,000,000 / mo | $180,000 / mo (inference) | $180,000 / mo |
| **GPU Cluster Amortization**| $0 | $120,000 / mo (56 B200s over 12mo) | $120,000 / mo |
| **Total Monthly Cost** | $2,000,000 / mo | **$300,000 / mo** | **$300,000 / mo** |
| **Net Cost Reduction** | Baseline (0%) | **-85.0% Net** (-91% raw) | **-85.0% Net** |
| **Annual Cash Savings** | $0 | **$20,400,000 / year** | **$20,400,000 / year** |
| **Hardware Payback Period**| N/A | **0.8 months** (< 26 days) | **0.8 months** |
| **Annual Productivity Boost**| Token-rationed | **+$86.4M / year** (+70% lead, +60% coding) | Tracked in `triage-savings-calculator` |

---

## 4. CLI & Enterprise Usage

```bash
# Model Revolut-scale enterprise savings (2,000 developers default)
node scripts/triage-savings-calculator.js --model-revolut

# Custom developer team scale (e.g. 500 developers)
node scripts/triage-savings-calculator.js --model-revolut --devs=500

# JSON output for automated enterprise ROI decks
node scripts/triage-savings-calculator.js --model-revolut --json
```
