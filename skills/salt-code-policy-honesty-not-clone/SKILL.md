---
name: salt-code-policy-honesty-not-clone
description: >
  Salt Code (getsaltcode.com by Salt Security) provides 40 security policies as prompt-time
  context injection, not an execution firewall. Steal the 40-policy taxonomy, OpenAPI query-string
  auth diode, and MCP credential hygiene onto ThumbGate PreToolUse rails. Never install Salt Code MCP
  or route traffic to mcp.getsaltcode.com. Slash: /salt-code-policy-honesty-not-clone.
---

# Salt Code policy honesty — compare, do not clone

## Goal

Compare Salt Code's advisory prompt-time context injection against ThumbGate's deterministic execution-layer
PreToolUse firewall. Steal the 40-policy taxonomy (OWASP API Top 10, OWASP LLM Top 10, MCP Security, OpenAPI Hygiene)
and enforce fail-closed checks when security rules exist only in context without PreToolUse enforcement.

## Constraints

| NEVER | ALWAYS |
| --- | --- |
| Route MCP traffic to `mcp.getsaltcode.com` | Run 100% local stdio/subshell inspection |
| Rely on prompt-only rules (`.cursorrules`) to stop attacks | Enforce deterministic `PreToolUse` execution gates |
| Pass API keys or secrets in URL query parameters (`?apiKey=`) | Enforce `Authorization: Bearer` headers |
| Treat Salt Code as a drop-in substitute for ThumbGate | Distinguish advisory context from active execution firewall |

HARD fail closed. REFUSE SKU clones and cloud dependencies.

## Reference

- https://getsaltcode.com/ (Salt Security, 2026)
- `scripts/salt-code-policy-honesty.js`
- `docs/agents/salt-code-policy-honesty.md`
- ThumbGate Completion Claim Contract in `AGENTS.md` / `GEMINI.md`

## Examples (show, don't tell)

Weak: "Salt Code protects agents by giving them a system prompt with 40 rules."

Gold:
```bash
$ npx thumbgate salt-code-policy-honesty --inspect-context=.cursorrules --json
# Flags context_injection_without_pretool_enforcement if PreToolUse is unconfigured.

$ npx thumbgate salt-code-policy-honesty --map-only --json
# Dumps complete 40-policy taxonomy mapped to deterministic PreToolUse gates.
```

## Procedures

```bash
# Print taxonomy and rail map
npx thumbgate salt-code-policy-honesty --map-only --json

# Audit code, OpenAPI spec, and MCP config
npx thumbgate salt-code-policy-honesty \
  --inspect-code=src/api.js \
  --inspect-api=openapi/spec.yaml \
  --inspect-mcp=.mcp.json \
  --strict

# Run regression test suite
npm run test:salt-code-policy-honesty
```
