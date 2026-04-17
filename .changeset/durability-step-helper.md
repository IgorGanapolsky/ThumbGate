---
"thumbgate": minor
---

Add lightweight durable-step helper (`scripts/durability/step.js`) inspired by Vercel Workflows' "use step" pattern. Wraps external I/O with uniform retry + idempotency semantics without pulling in a full durable-execution runtime:

- **`runStep(name, opts, fn)`** — retry with exponential backoff, classifying transient vs permanent errors (HTTP 429/5xx retry, 4xx bail, socket codes retry, `nonRetryable` flag bails immediately)
- **`idempotencyKey(...parts)`** — stable SHA-256-derived 32-char key for safe POST retry

Wired into three highest-leverage call sites:

1. **Zernio publisher** (`publishPost`, `schedulePost`) — adds `Idempotency-Key` header so retried POSTs collapse to one published post on Zernio's side. Plan-quota errors are tagged `nonRetryable` to avoid wasting retries on 402-equivalents.
2. **LanceDB vector write** (`upsertFeedback`) — survives transient filesystem contention (EBUSY / lock timeouts) with 2-retry backoff; embedding is pure CPU so not retried.
3. **Anthropic SDK call** (`callClaude`) — retries 429/5xx, bails on malformed-prompt / auth errors. Contract-preserving: callers still get `null` on permanent failure.

21 unit tests cover success/retry/exhaustion/nonRetryable paths and idempotency-key stability.

Not a Vercel Workflows migration — deliberately scoped to capture ~70% of the reliability benefit with ~60 lines of code and zero new infrastructure.
