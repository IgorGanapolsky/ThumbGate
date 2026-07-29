# How we know ThumbGate works

**Buyer-facing evaluation white paper** · Updated 2026-07-29

This document is the longform source for [thumbgate.ai/whitepaper](https://thumbgate.ai/whitepaper).
It maps every trust claim to a golden dataset, offline test, measurement, or production monitor.

## One-sentence model

We know ThumbGate works when offline goldens still score high (`unsafeActionRate = 0`), tool-call decisions match expected allow/deny/warn outcomes, latency stays local on the gate path, cost stays under budget with avoided repeats, humans review high-risk remainder, and production monitors stay healthy while feeding new failures back into the golden set.

## The seven proof dimensions

### 1. Golden evaluation dataset

Committed suites define expected behavior:

| Pack | Path |
|------|------|
| ThumbGate Bench | `bench/thumbgate-bench.json` |
| Agent safety eval | `config/evals/agent-safety-eval.json` |
| Prompt eval suite | `bench/prompt-eval-suite.json` |
| Observability / grounding | `bench/observability-eval-suite.json` |
| ProgramBench smoke | `bench/programbench-smoke.json` |
| Shell golden tests | `verification/golden_tests/**` |

Production failures promote into offline goldens via `scripts/llm-behavior-monitor.js` (`goldenCandidates`).

### 2. Offline regression tests

Before merge / release:

```bash
npm test
npm run test:coverage
npm run prove:adapters
npm run prove:automation
npm run self-heal:check
```

Proof artifacts and observed results are recorded in `docs/VERIFICATION_EVIDENCE.md`.
Release confidence also requires Changesets, SemVer, and version sync (`docs/RELEASE_CONFIDENCE.md`).

### 3. Tool-call correctness

ThumbGate Bench scores PreToolUse decisions directly:

| Metric | Pass intent |
|--------|-------------|
| `taskSuccessRate` | Decision matches expected |
| `unsafeActionRate` | Must stay **0** |
| `blockedUnsafeRate` | Unsafe hard-denied |
| `capabilityRate` | Safe work still allowed |
| `falseBlockRate` | Safe work not wrongly denied |
| `replayStability` | Same suite → same decisions |

Public scorecard: [thumbgate.ai/eval-scorecard](https://thumbgate.ai/eval-scorecard)  
Reproduce: `npm run thumbgate:bench -- --json`

### 4. Latency

Structural, not just measured:

- No LLM on the enforcement decision path
- Deterministic match first (sub-ms class)
- Local semantic fallback only when needed
- Routing budgets in `config/gate-classifier-routing.json` (`lowLatencyBudgetMs: 300`)

See architecture: [thumbgate.ai/architecture](https://thumbgate.ai/architecture)

### 5. Cost

- Blocks avoid model round-trips (`npx thumbgate cost`)
- Budget ledger + tokenomics PreToolUse guard
- Rubric guardrail `budgetCompliant`
- Public methodology: [thumbgate.ai/agents-cost-savings](https://thumbgate.ai/agents-cost-savings)
- Honest inventory counters: [thumbgate.ai/numbers](https://thumbgate.ai/numbers)

### 6. Human review

- `human_review` classifier route for credentials, customer data, regulated work, payments
- Rubrics require verification evidence (`config/rubrics/default-v1.json`)
- Protected-action approvals and short-lived break-glass
- Social replies draft-only until human publish

### 7. Production monitoring

- Railway `/health` + `/dashboard` after deploy
- `npm run self-heal:check` (budget, tests, prove lanes)
- Gate stats + LLM behavior monitor (malformed, wrong-tool, retry, drift)
- Live congruence probes
- Silent-gate canaries and published-artifact evasion jobs

## Diagrams

Mirrored on the site and in `docs/diagrams/`:

- System architecture
- Feedback pipeline
- Pre-action gate loop
- Agent integration
- Plugin topology

→ [thumbgate.ai/architecture](https://thumbgate.ai/architecture)

## Case studies

Real dogfood narratives (no fabricated logos):  
[thumbgate.ai/case-studies](https://thumbgate.ai/case-studies) · source `docs/THUMBGATE-CASE-STUDIES.md`

## ML model evaluation (separate from gate goldens)

Held-out lift, distribution-shift inversion, evaluator bugs fixed:  
[thumbgate.ai/evaluations](https://thumbgate.ai/evaluations) · source `docs/ML-EVALUATION.md`

## Buyer audit script (20 minutes)

```bash
git clone https://github.com/IgorGanapolsky/ThumbGate
cd ThumbGate && npm ci
npm test
npm run prove:adapters
npm run prove:automation
npm run self-heal:check
npm run thumbgate:bench -- --json
curl -s https://thumbgate-production.up.railway.app/health
open https://thumbgate.ai/eval-scorecard
open https://thumbgate.ai/numbers
```

## What this is not

- Not external customer revenue proof (see `docs/COMMERCIAL_TRUTH.md`)
- Not a claim that every free install hard-blocks every risky command by default
- Not an excuse to skip human review on payments, credentials, or regulated actions

## Related links

- Verification evidence: `docs/VERIFICATION_EVIDENCE.md`
- Bench methodology: `docs/THUMBGATE_BENCH.md`
- Release confidence: `docs/RELEASE_CONFIDENCE.md`
