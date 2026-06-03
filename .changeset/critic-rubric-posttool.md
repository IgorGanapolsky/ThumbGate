---
"thumbgate": minor
---

Add Critic/Rubric PostToolUse hook (`scripts/gates/critic-rubric-posttool.js`) — an independent auto-judge that evaluates every coding-agent tool call against a fixed rubric and writes a structured auto-thumbs-down to `.thumbgate/auto-feedback.jsonl` on any violation. Closes the RLHF loop without requiring a human click.

Default rubric ships with four clauses:
- `no-secret-write` — writes to `.env`/`secrets`/credential paths, or file bodies containing `sk_live_*` / `sk-*` / `AKIA*`
- `no-destructive-bash` — `rm -rf` against system paths (allows `/tmp`, `/var/folders`); force-push to protected branches without `--force-with-lease`
- `no-bare-curl-pipe-sh` — `curl|sh` / `wget|bash` remote-script execution
- `edit-result-not-empty` — Edit/Write that reported no-op (likely a missed target)

Operators can extend by writing `.thumbgate/rubric.js` that exports `{ rubric: [...] }`. Each clause is a pure predicate `(ctx) => { pass: bool, reason }`. No I/O. No agent self-evaluation — the critic is independent of the actor.

Pattern source: "Critic/Rubric" from the dynamic-workflows analysis. Pairwise + self-judging by the same agent introduces self-preferential bias; an independent rubric does not.

Wire into `.claude/settings.json` under `PostToolUse` to enable.
