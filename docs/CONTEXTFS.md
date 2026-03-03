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

## API Endpoints

- `POST /v1/context/construct`
- `POST /v1/context/evaluate`
- `GET /v1/context/provenance`

## MCP Tools

- `construct_context_pack`
- `evaluate_context_pack`
- `context_provenance`
