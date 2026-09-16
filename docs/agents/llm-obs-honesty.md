# LLM-obs honesty (Datadog FORMAT steal)

Doctor: `npx thumbgate llm-obs-honesty --json`

Steals **four practices** from [Datadog LLM Observability Best Practices](https://lp.datadoghq.com/rs/875-UVY-685/images/eBook-LLMObservabilityBestPractices.pdf) and maps them onto **existing** ThumbGate rails. Compare-not-clone. Not affiliated. Does **not** clone Datadog Agent Observability, Sensitive Data Scanner, Clusters, dd-trace, or OTLP.

Do not dual-edit sibling PR **#3881** (Datadog-style engine + PR orchestrator). PR drain lives on **#3883** `board-loop`.

## Practice → rail map

| Practice | Datadog analog | ThumbGate rails |
|----------|----------------|-----------------|
| operational | errors, latency, token-budget alerts | `latency-budget.js`, `action-receipts.js`, `task-outcomes.js`, `performance-budgets.json` |
| security | prompt-injection + PII scrub on traces | `secret-redaction.js`, `secret-scanner.js`, PreToolUse gates |
| quality | failure-to-answer, topic relevancy, toxicity, user feedback | `feedback-quality.js`, capture-feedback, `future-agi-evaluator.js` |
| tracing | end-to-end parented spans (RAG / LLM / tool) | `agent-audit-trace.js`, action receipts |

## Fail closed

`missing_operational_metrics` · `missing_token_budget` · `missing_injection_check` · `missing_pii_scrub` · `unredacted_prompt` · `missing_quality_evals` · `missing_trace_spans` · `retrieve_span_requires_evidence` · `tool_span_requires_evidence` · `datadog_clone_refused`

## CLI

```bash
npx thumbgate llm-obs-honesty --json
npx thumbgate llm-obs-honesty --trace=tests/fixtures/llm-obs-honesty-blind.json --json
npm run test:llm-obs-honesty
```

Skill: `.agents/skills/datadog-llm-obs-compare-not-clone/SKILL.md`
