# ThumbGate demo video

`thumbgate-demo.mp4`: 40.5 s, 1280x720, no audio. Recorded from a real run of the shipped CLI (`bin/cli.js`) in a
throwaway HOME, project and feedback folder (`docs/launch/.demo-sandbox/run-<time>`, git-ignored). No real
feedback log is read or written. Rebuild: `bash docs/launch/demo/record.sh` (needs asciinema, agg, ffmpeg).

Files: `demo/demo.sh` (session script), `demo/fmt.js` (selects and wraps real output, adds no words; hides
license and upgrade notices), `demo/payload.json` (the tool call), `thumbgate-demo.cast` (raw recording; the GIF intermediate is not kept),
`thumbgate-demo-transcript.txt` (exact on-screen text), `frames/` (5 extracted frames).

## On-screen claims and what backs them

| On screen | Backed by |
|---|---|
| Step 1 "default: warns": gate flags the download-and-run command | Real `gate-check` output `[GATE:stateful-helper-script-bypass] WARNING`; the CLI says "warn-by-default mode ... flagged and logged, not blocked" (hidden line, still in the cast) |
| Step 2 thumbs-down stored | Real `capture --feedback=down --json` output: `"ok": true, "signal": "down", "actionType": "store-mistake"` |
| Step 3 "carries your lesson (still warns)" | Real second `gate-check` output adds "Past mistakes relevant to this action" with the lesson text; same warning, no deny |
| Step 4 "Strict enforcement ON ... blocked" | Command shows `THUMBGATE_STRICT_ENFORCEMENT=1`; real output `decision: DENY` from `THIRD-AUTHOR:untrusted-pipe-to-shell` |
| Closing line | Summarizes steps 1 to 4 |

## Limits to know

- The strict-mode block comes from a built-in pipe-to-shell rule, not from the learned lesson. The video does not claim otherwise. Strict mode was set only in that one child command, never on this machine.
- The unflagged first run is a warning, not proof the thumbs-down changed behaviour: the warning text is the same until the lesson appears in step 3.
- `gate-check` is fed a tool-call JSON on stdin, the same interface agent hooks use; the video shows no agent.
- Free tier: the CLI prints license notices on stderr, hidden in the video.
