---
name: datadog-llm-obs-compare-not-clone
description: >
  Datadog LLM Observability eBook is FORMAT, not a ThumbGate clone. Steal four
  practices (operational metrics, injection+PII scrub, quality evals, e2e
  parented spans) onto existing receipts/redaction/feedback/audit-trace.
  Never vendor dd-trace, DatadogAgentObservability, or OTLP. Never dual-edit
  PR #3881. Slash: /datadog-llm-obs-compare-not-clone.
---

# Datadog LLM-obs — compare, do not clone

## Goal

Produce fail-closed honesty for whom: ThumbGate agents claiming an LLM/agent
run is observed — so errors, latency, tokens, injection/PII, quality, and
parented spans exist on **existing** rails before any "we have observability" claim.

## Constraints

| NEVER | ALWAYS |
| --- | --- |
| Clone Datadog Agent Observability / SDS / Clusters | Map 4 practices onto existing rails |
| `npm install dd-trace` / `DD_API_KEY` LLM obs | `scripts/secret-redaction.js` + `agent-audit-trace.js` |
| Dual-edit PR #3881 Datadog-style engine | Complement; orchestrator overlap is board-loop #3883 |
| Dual-edit PR #3883 board-loop | Leave PR drain there |
| OTLP-export prompt traces | Local receipts + redaction |
| Quote Datadog MTTR as ours | Measure ThumbGate latency-budget / task-outcomes |
| Hero Continuity / net-new obs SKU | ECI: maintenance of existing surfaces |

HARD fail closed. REFUSE SKU clones.

## Reference

- https://lp.datadoghq.com/rs/875-UVY-685/images/eBook-LLMObservabilityBestPractices.pdf
- `scripts/llm-obs-honesty.js`
- `scripts/latency-budget.js` · `action-receipts.js` · `secret-redaction.js` · `agent-audit-trace.js` · `task-outcomes.js`
- `/high-roi-steal-and-finish` · `/eci-thumbgate-ip-wall`

## Examples (show, don't tell)

Weak: Summarize the eBook and add a DatadogAgentObservability class.

Gold:

```bash
$ npx thumbgate llm-obs-honesty --json
ok: true
status: ready
$ npx thumbgate llm-obs-honesty --clone-datadog --json
datadog_clone_refused
```

## Procedures

```bash
npx thumbgate llm-obs-honesty --json
npx thumbgate llm-obs-honesty --map-only
npx thumbgate llm-obs-honesty --trace=tests/fixtures/llm-obs-honesty-blind.json --json
npm run test:llm-obs-honesty
```

1. Require operational counts + latency + tokens + budget alert.
2. Require prompt-injection check + `secret-redaction.js` scrub.
3. Require failure-to-answer, topic relevancy, toxicity (+ thumbs).
4. Require parented retrieve/llm/tool spans with evidenceIds.
5. Refuse `--clone-datadog`.

## Rubric

- gold default → `ok=true`
- empty `{}` or blind fixture → `ok=false`
- `--clone-datadog` → `datadog_clone_refused`
- doctor: `npm run test:llm-obs-honesty` PASS
- evidence: command output in the same turn
