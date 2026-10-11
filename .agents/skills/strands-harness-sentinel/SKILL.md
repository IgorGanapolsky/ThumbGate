---
name: strands-harness-sentinel
description: Autonomous maintenance, self-healing, rate-limit recovery, and capability enhancement for the Strands agent harness (@strands-agents/cli). Enforces 429 exponential backoff, zero-token local Ollama routing, native macOS vision OCR MCP servers, and parity with Antigravity and Grok autonomy.
---

# Strands Harness Sentinel

## Core Mission
Ensure the Strands CLI harness (`@strands-agents/cli`) operates continuously, resiliently, and autonomously without operator intervention. Defend Strands against rate limits, API quota exhaustion, permission prompts, and model deprecation.

Target: Empower Strands to match the speed, vision capability, and execution power of **Google Antigravity** and **xAI Grok**.

---

## 1. System Architecture & Locations

- **Launcher:** `/Users/iganapolsky/.local/bin/strands`
  - Injects `GEMINI_API_KEY` and `GOOGLE_API_KEY` from `~/.zshrc`.
  - Injects `OLLAMA_HOST="http://127.0.0.1:11434"`.
  - Dispatches to `/opt/homebrew/bin/strands` -> `/opt/homebrew/lib/node_modules/@strands-agents/cli/bin/strands.js`.
- **Config:** `~/.strands/cli/config.json`
- **Vision MCP Server:** `/Users/iganapolsky/.strands/mcp/vision-server.mjs`
  - Uses native Swift binary `/opt/homebrew/bin/mac-ocr` (Apple Vision Framework).
  - Sub-300ms OCR execution on any local image or screenshot path.

---

## 2. Rate-Limit Recovery & 429 Self-Healing

### The 15 RPM Problem
Google AI Studio's Free Tier enforces a hard quota of **15 requests per minute (RPM)** for `generate_content_free_tier_requests` on models like `gemini-3.5-flash-lite`. When an agent chains multiple tool calls in rapid succession (e.g. 15 tool calls in 40s), call #16 throws:
```text
HTTP 429: Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 15. Please retry in 2.8s.
```

### Self-Healing Diode
The GenAI client in `/opt/homebrew/lib/node_modules/@strands-agents/cli/node_modules/@google/genai/dist/node/index.mjs` is patched with an exponential retry loop inside `runFetch()`:
```javascript
for (let attemptNum = 0; attemptNum < 4; attemptNum++) {
  try {
    response = await fetchFunc(url, Object.assign({}, requestInit, { signal: attempt.signal }));
    if (response.status === 429 && attemptNum < 3) {
      const waitSec = attemptNum === 0 ? 3 : (attemptNum + 1) * 3;
      await new Promise(r => setTimeout(r, waitSec * 1000));
      continue;
    }
    break;
  } catch (e) {
    if (attemptNum >= 3) { attempt.dispose(); throw e; }
    await new Promise(r => setTimeout(r, 2000));
  }
}
```
**Rule:** When Strands encounters HTTP 429, it must never crash or throw unhandled errors to Ghostty; it must sleep for the required window (3s) and resume execution automatically.

---

## 3. Provider Routing & Local Fallback

### Zero-Token Offline Mode (Ollama)
When cloud quotas are constrained or privacy is paramount, route Strands to local Ollama on `http://127.0.0.1:11434`:
```bash
# High reasoning + tools (14.8B)
strands --model "ollama/qwen2.5:14b"

# General coding + tools (8B)
strands --model "ollama/llama3.1:latest"

# Deep thinking + tool calling (20B)
strands --model "ollama/gpt-oss:20b"
```

### Cloud Gemini Mode
For heavy multimodal / long-context tasks:
```bash
strands --model "google/gemini-flash-lite-latest"
```

---

## 4. Autonomous Autopilot Directives (Antigravity & Grok Parity)

1. **Autonomous Tool Execution:** Keep `"mode": "bypassPermissions"` enabled in `~/.strands/cli/config.json` for autonomous execution; all tool calls remain strictly gated and validated by ThumbGate PreToolUse and Strands Box diodes.
2. **Screenshot Inspection:** When the user supplies screenshot paths (e.g. `/Users/iganapolsky/Desktop/Screenshot...`), Strands must immediately trigger the vision MCP server (`inspect_screenshot`) before taking action.
3. **Evidence-First Verification:** Verify all code changes, test suites, and terminal commands with explicit stdout/stderr evidence before declaring victory.

---

## 5. Strands Box & Dogwood Containment (`strands-box-diode.js`)

Per AWS Open Source announcement (*Introducing Strands Box: AI agent sandboxes powered by Dogwood*), Strands Box provides OS containment paired with fine-grained policy:

- **Taint Tracking & Exfiltration Diode:** When Strands reads sensitive files (`.env`, `credentials`, `customer_data`), the session is marked tainted. Subsequent outbound HTTP calls are blocked unless hitting an explicit local/audit allowlist.
- **Zero-Secret-Egress Credential Injection:** The agent operates with dummy placeholder tokens (`strands_placeholder_token`). The egress gateway injects live Authorization headers (`Bearer ...`) on outbound requests, preventing secret leakage into LLM context.
- **Decomposed Command Interception:** Decomposes compound commands (e.g. `rm -rf`) into individual `fs:delete` events before execution, blocking root or parent directory destruction.
- **Sliding-Window Frequency Caps:** Prevents spam or API flooding (e.g. max 3 Slack alerts per 10 minutes).

Verify with:
```bash
npm run strands-box:doctor
```

---

## 6. Multi-Harness RL Invariants (FineEnvs Steal)

Per Hugging Face *FineEnvs/multi-harness-rl*, models overfit to their native harness and suffer catastrophic format failures when transferring to foreign harnesses.
ThumbGate normalizes tool calls across **Claude Code, Antigravity, Strands, and OpenHands** to canonical quadruplets `(entity, op, target, params)` and calculates cross-harness invariant rewards:

```bash
npm run test:strands-box
```

