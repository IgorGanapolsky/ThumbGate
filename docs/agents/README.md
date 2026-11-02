# On-Demand Agent Format Steals & Honesty Doctors (`docs/agents/`)

To keep root `AGENTS.md` well below the **3,000-word adherence ceiling** (`evaluateOuterHarnessRuleTestCoCommitAndContextEditor` in `scripts/rrsi-doctor.js`), detailed CLI invocations and reference notes for individual format-steal doctors live here and in `.agents/skills/*/SKILL.md`.

## Quick Reference Table

| Doctor / Format Steal | CLI Command | Doc / Skill Reference |
| --- | --- | --- |
| **ExplainX Trending** | `npm run explainx:trending -- --fetch --top 10 --json` | [`explainx-trending.md`](./explainx-trending.md) |
| **Memory vs RAG (Supermemory)** | `npm run memory:vs-rag -- --query "how does PreToolUse work?"` | [`memory-vs-rag.md`](./memory-vs-rag.md) |
| **Board Loop (Issues + PRs)** | `npx thumbgate board-loop --apply --json` | [`thumbgate-board-loop.md`](./thumbgate-board-loop.md) |
| **Cobble Hot-Store Split** | `npx thumbgate cobble-hot-store-split --json` | [`cobble-hot-store-split.md`](./cobble-hot-store-split.md) |
| **Token-Shunt Honesty** | `npx thumbgate token-shunt-honesty --json --lines=800` | [`token-shunt-honesty.md`](./token-shunt-honesty.md) |
| **TypeSafe Typed Questions** | `npx thumbgate typesafe-typed-questions --json --map-only` | [`typesafe-typed-questions.md`](./typesafe-typed-questions.md) |
| **DeepPattern Discipline** | `npx thumbgate deeppattern-discipline-honesty --json --map-only` | [`deeppattern-discipline-honesty.md`](./deeppattern-discipline-honesty.md) |
| **CI GHA Buildkite Patterns** | `npx thumbgate ci-gha-buildkite-patterns --json --map-only` | [`ci-gha-buildkite-patterns.md`](./ci-gha-buildkite-patterns.md) |
| **Colab & TorchTPU Honesty** | `npx thumbgate colab-compute-honesty --json --map-only` | [`colab-compute-honesty.md`](./colab-compute-honesty.md) |
| **Datadog LLM-Obs Honesty** | `npx thumbgate llm-obs-honesty --json` | [`llm-obs-honesty.md`](./llm-obs-honesty.md) |
| **Meko Datapack Honesty** | `npx thumbgate meko-datapack-honesty --json` | [`meko-datapack-honesty.md`](./meko-datapack-honesty.md) |
| **Salt Code Policy Honesty** | `npx thumbgate salt-code-policy-honesty --map-only --json` | [`salt-code-policy-honesty.md`](./salt-code-policy-honesty.md) |
| **RRSI Harness Regularizer** | `node scripts/rrsi-doctor.js --json` | [`rrsi-harness-regularization.md`](./rrsi-harness-regularization.md) |
| **Harness Evolution Ceiling** | `npx thumbgate harness-ceiling --json` | [`harness-evolution-ceiling.md`](./harness-evolution-ceiling.md) |
| **Decisive-Step Evaluator** | `npx thumbgate decisive-step --json` | [`decisive-step-evaluator.md`](./decisive-step-evaluator.md) |
| **Mintlify Knowledge Freshness** | `npx thumbgate mintlify-knowledge-honesty --map-only --json` | [`mintlify-knowledge-honesty.md`](./mintlify-knowledge-honesty.md) |
| **Fiddler Control Plane TCO** | `npx thumbgate fiddler-control-plane-honesty --map-only --json` | [`fiddler-control-plane-honesty.md`](./fiddler-control-plane-honesty.md) |
| **omp Coordination Honesty** | `npx thumbgate omp-coordination-honesty --json --map-only` | [`omp-coordination-honesty.md`](./omp-coordination-honesty.md) |
| **AWS Strands Harness & Decider** | `node scripts/strands-harness-doctor.js --json` | [`aws-strands-harness.md`](./aws-strands-harness.md) |
| **Anthropic Dream Mode (`dream`)** | `npx thumbgate dream --dry-run --json` | [`../specs/002-dream-mode-and-cuda-gates/spec.md`](../specs/002-dream-mode-and-cuda-gates/spec.md) |
| **CUDA Gate Batch (`cuda-gate`)** | `npx thumbgate cuda-gate --map-only` | [`../specs/002-dream-mode-and-cuda-gates/spec.md`](../specs/002-dream-mode-and-cuda-gates/spec.md) |
