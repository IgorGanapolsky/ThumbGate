# ThumbGate A+ evidence contract

ThumbGate does not get an A+ because a module exists, a fixture passes, a PR is
open, or a landing page says “self-improving.” The grade is awarded only when
all ten areas reach 10/10 on the evidence surface appropriate to the claim.

```bash
npm run score:a-plus
npm run score:a-plus -- --json
npm run score:a-plus -- --evidence /path/to/live-evidence.json --require-a-plus
```

The default command is deliberately fail-closed for production, provider,
security-review, and commercial facts. Missing evidence is unknown, never zero
and never a pass.

## Evidence layers

| Layer | It can prove | It cannot prove |
|---|---|---|
| Repository | implementation, wiring, deterministic tests, documentation | deployment, live latency, buyer behavior, captured money |
| Deterministic eval | repeatable regression floors on a frozen corpus | provider quality, generalization, human preference |
| Provider holdout | live model/reranker behavior on labeled cases | production load or tenant isolation |
| Production | exact deployed SHA, traces, p95, cost, failure drills | willingness to pay or revenue |
| Security review | scoped tenant-isolation and leak resistance | product-market fit |
| Commercial/provider | conversations, exact payment asks, reconciled external money | software correctness |

## What “self-improving” means here

ThumbGate does not retrain model weights. Its local control layer improves from
reviewed operational outcomes:

```text
thumbs feedback
  -> schema-validated lesson
  -> specific corrective reward
  -> relevance retrieval and reranking
  -> repeated negative-pattern promotion
  -> pre-action allow / warn / deny
  -> next reviewed outcome
```

An LLM judge may diagnose output quality. It cannot override deterministic
incident, holdout, mutation, authorization, or evidence gates. ThumbGate also is
not a model-level Mixture of Experts: it performs application-level provider and
tier routing, then evaluates or gates outputs and actions at later stages.

## Current hard blockers to a global A+/10 claim

Even when the repository checks are green, the global claim remains blocked
until the evidence file proves the exact candidate is live, provider holdouts
and calibration pass, production p95/cost and failure drills pass, tenant
isolation has external review, and real buyers produce value-conversation,
payment-ask, and reconciled external-payment evidence.
