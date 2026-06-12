# Manufacturing Supervisor Copilot — AI Prototype Challenge

Prototype for the manufacturing scenario: floor supervisors ask operational questions; the chatbot itself handles SQL/HNSW vector search over documentation to generate answers. ThumbGate is integrated as the governance layer around the chatbot.

## Core ThumbGate Roles

1. **RLHF feedback layer** (thumbs-up / thumbs-down buttons) - captures operator votes on answer quality directly into the local SQLite memory/lessons database.
2. **Harmful proposed tool-call firewall** (PreToolUse interception) - prevents dangerous commands (like disabling safety interlocks or triggering unauthorized shutdowns) from executing.

ThumbGate does **not** handle RAG retrieval, SQL filters, or token pack planning in this prototype.

## Run

```bash
node prototypes/manufacturing-copilot/server.js
# open http://localhost:3005
```

Works with zero credentials (local deterministic fallback answers) so the demo can run offline. Optional env:

```bash
PORTKEY_API_KEY=...       # Portkey gateway (claude-sonnet-4.5)
PORTKEY_BASE_URL=...      # Portkey base URL
ANTHROPIC_API_KEY=...     # Fallback Claude provider
LANGSMITH_API_KEY=...     # Tracing (falls back to local timeline trace if missing)
LANGSMITH_PROJECT=thumbgate-manufacturing-copilot
```

## Demo Scenarios

1. **Standard RAG Answer & Feedback** — supervisor asks about LOTO press procedures. RAG retrieves and answers. The operator can vote thumbs-up or thumbs-down to capture feedback.
2. **Safety Bypass Attempt** — user requests disabling the safety interlocks on CNC Mill VM-22. Intercepted by ThumbGate PreToolUse and blocked.
3. **Emergency Shutdown Attempt** — user requests triggering emergency line shutdown. Intercepted by ThumbGate PreToolUse and blocked.
