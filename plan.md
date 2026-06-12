# Manufacturing Copilot Prototype Plan

Branch: `feat/manufacturing-demo-prototype`

## Purpose

Build a live manufacturing chatbot prototype for the AI Prototype Challenge.

The chatbot itself owns retrieval (SQL/HNSW RAG) and answer generation: it searches the manuals index, compiles context, and generates supervisor-facing answers.

**ThumbGate is used strictly in two specific places:**
1. **RLHF feedback layer**: Users can vote thumbs-up (👍) or thumbs-down (👎) on chatbot answers. These votes are captured into ThumbGate's SQLite lesson database.
2. **Harmful proposed tool-call firewall**: Before any proposed physical plant action (tool call) executes, ThumbGate intercepts it and blocks it if harmful (e.g. bypassing safety interlocks or triggering unauthorized shutdowns).

ThumbGate is **not** doing input sanitization, prompt-injection defense, retrieval confidence checks, or citation requirements in this chatbot. It is purely the feedback loop and pre-action tool-use firewall.

## Two-Layer Architecture

### Layer 1: Front-End
Location: `prototypes/manufacturing-copilot/public/`
- Chat interface for supervisors.
- RLHF voting controls: thumbs-up and thumbs-down buttons to submit feedback.
- Tool-call monitor showing proposed tool actions and ThumbGate block/allow verdicts.
- LangSmith execution trace timeline.

### Layer 2: Backend & Middleware
Location: `prototypes/manufacturing-copilot/`
- `server.js`: Serves the front-end and exposes:
  - `POST /api/ask` (triggers RAG query and tool checks)
  - `POST /api/feedback` (submits thumbs votes directly to ThumbGate's `captureFeedback` SQLite logic).
- `middleware/rag.js`: Runs the chatbot RAG pipeline (LanceDB search + LLM response). Intercepts proposed tool calls and runs them through the PreToolUse safety gate.
- `middleware/vector-db.js`: LanceDB vector storage for manuals search.
- `middleware/langsmith.js`: Minimally traces runs locally and mirrors them.

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
node --test tests/manufacturing-copilot.test.js
```
