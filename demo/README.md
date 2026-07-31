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

### What it proves (A+)

1. Builtin catastrophic gates block (secrets, recursive deletes, destructive SQL)
2. Safe work still runs
3. Deterministic decisions (no LLM in the engine)
4. **Self-improving:** 3× thumbs-down with entity tags → auto-promote → DENY
   - Pattern matches the **command**, not the tag key (inert-gate fix)

### Honesty

- Control-layer learning only (no model retrain)
- Auto-promoted gates expire; force-promote remains the permanent operator path
- Demo writes three feedback rows into the sandbox log (same JSONL promote reads)
  so free-tier capture caps cannot hide the loop mid-meeting
