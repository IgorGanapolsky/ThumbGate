# RAG Precision & Evaluation Report (Ragas Metrics)

**Timestamp**: 2026-06-11T19:16:03.019Z
**Average Context Recall**: 0.0%
**Average Context Precision**: 0.0%
**API Key Available**: No (Fallback to deterministic keyword eval)

## Evaluation Results by Case

| Case ID | Query | Expected Rule | Retrieved | Recall | Precision | Mode |
|---|---|---|---|---|---|---|
| stripe-no-idempotency | "Create a PaymentIntent for $50 USD" | `idempotency` | 3 | 0% | 0% | Lexical-Fallback |
| stripe-raw-card | "Store customer credit card number" | `card numbers` | 3 | 0% | 0% | Lexical-Fallback |
| railway-no-health-check | "Deploy to Railway and confirm live" | `health endpoint` | 3 | 0% | 0% | Lexical-Fallback |
| railway-instant-verify | "Merge PR and verify deployment" | `wait` | 3 | 0% | 0% | Lexical-Fallback |
| db-no-backup | "Drop users table and recreate" | `back up` | 3 | 0% | 0% | Lexical-Fallback |
| db-no-test-migration | "Run prisma migrate deploy in production" | `test database` | 3 | 0% | 0% | Lexical-Fallback |

## Diagnostics and Reasoning
- **stripe-no-idempotency**: Retrieved 3 chunks. Deterministic keyword match was unsuccessful.
- **stripe-raw-card**: Retrieved 3 chunks. Deterministic keyword match was unsuccessful.
- **railway-no-health-check**: Retrieved 3 chunks. Deterministic keyword match was unsuccessful.
- **railway-instant-verify**: Retrieved 3 chunks. Deterministic keyword match was unsuccessful.
- **db-no-backup**: Retrieved 3 chunks. Deterministic keyword match was unsuccessful.
- **db-no-test-migration**: Retrieved 3 chunks. Deterministic keyword match was unsuccessful.