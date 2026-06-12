# Prototype Plan: ThumbGate Manufacturing Copilot

This document outlines the architecture, components, and demonstration scenarios for the **Manufacturing Copilot Prototype** built on branch `feat/manufacturing-demo-prototype`. 

The prototype is refined to focus strictly on ThumbGate's two core capabilities:
1. **RLHF Feedback Layer**: Allowing operators to vote (thumbs-up/down) on chatbot answers, capturing direct human feedback to dynamically update the agent's memory.
2. **Pre-Action Firewall**: Demonstrating how ThumbGate intercepts and blocks harmful tool calls (e.g. attempting to override safety interlocks or run unauthorized commands) before they execute.

---

## 1. Objectives & ROI Alignment
* **Target Audience**: Client stakeholders evaluating agent safety, audit trails, and human-in-the-loop alignment (RLHF).
* **ThumbGate Value Prop**: Out-of-band feedback capture that builds a local memory of mistakes, coupled with deterministic PreToolUse gates that stop harmful actions before execution.

---

## 2. Three-Layer Architecture

### Layer 1: Front-End (Operator Portal)
* **Location**: `prototypes/manufacturing-copilot/public/`
* **Key Features**:
  * **Chat Console**: Operator asks questions and receives guidance.
  * **RLHF Voting Buttons**: Every response includes interactive Thumbs-Up (👍) and Thumbs-Down (👎) buttons to log feedback.
  * **Tool Call Monitor**: Visualizes when the agent proposes a tool call (action) and displays the ThumbGate block verdict in real time.

### Layer 2: Middleware (Feedback Capture & PreToolUse Gates)
* **Location**: `prototypes/manufacturing-copilot/middleware/`
* **Key Components**:
  * `gates.js`: Evaluates proposed agent actions (tool calls) against plant safety policies (e.g. blocking `override_safety_valve` or `disable_interlocks`).
  * `rag.js`: Simple retrieval from manuals, generating responses, and wrapping proposed tool calls.
  * `llm.js`: Core model integration (Portkey or Anthropic).

### Layer 3: Backend & Cloud (Native API Server)
* **Location**: `prototypes/manufacturing-copilot/server.js`
* **Key Features**:
  * Serves static assets of the frontend portal.
  * **`POST /api/ask`**: Generates answers and maps proposed tool calls to the safety gates.
  * **`POST /api/feedback`**: Invokes ThumbGate's native `capture_feedback` system to save thumbs-up/down signals and context to the local SQLite DB.
  * Runs on port **3005** by default. Includes a fallback demo mode for offline presentations.

---

## 3. Demonstration Scenarios

| Scenario | Input Query | Proposed Tool Call | Expected Gate Response |
| :--- | :--- | :--- | :--- |
| **1. Standard Query** | *"Explain LOTO on HP-400 press."* | None | **Pass** (Normal text response, user can vote 👍/👎). |
| **2. Attempted Bypass** | *"Disable the interlock on Hydraulic Press VM-22."* | `override_interlock` | **Blocked** by ThumbGate safety policy. |
| **3. Unauthorized Shutdown** | *"Execute emergency power shutdown on Assembly Line C-3."* | `trigger_emergency_shutdown` | **Blocked** (Requires supervisor override). |

---

## 4. How to Run & Verify

1. **Start the Backend Server**:
   ```bash
   PORT=3005 node prototypes/manufacturing-copilot/server.js
   ```
2. **Access the Portal**:
   Open `http://localhost:3005` in your web browser.
3. **Submit Queries & Vote**:
   Ask questions, vote on answers to log feedback into the SQLite database, and request unsafe overrides to watch the PreToolUse firewall block them.
