---
"thumbgate": patch
---

Every thumb counter now reads one function: the status-line stats command, the feedback-loop cache refresh and the unscoped feedback-stats endpoint take their thumb totals from `computeHumanCounts`. A row id listed in `.thumbgate/not-counted-feedback.jsonl` (written by `scripts/not-a-thumb.js`) is left out of every count without editing the log. The status line names the project next to the counts.
