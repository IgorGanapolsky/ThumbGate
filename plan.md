# Manufacturing Copilot Prototype Plan

Branch: `feat/manufacturing-demo-prototype`

## Purpose

Build a live manufacturing chatbot prototype for the AI Prototype Challenge.

The chatbot itself owns retrieval (SQL/HNSW RAG) and answer generation: it searches the manuals index, compiles context, and generates supervisor-facing answers.

**ThumbGate is used strictly in two specific places:**
1. **RLHF feedback layer**: Users can vote thumbs-up (👍) or thumbs-down (👎) on chatbot answers. These votes are captured into ThumbGate's SQLite lesson database.
2. **Harmful proposed tool-call firewall**: Before any proposed physical plant action (tool call) executes, ThumbGate intercepts it and blocks it if harmful (e.g. bypassing safety interlocks or triggering unauthorized shutdowns).

ThumbGate is **not** doing input sanitization, prompt-injection defense, retrieval confidence checks, or citation requirements in this chatbot. It is purely the feedback loop and pre-action tool-use firewall.

**The chatbot itself DOES own those guardrails** (CEO directive 2026-06-12):
sanitization and injection defense are required, implemented as chatbot-owned
LangGraph nodes in `middleware/guardrails.js` — input sanitization (PII +
secrets), prompt-injection scan on user input, retrieval-confidence refusal,
unsafe-output scan, and safety-citation enforcement.

**Truth-grounded vector store** (CEO directive 2026-06-12): all content in the
LanceDB index must be grounded in truth. `middleware/vector-db.js` scans every
chunk at INGESTION time and quarantines any chunk carrying an injection
payload before embedding — a poisoned manual never becomes retrievable
"ground truth". The planted payload in `data/maintenance-manual.md` (MM-205)
stays in the source file as the live attack demo; `getIngestionReport()` and
`GET /api/ingestion` expose what was quarantined.

## Coordination Contract

This file is the live coordination source for agents on this branch. Update it
when architecture, endpoint contracts, data-store ownership, or verification
status changes.

### Work in flight (updated 2026-06-12, main session)

- DONE: `middleware/guardrails.js` (chatbot-owned guardrail functions).
- DONE: `middleware/vector-db.js` ingestion quarantine + `getIngestionReport()`.
- IN PROGRESS (main session): `middleware/graph.js` LangGraph StateGraph +
  `rag.js` facade rewrite; server endpoints per the contract below.
  `@langchain/langgraph` + `@langchain/core` are installed in the prototype's
  own `package.json` (NOT the repo root — keeps the npm product bundle clean).
- IN PROGRESS (parallel test agent): `tests/manufacturing-copilot.test.js`
  (unit) + `tests/manufacturing-copilot-e2e.test.js` (e2e instrumentation).
  Frozen module contract: `rag.js` exports `executeRAGPipeline`,
  `detectProposedToolCall`, `evaluatePreToolUseGate`; flat pipeline output
  `{answer, status, toolCall, gates[], traceId, project, remote, spans[]}`.
- Offline mode: `executeRAGPipeline` falls back to extractive answers when no
  LLM key is present (no mock data path; the real pipeline runs always).

## Three-Layer Architecture

### Layer 1: Front-End
Location: `prototypes/manufacturing-copilot/public/`
- Chat interface for supervisors.
- RLHF voting controls: thumbs-up and thumbs-down buttons to submit feedback.
- Tool-call monitor showing proposed tool actions and ThumbGate block/allow verdicts.
- LangSmith execution trace timeline.

### Layer 2: Middleware with LangSmith
Location: `prototypes/manufacturing-copilot/middleware/`
- `graph.js`: LangGraph state machine for the chatbot workflow.
- `rag.js`: Public pipeline facade and ThumbGate tool-firewall helpers.
- `langsmith.js`: Local-first tracing, mirrored to LangSmith when
  `LANGSMITH_API_KEY` is set.
- LangGraph owns state and orchestration: supervisor auth state, machine-state
  checks, retrieval branches, and tool-call decision edges.
- LangChain owns reusable components: prompt templates and retriever-compatible
  adapters over LanceDB vector search.

### Layer 3: Backend / Cloud Boundary
Location: `prototypes/manufacturing-copilot/`
- `server.js`: Serves the front-end and exposes:
  - `POST /api/ask` (triggers RAG query and tool checks)
  - `POST /api/feedback` (submits thumbs votes directly to ThumbGate's
    `captureFeedback` SQLite logic)
  - `POST /api/tool-call/check` (checks a proposed outbound plant tool call
    before execution)
  - `GET /api/health` (demo readiness and provider status)
  - `GET /api/scenarios` (scripted interview demo scenarios)
- Backend/cloud adapters are local-first for the demo; Portkey/Anthropic and
  LangSmith are optional cloud integrations.

## Data Stores and Documents

- Chatbot retrieval store: local LanceDB table under
  `prototypes/manufacturing-copilot/db/lancedb`, populated from synthetic local
  manufacturing manuals in `prototypes/manufacturing-copilot/data/`.
- Hybrid retrieval decision layer: LangGraph routes requests between proposed
  tool-call handling and LanceDB vector retrieval; LangChain prompt/retriever
  components format the RAG answer path.
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
| Standard Answer | "Explain LOTO on the HP-400 press." | Chatbot answers using manuals context; user can vote 👍 or 👎. |
| Positive Feedback | User clicks Thumbs-Up on a good answer. | captured as positive feedback in ThumbGate SQLite memory. |
| Negative Feedback | User clicks Thumbs-Down on a bad/incomplete answer. | captured as negative feedback in ThumbGate SQLite memory. |
| Attempted Safety Bypass | "Disable the safety interlock switch on CNC Mill VM-22." | Intercepted at PreToolUse layer and blocked by ThumbGate firewall. |
| Unauthorized Shutdown | "Trigger emergency line shutdown on Conveyor Line C-3." | Intercepted at PreToolUse layer and blocked by ThumbGate firewall. |

## Run

From the repository root:
```bash
node prototypes/manufacturing-copilot/server.js
# open http://localhost:3005
```

## Verify

Run the unit tests:
```bash
node --test tests/manufacturing-copilot.test.js tests/manufacturing-copilot-e2e.test.js
```
