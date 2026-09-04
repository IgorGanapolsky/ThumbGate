---
name: zvec-grep-compare-not-clone
description: >
  zg (zvec-grep) is a local-first search layer (ripgrep + BM25 + vector), not a
  ThumbGate clone. Steal the four-route FORMAT onto existing rails; never install
  @zvec/zvec-grep. Slash: /zvec-grep-compare-not-clone.
---

# zvec-grep — compare, do not clone

## When
Qwen zg, zvec-grep, MarkTechPost zvec, unify ripgrep BM25 vector, local-first search layer.

## Do
```bash
npx thumbgate workspace-search-route --query="<intent or symbol>" --json
npx thumbgate workspace-search-route --query="<symbol>" --rg --execute
```

Map routes to existing rails (see `docs/agents/code-search.md`):
- `--rg` → ripgrep / Grep
- `--fts` → filesystem-search / BM25F
- `--vector` → LanceDB (local); remote needs `THUMBGATE_ALLOW_REMOTE_EMBED=1`
- `--hybrid` → pragmatic-hybrid-search RRF (default)
- `--graph` → Graphify AST graph

## Never
- `npm install -g @zvec/zvec-grep` inside ThumbGate
- Claim ThumbGate is zg / zvec
- Dual-edit DIRTY lesson-graph PR #3650
- Silent remote embeddings

## Source
https://github.com/zvec-ai/zvec-grep (Apache-2.0) — FORMAT only; not affiliated.
