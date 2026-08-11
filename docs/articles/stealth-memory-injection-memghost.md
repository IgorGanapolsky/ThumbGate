# Stealth Memory Injection (MemGhost) — What ThumbGate Blocks

**Source paper:** [When Claws Remember but Do Not Tell](https://huggingface.co/papers/2607.05189) (arXiv/HF `2607.05189`).

## Why this matters

Persistent personal agents (OpenClaw, Hermes, NanoClaw, EnterpriseClaw-style runtimes) combine:

1. **Durable memory** (MEMORY.md, AGENTS.md, SOUL.md, USER.md, HEARTBEAT.md, vector Mem0, …)
2. **External tools** (email IMAP/SMTP, web, filesystems)

MemGhost shows a remote attacker can send **one email** that induces the agent to:

- **Inject** poisoned facts or preferences into durable carriers
- Stay **stealthy** in the user-visible reply (no “I saved this to memory”)
- Later **influence** behavior when a separate session loads that memory

Reported held-out success: up to **87.5% E2E** on OpenClaw + GPT-5.4; transfers across frameworks and memory backends; remains effective against several input/model/system defenses.

## How this helps ThumbGate buyers

Ordinary prompt-injection defenses stop *immediate* hijacks. They miss **silent durable writes**. ThumbGate’s pre-action engine is the right control plane:

| Paper stage | ThumbGate control |
|-------------|-------------------|
| Injection into durable carriers | Structural gate `block-stealth-memory-injection-from-external` |
| Stealth language (“do not tell”, “silently save”) | Pattern match in `scripts/stealth-memory-injection-gate.js` |
| External provenance (email/IMAP/tool_result) | Provenance signals + source flags |
| Preference / fact poisoning | Poison-language heuristics |
| Operator exception | Explicit approval flag or env override |

## Implementation

- **Module:** `scripts/stealth-memory-injection-gate.js`
- **Wire-in:** `scripts/gates-engine.js` (sync + async structural path)
- **Template:** `config/gate-templates.json` id `block-stealth-memory-injection-from-external`
- **Tests:** `tests/stealth-memory-injection-gate.test.js`
- **Claw adapter notes:** `adapters/claw/CLAW.md`

## What we do *not* claim

- We do not re-implement WhisperBench’s full 108-case IMAP lab.
- We do not claim 0% MemGhost transfer success against every frontier model.
- We claim a **deterministic, inspectable pre-action deny** on the high-availability write path that the paper proves is the attacker’s durable foothold.

## Operator override

Only for explicit human review:

```bash
export THUMBGATE_ALLOW_STEALTH_MEMORY_INJECTION=1
# or tool input: { "stealthMemoryInjectionApproved": true }
```
