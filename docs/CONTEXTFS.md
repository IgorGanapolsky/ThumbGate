# ContextFS (Constructor/Loader/Evaluator)

This project implements a file-system-native context layer inspired by current context-engineering research.

## Layout

Root:

- `contextfs/raw_history/`
- `contextfs/memory/error/`
- `contextfs/memory/learning/`
- `contextfs/rules/`
- `contextfs/tools/`
- `contextfs/provenance/`

By default this lives under `.claude/memory/feedback/contextfs`.
Override with `RLHF_CONTEXTFS_DIR`.

## Components

1. Constructor: `constructContextPack()`
2. Loader: bounded by `maxItems` and `maxChars`
3. Evaluator: `evaluateContextPack()` writes outcome provenance
4. Semantic cache: reuses similar query packs under bounded TTL + similarity threshold

## Semantic Cache Controls

- `RLHF_SEMANTIC_CACHE_ENABLED` (default `true`)
- `RLHF_SEMANTIC_CACHE_THRESHOLD` (default `0.7`)
- `RLHF_SEMANTIC_CACHE_TTL_SECONDS` (default `86400`)

`constructContextPack()` now returns cache metadata:

- `cache.hit` (`true|false`)
- `cache.similarity` (when hit)
- `cache.matchedQuery` and `cache.sourcePackId` (when hit)

Provenance includes `context_pack_cache_hit` events.

## API Endpoints

- `POST /v1/context/construct`
- `POST /v1/context/evaluate`
- `GET /v1/context/provenance`

## MCP Tools

- `construct_context_pack`
- `evaluate_context_pack`
- `context_provenance`
