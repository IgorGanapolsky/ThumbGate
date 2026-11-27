---
"thumbgate": patch
---

Privacy fixes: `DO_NOT_TRACK=1` now also stops the `cli_init` ping, and telemetry no longer sends the id of a learned or hand-written gate (a learned id contained words from the blocked command). Only ids of gates that ship with ThumbGate are sent; others are sent as `learned` or `custom`.
