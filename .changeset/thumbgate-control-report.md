---
"thumbgate": minor
---

Add `npx thumbgate control`: a read-only report of where ThumbGate keeps your data (project store, older stores, machine-wide files, with sizes), whether the anonymous usage ping is on, where it goes, the exact fields it carries, and how to turn it off (`THUMBGATE_NO_TELEMETRY=1` or `DO_NOT_TRACK=1`). It writes nothing and sends nothing. `--json` for machine output.
