---
"thumbgate": patch
---

fix(feedback): stop the claude-history-sync fallback from mass re-importing rotated signals

The history auto-capture fallback re-imported every historical thumbs signal
each time `~/.claude/history.jsonl` rotated or shrank: the saved byte offset
became invalid, the whole file re-scanned from zero, the processed-id ledger
(capped at 512) had evicted the old ids, and the text dedup only matched
inside a 5-minute timestamp window over the last 250 feedback lines. The
result was the repeated "claude-history-sync auto-capture-fallback" junk
entries observed 18x in this repo's lesson DB and 44x in mac-yolo-safeguards.

Three changes, each regression-tested (rotation test fails on the old code):

- Rotation guard: when the history file is smaller than the size recorded at
  the last sync, skip past the rotated content instead of re-reading from
  byte zero. First runs (no recorded size) still bootstrap-scan once.
- Identical text at length 20+ with the same signal now dedupes regardless of
  the timestamp gap; short bare signals ("thumbs up") stay window-bound so a
  human can legitimately repeat them on another day.
- Ledger capacity raised: processed-id cap 512 -> 4096, dedup read window
  250 -> 1000 feedback lines.
