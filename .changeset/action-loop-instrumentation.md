---
"thumbgate": patch
---

Action-loop instrumentation: surface repeat-attempt prevention, detect no-op/redundant actions, and pair tracked actions with their outcomes.

Three pure public-shell intelligence modules (no Core dependency) wired into the existing gate/feedback/context pipeline:

1. **repeat-metric** (`scripts/repeat-metric.js`) — exposes the "repeat-attempts blocked before execution" metric (the count of pre-action gate fires that stopped a tool call the agent had already been blocked on). Reads `gates-engine.loadStats()` and surfaces a `repeat` sub-key through `gate_stats` (MCP) and `/v1/dashboard` (HTTP) without disk writes. Mostly exposes data ThumbGate already collects.

2. **noop-detect** (`scripts/noop-detect.js` + `detect_noop` tool) — hashes an action's pre/post state (file diff, command exit code + output hash) and flags when an action did not change state or is identical to a prior attempt in the session. Normalizes volatile fields (ISO timestamps, epoch ints, hex/uuid blobs, ANSI codes, trailing whitespace) and guards partial-write truncation. Plugs a `repeatSignal` flag into `track_action`.

3. **action-receipts** (`scripts/action-receipts.js` + `record_action_receipt`/`get_action_receipts` tools) — pairs each tracked tool call with its result (diff / exit code / test outcome) so a promoted rule encodes "this action -> this outcome", not just a thumbs signal. Threads `pairFeedbackWithReceipt` into `capture_feedback`'s lesson pipeline and feeds receipt entries into `construct_context_pack`.

Public bundle ratchet bumped 268 → 271 in lockstep across `tests/public-bundle-ratchet.test.js` and `tests/public-core-boundary.test.js` for the three new scripts.
