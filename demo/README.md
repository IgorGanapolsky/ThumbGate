# Live demos

## Scale The Vibe / buyer walkthrough

```bash
bash demo/scale-the-vibe-demo.sh          # full (includes MCP)
bash demo/scale-the-vibe-demo.sh --fast   # skip MCP
bash demo/scale-the-vibe-demo.sh --learn  # self-improving beat only
```

Runs in a throwaway sandbox (`HOME` + `THUMBGATE_FEEDBACK_DIR`) so it never
touches real ThumbGate state. Pins `THUMBGATE_STRICT_ENFORCEMENT=1` so hard
blocks are visible (product default is warn-by-default).

### What it proves

1. Builtin catastrophic gates block (secrets, recursive deletes, destructive SQL)
2. Safe work still runs
3. Deterministic decisions (no LLM in the engine)
4. Learning: ALLOW → thumbs-down + force-promote → DENY on the exact command

### Honesty

- Learning beat uses **force-promote** (operator permanent gate).
- Automatic multi-thumbs promotion is a separate path (see PR #3119 for
  tag-pattern enforcement repair). Do not claim auto-promote is fully proven
  until that chain is green.
