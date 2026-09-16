# Cobble hot-store split (FORMAT steal)

Doctor: `npx thumbgate cobble-hot-store-split --json`

Steals the **three-plane storage protocol** from [CobbleDB (Perplexity, 2026-09)](https://www.perplexity.ai/hub/blog/cobbledb) — durable document state, batched update delivery, query-time batched reads — and maps it onto **existing** ThumbGate lesson rails. This is a compare-not-clone doctor. It does **not** clone CobbleDB, Pillar, Lorry, RocksDB, YTsaurus, or DynamoDB. Not affiliated.

Perplexity's production 5× / 20% figures are **theirs**. Do not quote them as ThumbGate measurements.

## Plane → rail map

| Plane | Cobble analog | ThumbGate rails |
|-------|---------------|-----------------|
| durable | Pillar (versioned document state, subset membership) | `feedback-log.jsonl`, `memory-log.jsonl`, `feedback-schema.js` |
| delivery | Lorry (partition-aligned batches, independent ingest) | `feedback-to-memory.js`, `memory-vs-rag` `dreaming=dynamic`, `compact-memory-store.js` |
| hot | CobbleDB (MultiGet + replica hedge, no transactions) | `lesson-retrieval.js`, `hybrid-feedback-context.js`, `config/performance-budgets.json` |

## Fail closed

| Finding | When |
|---------|------|
| `coupled_processing_hot_write` | Processing writes prepared records onto the hot store |
| `missing_delivery_plane` | Durable → hot ingest with no batched export |
| `sequential_hot_batch` | ≥3 serving keys fetched one-by-one |
| `unbounded_hot_subset` | Raw feedback log dumped into retrieval |
| `version_overwrite` | New embedding/chunk version clobbers the previous |
| `hot_transactions` | Hot path requests transactions / synced replicas |
| `cobble_clone_refused` | Clone/install CobbleDB, RocksDB cluster, or YTsaurus |

A batched read of ≥5 keys without `hedgeMs` is a warning (`missing_hedge`), not a pass dressed as ready-without-caveat.

## CLI

```bash
npx thumbgate cobble-hot-store-split --json
npx thumbgate cobble-hot-store-split --map-only
npx thumbgate cobble-hot-store-split --trace=tests/fixtures/cobble-hot-store-split-gold.json --json
npx thumbgate cobble-hot-store-split --keys=lesson-1,lesson-2 --json
npm run test:cobble-hot-store-split
```

## Skill

`.agents/skills/cobble-hot-store-compare-not-clone/SKILL.md` — `/cobble-hot-store-compare-not-clone`
