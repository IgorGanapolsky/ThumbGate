# ExplainX trending — honest ingest

Source: https://explainx.ai/trending  
Their scores = **their** page views (refreshed ~30 min), **not** ThumbGate ROI.

## Contract

1. Parse live `score` from HTML/RSC — never invent TF-IDF / fake growth %.
2. Map each item onto an **existing** rail or `skip` / `observe`.
3. Zero parsed items → `UNAVAILABLE` (fail closed).
4. Never auto-install third-party skills/MCP from the registry.
5. Do **not** dual-edit mac-yolo `tools/explainx-trending-rag-engine.js` (theater).

## CLI

```bash
npm run explainx:trending -- --fixture tests/fixtures/explainx-trending-rsc-snippet.html --json
npm run explainx:trending -- --fetch --top 10
npm run test:explainx-trending
```

## Highest-ROI steals from 2026-09-04 live top

| Score | Item | ThumbGate action |
|------:|------|------------------|
| 925 | `/limit-reset` (session vs weekly cap) | Honesty in context-budget skills — name which meter resets |
| 87 | `/show-me` visual answers | `.agents/skills/show-me/SKILL.md` |
| 96 | `grill-me` | Maps to intent-contract / spec-first |
| — | Skills + MCP + Loops workshop | Already: context-engineering + GSD/Ralph |

Skip: spy-satellite demos, RSA news, GPT launch blogs, commerce-agent SKUs (ECI).
