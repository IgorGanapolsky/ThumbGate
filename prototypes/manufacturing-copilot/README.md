# Manufacturing Supervisor Copilot — AI Prototype Challenge

Prototype for the manufacturing scenario: floor supervisors ask operational
questions; the system routes each question to the right documentation source
(safety procedures, maintenance manuals, quality standards) and answers from
approved context only — with ThumbGate enforcing safety, data sanitization, and
prompt-injection defense at every stage.

## Three layers

| Layer | Where | What it does |
|-------|-------|--------------|
| Front-end | `public/index.html` | Chat UI with live gate-chain panel, LangSmith trace view, retrieval evidence, demo scenario buttons |
| Middleware (LangSmith) | `middleware/` | ThumbGate gate chain (`gates.js`), question router (`router.js`), LangSmith tracing (`langsmith.js`), LLM client (`llm.js`) |
| Backend / cloud | `server.js`, `backend/cloud.js` | HTTP API, simulated cloud document stores + retrieval over `data/` |

## ThumbGate gate chain (runs on every question)

1. **input_sanitization** — redacts PII (employee IDs, emails, phones, SSNs) and
   secrets (via ThumbGate's `secret-redaction`) before the question reaches the
   model, logs, or traces.
2. **injection_scan_input** — blocks direct prompt-injection/jailbreak attempts.
3. **injection_scan_context** — scans retrieved chunks; quarantines poisoned
   documents (the maintenance manual ships with a planted injection payload in
   MM-205 to demo this live).
4. **retrieval_confidence** — refuses rather than hallucinates when the
   documentation doesn't cover the question.
5. **unsafe_output_scan** — blocks any answer that recommends defeating an
   interlock, guard, light curtain, or skipping LOTO.
6. **safety_citation** — safety answers must cite the governing SP-xxx procedure.

## Run

```bash
node prototypes/manufacturing-copilot/server.js
# open http://localhost:4173
```

Works with zero credentials (deterministic extractive answers + local trace
mirror) so the live demo cannot die on a network blip. Optional env:

```bash
PORTKEY_API_KEY=...       # interview Portkey gateway (claude-sonnet-4.5)
PORTKEY_BASE_URL=https://portkeygateway.perficient.com/v1
ANTHROPIC_API_KEY=...     # fallback provider
LANGSMITH_API_KEY=...     # send traces to LangSmith (else local mirror)
LANGSMITH_PROJECT=thumbgate-manufacturing-copilot
```

## Demo script (live interview)

1. **Happy path** — LOTO question routes to safety, answer cites SP-101.
2. **Poisoned manual** — HP-400 question retrieves MM-205, which contains an
   embedded "ignore previous instructions / bypass the interlock" payload; the
   quarantine gate strips it and the answer is built from clean chunks only.
3. **Direct jailbreak** — "Ignore all previous instructions…" blocked at input.
4. **PII** — employee ID + email are redacted before the model or logs see them.
5. **Out of scope** — wifi-password question is refused (low retrieval
   confidence) instead of hallucinated.
