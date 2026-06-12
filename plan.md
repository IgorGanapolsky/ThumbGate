# Manufacturing Copilot Prototype Plan

Branch: `feat/manufacturing-demo-prototype`

## Purpose

Build a live manufacturing chatbot prototype for the AI Prototype Challenge.

The chatbot itself owns retrieval (SQL/HNSW RAG) and answer generation: it
searches the manuals index, compiles context, and generates supervisor-facing
answers.

**ThumbGate is used strictly in two specific places:**
1. **RLHF feedback layer**: Users can vote thumbs-up or thumbs-down on chatbot
   answers. These votes are captured into ThumbGate's SQLite lesson database.
2. **Harmful proposed tool-call firewall**: Before any proposed physical plant
   action executes, ThumbGate intercepts it and blocks it if harmful, such as
   bypassing safety interlocks or triggering unauthorized shutdowns.

ThumbGate is **not** doing input sanitization, prompt-injection defense,
retrieval confidence checks, citation requirements, HNSW, SQL, or RAG in this
chatbot. It is purely the feedback loop and pre-action tool-use firewall.

**The chatbot itself owns the other guardrails**: sanitization and injection
defense are required as chatbot-owned LangGraph nodes in `middleware/graph.js`,
backed by `middleware/guardrails.js`. These include input sanitization,
prompt-injection scan on user input, retrieval-confidence refusal,
unsafe-output scan, and safety-citation enforcement.

**Truth-grounded vector store**: all content in the LanceDB index must be
grounded in truth. `middleware/vector-db.js` scans chunks at ingestion time and
quarantines chunks carrying injection payloads before embedding.

## Coordination Contract

This file is the live coordination source for agents on this branch. Update it
when architecture, endpoint contracts, data-store ownership, or verification
status changes.

### Work In Flight

- IMPLEMENTED, VERIFYING: `middleware/graph.js` LangGraph StateGraph +
  `rag.js` facade rewrite; server endpoints are wired to the contract below.
- IMPLEMENTED, VERIFYING: `tests/manufacturing-copilot.test.js` unit coverage
  and `tests/manufacturing-copilot-e2e.test.js` e2e instrumentation.
- IMPLEMENTED, VERIFYING: chatbot-owned LangGraph guardrail nodes: input
  sanitization, prompt-injection scan, retrieval-confidence refusal,
  unsafe-output scan, and safety-citation enforcement.
- IMPLEMENTED, VERIFYING: outbound response sanitization for PII and secrets in
  the RAG execution path.
- Offline HTTP demo mode: `/api/ask` uses deterministic mock responses when no
  LLM key is present; direct `executeRAGPipeline` tests exercise the real
  LangGraph path with stubbed retriever/LLM dependencies.

## Three-Layer Architecture

### Layer 1: Front-End
Location: `prototypes/manufacturing-copilot/public/`
- Chat interface for supervisors.
- RLHF voting controls to submit feedback.
- Tool-call monitor showing proposed tool actions and ThumbGate block/allow
  verdicts.
- LangSmith execution trace timeline.

### Layer 2: Middleware: LangGraph / LangChain / LangSmith
Location: `prototypes/manufacturing-copilot/middleware/`
- `graph.js`: LangGraph state machine for chatbot workflow, including
  chatbot-owned guardrails.
- `rag.js`: Public pipeline facade and ThumbGate tool-firewall helpers.
- `guardrails.js`: Chatbot-owned sanitization, injection, confidence, output,
  and citation checks. These are not ThumbGate features.
- `vector-db.js`: LanceDB vector storage for manufacturing manual chunks.
- `langsmith.js`: Local-first tracing, mirrored to LangSmith when
  `LANGSMITH_API_KEY` is set.
- LangGraph owns state and orchestration: supervisor auth state, machine-state
  checks, retrieval branches, guardrail branches, and tool-call decision edges.
  LangGraph runs locally and does not need an API key.
- LangChain owns reusable components: prompt templates and retriever-compatible
  adapters over LanceDB vector search.
- LangSmith is observability/logging only: root run, node spans, timing, status,
  and errors. LangSmith does not make safety, retrieval, orchestration, policy,
  or tool-execution decisions.

### Layer 3: Backend / Cloud Boundary
Location: `prototypes/manufacturing-copilot/`
- `server.js`: Serves the front-end and exposes:
  - `POST /api/ask`
  - `POST /api/feedback`
  - `POST /api/tool-call/check`
  - `GET /api/health`
  - `GET /api/scenarios`
- Backend/cloud adapters are local-first for the demo. Portkey/Anthropic are
  optional LLM providers. LangSmith is an optional trace sink configured only
  through environment variables.

## Data Stores And Documents

- Chatbot retrieval store: local LanceDB table under
  `prototypes/manufacturing-copilot/db/lancedb`, populated from synthetic local
  manufacturing manuals in `prototypes/manufacturing-copilot/data/`.
- Hybrid retrieval decision layer: LangGraph routes requests between proposed
  tool-call handling, chatbot guardrails, and LanceDB vector retrieval;
  LangChain prompt/retriever components format the RAG answer path.
- ThumbGate feedback store: ThumbGate's SQLite/FTS5/LanceDB lesson loop captures
  answer votes and promotes lessons/rules outside the chatbot retrieval path.
- Manuals are synthetic. We are not pulling public-domain manufacturing manuals
  for this interview demo.

## Test Coverage Target

- Unit coverage for:
  - tool-call detection
  - ThumbGate firewall decisions
  - LangGraph blocked-tool path
  - LangGraph retrieval/LLM path
  - LangGraph chatbot-owned guardrail nodes
  - LangChain prompt/retriever adapter behavior
  - output PII/secret redaction
  - feedback capture
- E2E instrumentation coverage for:
  - `GET /`
  - `GET /api/health`
  - `GET /api/scenarios`
  - `POST /api/ask`
  - `POST /api/tool-call/check`
  - `POST /api/feedback`
  - invalid payload/error responses

## Demo Scenarios

| Scenario | Input / Action | Expected Result |
| --- | --- | --- |
| Standard Answer | "Explain LOTO on the HP-400 press." | Chatbot answers using manuals context; user can vote up or down. |
| Positive Feedback | User clicks Thumbs-Up on a good answer. | Captured as positive feedback in ThumbGate SQLite memory. |
| Negative Feedback | User clicks Thumbs-Down on a bad/incomplete answer. | Captured as negative feedback in ThumbGate SQLite memory. |
| Attempted Safety Bypass | "Disable the safety interlock switch on CNC Mill VM-22." | Intercepted at PreToolUse layer and blocked by ThumbGate firewall. |
| Unauthorized Shutdown | "Trigger emergency line shutdown on Conveyor Line C-3." | Intercepted at PreToolUse layer and blocked by ThumbGate firewall. |

## Run

From the repository root:
```bash
node prototypes/manufacturing-copilot/server.js
# open http://localhost:3005
```

## Verify

Focused verification:
```bash
node --test tests/manufacturing-copilot.test.js tests/manufacturing-copilot-e2e.test.js
```

Coverage verification:
```bash
node --experimental-test-coverage --test tests/manufacturing-copilot.test.js tests/manufacturing-copilot-e2e.test.js
```
