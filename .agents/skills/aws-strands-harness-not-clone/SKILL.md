---
name: aws-strands-harness-not-clone
description: >
  AWS Strands Harness (The New Stack 2026-10 / Marc Brooker) is an agent
  runtime architecture, not a ThumbGate clone. Steal the three context-management
  defaults (output shunting <= 350 lines, 75% compaction threshold, in-loop
  recovery) and inject ThumbGate's PreToolUse diode. Never vendor Bedrock-only
  dependencies. Slash: /aws-strands-harness-not-clone.
---

# AWS Strands Harness — FORMAT Steal, Not Clone

## Goal

Provide fail-closed pre-action governance and token-shunted output bounds for agents running on AWS Strands Harness (`@strands-agents/harness` or `strands-harness`), capturing the 45% (and 77% Terminal-Bench 2.1) token savings while preventing destructive tool actions.

## Constraints

| NEVER | ALWAYS |
| --- | --- |
| Clone or install Bedrock-only proprietary packages | Use decoupled providers (Bedrock, Anthropic, OpenAI, Ollama) |
| Allow un-shunted raw tool returns (> 350 lines / 16KB) | Truncate with `evaluateOutputShunt` offset markers |
| Drop durable prevention rules during context compaction | Pin ThumbGate rules across 75% compaction threshold |
| Crash the agent loop on context overflow | Recover in-loop by pruning non-pinned conversational history |
| Execute mutating shell/file tools without governance | Run ThumbGate `PreToolUse` diode before dispatch |
| Claim 77% savings without citing Terminal-Bench 2.1 | Ground benchmarks in measured tool-output reduction |

HARD fail closed. REFUSE un-gated autonomous execution.

## Reference

- The New Stack (2026-10): *AWS open-sources an AI agent it says is 45% cheaper than Claude Code and Codex*
- `scripts/strands-harness-doctor.js`
- `adapters/strands/strands-middleware.js`
- `adapters/strands/config.json`
- `adapters/strands/STRANDS.md`
- `docs/agents/aws-strands-harness.md`

## Usage

```bash
# Audit Strands Harness compliance
node scripts/strands-harness-doctor.js

# Machine-readable output
node scripts/strands-harness-doctor.js --json

# Architectural map
node scripts/strands-harness-doctor.js --map-only

# CI Gate check
node scripts/strands-harness-doctor.js --check
```
