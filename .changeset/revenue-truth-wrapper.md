---
"thumbgate": patch
---

ops: `bin/revenue-truth.sh` wrapper — kill the "401 from cloud session" report-loop

Closes a repeatable-skill gap the CEO called out tonight: cloud Claude Code sessions and the bootstrap probe were repeatedly reporting "hosted billing summary returned 401" as if it were news, because `node scripts/revenue-status.js` run from a container without `THUMBGATE_OPERATOR_KEY` always hits 401 and the agent kept treating that as a blocker instead of the expected posture.

The wrapper handles three branches in one place:

1. **Fresh operator key configured** (env OR `~/.config/thumbgate/operator.json`) → runs the canonical `scripts/revenue-status.js` pipeline, exits with its code.
2. **Stale operator key** (file exists OR env var set, but the pipeline falls back to `Source: local-fallback` because the key no longer authenticates against Railway after a rotation) → runs the pipeline, then prints a loud `WARNING — configured operator key authenticated against the LOCAL fallback` block with the exact fix (`node bin/cli.js billing:setup` on the CEO's local machine). Detected by grepping the captured pipeline output for `Source: local-fallback` or `Hosted summary working: no`.
3. **No operator key AND shell looks cloudy** (`$CI`, `$CODESPACES`, `$GITHUB_ACTIONS`, `$CLAUDE_CODE_REMOTE`, or `/home/user/...` on Linux container) → prints a one-paragraph "revenue truth is a local operation by design, run from your own machine, do NOT paste the key here" message and exits **`0`**. Exiting 0 is deliberate: cloud sessions hitting this case is the *expected* posture, not a bug to alarm about.

Refuses to accept the operator key as a CLI argument (exits `64`). Pasting on the command line would leak to shell history; pasting into the Claude transcript would leak to model context. Per CLAUDE.md hard-block rule #2.

Ships with:

- `bin/revenue-truth.sh` (executable, no argv acceptance)
- `npm run revenue:truth` alias in `package.json`
- Troubleshooting block appended to `.claude/skills/revenue-truth/SKILL.md` documenting the three branches + the anti-pattern this exists to prevent (an agent reporting 401 as news across multiple turns).

Smoke-tested in this container: stale-key branch fires the WARNING block correctly. Argv-refusal branch exits 64. Operator key in this container is intentionally stale (Railway rotated; container's `operator.json` still has the old value), and the wrapper now surfaces that loudly instead of silently letting another session conclude "we have no traffic."
