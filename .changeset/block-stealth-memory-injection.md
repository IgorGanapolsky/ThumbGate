---
'thumbgate': minor
---

Block stealth memory injection from untrusted external content before it can be promoted into durable agent memory.

Memory ingress now preserves source type, identifier, and trust metadata; detects memory-write instructions, conversational concealment, instruction overrides, and delayed behavioral influence; and applies strict, balanced, or permissive enforcement. Decisions emit vendor-neutral `gen_ai.security.*` telemetry so Langfuse, LangSmith, Braintrust, Arize, OpenTelemetry, and other observability backends can record the security verdict without owning the enforcement boundary.

WhisperBench-inspired tests cover fact poisoning, preference poisoning, stealth, delayed influence, trusted-user false positives, and end-to-end blocking before the memory log is written.
