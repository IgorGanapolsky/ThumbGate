# The Third Author: One Policy, Three Checkpoints (SCANOSS Earnie FORMAT Steal)

> **ThumbGate Architecture Note** | 2026-10-09  
> *Author:* Igor Ganapolsky ([@IgorGanapolsky](https://github.com/IgorGanapolsky))  
> *Format Source:* SCANOSS Earnie ("Your code got a third author", October 2026)  
> *Rule:* Steal the Three Checkpoints & Four-Risk BOM format onto existing rails; never vendor SCANOSS cloud API or `scanoss-py`.

---

## 1. The Core Paradigm: "Your Code Got a Third Author"

Traditional Software Composition Analysis (SCA) assumed two authors:
1. **The Human Engineer:** At the keyboard, accountable, undergoes peer review.
2. **Open Source:** External dependencies arriving with license and vulnerability obligations.

Now there is **The Third Author**:
3. **AI Coding Agents (Claude Code, Cursor, Codex, OpenHands):** Faster than human review, non-deterministic, and fundamentally unaware of your legal, cryptographic, and architectural policies.

Earnie's core insight is that you cannot enforce policies after code is written—the same policy that gates merge in CI must guide the agent at the MCP prompt boundary.

ThumbGate takes this insight and implements it as an **in-line L7 execution firewall (<0.5ms on CPU)** with zero external network calls.

---

## 2. One Policy, Three Checkpoints

```
[The Third Author: AI Agent]
              │
              ▼
   ┌────────────────────────────────────────────────────────┐
   │ Checkpoint 1: MCP / PreToolUse Gate (<0.5ms on CPU)    │
   │  - Intercepts proposed tool calls (Bash/terminal/git)  │
   │  - Blocks copyleft installs (AGPL/GPL) before exec     │
   │  - Injects Permissive Approved Alternatives in context │
   └──────────────────────────┬─────────────────────────────┘
                              │ (pass)
                              ▼
                   [Agent Writes Local Code]
                              │
                              ▼
   ┌────────────────────────────────────────────────────────┐
   │ Checkpoint 2: Git Pre-Commit Hook                      │
   │  - Evaluates staged files against 4-risk taxonomy      │
   │  - Blocks commit on critical violations                │
   │  - Emits: `npx thumbgate explain TG-LIC-XXXX`          │
   └──────────────────────────┬─────────────────────────────┘
                              │ (commit)
                              ▼
                   [Agent Opens Pull Request]
                              │
                              ▼
   ┌────────────────────────────────────────────────────────┐
   │ Checkpoint 3: PR Gate / CI Evaluator                   │
   │  - Evaluates full diff against organizational policies │
   │  - Verdicts: PASS, WARN, REQUIRE_APPROVAL, BLOCK       │
   └────────────────────────────────────────────────────────┘
```

---

## 3. Four Risks, One Record (The BOM Quadrant)

| Risk Dimension | What ThumbGate Detects | Action & Remediation |
| :--- | :--- | :--- |
| **1. AI Models (AIBOM)** | AI SDKs (`@anthropic-ai/sdk`, `openai`), local model weights (`.gguf`, `.safetensors`, `.onnx`), vector DBs. | Automatically cataloged into CycloneDX ML-BOM (`npx thumbgate ai-inventory --format=cyclonedx`). |
| **2. Cryptography & PQC (CBOM)** | Classical algorithms vulnerable to Shor's algorithm (RSA, ECDSA secp256k1, DH) and broken hashes (MD5, SHA-1). | Flags deprecation horizon. Mandates transition to NIST FIPS 203/204 Post-Quantum standards (ML-KEM, ML-DSA). |
| **3. License Compliance (SBOM)** | Restrictive viral copyleft packages (`AGPL-3.0`, `GPL-3.0`, `SSPL-1.0`). | **In-line redirection:** blocks install and injects approved permissive alternatives (e.g. `fast-charts` [AGPL] → `chart.js` [MIT], `recharts` [MIT]). |
| **4. Security Vulnerabilities** | Unpinned versions, `latest` tags, remote pipe-to-bash execution (`curl ... \| bash`). | Hard-blocked at Checkpoint 1 before network execution. |

---

## 4. In-Line Interdiction & Explain Finding CLI

When an agent attempts a non-compliant tool action:

```bash
# Agent tries to install copyleft dependency
npm i fast-charts@4.2.1
```

ThumbGate intercepts the tool call in `PreToolUse` and returns:

```json
{
  "hookEventName": "PreToolUse",
  "permissionDecision": "deny",
  "permissionDecisionReason": "[THIRD-AUTHOR:copyleft-license] Prohibited copyleft dependency 'fast-charts' detected in proposed command. Author: ai_agent. Suggested permissive alternatives: chart.js (MIT) - Simple yet flexible JavaScript charting; recharts (MIT) - Redefined chart library built on React components",
  "findingId": "TG-LIC-3284B1",
  "alternatives": [
    { "name": "chart.js", "license": "MIT", "description": "Simple yet flexible JavaScript charting" },
    { "name": "recharts", "license": "MIT", "description": "Redefined chart library built on React components" }
  ]
}
```

Developers or operators can run `explain` at any time to inspect the full evidence box:

```bash
npx thumbgate explain TG-LIC-3284B1
```

```text
============================================================
ThumbGate Finding Evidence: TG-LIC-3284B1
============================================================
Category:    license_compliance
Severity:    CRITICAL
Checkpoint:  mcp_pretooluse
Author:      ai_agent
Decision:    deny
Reason:      [THIRD-AUTHOR:copyleft-license] Prohibited copyleft dependency 'fast-charts' detected in proposed command. Suggested permissive alternatives: chart.js (MIT); recharts (MIT)

Offending Command:
  npm i fast-charts@4.2.1

Permissive Alternatives (Approved):
  • chart.js [MIT]: Simple yet flexible JavaScript charting
  • recharts [MIT]: Redefined chart library built on React components

Remediation:
  Substitute the non-compliant dependency or algorithm with an approved alternative.
============================================================
```

---

## 5. Verification & Commands

```bash
# Run full Third Author Governance audit across all 3 checkpoints & 4 risks
npx thumbgate third-author

# Run with machine-readable JSON
npx thumbgate third-author --json

# Inspect any finding with raw evidence
npx thumbgate explain <FINDING-ID>

# Run unit tests
node --test tests/third-author-governance.test.js
```
