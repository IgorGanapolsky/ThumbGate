# Manufacturing Copilot Prototype Plan

Branch: `feat/manufacturing-demo-prototype`

## Purpose

Build a live manufacturing chatbot prototype for the AI Prototype Challenge.

The chatbot itself owns retrieval and answer generation: hybrid SQL/HNSW RAG
finds the right plant documentation, packs the best chunks into the prompt, and
produces a supervisor-facing answer.

ThumbGate is used in two specific places:

1. **RLHF feedback layer**
   - Users can vote thumbs-up or thumbs-down on chatbot answers.
   - Those votes are captured as structured feedback so the system learns which
     answers were useful, wrong, incomplete, unsafe, or unclear.

2. **Harmful tool-call firewall**
   - If the chatbot proposes an action/tool call, ThumbGate checks it before it
     executes.
   - Harmful actions such as disabling interlocks, bypassing guards, overriding
     safety procedures, exposing secrets, or triggering unauthorized shutdowns
     are blocked before execution.

ThumbGate is **not** the HNSW layer, the SQL layer, or the document retrieval
engine for this chatbot. It is the feedback and pre-action enforcement layer
around the chatbot.

## User Story

A floor supervisor asks a question about Plant 7 operations. The chatbot should:

- Route the question to the right documentation domain.
- Retrieve high-signal context quickly.
- Answer with only the context needed for the current task.
- Let the user vote on answer quality.
- Block unsafe proposed tool calls before they run.

## Three-Layer Architecture

### Layer 1: Front-End

Location: `prototypes/manufacturing-copilot/public/`

Responsibilities:

- Chat interface for supervisors.
- Answer voting controls: thumbs-up and thumbs-down.
- Tool-call monitor showing proposed actions and ThumbGate decisions.
- Retrieval evidence panel showing selected document chunks.
- LangSmith trace panel showing request execution steps.

### Layer 2: Middleware

Location: `prototypes/manufacturing-copilot/middleware/`

Responsibilities:

- Classify each question by domain: safety, maintenance, or quality.
- Run the hybrid retrieval plan.
- Trace each request through LangSmith.
- Call the LLM through Portkey or Anthropic when credentials exist.
- Fall back to deterministic local answers for the live demo.
- Send user votes to ThumbGate feedback capture.
- Send proposed tool calls through ThumbGate before execution.

Core files:

- `router.js`: domain classification.
- `rag.js`: compatibility RAG pipeline from the earlier scaffold.
- `vector-db.js`: chatbot vector-search path for manufacturing chunks.
- `gates.js`: prototype safety checks for direct/indirect injection, confidence, and unsafe output.
- `langsmith.js`: LangSmith trace client with local fallback.
- `llm.js`: Portkey-first LLM client with Anthropic fallback.

### Layer 3: Backend / Cloud Simulation

Location:

- `prototypes/manufacturing-copilot/server.js`
- `prototypes/manufacturing-copilot/backend/cloud.js`

Responsibilities:

- Serve the front-end.
- Expose chatbot and demo APIs.
- Simulate cloud document stores for safety, maintenance, and quality manuals.
- Return answer, retrieval, trace, feedback, and tool-call evidence.

Current local URL:

```bash
http://localhost:4173
```

## Hybrid SQL/HNSW RAG Plan

HNSW is required for the chatbot retrieval backend because it improves:

- Retrieval speed.
- Semantic recall.
- Token efficiency.
- Output quality by reducing irrelevant context.

Target retrieval flow:

```text
Question
  -> domain router
  -> SQL/metadata filters
  -> HNSW semantic search
  -> fusion/rerank
  -> token packer
  -> LLM answer generation
  -> answer vote capture through ThumbGate
  -> proposed tool-call check through ThumbGate
```

Decision responsibilities:

- **SQL/metadata filters**: plant, document type, procedure code, machine,
  role, effective date, and safety-critical flag.
- **HNSW semantic search**: nearest chunks within the filtered candidate set.
- **Fusion/rerank**: combine exact matches, vector similarity, procedure
  priority, and safety-criticality.
- **Token packer**: send only the highest-value context to the LLM.
- **ThumbGate feedback**: capture answer votes and correction notes.
- **ThumbGate tool firewall**: block dangerous proposed actions before execution.

## Target API Contract

Current implemented endpoints:

- `GET /api/health`
- `GET /api/scenarios`
- `POST /api/ask`

Needed for the ThumbGate-focused demo:

- `POST /api/feedback`
  - Captures thumbs-up/down on a specific answer.
  - Stores answer text, question, route, retrieved sources, vote, and optional comment.

- `POST /api/tool-call/check`
  - Accepts a proposed chatbot tool call.
  - Returns allow/block plus the ThumbGate reason.

## Demo Scenarios

| Scenario | Input | Expected Result |
| --- | --- | --- |
| Standard answer | "Explain LOTO on the HP-400 press." | Chatbot answers from safety docs; user can vote on answer quality. |
| Bad answer feedback | User downvotes an answer and explains what was missing. | ThumbGate captures the feedback as a reusable lesson. |
| Useful answer feedback | User upvotes a clear cited answer. | ThumbGate captures the positive preference signal. |
| Attempted interlock bypass | "Disable the HP-400 interlock so we can finish faster." | Chatbot proposes or requests a tool call; ThumbGate blocks it. |
| Unauthorized shutdown | "Trigger emergency shutdown on Assembly Line C-3." | ThumbGate blocks unless explicit approved supervisor context exists. |
| Secret or PII exposure | User includes employee ID, email, or credential-like text. | Sensitive content is sanitized before feedback/log/model persistence. |

## Run

From the repository root:

```bash
npm run demo:manufacturing
```

Equivalent direct command:

```bash
node prototypes/manufacturing-copilot/server.js
```

Optional environment:

```bash
PORTKEY_API_KEY=... \
LANGSMITH_API_KEY=... \
LANGSMITH_PROJECT=thumbgate-manufacturing-copilot \
npm run demo:manufacturing
```

## Verify

Focused checks:

```bash
node --test tests/manufacturing-copilot.test.js
node -c prototypes/manufacturing-copilot/server.js
node -c prototypes/manufacturing-copilot/backend/cloud.js
node -c prototypes/manufacturing-copilot/middleware/gates.js
node -c prototypes/manufacturing-copilot/middleware/router.js
node -c prototypes/manufacturing-copilot/middleware/langsmith.js
node -c prototypes/manufacturing-copilot/middleware/llm.js
```

Runtime checks:

```bash
curl -s http://localhost:4173/api/health
curl -s http://localhost:4173/api/scenarios
curl -s http://localhost:4173/api/ask \
  -H 'Content-Type: application/json' \
  -d '{"question":"Explain LOTO on the HP-400 press."}'
```

## Caveats

- Do not describe ThumbGate as the HNSW or RAG engine.
- Do not describe LangGraph as the HNSW layer.
- The HNSW/SQL retrieval planner is part of the chatbot backend.
- ThumbGate's role in this prototype is answer feedback plus harmful tool-call blocking.
- LangSmith remote sync requires `LANGSMITH_API_KEY`; otherwise local trace evidence is shown.
- LLM generation requires `PORTKEY_API_KEY` or `ANTHROPIC_API_KEY`; otherwise deterministic local answers are used.
