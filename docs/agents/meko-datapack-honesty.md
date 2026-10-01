# Meko Datapack & Collective Memory honesty (FORMAT steal)

Doctor: `npx thumbgate meko-datapack-honesty --json`

Steals the **five-plane agent data protocol** from [Meko (YugabyteDB, 2026)](https://cloud.mekodata.ai/signup) — multi-tenant Datapacks, episodic memory, mathematically promoted Learnings, content-addressed artifacts, and decision traces — and maps it onto **existing** ThumbGate rails.

This is a compare-not-clone doctor. It does **not** vendor YugabyteDB, meko-skills, or depend on `cloud.mekodata.ai`. Not affiliated.

## The Core Thesis: Storage is Not a Firewall

Meko positions itself as "agent-native data infrastructure." However, Meko is fundamentally a **passive database**. Storing memory without a `PreToolUse` firewall leaves autonomous systems vulnerable:
1. An agent that retrieves toxic, outdated, or hallucinated memory from a database will execute destructive tools unchecked.
2. In Meko, memory promotion is unprincipled; any agent can write to the shared pool.
3. ThumbGate is **The Infrastructure Firewall**: we evaluate every tool call *before* execution and enforce that feedback signals mathematically graduate into durable prevention rules.

## Five-Plane FORMAT Map

| Plane | Meko Analog | ThumbGate Rails | Enforcement Rule |
| :--- | :--- | :--- | :--- |
| **datapack** | Multi-tenant isolation container grouping memory, conversation, knowledge bases, and artifacts | `scripts/memory-vs-rag-route.js` (4-field scope: entity, project, process, session), `evals/ai-identity-checklist/registry.json`, `scripts/task-scope-lease.js` | Enforces complete four-field isolation so multi-agent teams cannot leak cross-tenant state. |
| **memory** | Episodic raw conversation context stored in PostgreSQL + pgvector (`memory_add`, `memory_search`) | `feedback-log.jsonl`, `memory-log.jsonl`, `scripts/feedback-schema.js`, `scripts/lesson-retrieval.js` | Captures raw session observations. Never exposed without active `PreToolUse` gating. |
| **learning** | Compounded cross-agent knowledge promoted from memory (`memory_promote`) | `scripts/feedback-to-memory.js`, `scripts/rubric-engine.js`, `scripts/thompson-sampling.js`, `prevention-rules.md` | Requires rubric score ≥ 0.70 and explicit operator feedback signal before permanent promotion. |
| **artifact** | Content-addressed SHA-256 file store (`artifact_put`, `artifact_get`) | `scripts/action-receipts.js`, `scripts/verification-evidence.js`, `scripts/operator-artifacts.js` | Files must be content-addressed by SHA-256 for idempotent receipt attestation across agent swarms. |
| **trace** | Chain-of-thought, reasoning steps, execution plan, token consumption (`track_token_usage`) | `scripts/decision-trace.js`, `scripts/agent-reasoning-traces.js`, `scripts/cli-telemetry.js` | Maintains an auditable decision trail connecting prompt intent to tool execution. |

## Fail-Closed Boundaries

| Finding Code | Trigger Condition | Rationale |
| :--- | :--- | :--- |
| `passive_store_without_firewall` | Agent memory store exists without a `PreToolUse` gate | A passive database cannot stop an agent from executing dangerous tools based on poisoned memory. |
| `unverified_learning_promotion` | `memory_promote` invoked without rubric validation (score < 0.70) | Prevents noisy or unverified agent chatter from corrupting the collective fleet rules. |
| `plaintext_cloud_egress` | Agent context or credentials routed to `mekodata.ai` unredacted | Client secrets, private keys, and proprietary code must never leave local boundaries un-redacted. |
| `unhashed_artifact_store` | Artifact stored without 64-char SHA-256 content address | Unhashed artifacts cannot provide cryptographic verification receipts or guarantee idempotency. |
| `incomplete_scope_partition` | Datapack missing entity, project, process, or session scope | Multi-agent isolation collapses without full four-field scope keys. |
| `meko_clone_refused` | Attempt to install YugabyteDB or depend on `cloud.mekodata.ai` | ThumbGate steals the architectural FORMAT, maintaining zero third-party database overhead. |

## CLI

```bash
# Display five-plane FORMAT mapping
npx thumbgate meko-datapack-honesty --map-only

# Emit machine-readable audit report
npx thumbgate meko-datapack-honesty --json

# Audit a live multi-agent execution trace
npx thumbgate meko-datapack-honesty --trace=trace.json --json

# Run unit verification
npm run test:meko-datapack-honesty
```

## Skill

`.agents/skills/meko-datapack-honesty-not-clone/SKILL.md` — `/meko-datapack-honesty-not-clone`
