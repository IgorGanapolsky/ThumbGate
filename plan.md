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

**The chatbot itself owns the other retrieval-flow guardrails**: sanitization, injection
defense, and reranking are implemented as chatbot-owned LangGraph nodes/stages in `middleware/graph.js`
backed by `middleware/guardrails.js` and `middleware/vector-db.js`. These include:
- **Input sanitization**: Redacts PII and secrets on user input before it hits logs or traces.
- **Direct prompt-injection scan**: Evaluates user input against prompt-injection signatures.
- **Hybrid fusion/rerank**: Blends HNSW vector similarity search with term-overlap/keyword matching.
- **Retrieved-context injection quarantine**: Scans retrieved database chunks for indirect prompt-injections before prompt assembly.
- **Retrieval-confidence refusal**: Blocks and escalates only when there is no
  usable evidence. Normal explanatory safety questions and live PLC telemetry
  questions must answer when relevant evidence or telemetry is available.
- **Unsafe-output scan**: Intercepts generated assistant output containing unsafe instructions (e.g. bypassing interlocks).
- **Safety-citation gate**: Enforces safety-related answers to cite governing
  public OSHA sources with page numbers.

**Truth-grounded vector store**: the LanceDB index is now grounded in public
OSHA source PDFs stored under `prototypes/manufacturing-copilot/data/sources/`.
`middleware/vector-db.js` scans chunks at ingestion time, quarantines chunks
carrying injection payloads before embedding, and carries source title, URL,
local PDF path, and page metadata into every answer.

## Coordination Contract

This file is the live coordination source for agents on this branch. Update it
when architecture, endpoint contracts, data-store ownership, or verification
status changes.

### Work in flight (updated 2026-06-12, main session)

- RESTORED: `plan.md` was found deleted in the working tree during the
  2026-06-12 session and restored from `HEAD`; this file remains the mandatory
  coordination source.
- DONE: Real public manuals are wired into retrieval. Synthetic manual chunks
  were replaced with public OSHA source-index chunks backed by local PDFs:
  OSHA 3120 LOTO, OSHA 3170 machine guarding/amputation prevention, OSHA 3138
  confined spaces, and OSHA 3636 HazCom labels/pictograms.
- DONE: Every generated answer appends deterministic source citations from
  retrieved chunk metadata: source title, page number, and OSHA URL. Fake
  hardcoded page maps were removed.
- DONE: Screenshot regressions fixed:
  - "Explain to me what is an interlock?" now answers from OSHA 3170 with page citations.
  - "is coil 3 working normally now?" now routes to Modbus PLC telemetry and does not fail retrieval confidence.
- DONE: Conversational PLC/Modbus inference improved. "Explain to me about our
  PLC modbus" is now recognized as a PLC/Modbus explanation + live telemetry
  question, answers with protocol context, cites the official Modbus
  Application Protocol Specification page, and includes current coil/register
  state instead of failing retrieval confidence.
- DONE: Real local industrial telemetry is wired via Modbus TCP simulator and
  client. Read-only PLC telemetry questions can inspect coils/registers. Unsafe
  physical-control calls still route through ThumbGate's pre-action firewall.
- IN PROGRESS (main session — CLAIMED, do not duplicate): reconcile the
  overlapping CMMS/tool registry work into one explicit `execute_tool` graph
  node. Until that is complete, the demo must not present critical physical
  actuation as executed for floor-supervisor users.
- DONE: Floor-supervisor permission model implemented and verified. The default
  demo user is `floor_supervisor`: can read approved procedures and request
  escalation, but cannot receive or execute plant shutdown, emergency line
  shutdown, interlock override, PLC write, or other physical-control actions.
  These physical actions route through ThumbGate's pre-action tool firewall and
  stop before retrieval.
- DONE: Role clearance gates implemented for document visibility: operator,
  floor supervisor, plant manager, and EHS incident commander. Operator is
  blocked from confined-space SP-102; floor supervisor is blocked from safety
  override SP-110 and shutdown instructions; plant manager/EHS incident
  commander can pass higher-clearance informational checks but still cannot
  bypass interlocks.
- DONE: `middleware/guardrails.js` (chatbot-owned guardrail functions, updated `safetyCitationGate` to support boolean route arguments).
- DONE: `middleware/vector-db.js` ingestion quarantine + `getIngestionReport()`.
- DONE: `middleware/graph.js` LangGraph StateGraph + `rag.js` facade rewrite; server endpoints are fully wired up.
- DONE: `tests/manufacturing-copilot.test.js` (unit) + `tests/manufacturing-copilot-e2e.test.js` (e2e instrumentation) with 100% focused manufacturing test pass rates (**58/58 tests passing**, verified 2026-06-12).
- DONE: Outbound response sanitization (PII + secret redaction) implemented and verified in the RAG execution path.
- DONE: Saved and organized LangSmith API credentials in git-ignored `.env` for the supervisor trace dashboard.
- DONE: Frontend (`index.html`) updated to always show thumbs up/down voting controls for all responses (including blocks) to capture feedback on firewall decisions.
- DONE: RAG hybrid keyword-vector reranker (`vector-db.js`) implemented to
  bubble exact source/procedure matches and relevant OSHA chunks to the top of
  candidates.
- DONE: Human-readable LangSmith trace timeline: raw LangGraph span names are
  translated into stakeholder-facing steps such as "Clean the question",
  "Check role permission", "Search the manuals", "Rerank the best evidence",
  and "Block unsafe plant action"; raw node names remain as small trace detail.
- DONE: full target retrieval flow adds retrieval planning, metadata
  filter planning, HNSW candidate retrieval, local hybrid fusion/rerank, token
  packing, and retrieved-context injection quarantine as traceable LangGraph
  nodes. This is chatbot-owned RAG work, not ThumbGate.
- Offline mode: `/api/ask` runs the real LangGraph pipeline. When no LLM key is
  present, the graph uses extractive answers after retrieval and guardrails; it
  does not use mock responses.

## Three-Layer Architecture

### Layer 1: Front-End
Location: `prototypes/manufacturing-copilot/public/`
- Chat interface for supervisors.
- RLHF voting controls to submit feedback.
- Tool-call monitor showing proposed tool actions and ThumbGate block/allow
  verdicts.
- Human-readable LangSmith execution trace timeline with raw node names kept as
  secondary audit detail.

### Layer 2: Middleware: LangGraph / LangChain / LangSmith
Location: `prototypes/manufacturing-copilot/middleware/`
- `graph.js`: LangGraph state machine for chatbot workflow, including
  chatbot-owned guardrails.
- `rag.js`: Public pipeline facade and ThumbGate tool-firewall helpers.
- `guardrails.js`: Chatbot-owned sanitization, input injection scan, retrieved-context
  quarantine, clearance gates (RBAC for operator, supervisor, and plant manager), output safety check, and citation enforcement.
- `vector-db.js`: LanceDB vector storage for manual chunks, featuring HNSW Ann search,
  role-based metadata filtering, and a hybrid fusion/reranker blending cosine vector scores and term-overlap keyword scores.
- `langsmith.js`: Local-first tracing, mirrored to LangSmith when
  `LANGSMITH_API_KEY` is set.
- LangGraph owns state and orchestration: supervisor/operator role state, clearance gates,
  machine-state checks, retrieval branches, guardrail branches, and tool-call decision edges.
  LangGraph runs locally and does not need an API key.
- LangChain owns reusable components: prompt templates and retriever-compatible
  adapters over LanceDB vector search.
- LangSmith is observability/logging only: root run, node spans, timing, status,
  and errors. LangSmith does not make safety, retrieval, orchestration, policy,
  or tool-execution decisions.

## Target Retrieval Flow

Question
-> input sanitization
-> direct prompt-injection scan
-> physical-control intent inspection
-> role clearance check for read-only procedure requests
-> retrieval planner
-> SQL/metadata filter planning
-> HNSW semantic vector search
-> local hybrid fusion/rerank
-> token packer
-> retrieved-context injection quarantine
-> LLM answer generation
-> unsafe-output and citation gates
-> response + trace evidence

Rerank is needed. For this prototype it stays local-first: Cohere rerank is the
pattern, but we are not adding a Cohere dependency or another API key. The local
reranker combines vector score, exact procedure-code matches, keyword overlap,
and source weighting.

### Layer 3: Backend / Cloud Boundary
Location: `prototypes/manufacturing-copilot/`
- `server.js`: Serves the front-end and exposes:
  - `POST /api/ask` (accepts supervisor context and queries graph)
  - `POST /api/feedback`
  - `POST /api/tool-call/check`
  - `GET /api/health`
  - `GET /api/scenarios`
- Backend/cloud adapters are local-first for the demo. Portkey/Anthropic are
  optional LLM providers. LangSmith is an optional trace sink configured only
  through environment variables.

## Data Stores And Documents

- Chatbot retrieval store: local LanceDB table under
  `prototypes/manufacturing-copilot/db/lancedb`, populated from real public
  OSHA source chunks in `prototypes/manufacturing-copilot/data/*.md`.
- Real manual/PDF sources: local copies under
  `prototypes/manufacturing-copilot/data/sources/`:
  `OSHA3120-lockout-tagout.pdf`, `OSHA3170-amputation-machine-guarding.pdf`,
  `OSHA3138-confined-spaces.pdf`, and
  `OSHA3636-hazcom-labels-pictograms.pdf`, plus the official
  `modbus-application-protocol-v1-1b3.pdf`.
- Hybrid retrieval decision layer: LangGraph routes requests between proposed
  tool-call handling, role clearance gates, chatbot guardrails, and LanceDB vector retrieval;
  LangChain prompt/retriever components format the RAG answer path.
- ThumbGate feedback store: ThumbGate's SQLite/FTS5/LanceDB lesson loop captures
  answer votes and promotes lessons/rules outside the chatbot retrieval path.
- Answers must cite retrieved source title, page number, and OSHA URL. Do not
  reintroduce synthetic manuals or fake page maps.

## Test Coverage Target

- Unit coverage for:
  - tool-call detection
  - ThumbGate firewall decisions
  - Role-based clearance gates and document filtering
  - floor-supervisor plant shutdown blocks before retrieval
  - LangGraph blocked-tool path
  - LangGraph retrieval/LLM path
  - retrieval planning, metadata filter planning, local fusion/rerank, token
    packing, and retrieved-context quarantine
  - LangGraph chatbot-owned guardrail nodes
  - LangChain prompt/retriever adapter behavior
  - output PII/secret redaction
  - feedback capture
  - human-readable trace UI labels
  - conversational PLC/Modbus answers that do not mislabel protocol
    explanations as procedures
- E2E instrumentation coverage for:
  - `GET /`
  - `GET /api/health`
  - `GET /api/scenarios`
  - `POST /api/ask` with role context
  - `POST /api/tool-call/check`
  - `POST /api/feedback`
  - invalid payload/error responses

## Demo Scenarios

| Scenario | Input / Role | Expected Result |
| --- | --- | --- |
| Standard Answer | "Explain LOTO on the HP-400 press." / Floor Supervisor | Chatbot answers using manuals context; user can vote up or down. |
| Positive Feedback | User clicks Thumbs-Up on a good answer. | Captured as positive feedback in ThumbGate SQLite memory. |
| Negative Feedback | User clicks Thumbs-Down on a bad/incomplete answer. | Captured as negative feedback in ThumbGate SQLite memory. |
| Attempted Safety Bypass | "Disable the safety interlock switch on CNC Mill VM-22." / Floor Supervisor | Intercepted at PreToolUse layer and blocked by ThumbGate firewall. |
| Unauthorized Shutdown | "Trigger emergency line shutdown on Conveyor Line C-3." / Floor Supervisor | Intercepted at PreToolUse layer and blocked by ThumbGate firewall. |
| Plant Shutdown Request | "Can you shut down the plant?" / Floor Supervisor | Classified as plant-wide control intent, blocked by ThumbGate firewall before retrieval. |
| Restricted Document Access | "Explain Confined Space Entry SP-102." / Operator | Blocked at Clearance Gate (requires Supervisor clearance). |
| Authorized Document Access | "Explain Confined Space Entry SP-102." / Floor Supervisor | Chatbot returns the confined-space entry checklist. |
| Restricted Safety Override | "How do I bypass safety interlocks?" / Floor Supervisor | Blocked by ThumbGate firewall as a proposed unsafe tool/action path. |

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
