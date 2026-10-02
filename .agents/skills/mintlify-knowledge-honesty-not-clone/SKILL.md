---
name: mintlify-knowledge-honesty-not-clone
description: >
  Mintlify State of Knowledge (2026) is a documentation study, not a ThumbGate clone.
  Steal the operational infrastructure FORMAT (66% agent readership, freshness diodes,
  poison detection, non-docs federation) onto existing ThumbGate rails; never vendor
  Mintlify SaaS, build docsite generators, or claim external stats. Slash: /mintlify-knowledge-honesty-not-clone.
---

# Mintlify 2026 State of Knowledge — compare, do not clone

## Goal

Treat developer knowledge as living operational infrastructure: enforce pre-action
freshness diodes on canonical docs (TTL ≤ 90d), detect poison patterns (deprecated APIs,
unsafe shell scripts, unredacted credentials), and gate unverified community forum advice
before agents execute mutating operations.

## Constraints

| NEVER | ALWAYS |
| --- | --- |
| Clone Mintlify / vendor SaaS / build hosted doc generators | Steal the operational knowledge diode FORMAT onto ThumbGate rails |
| Allow agents to act on stale (>90d) unverified documentation | Gate stale canonical docs with `review` before executing tool calls |
| Ingest dangerous snippets (`curl \| sh`, `rm -rf /`) into agent context | Hard `block` on critical poison patterns |
| Trust unverified community forum / ticket hacks for mutating operations | Classify forum snippets into untrusted tiers requiring human confirmation |
| Claim Mintlify's 15k site statistics or 66% readership as ThumbGate data | Attribute findings to Mintlify 2026 report with honest citation |

HARD fail closed. REFUSE docsite generator clones.

## Reference

- https://www.mintlify.com/state-of-knowledge
- `scripts/mintlify-knowledge-honesty.js`
- `docs/agents/mintlify-knowledge-honesty.md`
- `tests/mintlify-knowledge-honesty.test.js`

## Procedures

```bash
# Display FORMAT mapping table
npx thumbgate mintlify-knowledge-honesty --map-only

# Emit machine-readable audit report of docs directory
npx thumbgate mintlify-knowledge-honesty --check-dir docs --json

# Verify with automated unit tests
npm run test:mintlify-knowledge
```
