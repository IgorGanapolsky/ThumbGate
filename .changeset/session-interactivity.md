---
"thumbgate": patch
---

feat(metrics): measure what the user waited, not what the server was busy for

Adds `src/session-interactivity.js`, implementing the two rates NVIDIA's
SemiAnalysis AgentX methodology reports side by side:

- **Standard Interactivity** — "output tokens divided by the elapsed time from
  the first token to the last"
- **E2E Normalized Interactivity** — "average output-token rate per user over
  the full request, calculated by dividing total output tokens by the time from
  request submission to final-token delivery"

Standard starts the clock at the first token, so queue time, scheduling, and a
runner that has not claimed the work yet are all invisible to it. **The gap
between the two rates is user wait the system does not currently count.**

## Why this is not theoretical

2026-08-25, production: a task was created 17:34:08Z and completed 17:34:53Z.
Execution was quick and the UI advertised a "90s lease", so every server-side
measure said healthy. The user spent 45 seconds watching a spinner that read
"Waiting for the fenced VPS runner to pick this up."

Standard Interactivity scores that request at ~100 tok/s. E2E scores it at ~11.
The test suite pins that ~9x divergence using the incident's real timestamps, so
this class of defect becomes a number instead of a screenshot.

## Session-level, because agentic traffic is not request-shaped

Also from AgentX: "Agentic sessions are long, stateful, and variable: they chain
model calls, tool use, and growing context rather than following a fixed
prompt-and-response pattern" — their sample session grows ~60K to ~400K tokens,
and a single agentic request is cited at ~15x the tokens of ordinary chat.

So the module aggregates whole sessions and **keeps tool gaps in the
denominator**: a tool call the user waits through is wait, whoever executes it.
A serving stack does not get to subtract offloaded time from its own score.

Also included:
- `contextGrowth` — reports first/last prompt tokens and the growth factor,
  which a fixed 8K-in/1K-out benchmark cannot show.
- `compareRuns` — refuses to compare two runs unless they replayed the same
  sessions in the same order. AgentX: "Because every system receives the same
  recorded traffic, observed differences reflect the serving stack rather than
  benchmark-specific tuning." Comparing over different traffic measures the
  traffic.

## Fails closed

One unmeasurable turn makes the whole session `UNKNOWN`, never fast — measuring
only the good turns would understate the wait, which is the original failure
mode. A zero-length generation window yields a `null` rate rather than
`Infinity`, since an unmeasurable rate is not an infinitely fast one.

14 tests. Not wired into the dashboard yet; this lands the metric and its
contract first.

Note: this bumps the three npm file-count ceilings 512 -> 513 and the size
ceiling 8.01 -> 8.03 MB (main sits at 99.9% of the old size limit). PR #3667
makes the same +1 claim, so whichever lands second needs a one-line rebase.
