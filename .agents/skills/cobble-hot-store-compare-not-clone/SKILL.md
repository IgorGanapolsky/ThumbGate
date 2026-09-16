---
name: cobble-hot-store-compare-not-clone
description: >
  CobbleDB (Perplexity 2026-09) is a batch-read hot store, not a ThumbGate
  clone. Steal the three-plane FORMAT (durable state / batched delivery /
  query-time MultiGet + hedge + hot subset) onto existing lesson rails; never
  vendor RocksDB, YTsaurus, Pillar, or Lorry. Slash: /cobble-hot-store-compare-not-clone.
---

# CobbleDB — compare, do not clone

## Goal

Produce fail-closed honesty for whom: ThumbGate agents writing feedback or
serving lessons — so processing never contends with PreToolUse reads, batch
lookups hedge slow sources, and only promoted/matchable records occupy the
hot path.

## Constraints

| NEVER | ALWAYS |
| --- | --- |
| Clone CobbleDB / Pillar / Lorry / RocksDB / YTsaurus | Map planes onto existing lesson rails |
| Write processing output onto `hybrid-feedback-context` | Durable log → `feedback-to-memory` → retrieval |
| Sequential per-key hot reads of a batch | `batchGetPrepared` (partition + hedge) |
| Dump raw `feedback-log.jsonl` into retrieval | `promoted_matchable` (or `fresh_high_value`) subset |
| Overwrite embedding/chunk versions | Coexist representations |
| Dual-edit DIRTY lesson-graph PR #3650 | Leave graph layer alone |
| Quote Perplexity 5× / 20% as ours | Measure ThumbGate rails with `perf-budget-check` |
| Hero Continuity / net-new storage SKU | ECI: existing retrieval rails only |

HARD fail closed. REFUSE SKU clones.

## Reference

- https://www.perplexity.ai/hub/blog/cobbledb
- `scripts/cobble-hot-store-split.js`
- `scripts/lesson-retrieval.js` · `scripts/feedback-to-memory.js` · `scripts/memory-vs-rag-route.js`
- `docs/agents/cobble-hot-store-split.md`
- `/high-roi-steal-and-finish` · `/eci-thumbgate-ip-wall`

## Examples (show, don't tell)

Weak: Summarize CobbleDB and add a RocksDB cluster class.

Gold:

```bash
$ npx thumbgate cobble-hot-store-split --json
ok: true
status: ready
$ node --test tests/cobble-hot-store-split.test.js
# processing → hot write → coupled_processing_hot_write deny
```

## Procedures

```bash
npx thumbgate cobble-hot-store-split --json
npx thumbgate cobble-hot-store-split --map-only
npx thumbgate cobble-hot-store-split --trace=tests/fixtures/cobble-hot-store-split-coupled.json --json
npx thumbgate cobble-hot-store-split --keys=lesson-1,lesson-2 --json
npm run test:cobble-hot-store-split
```

1. Classify every write as `durable`, `delivery`, or `hot`.
2. Deny processing → hot coupling.
3. Require batched MultiGet (+ hedge) for ≥3 serving keys.
4. Keep the hot subset to promoted/matchable records.
5. Refuse `--clone-cobbledb`.

## Rubric

- gold default (this repo) → `ok=true`, `status=ready`
- `--trace` coupled fixture → `ok=false`, `coupled_processing_hot_write`
- `--clone-cobbledb` → `ok=false`, `cobble_clone_refused`
- sequential ≥3-key hot read → `sequential_hot_batch`
- unbounded hot subset → `unbounded_hot_subset`
- doctor: `npm run test:cobble-hot-store-split` PASS
- evidence: command output in the same turn
