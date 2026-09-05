# Memory vs RAG (Supermemory process steal)

Source format: [Supermemory — Memory vs RAG](https://supermemory.ai/docs/concepts/memory-vs-rag)  
Logged console: `console.supermemory.ai` (Igor Google SSO). **We do not clone Supermemory as a ThumbGate SKU.**

## Contract

| Rail | Answers | ThumbGate surface |
|------|---------|-------------------|
| **RAG** | “What do I know?” — stateless knowledge | Graphify AST graph, grepai, `docs/`, public HTML |
| **Memory** | “What do I remember about you?” — scoped + temporal | Lesson store + four-field scope + temporal decay |
| **Profile** | Always-on facts (not query-similar) | `buildLessonProfile` static + dynamic |

## Isolation

Supermemory `containerTag` ≈ ThumbGate four-field scope encoded as:

`entity:<id>:project:<id>:process:<id>:session:<id>`

Field values must not contain `:`. Incomplete scope → memory rail **fails closed**.

## Dreaming (promotion)

| Mode | Behavior |
|------|----------|
| `dynamic` (default) | Batch related feedback before promotion |
| `instant` | Promote this signal alone immediately |

## CLI

```bash
node scripts/memory-vs-rag-route.js --query "how does PreToolUse work?"
node scripts/memory-vs-rag-route.js --query "what did we decide last time?" \
  --entity alice --project thumbgate --process coder --session s1 --json
npm run memory:vs-rag -- --dreaming dynamic --json
```

## Never

- Treat lesson-store vector hits as a substitute for scoped memory
- Call memory rail without `entityId`/`projectId`/`processId`/`sessionId`
- Vendor Supermemory SaaS as ThumbGate product memory without counsel clearance
