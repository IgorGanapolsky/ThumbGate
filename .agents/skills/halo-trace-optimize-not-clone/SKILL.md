---
name: halo-trace-optimize-not-clone
description: >
  HALO (inference.net/products/halo) is a trace-optimization model, not a ThumbGate
  clone. Steal the Trace-to-Fix FORMAT (mine redundant tool thrashing, retry stalls,
  expensive spans, unhandled denies -> rank by impact -> synthesize pre-action gates)
  onto existing audit-trail / auto-promoted-gates rails. Never vendor Inference.net,
  Catalyst SDK, or cloud OTLP export. Slash: /halo-trace-optimize-not-clone.
---

# HALO Trace Optimizer — compare, do not clone

## Goal

Analyze real agent trace logs (`audit-trail.jsonl`, `action-log.jsonl`) to detect
repeated failure modes (tool loops, cascading retries, runaway spans) and synthesize
concrete, executable pre-action gates and eval fixtures before cost or damage compounds.

## Constraints

| NEVER | ALWAYS |
| --- | --- |
| Clone Inference.net Catalyst / cloud backend | Map trace analysis onto local `audit-trail.jsonl` |
| `pip install inference-net` / import `engine.agents` | Pure local node analysis in `scripts/halo-trace-optimizer.js` |
| Export prompt traces over the network | Local receipts + shadow audit |
| Quote vendor optimization numbers as ours | Measure local task-outcomes and prevented loop calls |
| Require human 👎 for obvious tool thrashing | Automatically detect 3+ duplicate calls and propose gate |

HARD fail closed. REFUSE SKU clones.

## Reference

- https://inference.net/products/halo/
- `scripts/halo-trace-optimizer.js`
- `scripts/auto-promote-gates.js` · `scripts/gates-engine.js` · `scripts/agent-action-inventory.js`
- `.thumbgate/auto-promoted-gates.json`

## Examples (show, don't tell)

Weak: Install an external observability agent and wait for cloud report.

Gold:

```bash
$ npx thumbgate halo-trace-optimizer --json
ok: true
tracesAnalyzed: 42
failureModesFound: 2
$ npx thumbgate halo-trace-optimizer --clone-halo --json
halo_clone_refused
```

## Procedures

```bash
npx thumbgate halo-trace-optimizer --json
npx thumbgate halo-trace-optimizer --map-only
npx thumbgate halo-trace-optimizer --apply --json
npm run test:halo-trace-optimizer
```
