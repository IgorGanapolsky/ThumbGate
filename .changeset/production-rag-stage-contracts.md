---
"thumbgate": minor
---

Harden production RAG with structure-aware document chunks, scoped hybrid
retrieval, parent expansion, token-budgeted cited prompts, schema-validated
structured output, and stage-level quality telemetry. Add explicit LanceDB
cache preflight, bounded ANN-versus-exhaustive recall auditing, and preservation
of lexical plus dense evidence for second-stage ranking. Quick-start now
configures only its resolved agent, preventing unrelated agent installers from
racing temporary-home cleanup. Add a seeded deterministic reliability proof
that injects re-index interruption, vector outage, and repeated invalid model
output; records named invariants plus a replay command; resumes partial
re-index checkpoints without duplicate embedding work; and prevents RAG
operations from silently ignoring their requested feedback directory.
