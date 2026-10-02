# Salt Code Security Policy Honesty (FORMAT steal)

Source: https://getsaltcode.com/ (Salt Security, 2026)

## Overview

Salt Code positions as "Free AI Security Guardrails for Coding Agents" (Cursor, Claude Code, Copilot CLI, Windsurf, VS Code), leveraging Salt Security's background as co-authors and contributors to the OWASP API Security Top 10.

However, Salt Code operates as a **prompt-time context injection layer** via a remote MCP server (`https://mcp.getsaltcode.com/mcp`). It injects advisory rules into the prompt window.

### The Fundamental Vulnerability (ThumbGate Moat)

When an agent suffers from **context drift, indirect prompt injection, or mathematical distress**, it ignores advisory context instructions and executes destructive tool calls (`rm -rf`, force-pushing `main`, exfiltrating secrets).

**ThumbGate operates at the execution layer (`PreToolUse` hook).** ThumbGate is the active Infrastructure Firewall that intercepts tool execution and deterministically blocks unauthorized commands, regardless of what the LLM hallucinates or decides to run.

## Transfers (FORMAT only)

| Salt Code Feature | ThumbGate Rail | Architectural Verdict |
|---|---|---|
| **40 Security Policies** across OWASP API & LLM Top 10 | Deterministic inspection gates in `scripts/salt-code-policy-honesty.js` | Full 40-policy taxonomy stolen and codified into static and runtime checks. |
| **Context Guidelines Injection** | `context_injection_without_pretool_enforcement` | Flags when security rules exist only in instructions (`.cursorrules`) without `PreToolUse` hooks. |
| **OpenAPI / Query Auth Diode** | `query_string_secret_auth` gate | Blocks API keys, passwords, and tokens passed in URL query strings (OWASP API2/OAS01). |
| **Remote Cloud MCP Server** | `salt_cloud_dependency_refusal` | Refuses dependencies on `mcp.getsaltcode.com`; keeps all enforcement 100% local, zero-token, and offline. |
| **MCP Credential Redaction** | `unredacted_mcp_credentials` | Scans `.mcp.json` and agent configurations for plaintext secrets and unencrypted `http://` endpoints. |
| **1-Click Deep Links & 16 Agents** | `generateAgentOnboardingConfig` | Native 1-click Cursor (`cursor://`) & VS Code (`vscode:`) deep links + configs for all 16 major AI agents. |
| **Prompt Alternative Rewriter** | `evaluatePromptSecurity` | Intercepts dangerous prompts at design time and suggests secure architectural alternatives. |

## 40-Policy Taxonomy

The doctor evaluates code, API contracts, and MCP manifests against 4 core tiers:
1. **OWASP API Security Top 10 (2023):** BOLA (`API1:2023`), Broken Auth (`API2:2023`), BOPLA/Mass Assignment (`API3:2023`), Unrestricted Resource Consumption (`API4:2023`), BFLA (`API5:2023`), Sensitive Business Flows (`API6:2023`), SSRF (`API7:2023`), Security Misconfiguration/CORS (`API8:2023`), Improper Inventory Management (`API9:2023`), Unsafe Consumption (`API10:2023`).
2. **OWASP Top 10 for LLM Applications (2025):** Prompt Injection (`LLM01:2025`), Sensitive Information Disclosure (`LLM02:2025`), Supply Chain Vulnerabilities (`LLM03:2025`), Data and Model Poisoning (`LLM04:2025`), Improper Output Handling (`LLM05:2025`), Excessive Agency (`LLM06:2025`), System Prompt Leakage (`LLM07:2025`), Vector and Embedding Weaknesses (`LLM08:2025`), Misinformation (`LLM09:2025`), Unbounded Consumption (`LLM10:2025`).
3. **MCP Security Guidelines:** Mandatory tool auth, parameter credential redaction, TLS transport, least privilege, config isolation, mutation tiers, stdio hygiene, rate caps, cryptographic receipts, zero remote cloud dependency.
4. **OpenAPI Contract Hygiene:** Query-string secret prohibition, strict Authorization header enforcement, strict schemas, error disclosure sanitizer, CORS without wildcards, rate-limit response headers, path versioning, payload size caps, HTTPS exclusivity, execution-time PreTool enforcement.

## Commands

```bash
# Print the 40-policy taxonomy and architecture rail map
npx thumbgate salt-code-policy-honesty --map-only --json

# Intercept and rewrite insecure prompts before code is generated
npx thumbgate salt-code-policy-honesty \
  --eval-prompt="Design me a delete user API with token in query string" \
  --json

# Generate 1-click onboarding deep links and native configs for 16 AI agents
npx thumbgate salt-code-policy-honesty --onboarding=cursor --deeplinks --vibe-stats --json

# Inspect source code, OpenAPI specs, and MCP configs
npx thumbgate salt-code-policy-honesty \
  --inspect-code=src/api.js \
  --inspect-api=openapi/spec.yaml \
  --inspect-mcp=.mcp.json \
  --json

# Strict mode (exit 1 on any failure)
npx thumbgate salt-code-policy-honesty --strict

# Run unit tests
node --test tests/salt-code-policy-honesty.test.js
```

## Out of Scope

- Installing Salt Code MCP or directing traffic to `mcp.getsaltcode.com`.
- Requiring operator work emails or remote token registration.
- Treating prompt-time guidelines as a replacement for ThumbGate's `PreToolUse` firewall.
